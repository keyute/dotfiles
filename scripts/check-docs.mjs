// Mechanical half of the doc-authoring doctrine in AGENTS.md ("Authoring agent
// instructions"): line budgets, dated annotations, why-span shape, and
// cross-file duplication. The prose gates (observed failure, durable intent)
// stay with the audit skill; only what a linter can decide lives here.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const INTENT_MAX_LINES = 8;
const WHY_MAX_LINES = 8;
const WHY_MAX_DATES = 1;
const SHINGLE_WORDS = 14;
const PREVIEW_WORDS = 8;
const HARNESS_DOC_MAX_LINES = 120;
const HARNESS_BULLET_MAX_LINES = 8;
const VERIFIED_MAX_AGE_DAYS = 90;
const AUDIT_OPEN_AFTER_DAYS = 60;
// rendered lines; the Claude projection was 119 before the 2026-09-15 cut
const PROJECTION_MAX_LINES = 100;
const YAML_COMMENT_MAX_RUN = 5;
const LINE_BUDGETS = {
  "docs/pi-implementation.md": 150,
  "docs/pi-design.md": 200,
  "AGENTS.md": 120,
  "docs/agents-baseline.md": 250,
};

const BASELINE = "docs/agents-baseline.md";
const AUDIT_LOG = "docs/agents-audit-log.md";
const AGENTS_YAML = ".chezmoidata/agents.yaml";
const HARNESS_DOCS = [
  "private_dot_claude/docs/harness.md.tmpl",
  "private_dot_codex/docs/harness.md.tmpl",
  "private_dot_pi/agent/docs/harness.md.tmpl",
];
const PROJECTIONS = [
  "private_dot_claude/CLAUDE.md.tmpl",
  "private_dot_codex/AGENTS.md.tmpl",
  "private_dot_pi/agent/AGENTS.md.tmpl",
];
const DUPLICATE_GLOBS = [
  "docs/*.md",
  "private_dot_claude/docs/*.md.tmpl",
  "private_dot_codex/docs/*.md.tmpl",
  "private_dot_pi/agent/docs/*.md.tmpl",
  ".chezmoitemplates/**/*.md",
  "AGENTS.md",
];
// Generated from the live sandbox config, so its phrasing repeats by design.
const DUPLICATE_EXEMPT = new Set([
  "private_dot_claude/docs/sandbox.md.tmpl",
  "private_dot_pi/agent/docs/sandbox.md.tmpl",
]);
// The projection restates the baseline's intent lines by design; drift between
// the two is the audit skill's job, not this lint's.
const DUPLICATE_EXEMPT_PAIRS = [
  ["docs/agents-baseline.md", ".chezmoitemplates/agent-instructions.md"],
];
const PAIR_SEPARATOR = "\u0000";

const EVIDENCE_PATTERNS = [
  [/arXiv/i, "cites arXiv"],
  [/\d+%/, "cites a percentage"],
  [/#\d{4,}/, "cites an issue number"],
];
const DATE = /\b20\d\d-\d\d-\d\d\b/g;

const finding = (check, file, line, message) => ({ check, file, line, message });

const readIfExists = (root, file) => {
  const path = join(root, file);
  return existsSync(path) ? readFileSync(path, "utf8") : null;
};

const toLines = (text) => {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

// True for fence delimiters and every line between them. A fence closes only
// on the same delimiter character at the opening length or longer, so a
// three-backtick example inside a four-backtick block stays masked.
const fencedMask = (lines) => {
  let open = null;
  return lines.map((line) => {
    const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      const [char, length, rest] = [fence[1][0], fence[1].length, fence[2]];
      // A closing fence carries nothing after the delimiter.
      const closes = open !== null && open.char === char && length >= open.length && rest.trim() === "";
      if (!open) open = { char, length };
      else if (closes) open = null;
      return open !== null || closes;
    }
    return open !== null;
  });
};

const globToRegExp = (pattern) => {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, PAIR_SEPARATOR)
    .replace(/\*/g, "[^/]*")
    .replace(new RegExp(PAIR_SEPARATOR, "g"), "(?:[^/]+/)*");
  return new RegExp(`^${source}$`);
};

const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.isFile() ? [path] : [];
  });

const glob = (root, pattern) => {
  const segments = pattern.split("/");
  const wildcard = segments.findIndex((segment) => segment.includes("*"));
  if (wildcard === -1) return existsSync(join(root, pattern)) ? [pattern] : [];
  const base = join(root, ...segments.slice(0, wildcard));
  if (!existsSync(base) || !statSync(base).isDirectory()) return [];
  const matches = globToRegExp(pattern);
  return walk(base)
    .map((path) => relative(root, path))
    .filter((path) => matches.test(path))
    .sort();
};

