import test from "node:test";
import assert from "node:assert/strict";
import { CaretEditor } from "./index.mjs";

const editor = () => new CaretEditor({ terminal: { rows: 24 }, requestRender: () => {} }, { borderColor: text => text, selectList: {} }, {});

test("caret survives the host copying the default editor's paddingX onto the custom editor", () => {
  const caret = editor();
  caret.setPaddingX(0);
  const lines = caret.render(40);
  assert.ok(lines[1].startsWith("❯ "), lines.join("\n"));
});

test("caret clamp still honours a larger configured padding", () => {
  const caret = editor();
  caret.setPaddingX(3);
  assert.equal(caret.getPaddingX(), 3);
  assert.ok(caret.render(40)[1].startsWith("❯ "));
});
