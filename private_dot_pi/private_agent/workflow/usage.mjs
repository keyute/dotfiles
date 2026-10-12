import { basename } from "node:path";
import { getCurrentSystemMessage } from "@earendil-works/pi-ai";
import { estimateTokens } from "@earendil-works/pi-coding-agent";
import { truncateToWidth as truncate } from "@earendil-works/pi-tui";
import { formatReset, longWindow, readRateLimits, windowLabel } from "./footer.mjs";
import { formatTokens, modelLabel, rpcCall } from "./fleet.mjs";
import { PAD, TURN_GLYPH, formatDuration, pad } from "./rows.mjs";

// The shape is docs/pi-design.md's /usage bullet: plan limits, context and
// cost as three π blocks. The entry stores numbers; the layout is per width.
const SEP = " · ";
const WINDOW_NAMES = { ses: "Session", wk: "Weekly" };
const WARN_PERCENT = 90;
// Below this width the % column goes, then lines truncate.
const NARROW = 48;
const TOP = 3;
const MESSAGE_ROLES = { toolResult: "tool results", assistant: "assistant" };

// pi has no tokenizer; its own estimateTokens is chars ÷ 4 too.
const estimate = text => Math.ceil((Array.isArray(text) ? text.map(part => part.text ?? "").join("") : text ?? "").length / 4);
const top = (counts, format) => [...counts].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, TOP).map(([name, n]) => `${name} ${format(n)}`).join(SEP);
const fit = (text, width) => truncate(text, width, "…");
const tokenText = n => formatTokens(n) ?? "0";

export const formatMoney = usd => `$${usd < 0.1 ? usd.toFixed(4) : usd.toFixed(2)}`;

// The current branch's context, split by the system message's own sections.
// The headline is pi's real count; Messages takes what the system-side
// estimate leaves of it, so the rows sum to the headline. When the real count
// is below that estimate, the system rows shrink to it and Messages is 0.
// Right after a compaction pi has no count, and the sum of estimates stands in.
export function contextUsage(ctx) {
  const messages = ctx.sessionManager.buildSessionProjection().messages;
  const system = getCurrentSystemMessage(messages);
  const { project_context: project = "", skills = "", ...rest } = system?.sections ?? {};
  const promptEstimate = estimate(system?.content) + Object.values(rest).reduce((sum, text) => sum + estimate(text), 0);
  const toolEstimates = (system?.toolsAdded ?? []).map(tool => [tool.name, estimate(JSON.stringify(tool))]);
  const files = new Map();
  for (const [, path] of project.matchAll(/<project_instructions path="([^"]+)">/g)) files.set(basename(path), (files.get(basename(path)) ?? 0) + 1);
  const roles = new Map([["tool results", 0], ["assistant", 0], ["user", 0]]);
  for (const message of messages) {
    if (message.role === "system") continue;
    const role = MESSAGE_ROLES[message.role] ?? "user";
    roles.set(role, roles.get(role) + estimateTokens(message));
  }
  const systemSide = promptEstimate + toolEstimates.reduce((sum, [, n]) => sum + n, 0) + estimate(project) + estimate(skills);
  const estimatedMessages = [...roles.values()].reduce((sum, n) => sum + n, 0);
  const real = ctx.getContextUsage()?.tokens ?? null;
  const used = real ?? systemSide + estimatedMessages;
  const scale = n => (used < systemSide ? Math.round((n * used) / systemSide) : n);
  const prompt = scale(promptEstimate);
  const tools = toolEstimates.map(([name, n]) => [name, scale(n)]);
  const toolTokens = tools.reduce((sum, [, n]) => sum + n, 0);
  const messageTokens = Math.max(0, used - systemSide);
  const share = n => (estimatedMessages ? Math.round((messageTokens * n) / estimatedMessages) : 0);
  return {
    model: ctx.model?.id,
    window: ctx.model?.contextWindow ?? 0,
    used,
    estimated: real == null,
    parts: [
      { label: "System prompt", tokens: prompt },
      { label: "Tools", tokens: toolTokens, tail: top(tools, tokenText) },
      { label: "Project context", tokens: scale(estimate(project)), tail: [...files].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(SEP) },
      { label: "Skills", tokens: scale(estimate(skills)) },
      { label: "Messages", tokens: messageTokens, tail: top([...roles].map(([role, n]) => [role, share(n)]), tokenText) },
    ],
  };
}

