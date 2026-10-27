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
  // 页脚带版本号,链到 GitHub 上的那次提交
  assert.match(home, /版本 <a href="https:\/\/github\.com\/DPNDolphin\/defiexit\/commit\/[0-9a-f]{7,}"/);
  const headers = readFileSync("dist/_headers", "utf8");
  assert.match(headers, /script-src 'self'/);
  assert.match(headers, /connect-src 'self' https:\/\/api\.hyperliquid\.xyz/);
  assert.match(headers, /https:\/\/arb1\.arbitrum\.io\/rpc/);
  // 每一步都有「我卡在这一步」的帮助面板;常见情况用 details 展开,不靠 JS
  assert.ok(guide.includes('class="help" hidden'));
  assert.ok(guide.includes('<details class="sit stop" data-sit="wrong-destination">'));
  // 保底价是默认就能用的变量:复制按钮不用等填地址
  assert.ok(/<button class="copy" data-copy-var="\{\{floorPx\}\}">/.test(guide));
});
