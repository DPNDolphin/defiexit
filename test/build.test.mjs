import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { build, splitMarks, localize } from "../scripts/build.mjs";
import { STR } from "../src/js/lib/i18n.js";
import { site } from "../scripts/site.mjs";

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

test("WOOFi 指南:三笔交易各一张核对卡、都能明说跳过;10-29 实测取回过,首页标「已实测」", () => {
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
  assert.match(home, /<b>WOOFi<\/b>[\s\S]*?<span class="tag-ok">/);
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

test("WOOFi 第 3–5 步:一下点击一张图,编号在这一步里接着数;页面停在 K 线图时有岔路先回来", () => {
  const r = JSON.parse(read("recipes/woofi/recipe.json"));
  const en = localize(r, JSON.parse(read("recipes/woofi/i18n/en.json")), "woofi/en.json");
  const nums = (c) => [...c].filter((ch) => "①②③④⑤⑥⑦⑧⑨".includes(ch)).map((ch) => "①②③④⑤⑥⑦⑧⑨".indexOf(ch) + 1);
  for (const L of [r, en]) {
    for (const id of ["claim", "unstake", "vault"]) {
      const s = L.steps.find((x) => x.id === id);
      const seq = s.images.map((im) => nums(im.caption));
      for (const n of seq) assert.equal(n.length, 1, `${id}:一张图只该有一个要点的地方`);
      assert.deepEqual(seq.flat(), seq.map((_, i) => i + 1), `${id}:编号要从 1 接着数`);
      assert.ok(s.detour?.images.length === 2, `${id} 缺岔路`);
    }
  }
  const zh = read("dist/r/woofi/index.html"), enHtml = read("dist/en/r/woofi/index.html");
  assert.equal(zh.match(/<details class="detour">/g)?.length, 3);
  assert.ok(zh.includes('src="/r/woofi/img/perps-earn.webp"') && !zh.includes("perps-earn-en.webp"));
  assert.ok(enHtml.includes('src="/r/woofi/img/perps-earn-en.webp"'));
});

test("WOOFi 第 1 步:币安钱包里一下一张图(录屏)——先复制,发现 → 搜索框 → 允许粘贴 → 粘贴 → 点那一行;别点历史记录", () => {
  // 10-29 两段手机录屏:点历史记录里的 WOOFi 只会打开首页(→ 介绍页 → LAUNCH APP → K 线页);粘贴完整网址再点那一行,直接是质押页
  const r = JSON.parse(read("recipes/woofi/recipe.json"));
  const en = localize(r, JSON.parse(read("recipes/woofi/i18n/en.json")), "woofi/en.json");
  const nums = (c) => [...c].filter((ch) => "①②③④⑤⑥⑦⑧⑨".includes(ch)).map((ch) => "①②③④⑤⑥⑦⑧⑨".indexOf(ch) + 1);
  for (const L of [r, en]) {
    const s = L.steps.find((x) => x.id === "open");
    assert.deepEqual(s.images.map((im) => im.src), ["bn-wallet.webp", "bn-discover.webp", "bn-search.webp", "bn-allow.webp", "bn-paste.webp", "bn-go.webp", "bn-history.webp", "bn-stake.webp"]);
    const taps = s.images.filter((im) => !im.caption.startsWith("✗"));
    assert.deepEqual(taps.map((im) => nums(im.caption)).flat(), [1, 2, 3, 4, 5, 6, 7], "编号要从 1 接着数,一张图一个");
    assert.ok(s.images.find((im) => im.src === "bn-history.webp").caption.startsWith("✗"), "历史记录那张是「别点」");
    assert.ok(s.items[0].includes("https://woofi.com/stake"), "第一句就让人先复制网址");
    for (const id of ["history", "no-paste"]) assert.ok(s.situations.find((x) => x.id === id), `缺常见情况 ${id}`);
    // 地区限制的提醒放在连接那一步的图后面
    const c = L.steps.find((x) => x.id === "connect");
    assert.ok(c.items?.some((x) => x.startsWith("✗") && x.includes("WE'RE SORRY")), "连接那一步缺地区限制的提醒");
  }
  const zh = read("dist/r/woofi/index.html");
  const step1 = zh.slice(zh.indexOf('id="s-open"'), zh.indexOf('id="s-connect"'));
  // 「点下面那一行」写的是 woofi.com/stake,不能变成复制按钮;第一句里的完整网址才是
  assert.equal((step1.match(/data-copy="https:\/\/woofi\.com\/stake"/g) || []).length >= 1, true);
  assert.ok(step1.indexOf("bn-wallet.webp") > step1.indexOf("https://woofi.com/stake"), "先复制,再看图");
});

test("首页如实写作者本人的实测、不放累计金额;每份指南有实测记录;隐私说明列全查询的地方", () => {
  const zh = read("dist/index.html"), en = read("dist/en/index.html");
  assert.match(zh, /<p class="proof">[\s\S]*?实测取回 4 次[\s\S]*?目前还没有经过核实的其他用户案例/);
  assert.match(en, /<p class="proof">[\s\S]*?4 times[\s\S]*?no verified cases from other users yet/);
  assert.ok(!/\$\s?\d[\d,.]*\s*(?:USD)?[^<]*累计|累计[^<]*\$\d/.test(zh), "首页不该有累计美元金额");
  assert.match(zh, /Hyperliquid 和 Arbitrum/);
  for (const [f, date] of [["dist/r/woofi/index.html", "2026-10-29"], ["dist/en/r/woofi/index.html", "2026-10-29"], ["dist/r/hyperliquid/index.html", "2026-10-27"], ["dist/en/r/hyperliquid/index.html", "2026-10-27"]]) {
    const g = read(f);
    assert.match(g, new RegExp(`<section class="tests">[\\s\\S]*?<b class="mono">${date}</b>`), `${f} 缺实测记录`);
  }
});

test("截图求助:只在有图鉴的指南里出现;每张普通页面都有 2–3 条要用户逐条核对的文字特征;发出去前两个勾", () => {
  for (const f of ["dist/r/woofi/index.html", "dist/en/r/woofi/index.html"]) {
    const g = read(f);
    assert.ok(g.includes('<button class="btn block shot-open" type="button" id="shotOpen">'), `${f} 缺入口`);
    // 入口放在图鉴小图后面:先自己比对,拿不准再发图
    assert.ok(g.indexOf('class="scrs"') < g.indexOf('id="shotOpen"'));
    assert.ok(g.indexOf('class="scr-stops"') < g.indexOf('id="shotOpen"'));
    assert.match(g, /<input class="sr-only" type="file" id="shotFile" accept="image\/\*"/);
    assert.equal(g.match(/<input type="checkbox" data-agree>/g)?.length, 2);
    assert.ok(/<button class="btn primary" type="button" id="shotGo" disabled>/.test(g), "发送按钮默认不能点");
    const tpls = [...g.matchAll(/<template data-feat="([a-z-]+)">((?:(?!<\/template>)[\s\S])*)<\/template>/g)];
    assert.deepEqual(tpls.map((m) => m[1]), ["perps", "home", "stake-new", "wallets", "networks", "stake", "unstake", "earn", "vault"]);
    for (const [, id, body] of tpls) {
      const n = body.match(/data-feat-ck/g)?.length;
      assert.ok(n >= 2 && n <= 3, `${id} 的文字特征 ${n} 条`);
    }
  }
  for (const f of ["dist/r/hyperliquid/index.html", "dist/en/r/hyperliquid/index.html"]) {
    assert.ok(!read(f).includes("lostShot"), `${f} 没有图鉴,不该有截图求助`);
  }
  // 页面带的版本号和服务端读的候选页面数据是同一版
  const data = JSON.parse(read("dist/r/woofi/screens.json"));
  for (const f of ["dist/r/woofi/index.html", "dist/en/r/woofi/index.html"]) {
    assert.ok(read(f).includes(`<div id="lostShot" class="shot-ai" hidden data-r="woofi" data-v="${data.v}">`), `${f} 的版本对不上`);
  }
  assert.deepEqual(JSON.parse(read("dist/_routes.json")), { version: 1, include: ["/api/*"], exclude: [] });
  const h = read("dist/_headers");
  assert.match(h, /img-src 'self' data: blob:/);
  assert.ok(!h.includes("unsafe-eval") && !h.includes("unsafe-inline"));
  // 人机验证:配了站点密钥,每张页面都带上它,CSP 只在脚本和小窗口两处放开 challenges.cloudflare.com;没配就哪儿都不放
  const ts = h.match(/https:\/\/challenges\.cloudflare\.com/g)?.length ?? 0;
  if (site.turnstile) {
    assert.equal(ts, 2);
    assert.match(h, /script-src 'self' https:\/\/challenges\.cloudflare\.com;/);
    assert.match(h, /frame-src https:\/\/challenges\.cloudflare\.com;/);
    for (const f of PAGES) assert.ok(read(f).includes(`<meta name="dx-turnstile" content="${site.turnstile}">`), `${f} 缺站点密钥`);
  } else {
    assert.equal(ts, 0, "没配人机验证时不放开它的脚本");
    for (const f of PAGES) assert.ok(!read(f).includes("dx-turnstile"), `${f} 不该带站点密钥`);
  }
});

test("图鉴答案只带路:质押页、Unstake 页签、金库取款页签不再直接叫人点 Claim / UNSTAKE / WITHDRAW", () => {
  for (const f of ["dist/r/woofi/index.html", "dist/en/r/woofi/index.html"]) {
    const g = read(f);
    for (const id of ["stake", "unstake", "vault"]) {
      const a = g.match(new RegExp(`data-scr-a="${id}" hidden>\\s*<h3>[\\s\\S]*?</h3>\\s*<p>([\\s\\S]*?)</p>`));
      assert.ok(a, `${f} 缺 ${id} 的答案`);
      assert.ok(!/Claim|UNSTAKE|WITHDRAW/.test(a[1]), `${f} ${id} 的答案还写着按钮:${a[1]}`);
      assert.match(g, new RegExp(`data-scr-a="${id}" hidden>(?:(?!</section>)[\\s\\S])*data-scr-(go|after)=`), `${id} 要带去对应那一步`);
    }
  }
});

test("截图求助:停手的页面都给 AI 写了判定条件(普通交易确认弹窗不算要你签名);介绍页的答案走 LAUNCH APP → 三条横线 → 质押", () => {
  // 10-29 真模型评测:没写判定条件时,币安的交易确认弹窗被认成「要你签名」、币安发现页被认成「域名不对」
  const data = JSON.parse(read("dist/r/woofi/screens.json"));
  for (const x of data.screens.filter((y) => y.stop)) assert.ok(typeof x.ai === "string" && x.ai.length > 20, `${x.id} 缺判定条件`);
  assert.match(data.screens.find((x) => x.id === "sign").ai, /Contract call[\s\S]*answer none/);
  assert.match(data.screens.find((x) => x.id === "domain").ai, /no address bar/);
  // 判定条件只给服务端,页面上不出现
  for (const f of ["dist/r/woofi/index.html", "dist/en/r/woofi/index.html"]) assert.ok(!read(f).includes("Only when") && !read(f).includes("answer none"), f);
  // 币安钱包里点历史记录、或只开 woofi.com 会先落到介绍页,地址栏改不了网址:按录屏走通的路带回质押页
  const zh = read("dist/r/woofi/index.html"), en = read("dist/en/r/woofi/index.html");
  const home = (g) => g.match(/data-scr-a="home" hidden>((?:(?!<\/section>)[\s\S])*)<\/section>/)?.[1] || "";
  assert.ok(/LAUNCH APP/.test(home(zh)) && !/地址栏/.test(home(zh)), "中文介绍页答案");
  for (const [g, imgs] of [[zh, ["home-launch.webp", "perps-1.webp", "perps-2.webp"]], [en, ["home-launch.webp", "perps-1-en.webp", "perps-2-en.webp"]]]) {
    const h = home(g);
    let at = -1;
    for (const im of imgs) {
      const k = h.indexOf(im);
      assert.ok(k > at, `介绍页答案的图顺序不对:${im}`);
      at = k;
    }
  }
});

test("页面图鉴的英文版:文字特征条数要和中文一样", () => {
  const r = JSON.parse(read("recipes/woofi/recipe.json"));
  const en = JSON.parse(read("recipes/woofi/i18n/en.json"));
  const L = localize(r, en, "woofi/en.json");
  assert.equal(L.screens.find((x) => x.id === "vault").features.length, r.screens.find((x) => x.id === "vault").features.length);
  const bad = JSON.parse(JSON.stringify(en));
  bad.screens.vault.features = bad.screens.vault.features.slice(1);
  assert.throws(() => localize(r, bad, "x.json"), /screens\.vault\.features/);
});

test("体检结果页:「全部资产」先留空位、默认不显示;WOOFi 配方写明在 Zerion 里对应的项目名和链", () => {
  for (const f of ["dist/check/index.html", "dist/en/check/index.html"]) {
    const h = read(f);
    assert.ok(h.includes('<section id="assets" class="assets" aria-live="polite" hidden></section>'), f);
    const li = h.match(/<li data-id="woofi"[^>]*>/)?.[0] || "";
    assert.ok(/data-zerion="[^"]*WOOFi[^"]*Arbitrum[^"]*"/.test(li), li);
    const hl = h.match(/<li data-id="hyperliquid"[^>]*>/)?.[0] || "";
    assert.ok(hl.includes('data-zerion="null"'), "Hyperliquid 的仓位不在 Zerion 里,不对应");
  }
});
