// Merge chezmoi-managed Pi settings into Pi's JSON settings while preserving
// interactive settings Pi writes itself. stdin is the current JSON object;
// argv[2] is the managed JSON object.
import { readFileSync } from "node:fs";

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const parseObject = (raw, label) => {
  let value;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    throw new SyntaxError(`${label} must be valid JSON: ${error.message}`);
  }
  if (!isObject(value)) throw new TypeError(`${label} must be a JSON object`);
  return value;
};

const assertSafeKey = (key) => {
  if (["__proto__", "constructor", "prototype"].includes(key)) {
    throw new TypeError(`unsupported settings key: ${key}`);
  }
};

const merge = (current, managed) => {
  for (const [key, value] of Object.entries(managed)) {
    assertSafeKey(key);
    if (isObject(value) && isObject(current[key])) merge(current[key], value);
    else current[key] = value;
  }
  return current;
};

if (process.argv.length !== 3) {
  throw new TypeError("usage: merge-pi-settings.mjs '<managed JSON>'");
}

const rawCurrent = readFileSync(0, "utf8");
const current = parseObject(rawCurrent.trim() ? rawCurrent : "{}", "current settings");
const managed = parseObject(process.argv[2], "managed settings");
const output = `${JSON.stringify(merge(current, managed), null, 2)}\n`;

// Parsing the serialized result verifies that malformed data cannot be written.
parseObject(output, "merged settings");
process.stdout.write(output);