const addUsage = (totals, usage) => {
  totals.cost += usage.cost?.total ?? 0;
  totals.input += usage.input ?? 0;
  totals.output += usage.output ?? 0;
  totals.cacheRead += usage.cacheRead ?? 0;
  totals.cacheWrite += usage.cacheWrite ?? 0;
};
const emptyUsage = () => ({ cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

// Main is pi's own assistant usage over every entry, not just the branch: money
// spent on an abandoned branch was spent, as pi's own /session counts it.
// Subagents come from pi-subagents' cost report (null when it gave none).
export function sessionCost(entries, report) {
  const main = emptyUsage();
  const models = new Map();
  const byModel = (key, usage) => {
    if (!models.has(key)) models.set(key, emptyUsage());
    addUsage(models.get(key), usage);
    addUsage(main, usage);
  };
  for (const entry of entries) {
    const message = entry.type === "message" ? entry.message : null;
    if (message?.role === "assistant" && message.usage) byModel(modelLabel(message.responseModel ?? message.model) ?? "other", message.usage);
    else if (entry.type === "usage") byModel(modelLabel(entry.model) ?? "other", entry.usage);
    // Only web_fetch: subagent tool results carry child usage the cost report already counts.
    else if (message?.role === "toolResult" && message.toolName === "web_fetch" && message.usage) byModel("summaries", message.usage);
    else if ((entry.type === "compaction" || entry.type === "branch_summary") && entry.usage) byModel("summaries", entry.usage);
  }
  const agents = new Map();
  for (const child of report?.children ?? []) agents.set(child.agent ?? "unknown", (agents.get(child.agent ?? "unknown") ?? 0) + 1);
  const unavailable = report?.unresolvedAsyncChildren ?? 0;
  return {
    total: main.cost + (report?.childTotal.cost ?? 0),
    main,
    models: models.size > 1 ? [...models].map(([model, usage]) => ({ model, ...usage })) : [],
    subagents: report && { cost: report.childTotal.cost, runs: report.children.length + unavailable, agents: [...agents], unavailable },
  };
}

// pi-subagents' documented `cost` RPC (docs/extension-api.md): it walks the
// current branch only, and its childTotal is a lower bound for nested spend.
async function subagentCost(events) {
  const ping = await rpcCall(events, "ping");
  return ping?.capabilities?.cost?.version === 1 ? rpcCall(events, "cost") : null;
}

export async function readUsage(pi, ctx, { readLimits = readRateLimits, now = Date.now() } = {}) {
  return {
    at: now,
    limits: await readLimits(),
    context: contextUsage(ctx),
    cost: sessionCost(ctx.sessionManager.getEntries(), await subagentCost(pi.events)),
  };
}

const percent = (part, whole, digits = 0) => `${(whole ? (100 * part) / whole : 0).toFixed(digits)}%`;
const bar = (fraction, width, theme, colour = "accent") => {
  const used = Math.max(0, Math.min(width, Math.round(fraction * width)));
  return theme.fg(colour, "━".repeat(used)) + theme.fg("dim", "─".repeat(width - used));
};
const head = (title, rest, theme) => `${theme.fg("accent", TURN_GLYPH)} ${title}${rest ? theme.fg("muted", `${SEP}${rest}`) : ""}`;

function planLines({ at, limits }, theme, width) {
  if (!limits) return [theme.fg("dim", `${TURN_GLYPH} Plan${SEP}unavailable`)];
  const barWidth = Math.max(8, Math.min(24, width - 46));
  return [head("Plan", "ChatGPT", theme), ...limits.map(window => {
    const label = windowLabel(window.windowMins);
    const weekday = longWindow(window);
    const reset = formatReset(window.resetsAt, { weekday });
    const until = !weekday && window.resetsAt ? ` (in ${formatDuration(window.resetsAt * 1000 - at)})` : "";
    const colour = window.usedPercent >= WARN_PERCENT ? "warning" : "accent";
    const figure = theme.fg("muted", `${String(window.usedPercent).padStart(5)}%${reset ? `   resets ${reset}${until}` : ""}`);
    return fit(`${PAD}${pad(WINDOW_NAMES[label] ?? label, 10)}${bar(window.usedPercent / 100, barWidth, theme, colour)}${figure}`, width);
  })];
}

function contextLines({ model, window, used, estimated, parts }, theme, width) {
  const narrow = width < NARROW;
  const row = (label, tokens, tail) => fit(`${PAD}${pad(label, 16)}${theme.fg("muted", `${tokenText(tokens).padStart(7)}${narrow ? "" : percent(tokens, window, 1).padStart(8)}${tail ? `   ${tail}` : ""}`)}`, width);
  const headline = `${estimated ? "~" : ""}${tokenText(used)} / ${tokenText(window)} tokens (${percent(used, window, 1)})`;
  return [
    fit(head("Context", [modelLabel(model), headline].filter(Boolean).join(SEP), theme), width),
    `${PAD}${bar(window ? used / window : 0, Math.max(0, Math.min(62, width - PAD.length)), theme)}`,
    ...parts.filter(part => part.tokens > 0).map(part => row(part.label, part.tokens, part.tail)),
    row("Free", Math.max(0, window - used)),
  ];
}

function costLines({ total, main, models, subagents }, theme, width) {
  const row = (label, cost, tail) => fit(`${PAD}${pad(label, 12)}${theme.fg("muted", `${formatMoney(cost).padStart(8)}${tail ? `   ${tail}` : ""}`)}`, width);
  const tokens = usage => {
    const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
    return [`${tokenText(prompt)} in`, `${tokenText(usage.output)} out`, prompt && `${percent(usage.cacheRead, prompt)} cached`].filter(Boolean).join(SEP);
  };
  const lines = [fit(head("Cost", formatMoney(total), theme), width), row("Main", main.cost, tokens(main))];
  // Indented under Main: the per-model lines are its parts, not further spend.
  for (const usage of models) lines.push(row(`  ${usage.model}`, usage.cost, tokens(usage)));
  if (!subagents) lines.push(fit(`${PAD}${pad("Subagents", 12)}${theme.fg("muted", "unavailable")}`, width));
  else if (subagents.runs) {
    // The unavailable count leads the tail so truncation never takes it: it
    // is what marks the figure as a lower bound.
    const runs = `${subagents.runs} run${subagents.runs === 1 ? "" : "s"}${subagents.unavailable ? ` (${subagents.unavailable} unavailable)` : ""}`;
    lines.push(row("Subagents", subagents.cost, [runs, top(subagents.agents, String)].filter(Boolean).join(SEP)));
  }
  return lines;
}

export function usageLines(data, theme, width) {
  return [...planLines(data, theme, width), "", ...contextLines(data.context, theme, width), "", ...costLines(data.cost, theme, width)];
}

// Re-laid out on each paint, so a resize or theme switch applies.
export const usageComponent = (data, theme) => ({ render: width => usageLines(data, theme, width), invalidate() {} });
