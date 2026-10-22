import { Markdown } from "@earendil-works/pi-tui";
import { convertToLlm, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { MarkdownView, openView } from "./dialog.mjs";

const SIDE_QUESTION = "The user asks a side question. Answer it directly and briefly from the conversation so far. You cannot use tools here, and your answer will not join the conversation.";

// Resolves undefined when aborted, else { text } or { error }.
async function answer(ctx, question, signal) {
  // The projection's system messages carry the session's prompt and tool
  // declarations, as on the main request; a separate systemPrompt or tools
  // would prepend a second system head and break the cached prefix.
  const messages = [...convertToLlm(ctx.sessionManager.buildSessionProjection().messages), { role: "user", content: `${SIDE_QUESTION}\n\nQuestion: ${question}`, timestamp: Date.now() }];
  // SSE, as web_fetch: the codex websocket is cached per session and the main turn continues from it.
  const message = await ctx.modelRegistry.complete(ctx.model, { messages }, { signal, sessionId: ctx.sessionManager.getSessionId(), transport: "sse" }).catch(error => ({ stopReason: "error", errorMessage: error.message }));
  if (message.stopReason === "aborted" || signal?.aborted) return undefined;
  if (message.stopReason === "error") return { error: message.errorMessage ?? "The model failed" };
  const text = message.content.filter(part => part.type === "text").map(part => part.text).join("").trim();
  // The projection declares the session's tools, so the model can still reply with only a call.
  if (!text && message.stopReason === "toolUse") return { error: "The model tried to use a tool; /btw can't run tools" };
  return { text: text || "No answer" };
}

class BtwViewComponent extends MarkdownView {
  constructor(tui, theme, keybindings, done, ctx, question, signal) {
    super(tui, theme, keybindings, done, signal);
    this.question = question;
    this.controller = new AbortController();
    if (this.finished) return;
    answer(ctx, question, this.controller.signal).then(reply => {
      if (this.disposed || !reply) return;
      this.reply = reply;
      if (reply.text) this.markdown = new Markdown(reply.text, 2, 0, getMarkdownTheme());
      this.tui.requestRender();
    });
  }
  // Closing, or another view taking the slot, abandons the request.
  dispose() {
    super.dispose();
    this.controller?.abort();
  }
  heading(width) { return this.line(`${this.theme.fg("accent", "/btw")} ${this.theme.bold(this.question)}`, width); }
  placeholder(width) { return this.line(this.reply?.error ? this.theme.fg("error", this.reply.error) : this.theme.fg("dim", "Answering…"), width); }
}

export async function askBtw(ctx, args) {
  const question = args?.trim();
  if (!question) return ctx.ui.notify("Usage: /btw <question>", "error");
  if (!ctx.model) return ctx.ui.notify("No model selected", "error");
  if (ctx.mode !== "tui") {
    const reply = await answer(ctx, question);
    if (reply) ctx.ui.notify(reply.error ?? reply.text, reply.error ? "error" : "info");
    return;
  }
  return openView(signal => ctx.ui.custom((tui, theme, keybindings, done) => new BtwViewComponent(tui, theme, keybindings, done, ctx, question, signal)));
}
