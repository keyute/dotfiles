import { readFileSync } from "node:fs";
import { createJiti } from "jiti";
import * as sdk from "@earendil-works/pi-coding-agent";
import { workerTools } from "./policy.mjs";

// This entire process, including plugin-side file IO, runs inside SRT.
const name = process.argv[2];
if (!workerTools.includes(name)) throw new Error("Unregistered sandbox tool");
const request = JSON.parse(readFileSync(0, "utf8"));
const cwd = process.cwd();
const tools = Object.fromEntries(["read", "write", "edit", "bash", "grep", "find", "ls"].map(tool => [tool, sdk[`create${tool[0].toUpperCase()}${tool.slice(1)}Tool`](cwd)]));
if (name.startsWith("lsp_")) {
  const jiti = createJiti(import.meta.url);
  const lsp = await jiti.import("@narumitw/pi-lsp/dist/index.ts", { default: true });
  lsp({ registerTool(tool) { tools[tool.name] = tool; }, registerCommand() {}, on() {} });
}
const controller = new AbortController();
process.on("SIGTERM", () => controller.abort());
const result = await tools[name].execute("sandbox", request, controller.signal, undefined, {
  cwd,
  isProjectTrusted: () => false,
  ui: { setStatus() {}, notify() {} },
});
process.stdout.write(JSON.stringify(result));
