import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { build, splitMarks, localize, TITLE_BAN } from "../scripts/build.mjs";
import { STR } from "../src/js/lib/i18n.js";
import { svgString } from "../src/js/lib/icons.js";
import { site } from "../scripts/site.mjs";
import { headerRules, headersFor } from "./cf-headers.mjs";

const read = (f) => readFileSync(f, "utf8");
const NT = "Cache-Control: public, max-age=0, must-revalidate, no-transform";
const PAGES = ["dist/index.html", "dist/en/index.html", "dist/check/index.html", "dist/en/check/index.html", "dist/r/hyperliquid/index.html", "dist/en/r/hyperliquid/index.html", "dist/r/woofi/index.html", "dist/en/r/woofi/index.html", "dist/404.html",
  "dist/deadlines/index.html", "dist/en/deadlines/index.html", "dist/topics/index.html", "dist/en/topics/index.html"];

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
  for (const f of ["dist/en/index.html", "dist/en/check/index.html", "dist/en/r/hyperliquid/index.html", "dist/en/r/woofi/index.html", "dist/en/deadlines/index.html", "dist/en/topics/index.html"]) {
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

test("DYORSwap 指南:签名、交易各一张核对卡;网址是能直接打开的 Find 页;图里的 USD₮0 和 Bridge 都标了别点;首页如实标待实测", () => {
  for (const f of ["dist/r/dyorswap/index.html", "dist/en/r/dyorswap/index.html"]) {
    const g = read(f);
    assert.equal(g.match(/data-checks="3"/g)?.length, 2, f);
    assert.equal(g.match(/<button class="tick" type="button"/g)?.length, 6, f);
    assert.ok(g.includes('data-copy="https://dyorswap.finance/find/?chainId=196"'), f);
    assert.ok(g.includes("0x35c185563dFd328256A80Aafc23822200719cD25") && g.includes("0x1E690F24F704672e44255013C2cB22FC04c46036"), `${f} 核对卡要给完整地址`);
    assert.ok(/\/r\/dyorswap\/img\/dy-enable(-en)?\.webp/.test(g) && /\/r\/dyorswap\/img\/dy-fail(-en)?\.webp/.test(g), f);
  }
  // 中文版用中文界面的图,英文版用英文界面的图;网页上的每一张都要换
  const zh = read("dist/r/dyorswap/index.html"), en = read("dist/en/r/dyorswap/index.html");
  assert.ok(zh.includes("/r/dyorswap/img/dy-enable.webp") && !zh.includes("-en.webp"), "中文版用中文图");
  assert.ok(!/img\/dy-[a-z]+\.webp/.test(en), "英文版不混中文界面的图");
  // 别点的东西不进第 1 张图(图上打叉的 Bridge 反而有人点),文字里写清楚,中文界面叫「桥」
  assert.ok(zh.includes("底部导航栏的「桥」（Bridge）不要点"));
  assert.ok(/data-sit="bridge-page"/.test(zh) && /data-sit="wrong-network"/.test(zh), "点进跨链桥、网络不对都有说法");
  assert.ok(/<b>DYORSwap<\/b>(?:(?!<\/li>)[\s\S])*tag-ok/.test(read("dist/index.html")), "实测过了,首页标已实测");
});

test("会动资产的步骤标红框,只给权限的签名标黄框:标题下面写明钱是谁在动、给出去的权限能做什么;别的步骤都不标", () => {
  const recipes = ["hyperliquid", "woofi", "okx-boost", "dyorswap"].map((id) => JSON.parse(read(`recipes/${id}/recipe.json`)));
  const signs = (s) => s.check && s.check.kind !== "arrive";
  // 每个签名的步骤都写明签完会不会动资产(构建也查)
  for (const r of recipes) for (const s of r.steps) if (signs(s)) assert.equal(typeof s.moves, "boolean", `${r.id}/${s.id} 没写 moves`);
  const pick = (f) => Object.fromEntries(recipes.map((r) => [r.id, r.steps.filter(f).map((s) => s.id)]));
  const MOVES = pick((s) => s.moves), GRANTS = pick((s) => signs(s) && s.moves === false);
  // Hyperliquid 的「下单卖出」不弹钱包(之前批准的下单密钥签),但会把 USDH 卖成 USDC,也标
  assert.deepEqual(MOVES, { hyperliquid: ["order", "transfer", "withdraw"], woofi: ["claim", "unstake", "vault"], "okx-boost": ["unstake"], dyorswap: ["remove"] });
  // 只给权限、签名本身不动钱的两步:Hyperliquid 开启交易(ApproveAgent)、DYORSwap 的 Permit
  assert.deepEqual(GRANTS, { hyperliquid: ["enable"], woofi: [], "okx-boost": [], dyorswap: ["enable"] });
  const HEAD = { moves: ["这一步会动你的资产", "This step moves your funds"], grants: ["这一步给权限，不直接动钱", "This step grants permission; it doesn't move funds by itself"] };
  const ICON = { moves: svgString("alert"), grants: svgString("key") };
  // 红框那句默认「由 <协议> 的合约执行」;Hyperliquid 的划转、提现是它自己的链在处理,写「由 Hyperliquid 执行」(英文名两边空一格,挨着汉字不空)
  const SIGNED = {
    hyperliquid: ["你在自己钱包里签名后，由 Hyperliquid 执行。DeFiExit 不经手你的钱。", "After you sign in your own wallet, Hyperliquid carries it out. DeFiExit never touches your money."],
    woofi: ["你在自己钱包里签名后，由 WOOFi 的合约执行。DeFiExit 不经手你的钱。", "After you sign in your own wallet, WOOFi's contract carries it out. DeFiExit never touches your money."],
    "okx-boost": ["你在自己钱包里签名后，由 OKX Boost 的合约执行。DeFiExit 不经手你的钱。", "After you sign in your own wallet, OKX Boost's contract carries it out. DeFiExit never touches your money."],
    dyorswap: ["你在自己钱包里签名后，由 DYORSwap 的合约执行。DeFiExit 不经手你的钱。", "After you sign in your own wallet, DYORSwap's contract carries it out. DeFiExit never touches your money."],
  };
  // 整句换掉的:不弹钱包的「下单卖出」;黄框那两步照各自的核对卡写,给出去的权限能做什么
  const OWN = {
    "hyperliquid/order": ["这一步在 Hyperliquid 上卖出，由你之前批准的下单密钥签名，钱包不会弹窗。DeFiExit 不经手你的钱。", "This sell order on Hyperliquid is signed by the order key you approved earlier, so no wallet pop-up appears. DeFiExit never touches your money."],
    "hyperliquid/enable": ["签名后，这个下单密钥能替你在 Hyperliquid 上下单，不再弹钱包。照核对卡逐项核对，对不上就拒绝。", "After you sign, this order key can place orders for you on Hyperliquid without your wallet popping up. Check the card line by line, and tap Reject if anything doesn't match."],
    "dyorswap/enable": ["签名后，DYORSwap 的路由合约能取用你的流动性代币（LP），数量就是这一次要撤的，不是无限额。照核对卡逐项核对，对不上就拒绝。", "After you sign, DYORSwap's router contract can take your liquidity tokens (LP): exactly the amount you're withdrawing now, not an unlimited amount. Check the card line by line, and tap Reject if anything doesn't match."],
  };
  for (const r of recipes) {
    for (const [k, f] of [[0, `dist/r/${r.id}/index.html`], [1, `dist/en/r/${r.id}/index.html`]]) {
      const g = read(f);
      const line = (s) => OWN[`${r.id}/${s.id}`]?.[k] || SIGNED[r.id][k];
      r.steps.forEach((s, i) => {
        const next = r.steps[i + 1];
        const sec = g.slice(g.indexOf(`id="s-${s.id}"`), g.indexOf(next ? `id="s-${next.id}"` : 'id="done"'));
        const tag = sec.slice(0, sec.indexOf(">"));
        const found = Object.fromEntries(["moves", "grants"].map((x) => [x, sec.match(new RegExp(`<p class="step-${x}">[\\s\\S]*?</p>`))?.[0]]));
        const kind = MOVES[r.id].includes(s.id) ? "moves" : GRANTS[r.id].includes(s.id) ? "grants" : null;
        for (const x of ["moves", "grants"]) if (x !== kind) assert.equal(found[x], undefined, `${f} ${s.id} 不该有 step-${x}`);
        if (!kind) return assert.ok(!tag.includes("data-funds"), `${f} ${s.id} 不该带 data-funds`);
        const badge = found[kind];
        assert.ok(badge, `${f} ${s.id} 缺 step-${kind}`);
        assert.match(sec, new RegExp(`</h2>\\s*<p class="step-${kind}">`), `${f} ${s.id}:要紧跟在标题下面`);
        // 字是真文字(读屏能读),图标只是装饰(aria-hidden);两种的图标也不一样,不只靠颜色;里面没有能点的东西,焦点顺序不变
        assert.ok(badge.includes(`${ICON[kind]}<span><b>${HEAD[kind][k]}</b> ${line(s)}</span>`), `${f} ${s.id} 的字不对:${badge}`);
        assert.ok(!/<(button|a|input)\b/.test(badge), `${f} ${s.id}`);
        assert.ok(tag.includes(` data-funds="${kind}"`), `${f} ${s.id} 缺 data-funds,路线上标不出来`);
      });
      assert.equal((g.match(/class="step-moves"/g) || []).length, MOVES[r.id].length, f);
      assert.equal((g.match(/class="step-grants"/g) || []).length, GRANTS[r.id].length, f);
      // 路线下面那一行先藏着:页面按这个账户用得到的步骤,两组各填上第几步(没有的那组藏起来)
      assert.ok(g.includes(`<p class="route-marks" id="routeMarks" hidden><span data-mark="moves"><span class="tag-moves">${ICON.moves}${k ? "Moves funds" : "动资产"}</span><span></span></span><span data-mark="grants"><span class="tag-grants">${ICON.grants}${k ? "Grants permission" : "给权限"}</span><span></span></span></p>`), f);
    }
  }
  assert.ok(!read("dist/r/hyperliquid/index.html").includes("Hyperliquid 的合约") && !read("dist/en/r/hyperliquid/index.html").includes("Hyperliquid's contract"));
  // 换了执行方、整句换掉的、黄框那句,英文版都要有;缺了构建直接报错
  const en = JSON.parse(read("recipes/hyperliquid/i18n/en.json"));
  const noBy = structuredClone(en), noText = structuredClone(en), noGrant = structuredClone(en);
  delete noBy.movesBy;
  delete noText.steps.order.movesText;
  delete noGrant.steps.enable.grantsText;
  assert.throws(() => localize(recipes[0], noBy, "en.json"), /movesBy/);
  assert.throws(() => localize(recipes[0], noText, "en.json"), /steps\.order\.movesText/);
  assert.throws(() => localize(recipes[0], noGrant, "en.json"), /steps\.enable\.grantsText/);
  assert.equal(STR.zh.stepsAt([7, 8, 9]), "第 7、8、9 步");
  assert.equal(STR.en.stepsAt([6]), "Step 6");
  assert.equal(STR.en.stepsAt([8, 9]), "Steps 8 and 9");
  assert.equal(STR.en.stepsAt([7, 8, 9]), "Steps 7, 8 and 9");
});

test("查到用户往前走了才说恭喜;往回退的只是提示", () => {
  for (const k of ["follow", "whereAt"]) {
    assert.match(STR.zh[k](6, "到账核对", true), /^恭喜/);
    assert.ok(!STR.zh[k](2, "找到池子", false).includes("恭喜"));
    assert.match(STR.en[k](6, "Check it arrived", true), /^Nice work/);
    assert.ok(!STR.en[k](2, "Find your pool", false).includes("Nice work"));
  }
});

test("每个网页都带 no-transform:Cloudflare 不往页面里插统计脚本;图片、样式、脚本不带(照样压缩);规则不超过 Cloudflare 认的 100 条", () => {
  const h = read("dist/_headers");
  assert.ok(headerRules(h).length <= 100, `_headers 有 ${headerRules(h).length} 条规则`);
  // dist 里每一个 index.html 就是一个网页,地址是它所在的目录
  const pages = [];
  const walk = (d) => { for (const f of readdirSync(d, { withFileTypes: true })) if (f.isDirectory()) walk(`${d}/${f.name}`); else if (f.name === "index.html") pages.push(`${d.slice(4)}/`); };
  walk("dist");
  for (const f of PAGES.filter((f) => f.endsWith("/index.html"))) assert.ok(pages.includes(f.slice(4, -10)), `没找到 ${f}`);
  for (const p of [...pages, "/404"]) assert.equal(headersFor(h, p).filter((x) => x === NT).length, 1, `${p} 要带一次 no-transform`);
  for (const p of ["/assets/site.css", "/assets/fonts/atkinson-next.woff2", "/r/hyperliquid/img/fill.webp"]) {
    assert.ok(existsSync(`dist${p}`), p);
    assert.ok(!headersFor(h, p).some((x) => x.includes("no-transform")), `${p} 不该带 no-transform`);
  }
  for (const p of ["/", "/en/r/woofi/", "/assets/site.css"]) assert.ok(headersFor(h, p).some((x) => x.startsWith("Content-Security-Policy: ")), `${p} 没有安全头`);
});

test("截止日历、专题:首页正文和顶栏导航都有入口;两页带 canonical 和 og 信息,标题不写领取类的词;倒数脚本拷进了网站", () => {
  const home = read("dist/index.html"), homeEn = read("dist/en/index.html");
  // 顶栏导航(电脑上显示);手机上顶栏不显示导航,靠首页正文里那一块
  assert.match(home, /<nav class="links" aria-label="DeFiExit"><a href="#how">[\s\S]*?<a href="\/deadlines\/">截止日历<\/a><a href="\/topics\/">专题<\/a><a href="https:\/\/github\.com/);
  assert.match(homeEn, /<nav class="links" aria-label="DeFiExit"><a href="#how">[\s\S]*?<a href="\/en\/deadlines\/">Exit deadlines<\/a><a href="\/en\/topics\/">Topics<\/a>/);
  assert.ok(home.includes('<a class="more-card" href="/deadlines/">') && home.includes('<a class="more-card" href="/topics/">'));
  assert.ok(homeEn.includes('<a class="more-card" href="/en/deadlines/">') && homeEn.includes('<a class="more-card" href="/en/topics/">'));
  // 截止日历页:导航里标出当前页;首页上的页内跳转换成「体检」回首页
  const dl = read("dist/deadlines/index.html");
  assert.ok(dl.includes('<a href="/deadlines/" aria-current="page">截止日历</a>') && dl.includes('<a href="/">体检</a>') && !dl.includes('href="#how"'));
  assert.ok(read("dist/en/deadlines/index.html").includes('<a href="/en/">Checkup</a>'));
  assert.ok(dl.includes('<script type="module" src="/assets/js/deadlines.js"></script>'));
  assert.ok(existsSync("dist/assets/js/deadlines.js") && existsSync("dist/assets/js/lib/deadline.js"));
  for (const [f, url] of [["dist/deadlines/index.html", "/deadlines/"], ["dist/en/deadlines/index.html", "/en/deadlines/"], ["dist/topics/index.html", "/topics/"], ["dist/en/topics/index.html", "/en/topics/"]]) {
    const h = read(f);
    assert.ok(h.includes(`<link rel="canonical" href="https://defiexit.com${url}">`), f);
    assert.ok(h.includes(`<meta property="og:url" content="https://defiexit.com${url}">`), f);
    assert.match(h, /<meta property="og:title" content="[^"]+">\n<meta property="og:description" content="[^"]+">/, f);
    assert.ok(!TITLE_BAN.test(h.match(/<title>([^<]*)<\/title>/)[1]), `${f} 的标题写了领取类的词`);
    // 顶栏里已经有语言和深浅色,页脚不再放一遍
    assert.ok(!h.includes('class="foot-tools"'), f);
  }
});

test("专题:data/topics 里的每一篇都出了中英两页,列表里都有;英文页没有中文,不用内联脚本和样式,也带 no-transform", () => {
  const slugs = readdirSync("data/topics").filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
  assert.ok(slugs.length > 0);
  const headers = read("dist/_headers");
  for (const s of slugs) {
    for (const P of ["", "/en"]) {
      const f = `dist${P}/topics/${s}/index.html`;
      const h = read(f);
      assert.ok(read(`dist${P}/topics/index.html`).includes(`<a href="${P}/topics/${s}/">`), `${f} 不在列表里`);
      assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/.test(h) && !/\sstyle="/.test(h), f);
      assert.ok(headersFor(headers, `${P}/topics/${s}/`).includes(NT), f);
      if (P) assert.equal(h.replace(/<nav class="langs"[\s\S]*?<\/nav>/g, "").match(/[　-〿一-鿿＀-￯]+/), null, f);
    }
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
  // 只有接口和运营台走函数(运营台要先看主机名);网页、图片还是静态文件
  assert.deepEqual(JSON.parse(read("dist/_routes.json")), { version: 1, include: ["/api/*", "/admin", "/admin/*"], exclude: [] });
  const h = read("dist/_headers");
  assert.match(h, /img-src 'self' data: blob:/);
  assert.ok(!h.includes("unsafe-eval") && !h.includes("unsafe-inline"));
  // 截图求助不用人机验证:用户是卡住了才来传图,不能再让他们过一关
  assert.ok(!h.includes("challenges.cloudflare.com"));
  for (const f of PAGES) assert.ok(!read(f).includes("dx-turnstile"), `${f} 不该带人机验证`);
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

test("体检结果页:WOOFi 配方写明在 Zerion 里对应的项目名和链;Hyperliquid 不对应", () => {
  for (const f of ["dist/check/index.html", "dist/en/check/index.html"]) {
    const h = read(f);
    const li = h.match(/<li data-id="woofi"[^>]*>/)?.[0] || "";
    assert.ok(/data-zerion="[^"]*WOOFi[^"]*Arbitrum[^"]*"/.test(li), li);
    const hl = h.match(/<li data-id="hyperliquid"[^>]*>/)?.[0] || "";
    assert.ok(hl.includes('data-zerion="null"'), "Hyperliquid 的仓位不在 Zerion 里,不对应");
  }
});

// 放在这个文件里:测试文件是并行跑的,别的文件去读 dist/,可能正赶上这里在删了重建
test("体检结果页:有取回弹层;链图标拷进了网站", () => {
  for (const f of ["dist/check/index.html", "dist/en/check/index.html"]) {
    const h = read(f);
    assert.ok(h.includes('<dialog class="sheet" id="exitSheet" aria-labelledby="exitH">'), f);
    assert.match(h, /<li data-id="woofi"[^>]*data-chain="arbitrum"/);
  }
  assert.ok(existsSync("dist/assets/chains/xlayer.svg") && existsSync("dist/assets/chains/merlin.webp"));
});

test("体检结果页:最上面(结果概要前面)留着截止提醒的位置;截止日历按页面语言嵌在页面里,不另外发请求(没有 data/deadlines.json 就是空列表)", () => {
  for (const f of ["dist/check/index.html", "dist/en/check/index.html"]) {
    const h = read(f);
    const box = h.indexOf('<section class="dues" id="dueBox"');
    assert.ok(box > 0 && box < h.indexOf('id="sum"'), f);
    assert.match(h, /<ul id="due" hidden>(<li data-event="[^"]*"><\/li>)*<\/ul>/);
  }
});
