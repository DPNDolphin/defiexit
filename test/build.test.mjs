import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { build, splitMarks, localize } from "../scripts/build.mjs";
import { STR } from "../src/js/lib/i18n.js";

const read = (f) => readFileSync(f, "utf8");
const PAGES = ["dist/index.html", "dist/en/index.html", "dist/check/index.html", "dist/en/check/index.html", "dist/r/hyperliquid/index.html", "dist/en/r/hyperliquid/index.html", "dist/r/woofi/index.html", "dist/en/r/woofi/index.html", "dist/404.html"];

test("构建:中英两套页面齐全、没有漏填的变量、不用内联脚本和内联样式", () => {
  build();
  for (const f of PAGES) {
    assert.ok(existsSync(f), `缺 ${f}`);
    const html = read(f);
    // 复制按钮的 data-copy-var 故意留着 {{变量}},由浏览器按用户的数填;其他地方不许有
    assert.ok(!html.replace(/data-copy-var="[^"]*"/g, "").includes("{{"), `${f} 有没替换的 {{变量}}`);
    assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/.test(html), `${f} 有内联脚本`);
    // CSP 是 style-src 'self':内联 style 会被浏览器拦掉
    assert.ok(!/\sstyle="/.test(html), `${f} 有内联样式`);
  }
  assert.match(read("dist/index.html"), /<html lang="zh-CN" data-page="home">/);
  assert.match(read("dist/en/index.html"), /<html lang="en" data-page="home">/);
  // 页脚带版本号,链到 GitHub 上的那次提交
  assert.match(read("dist/index.html"), /版本 <a href="https:\/\/github\.com\/DPNDolphin\/defiexit\/commit\/[0-9a-f]{7,}"/);
  assert.match(read("dist/en/index.html"), /Version <a href="https:\/\/github\.com\/DPNDolphin\/defiexit\/commit\/[0-9a-f]{7,}"/);
});

test("英文页面里没有中文(语言切换按钮上的「中文」除外)", () => {
  for (const f of ["dist/en/index.html", "dist/en/check/index.html", "dist/en/r/hyperliquid/index.html", "dist/en/r/woofi/index.html"]) {
    const html = read(f).replace(/<nav class="langs"[\s\S]*?<\/nav>/g, "");
    const cjk = html.match(/[　-〿一-鿿＀-￯]+/);
    assert.equal(cjk, null, `${f} 里有中文:${cjk?.[0]}`);
  }
});

test("指南页:核对卡要逐项打勾、常见情况不靠 JS 也在页面里、保底价不用等填地址", () => {
  for (const f of ["dist/r/hyperliquid/index.html", "dist/en/r/hyperliquid/index.html"]) {
    const guide = read(f);
    assert.ok(guide.includes('data-when="needsSell"'));
    assert.ok(guide.includes('class="help" hidden'));
    assert.ok(guide.includes('<details class="sit stop" data-sit="wrong-destination">'));
    assert.ok(/<button class="copy" type="button" data-copy-var="\{\{floorPx\}\}">/.test(guide));
    // 开启交易、划转、提现三张签名核对卡,每张 3 项
    assert.equal(guide.match(/data-checks="3"/g)?.length, 3);
    assert.equal(guide.match(/<button class="tick" type="button"/g)?.length, 9);
    // 开启交易、划转这两步有时用不到:明说可以跳过,不用假装打勾
    assert.equal(guide.match(/data-skip>/g)?.length, 2);
    // 截图标了宽高,图片没下载完也不会挤动页面
    assert.match(guide, /<img src="\/r\/hyperliquid\/img\/fill\.webp" alt="[^"]+" width="\d+" height="\d+"/);
  }
});

test("安全响应头、字体和字体授权都在", () => {
  const headers = read("dist/_headers");
  assert.match(headers, /script-src 'self'/);
  assert.match(headers, /style-src 'self'/);
  assert.match(headers, /font-src 'self'/);
  assert.match(headers, /connect-src 'self' https:\/\/api\.hyperliquid\.xyz/);
  assert.match(headers, /https:\/\/arb1\.arbitrum\.io\/rpc/);
  for (const f of ["atkinson-next.woff2", "atkinson-mono.woff2", "barlow-sc-700.woff2", "barlow-sc-800.woff2", "OFL-atkinsonhyperlegiblenext.txt", "OFL-atkinsonhyperlegiblemono.txt", "OFL-barlowsemicondensed.txt"]) {
    assert.ok(existsSync(`dist/assets/fonts/${f}`), `缺 ${f}`);
  }
  assert.match(read("dist/assets/site.css"), /url\("fonts\/atkinson-next\.woff2"\)/);
});

test("界面文字:中英两套的条目一一对应", () => {
  assert.deepEqual(Object.keys(STR.en).sort(), Object.keys(STR.zh).sort());
});

test("截图说明拆成:提示、带编号的步骤、别做的事", () => {
  assert.deepEqual(splitMarks("! 官方提示 ① 点 **Sell** ② 价格填 {{floorPx}} ✗ 不要点 USDHL"), [
    { k: "tip", text: "官方提示" },
    { k: "n", n: 1, text: "点 **Sell**" },
    { k: "n", n: 2, text: "价格填 {{floorPx}}" },
    { k: "bad", text: "不要点 USDHL" },
  ]);
  assert.deepEqual(splitMarks("分开账户会显示两行"), [{ k: "plain", text: "分开账户会显示两行" }]);
});

test("英文版配方:缺一条或者混着中文,构建直接报错", () => {
  const r = JSON.parse(read("recipes/hyperliquid/recipe.json"));
  const en = JSON.parse(read("recipes/hyperliquid/i18n/en.json"));
  assert.doesNotThrow(() => localize(r, en, "en.json"));
  const missing = structuredClone(en);
  delete missing.steps.withdraw.check.confirm;
  assert.throws(() => localize(r, missing, "en.json"), /steps\.withdraw\.check\.confirm/);
  const mixed = structuredClone(en);
  mixed.steps.fill.title = "填卖单";
  assert.throws(() => localize(r, mixed, "en.json"), /中文/);
});

test("WOOFi 指南:三笔交易各一张核对卡、都能明说跳过;首页如实标「待实测」", () => {
  for (const f of ["dist/r/woofi/index.html", "dist/en/r/woofi/index.html"]) {
    const g = read(f);
    for (const w of ["needsClaim", "needsUnstake", "needsVault"]) assert.ok(g.includes(`data-when="${w}"`), `${f} 缺 ${w}`);
    assert.equal(g.match(/data-checks="3"/g)?.length, 3);
    assert.equal(g.match(/<button class="tick" type="button"/g)?.length, 9);
    assert.equal(g.match(/data-skip>/g)?.length, 3);
    assert.match(g, /<img src="\/r\/woofi\/img\/claim\.webp" alt="[^"]+" width="\d+" height="\d+"/);
  }
  const home = read("dist/index.html");
  assert.match(home, /<b>Hyperliquid<\/b>[\s\S]*?<span class="tag-ok">/);
  assert.match(home, /<b>WOOFi<\/b>[\s\S]*?<span class="tag-wait">[\s\S]*?页面已核对[,，]待实测/);
});

test("每个网页都带 no-transform:Cloudflare 不往页面里插统计脚本", () => {
  const h = read("dist/_headers");
  for (const p of ["/", "/en/", "/check/", "/en/check/", "/r/hyperliquid/", "/en/r/hyperliquid/", "/r/woofi/", "/en/r/woofi/", "/404.html"]) {
    assert.ok(h.includes(`
${p}
  Cache-Control: public, max-age=0, must-revalidate, no-transform
`), `缺 ${p}`);
  }
});

test("WOOFi 英文版配方:条目齐全、没有中文", () => {
  const r = JSON.parse(read("recipes/woofi/recipe.json"));
  const en = JSON.parse(read("recipes/woofi/i18n/en.json"));
  assert.doesNotThrow(() => localize(r, en, "woofi/en.json"));
});

test("要复制的网址:说明文字里整段就是复制按钮;只出现 https:// 这种片段的不算", () => {
  for (const [f, url] of [["dist/r/woofi/index.html", "https://woofi.com/stake"], ["dist/en/r/woofi/index.html", "https://woofi.com/stake"], ["dist/r/hyperliquid/index.html", "https://app.hyperliquid.xyz"], ["dist/en/r/hyperliquid/index.html", "https://app.hyperliquid.xyz"]]) {
    const g = read(f);
    assert.ok(g.includes(`<button class="copy code-copy" type="button" data-copy="${url}"`), `${f} 的网址不是复制按钮`);
    assert.ok(!g.includes('data-copy="https://"'), `${f}:「网址要带 https://」里的片段不该变成复制按钮`);
    if (!f.includes("/en/")) assert.ok(g.includes("<code>https://</code>"), `${f}:「网址要带 https://」里的片段应该照常显示`);
    // 核对卡的勾选项本身是按钮,里面不能再套按钮
    assert.ok(!/<button class="tick"[^>]*>(?:(?!<\/button>)[\s\S])*<button/.test(g), `${f} 勾选项里套了按钮`);
  }
});

test("页面图鉴:每一步都有「页面和图里不一样?」,点开能选最像自己手机的页面;英文版换英文界面的截图", () => {
  const zh = read("dist/r/woofi/index.html"), en = read("dist/en/r/woofi/index.html");
  for (const g of [zh, en]) {
    assert.equal(g.match(/<button class="lost-btn" type="button" data-lost>/g)?.length, 6);
    assert.ok(g.includes('<dialog class="sheet" id="lost"'));
    assert.equal(g.match(/<button class="scr" type="button" data-scr="/g)?.length, 9);
    // 要停手的情况单独一个红框放最上面,不混在普通页面里
    assert.equal(g.match(/<button class="scr-stop" type="button" data-scr="/g)?.length, 4);
    assert.ok(g.indexOf('class="scr-stops"') < g.indexOf('class="scrs"'));
    assert.equal(g.match(/data-scr-a="/g)?.length, 13);
    // 停手的答案只让停下,不带去任何一步
    for (const id of ["domain", "sign", "sorry", "blocked"]) {
      const a = g.match(new RegExp(`data-scr-a="${id}" hidden>((?:(?!</section>)[\\s\\S])*)</section>`));
      assert.ok(a, `缺 ${id} 的答案`);
      assert.ok(!a[1].includes("data-scr-go"), `${id} 不该带去某一步`);
    }
    assert.match(g, /data-scr-go="" data-scr-after="connect"/);
    // 图鉴里也给官方渠道,并写明这些页面哪天核对的
    const lost = g.slice(g.indexOf('<dialog class="sheet" id="lost"'));
    assert.ok(lost.includes('href="https://discord.com/invite/woo-854313849591431188"'));
    assert.ok(lost.includes("2026-10-29"));
    assert.ok(lost.includes('id="lostSkip" hidden'));
  }
  assert.ok(zh.includes('src="/r/woofi/img/perps-1.webp"') && !zh.includes("perps-1-en.webp"));
  assert.ok(en.includes('src="/r/woofi/img/perps-1-en.webp"') && en.includes("perps-2-en.webp"));
  // 没有图鉴的配方不放这个按钮
  for (const f of ["dist/r/hyperliquid/index.html", "dist/en/r/hyperliquid/index.html"]) {
    const g = read(f);
    assert.ok(!g.includes("data-lost") && !g.includes('id="lost"'), `${f} 不该有页面图鉴`);
  }
});

test("页面图鉴的英文版:缺一条就报错;图可以整张换掉", () => {
  const r = JSON.parse(read("recipes/woofi/recipe.json"));
  const en = JSON.parse(read("recipes/woofi/i18n/en.json"));
  const L = localize(r, en, "woofi/en.json");
  assert.equal(L.screens.find((x) => x.id === "perps").img, "perps-1-en.webp");
  assert.equal(L.screens.find((x) => x.id === "stake").img, "claim.webp");
  const bad = JSON.parse(JSON.stringify(en));
  delete bad.screens.home.do;
  assert.throws(() => localize(r, bad, "x.json"), /screens\.home\.do/);
  const bad2 = JSON.parse(JSON.stringify(en));
  bad2.screens.perps.images = [bad2.screens.perps.images[0]];
  assert.throws(() => localize(r, bad2, "x.json"), /screens\.perps\.images/);
});