// Infinity for a date that is not a real calendar day or lies in the future, so
// a typo reads as stale rather than as fresh forever.
const ageDays = (iso) => {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== iso || t > Date.now()) return Infinity;
  return (Date.now() - t) / 86_400_000;
};

// A principle bullet runs from its `- **Name**:` line to the next bullet,
// heading, or blank line.
const principleBullets = (lines, mask) => {
  const bullets = [];
  for (let start = 0; start < lines.length; start += 1) {
    if (mask[start] || !/^- \*\*[^*]+\*\*/.test(lines[start])) continue;
    let end = start + 1;
    while (end < lines.length && !/^(- |#)/.test(lines[end]) && lines[end].trim() !== "") {
      end += 1;
    }
    bullets.push({ start, end });
  }
  return bullets;
};

// The why is the italic span opened by `*Why`; it closes on the first line at
// or after the marker that ends the italic.
const whySpan = (lines, { start, end }) => {
  let marker = -1;
  for (let i = start; i < end; i += 1) {
    if (lines[i].includes("*Why")) {
      marker = i;
      break;
    }
  }
  if (marker === -1) return null;
  for (let i = marker; i < end; i += 1) {
    const text = i === marker ? lines[i].slice(lines[i].indexOf("*Why") + 4) : lines[i];
    if (text.trimEnd().endsWith("*")) return { marker, close: i };
  }
  return { marker, close: end - 1 };
};

const checkBaselineWhys = (root) => {
  const text = readIfExists(root, BASELINE);
  if (text === null) return [];
  const lines = toLines(text);
  const mask = fencedMask(lines);
  const findings = [];
  for (const bullet of principleBullets(lines, mask)) {
    const why = whySpan(lines, bullet);
    const intentLines = (why ? why.marker : bullet.end) - bullet.start;
    if (intentLines > INTENT_MAX_LINES) {
      findings.push(
        finding(
          "why-length",
          BASELINE,
          bullet.start + 1,
          `intent span is ${intentLines} lines (max ${INTENT_MAX_LINES})`,
        ),
      );
    }
    if (!why) continue;
    const whyLines = why.close - why.marker + 1;
    if (whyLines > WHY_MAX_LINES) {
      findings.push(
        finding(
          "why-length",
          BASELINE,
          why.marker + 1,
          `why span is ${whyLines} lines (max ${WHY_MAX_LINES})`,
        ),
      );
    }
    const body = lines.slice(why.marker, why.close + 1).join(" ");
    for (const [pattern, message] of EVIDENCE_PATTERNS) {
      if (pattern.test(body)) {
        findings.push(finding("why-evidence", BASELINE, why.marker + 1, `why ${message}`));
      }
    }
    const dates = body.match(DATE) ?? [];
    if (dates.length > WHY_MAX_DATES) {
      findings.push(
        finding(
          "why-evidence",
          BASELINE,
          why.marker + 1,
          `why cites ${dates.length} dates (max ${WHY_MAX_DATES})`,
        ),
      );
    }
  }
  return findings;
};

const normalise = (line) =>
  line
    .replace(/\{\{.*?\}\}/g, " ")
    .replace(/\{\{[^}]*$/, " ")
    .replace(/^[^{]*\}\}/, " ")
    .toLowerCase()
    .replace(/[`*_#>[\]()|~:;,.!?"'‘’“”…—–/\\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const tokenise = (lines, mask, keep = () => true) => {
  const tokens = [];
  lines.forEach((line, index) => {
    if (mask[index] || !keep(line)) return;
    for (const word of normalise(line).split(" ")) {
      if (word) tokens.push({ word, line: index + 1 });
    }
  });
  return tokens;
};

const exemptPair = (a, b) =>
  DUPLICATE_EXEMPT_PAIRS.some(([x, y]) => (a === x && b === y) || (a === y && b === x));

const checkDuplicates = (root) => {
  const sources = [];
  for (const pattern of DUPLICATE_GLOBS) {
    for (const file of glob(root, pattern)) {
      if (DUPLICATE_EXEMPT.has(file) || sources.some((source) => source.file === file)) continue;
      const lines = toLines(readFileSync(join(root, file), "utf8"));
      sources.push({ file, tokens: tokenise(lines, fencedMask(lines)) });
    }
  }
  const yaml = readIfExists(root, AGENTS_YAML);
  if (yaml !== null) {
    const lines = toLines(yaml);
    sources.push({
      file: AGENTS_YAML,
      tokens: tokenise(lines, fencedMask(lines), (line) => line.trim().startsWith("#")),
    });
  }

  const first = new Map();
  const runs = new Map();
  const findings = [];
  for (const { file, tokens } of sources) {
    for (let i = 0; i + SHINGLE_WORDS <= tokens.length; i += 1) {
      const window = tokens.slice(i, i + SHINGLE_WORDS);
      const key = window.map((token) => token.word).join(" ");
      const seen = first.get(key);
      if (!seen) {
        first.set(key, { file, line: window[0].line, index: i });
        continue;
      }
      if (seen.file === file || exemptPair(seen.file, file)) continue;
      const pair = `${seen.file}${PAIR_SEPARATOR}${file}`;
      const previous = runs.get(pair);
      runs.set(pair, { a: seen.index, b: i });
      // A duplicated passage repeats once per word; report the run once.
      const contiguous =
        previous !== undefined &&
        i - previous.b === seen.index - previous.a &&
        i - previous.b > 0 &&
        i - previous.b < SHINGLE_WORDS;
      if (contiguous) continue;
      const preview = window
        .slice(0, PREVIEW_WORDS)
        .map((token) => token.word)
        .join(" ");
      findings.push(
        finding("duplicate", file, window[0].line, `repeats ${seen.file}:${seen.line} - "${preview}"`),
      );
    }
  }
  return findings;
};

const checkHarnessDocs = (root) => {
  const findings = [];
  for (const file of HARNESS_DOCS) {
    const text = readIfExists(root, file);
    if (text === null) continue;
    const lines = toLines(text);
    const mask = fencedMask(lines);
    if (lines.length > HARNESS_DOC_MAX_LINES) {
      findings.push(
        finding("harness-doc", file, 1, `file is ${lines.length} lines (max ${HARNESS_DOC_MAX_LINES})`),
      );
    }
    lines.forEach((line, index) => {
      if (mask[index]) return;
      if (/^- /.test(line)) {
        let end = index + 1;
        while (end < lines.length && /^\s+\S/.test(lines[end])) end += 1;
        const span = end - index;
        if (span > HARNESS_BULLET_MAX_LINES) {
          findings.push(
            finding(
              "harness-doc",
              file,
              index + 1,
              `bullet is ${span} lines (max ${HARNESS_BULLET_MAX_LINES})`,
            ),
          );
        }
      }
      if (/^## /.test(line) && !/\((last verified|decision) 20\d\d-\d\d-\d\d/.test(line)) {
        findings.push(
          finding("harness-doc", file, index + 1, "heading lacks a last verified or decision date"),
        );
      }
      for (const match of line.matchAll(/last verified (20\d\d-\d\d-\d\d)/g)) {
        const age = Math.round(ageDays(match[1]));
        if (age === Infinity) {
          findings.push(finding("harness-doc", file, index + 1, `last verified ${match[1]} is not a past calendar date`));
          continue;
        }
        if (age > VERIFIED_MAX_AGE_DAYS) {
          findings.push(
            finding(
              "harness-doc",
              file,
              index + 1,
              `last verified ${match[1]} is ${age} days old (max ${VERIFIED_MAX_AGE_DAYS})`,
            ),
          );
        }
      }
      if (line.includes("expiry fired")) {
        findings.push(finding("harness-doc", file, index + 1, "expiry fired"));
      }
    });
  }
  return findings;
};

const checkAuditLog = (root) => {
  const text = readIfExists(root, AUDIT_LOG);
  if (text === null) return [];
  const lines = toLines(text);
  const mask = fencedMask(lines);
  const findings = [];
  const heading = (index, level) => !mask[index] && lines[index].startsWith(`${level} `);

  for (let start = 0; start < lines.length; start += 1) {
    if (!heading(start, "##")) continue;
    const date = lines[start].slice(3).trim().match(/^20\d\d-\d\d-\d\d$/)?.[0];
    if (!date || ageDays(date) <= AUDIT_OPEN_AFTER_DAYS) continue;
    let end = start + 1;
    while (end < lines.length && !heading(end, "##")) end += 1;

    const subStarts = [];
    for (let i = start + 1; i < end; i += 1) if (heading(i, "###")) subStarts.push(i);
    const preamble = lines.slice(start + 1, subStarts[0] ?? end);
    if (preamble.join("").trim() !== "" && !preamble.join("\n").includes("**Open**")) {
      findings.push(
        finding("audit-log", AUDIT_LOG, start + 1, `entry ${date} is stale without **Open**`),
      );
    }
    subStarts.forEach((subStart, index) => {
      const subEnd = subStarts[index + 1] ?? end;
      if (lines.slice(subStart, subEnd).join("\n").includes("**Open**")) return;
      findings.push(
        finding(
          "audit-log",
          AUDIT_LOG,
          subStart + 1,
          `sub-entry under ${date} is stale without **Open**`,
        ),
      );
    });
  }
  return findings;
};

// An inert `op` ahead of the real one, mirroring CI's setup-verify-env stub, so
// a template that calls onepasswordRead renders instead of prompting a signin.
const opStubPath = () => {
  const dir = mkdtempSync(join(tmpdir(), "check-docs-op-"));
  writeFileSync(
    join(dir, "op"),
    '#!/bin/sh\ncase "$1" in --version) echo 2.0.0 ;; signin) echo "stub-session" ;; *) printf "op-stub" ;; esac\n',
    { mode: 0o755 },
  );
  return dir;
};

const checkProjections = (root) => {
  const findings = [];
  let chezmoiMissing = false;
  const opStub = opStubPath();
  for (const file of PROJECTIONS) {
    const source = readIfExists(root, file);
    if (source === null || chezmoiMissing) continue;
    // -S so a checkout outside ~/.local/share/chezmoi renders its own source.
    const rendered = spawnSync("chezmoi", ["-S", root, "execute-template", "--file", file], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: `${opStub}:${process.env.PATH ?? ""}` },
    });
    if (rendered.error?.code === "ENOENT") {
      process.stderr.write("SKIP projection: chezmoi not installed\n");
      chezmoiMissing = true;
      continue;
    }
    if (rendered.status !== 0) {
      findings.push(
        finding("projection", file, 1, `render failed: ${rendered.stderr.trim().split("\n")[0]}`),
      );
      continue;
    }
    const lines = toLines(rendered.stdout);
    if (lines.length > PROJECTION_MAX_LINES) {
      findings.push(
        finding("projection", file, 1, `renders to ${lines.length} lines (max ${PROJECTION_MAX_LINES})`),
      );
    }
    const mask = fencedMask(lines);
    lines.forEach((line, index) => {
      if (mask[index]) return;
      for (const [pattern, message] of EVIDENCE_PATTERNS) {
        if (pattern.test(line)) {
          findings.push(finding("projection", file, index + 1, `rendered line ${message}`));
        }
      }
    });
  }
  return findings;
};

const checkYamlComments = (root) => {
  const text = readIfExists(root, AGENTS_YAML);
  if (text === null) return [];
  const lines = toLines(text);
  const findings = [];
  let start = -1;
  const closeRun = (end) => {
    const run = end - start;
    if (start !== -1 && run > YAML_COMMENT_MAX_RUN) {
      findings.push(
        finding(
          "yaml-comment",
          AGENTS_YAML,
          start + 1,
          `${run} consecutive comment lines (max ${YAML_COMMENT_MAX_RUN})`,
        ),
      );
    }
    start = -1;
  };
  lines.forEach((line, index) => {
    if (line.trim().startsWith("#")) {
      if (start === -1) start = index;
      return;
    }
    closeRun(index);
  });
  closeRun(lines.length);
  return findings;
};

const checkBudgets = (root) => {
  const findings = [];
  for (const [file, budget] of Object.entries(LINE_BUDGETS)) {
    const text = readIfExists(root, file);
    if (text === null) continue;
    const count = toLines(text).length;
    if (count > budget) findings.push(finding("budget", file, 1, `${count} lines (max ${budget})`));
  }
  return findings;
};

export const runChecks = (root) => {
  const base = resolve(root);
  return [
    ...checkBaselineWhys(base),
    ...checkDuplicates(base),
    ...checkHarnessDocs(base),
    ...checkAuditLog(base),
    ...checkProjections(base),
    ...checkYamlComments(base),
    ...checkBudgets(base),
  ];
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = runChecks(process.argv[2] ?? process.cwd());
  for (const { file, line, check, message } of findings) {
    process.stdout.write(`${file}:${line}  ${check}  ${message}\n`);
  }
  if (findings.length > 0) process.exit(1);
  process.stdout.write("docs: ok\n");
}
