import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { build } from "../scripts/build.mjs";

test("构建:页面齐全、没有漏填的变量、带安全头", () => {
  build();
  const home = readFileSync("dist/index.html", "utf8");
  const guide = readFileSync("dist/r/hyperliquid/index.html", "utf8");
  for (const html of [home, guide]) {
    // 复制按钮的 data-copy-var 故意留着 {{变量}},由浏览器按用户的数填;其他地方不许有
    assert.ok(!html.replace(/data-copy-var="[^"]*"/g, "").includes("{{"), "有没替换的 {{变量}}");
    assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/.test(html), "不允许内联脚本");
  }
  assert.ok(guide.includes('data-when="needsSell"'));
  const headers = readFileSync("dist/_headers", "utf8");
  assert.match(headers, /script-src 'self'/);
  assert.match(headers, /connect-src 'self' https:\/\/api\.hyperliquid\.xyz/);
});
