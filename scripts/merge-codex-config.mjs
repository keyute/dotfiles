// Merge chezmoi-managed settings into Codex's config.toml while preserving the
// runtime state Codex writes into the same file (trusted projects, notices, ...).
//
// stdin: one JSON manifest line {delete: ["dotted.key.path", ...], managed: {...}},
// followed by the current config.toml. stdout: the merged TOML. Any parse or
// serialize error exits non-zero, which makes chezmoi abort without touching the
// target file.
import { readFileSync } from "node:fs";
import { parse, stringify } from "smol-toml";

const raw = readFileSync(0, "utf8");
const nl = raw.indexOf("\n");
const manifest = JSON.parse(raw.slice(0, nl));
const config = parse(raw.slice(nl + 1));

// TOML tables parse to null-prototype-free plain objects; dates/arrays are leaves
const isTable = (v) =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  !(v instanceof Date);

for (const path of manifest.delete) {
  const parts = path.split(".");
  let node = config;
  for (const part of parts.slice(0, -1)) {
    node = isTable(node[part]) ? node[part] : null;
    if (node === null) break;
  }
  if (node !== null) delete node[parts.at(-1)];
}

const deepMerge = (dst, src) => {
  for (const [key, value] of Object.entries(src)) {
    if (isTable(value) && isTable(dst[key])) deepMerge(dst[key], value);
    else dst[key] = value;
  }
};
deepMerge(config, manifest.managed);

let out = stringify(config);
if (!out.endsWith("\n")) out += "\n";
parse(out); // round-trip sanity check: corrupt output must abort, not be written
process.stdout.write(out);
