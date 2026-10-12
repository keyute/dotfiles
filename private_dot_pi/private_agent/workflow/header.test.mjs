import test from "node:test";
import assert from "node:assert/strict";
import { installHeader, renderHeader } from "./header.mjs";

const theme = { fg: (color, text) => `<${color}>${text}`, bold: text => `*${text}` };

test("the header is the mascot over a version line, coloured through the theme", () => {
  const lines = renderHeader(theme, "1.2.3");
  assert.equal(lines[1], "     <text>█<dim>▌  <text>█<dim>▌");
  assert.equal(lines[2], `  <accent>${"█".repeat(14)}`);
  assert.equal(lines[3], "     <accent>██    <accent>██");
  assert.equal(lines.at(-2), "  *<accent>pi<dim> v1.2.3");
  assert.equal(lines.at(-1), "");
});

test("installHeader gives pi a component rendering the mascot", () => {
  let factory;
  installHeader({ ui: { setHeader: value => { factory = value; } } });
  assert.deepEqual(factory({}, theme).render(80), renderHeader(theme));
});
