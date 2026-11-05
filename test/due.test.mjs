// 截止提醒:体检查到的东西对上截止日历(src/js/lib/due.js),结果最上面一个事件一张卡;构建时按页面语言把截止日历嵌进体检结果页(scripts/build.mjs)。
// 数据是编的(test/fixtures/due-deadlines.json;后面几项用真的 data/deadlines.json),查到的东西也是编的,合约地址也是编的;不连网,也不重建 dist/(build.test.mjs 在别的进程里删了重建)。
// 单独一个文件:要换掉全局的 document(node --test 每个文件一个进程,不影响别的测试)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { upcoming, holdings, matchDue, dueCard, dueKey, dueView, dueKind, httpsHost } from "../src/js/lib/due.js";
import { daysLeft } from "../src/js/lib/deadline.js";
import { checkDeadlines, dueList, deadlinesPage, texts, DL_TYPES, TITLE_BAN } from "../scripts/build.mjs";
import { makeT } from "../src/js/lib/i18n.js";

// 很小的假页面:只够 el() 和 icon() 建节点
class FakeNode {
  constructor(tag) { this.tag = tag; this.className = ""; this.attrs = {}; this.children = []; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  append(...xs) { this.children.push(...xs); }
}
globalThis.Node = FakeNode;
globalThis.document = { createElement: (tag) => new FakeNode(tag), createElementNS: (_, tag) => new FakeNode(tag) };
const text = (n) => (typeof n === "string" ? n : n.children.map(text).join(""));
const all = (n, f) => (typeof n === "string" ? [] : [...(f(n) ? [n] : []), ...n.children.flatMap((c) => all(c, f))]);
const tagText = (n, tag) => all(n, (x) => x.tag === tag).map(text);

// 截止日历只有一个校验(build.mjs 的 checkDeadlines):编的数据也要过它
const FIX = JSON.parse(readFileSync("test/fixtures/due-deadlines.json", "utf8"));
const EV = checkDeadlines(structuredClone(FIX), "test/fixtures/due-deadlines.json").events;
// 「现在」是 11-05 的 UTC 中午;日子按 UTC 算(lib/deadline.js)
const TODAY = new Date("2026-11-05T12:00:00Z"), DAY = "2026-11-05";
const ev = (id) => EV.find((e) => e.id === id);
// 页面上查到的东西,样子照体检结果页里的(Zerion 经 /api/assets 传来的钱包余额、项目仓位)。
// 币写成 "CAKE" 或 "CAKE@0x合约":接口传来的每个币都带 addr(合约,小写;原生币、认不出来的是 null)
const coin = (s) => {
  const [sym, addr = null] = s.split("@");
  return { sym, addr };
};
const wallet = (cid, chain, ...coins) => ({ cid, chain, usd: 10, tokens: coins.map((s) => ({ ...coin(s), qty: 1, usd: 10 })) });
const defi = (app, cid, chain, ...coins) => ({ app, cid, chain, usd: 10, debt: 0, items: coins.map((s) => ({ type: "deposit", ...coin(s), qty: 1, usd: 10 })) });
// 编的合约地址:fixture 里的 CAKE;同名的仿冒币
const CAKE = `0x${"ca4e".repeat(10)}`, FAKE = `0x${"ab".repeat(20)}`;
const hit = (events, held, today = TODAY) => matchDue(events, holdings(held), today);
const ids = (list) => list.map((m) => m.e.id);
// 构建嵌进页面的那一份,原样读回来(浏览器读的就是它)
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const embedded = (lang, today = TODAY) => [...dueList(lang, EV, today).matchAll(/<li data-event="([^"]*)"><\/li>/g)].map((m) => JSON.parse(unesc(m[1])));
// 真的截止日历,和嵌进体检结果页的那一份(提醒卡用的就是它)
const REAL = checkDeadlines(JSON.parse(readFileSync("data/deadlines.json", "utf8"))).events;
const realEmb = (lang, now = TODAY) => [...dueList(lang, REAL, now).matchAll(/<li data-event="([^"]*)"><\/li>/g)].map((m) => JSON.parse(unesc(m[1])));
// 真的截止日历,只把按币对的那几条换成编的合约(每条 EVM 链一个,地址由事件编号和链名编出来):测排序、截止的时间、下一步时,不跟着数据里的真地址变。
// 数据里写的真地址对不对得上,见「真的截止日历里写的每个合约」那一项
const TOKEN_IDS = ["meth-cmeth-rewards", "gmo-gyen-zusd-redemption", "universal-uassets-winddown", "pancakeswap-opbnb-cake", "stargate-stg-zro", "standx-winddown", "parasail-pfil", "parasail-stpeaq", "aero-merger", "venus-vai-lisusd", "awe-stpt-migration", "vanar-vanry-migration"];
const fake = (id, chain) => `0x${createHash("sha1").update(`${id} ${chain}`).digest("hex")}`;
const SIM = REAL.map((e) => (!TOKEN_IDS.includes(e.id) ? e : {
  ...e, matchBy: "token", tokenKeys: e.tokenKeys || ["x"],
  // 币名照数据里这个币核对过的写法(cmETH、uSOL…)
  tokenContracts: e.chainKeys.filter((k) => !["stellar", "solana"].includes(k)).map((chain) => ({ chain, token: (e.tokenKeys || ["x"])[0], symbol: (e.tokenContracts || []).find((c) => c.token === (e.tokenKeys || ["x"])[0])?.symbol || "X", address: fake(e.id, chain), source: "https://example.com/" })),
}));
const simEmb = (lang, now = TODAY) => [...dueList(lang, SIM, now).matchAll(/<li data-event="([^"]*)"><\/li>/g)].map((m) => JSON.parse(unesc(m[1])));
// 编的合约上的币:sim("standx-winddown", "bsc", "DUSD") 是 "DUSD@0x…"
const sim = (id, chain, sym) => `${sym}@${fake(id, chain)}`;

test("截止提醒·按链对(matchBy: chain):Zerion 的链编号、显示名、本站的链名都认,大小写和横线不算;链上钱包里、项目里的都算", () => {
  assert.deepEqual(ids(hit(EV, { wallet: [wallet("abstract", "Abstract", "ETH")] })), ["abstract-chain-shutdown"]);
  const s = hit(EV, { wallet: [wallet("sophon", "Sophon", "SOPH")], defi: [defi("SophSwap", "sophon", "Sophon", "USDC")] });
  assert.deepEqual(ids(s), ["sophon-chain-shutdown"]);
  assert.deepEqual(s[0].where, ["Sophon"], "钱包里的、项目里的都在 Sophon 上:标题只说一次");
  assert.equal(s[0].left, 20);
  // 键的写法和 Zerion 的不一样也认:X-Layer 对 okbchain(本站的链名是 xlayer),BNB 对 binance-smart-chain
  const x = [
    { id: "x", type: "chain-shutdown", matchBy: "chain", deadline: "2026-12-01", chains: ["X Layer"], chainKeys: ["X-Layer"] },
    { id: "b", type: "chain-shutdown", matchBy: "chain", deadline: "2026-12-01", chains: ["BNB Chain"], chainKeys: ["BNB"] },
  ];
  assert.deepEqual(ids(hit(x, { wallet: [wallet("okbchain", "X Layer", "OKB"), wallet("binance-smart-chain", "BNB Chain", "BNB")] })), ["x", "b"]);
  // 截止日历把 BNB Chain 写成 bsc(本站的链名是 bnb):Zerion 的 binance-smart-chain 也对得上
  const bsc = [{ id: "s", type: "chain-shutdown", matchBy: "chain", deadline: "2026-12-01", chains: ["BNB Chain"], chainKeys: ["bsc"] }];
  assert.deepEqual(hit(bsc, { wallet: [wallet("binance-smart-chain", "BNB Chain", "BNB")] })[0].where, ["BNB Chain"]);
  // 不在这几条链上的不提醒;按链对的,别的链上同名项目的仓位也不算(宁可少提醒)
  assert.deepEqual(hit(EV, { wallet: [wallet("ethereum", "Ethereum", "ETH")], defi: [defi("Uniswap V3", "base", "Base", "WETH"), defi("sophon", "ethereum", "Ethereum", "ETH")] }), []);
});

test("截止提醒·按项目对(matchBy: protocol):项目名一样或者以「键-」开头(PancakeSwap V3 算、PancakeSwapX 不算);只关一个版本的,键带版本", () => {
  // 只写了项目的事件:哪条链上的仓位都算;钱包里的币、名字只是开头像的项目不算
  const aave = [{ id: "aave-x", type: "withdraw-only", matchBy: "protocol", deadline: "2026-12-01", protocol: "Aave", protocolKeys: ["AAVE"] }];
  assert.deepEqual(hit(aave, { defi: [defi("Aave V3", "base", "Base", "USDC")] })[0].where, ["Aave"], "按项目对上的,标题说项目(用 data 里的写法)");
  assert.deepEqual(hit(aave, { defi: [defi("Aavegotchi", "polygon", "Polygon", "GHST")], wallet: [wallet("ethereum", "Ethereum", "AAVE")] }), []);
  // 只关 V1 的:键写 stargate-v1,对得上 Stargate V1;对不上 Stargate V2,也对不上没写版本的 Stargate
  const v1 = [{ id: "v1", type: "bridge-route-end", matchBy: "protocol", deadline: "2026-12-15", protocol: "Stargate", protocolKeys: ["stargate-v1"] }];
  assert.deepEqual(ids(hit(v1, { defi: [defi("Stargate V1", "arbitrum", "Arbitrum", "USDC")] })), ["v1"]);
  assert.deepEqual(hit(v1, { defi: [defi("Stargate V2", "arbitrum", "Arbitrum", "USDC"), defi("Stargate", "ethereum", "Ethereum", "ETH")] }), []);
  // 我们自己查到的配方仓位:按配方的协议名、编号和链对
  const r = { id: "woofi", protocol: "WOOFi", chain: "arbitrum" };
  assert.deepEqual(hit([{ id: "w", type: "withdraw-only", matchBy: "protocol", deadline: "2026-12-01", protocol: "WOOFi", protocolKeys: ["woofi"] }], { found: [{ r }] })[0].where, ["WOOFi"]);
  assert.deepEqual(hit([{ id: "a", type: "chain-shutdown", matchBy: "chain", deadline: "2026-12-01", chains: ["Arbitrum"], chainKeys: ["arbitrum"] }], { found: [{ r }] })[0].where, ["Arbitrum"]);
  // 写了链和项目的:那条链上有钱、但不在这个项目里的,不提醒;这个项目在别的链上的,也不提醒
  const sunset = [{ id: "aave-eth", type: "withdraw-only", matchBy: "protocol", deadline: "2026-12-01", protocol: "Aave", chains: ["Ethereum"], chainKeys: ["ethereum"], protocolKeys: ["aave"] }];
  assert.deepEqual(hit(sunset, { wallet: [wallet("ethereum", "Ethereum", "ETH")], defi: [defi("Aave V3", "base", "Base", "USDC"), defi("Lido", "ethereum", "Ethereum", "stETH")] }), []);
  assert.deepEqual(ids(hit(sunset, { defi: [defi("Aave V3", "ethereum", "Ethereum", "USDC")] })), ["aave-eth"]);
});

test("截止提醒·按币对(matchBy: token):只认「链 + 合约地址」(钱包里的、仓位里的、排在 8 种以后的);同名的仿冒币、别的链上的同一个地址、只有符号的都不提醒", () => {
  const cake = `CAKE@${CAKE}`;
  // opBNB 上钱包里的 CAKE、带 CAKE 的池子:提醒,标题说 opBNB(data 里的写法);合约的大小写不算
  assert.deepEqual(hit(EV, { wallet: [wallet("opbnb", "Opbnb", cake, "BNB")] })[0].where, ["opBNB"]);
  assert.deepEqual(hit(EV, { defi: [defi("PancakeSwap V3", "opbnb", "Opbnb", cake, "BNB")] })[0].where, ["opBNB"]);
  assert.deepEqual(ids(hit(EV, { wallet: [wallet("opbnb", "Opbnb", `CAKE@0x${CAKE.slice(2).toUpperCase()}`)] })), ["opbnb-cake-bridge-end"]);
  // 同一个项目、不带 CAKE 的池子;opBNB 上只有 BNB;BNB Chain 上的同一个地址;名字像的别的项目:都不提醒
  assert.deepEqual(hit(EV, {
    wallet: [wallet("opbnb", "Opbnb", "BNB"), wallet("binance-smart-chain", "BNB Chain", cake)],
    defi: [defi("PancakeSwap V3", "opbnb", "Opbnb", `USDT@0x${"1".repeat(40)}`, `WBNB@0x${"2".repeat(40)}`), defi("PancakeSwap", "binance-smart-chain", "BNB Chain", cake), defi("PancakeSwapX", "opbnb", "Opbnb", "USDT")],
  }), []);
  // 同名的仿冒币(合约不一样)、只有符号没有合约的:钱包里、池子里都不提醒——宁可不提醒,也不提醒错
  assert.deepEqual(hit(EV, { wallet: [wallet("opbnb", "Opbnb", `CAKE@${FAKE}`, "CAKE")], defi: [defi("PancakeSwap V3", "opbnb", "Opbnb", `CAKE@${FAKE}`, "CAKE")] }), []);
  // 钱包里排在 8 种以后的币,接口传符号和合约(rest),照样对得上;只有符号的(旧版接口 10 分钟内的缓存)、合约不对的对不上
  assert.deepEqual(ids(hit(EV, { wallet: [{ ...wallet("opbnb", "Opbnb", "BNB"), rest: [{ sym: "CAKE", addr: CAKE }] }] })), ["opbnb-cake-bridge-end"]);
  assert.deepEqual(hit(EV, { wallet: [{ ...wallet("opbnb", "Opbnb", "BNB"), rest: ["CAKE", { sym: "CAKE", addr: FAKE }, { sym: "CAKE" }] }] }), []);
  // 我们自己查到的配方仓位不带币,按币对的事件对不上
  assert.deepEqual(hit(EV, { found: [{ r: { id: "x", protocol: "PancakeSwap", chain: "opbnb" } }] }), []);
  // 没写怎么对(matchBy 是 null 或没写):键写得再全也不提醒
  const keys = { type: "chain-shutdown", deadline: "2026-12-01", chains: ["Ethereum"], chainKeys: ["ethereum"], protocolKeys: ["aave"] };
  assert.deepEqual(hit([{ id: "n", ...keys }, { id: "m", matchBy: null, ...keys }], { wallet: [wallet("ethereum", "Ethereum", "ETH")], defi: [defi("Aave V3", "ethereum", "Ethereum", "USDC")] }), []);
});

test("审查报的误报:BNB Chain 上叫 DUSD、合约是 0xabab…ab 的币,在前 8 种里、排第 9 以后只经 rest 传来,都不再提醒 StandX;对上核对过的地址才提醒", () => {
  // 编的事件,样子照真的 standx-winddown(BNB Chain、Solana 上的 DUSD;Solana 的地址不是 0x 的,不写);核对过的地址也是编的
  const DUSD = `0x${"d05d".repeat(10)}`;
  const sx = [{ id: "sx", type: "withdraw-only", matchBy: "token", deadline: "2027-01-31", chains: ["BNB Chain", "Solana"], chainKeys: ["bsc", "solana"], tokenKeys: ["dusd"], tokenContracts: [{ chain: "bsc", token: "dusd", address: DUSD }] }];
  const bsc = (...c) => wallet("binance-smart-chain", "BNB Chain", ...c);
  const top8 = ["BNB", "USDT", "USDC", "ETH", "BTCB", "XRP", "DOGE", "ADA"];
  // 假的:在前 8 种里;排第 9 以后只经 rest 传来;只有符号(旧缓存)
  assert.deepEqual(hit(sx, { wallet: [bsc(`DUSD@${FAKE}`)] }), []);
  assert.deepEqual(hit(sx, { wallet: [{ ...bsc(...top8), rest: [{ sym: "DUSD", addr: FAKE }] }] }), []);
  assert.deepEqual(hit(sx, { wallet: [bsc("DUSD"), { ...bsc(...top8), rest: ["DUSD"] }] }), []);
  // 真的:在前 8 种里、只经 rest 传来、在 PancakeSwap 的 DUSD 池子里,都提醒,标题说 BNB Chain
  assert.deepEqual(hit(sx, { wallet: [bsc(`DUSD@${DUSD}`)] })[0].where, ["BNB Chain"]);
  assert.deepEqual(hit(sx, { wallet: [{ ...bsc(...top8), rest: [{ sym: "DUSD", addr: DUSD }] }] })[0].where, ["BNB Chain"]);
  assert.deepEqual(ids(hit(sx, { defi: [defi("PancakeSwap V3", "binance-smart-chain", "BNB Chain", `DUSD@${DUSD}`, "USDT")] })), ["sx"]);
  // 地址对、链不对:以太坊上的同一个地址不算(不在这个事件的链上);事件写了以太坊、但合约只写了 BNB Chain 的,以太坊上的也不算
  assert.deepEqual(hit(sx, { wallet: [wallet("ethereum", "Ethereum", `DUSD@${DUSD}`)] }), []);
  const two = [{ ...sx[0], chains: ["BNB Chain", "Ethereum"], chainKeys: ["bsc", "ethereum"] }];
  assert.deepEqual(hit(two, { wallet: [wallet("ethereum", "Ethereum", `DUSD@${DUSD}`)] }), []);
  // 符号对、合约不对:哪种都不算(符号本身不参与对)
  assert.deepEqual(hit(sx, { wallet: [bsc(`USDT@${DUSD}`)] })[0].where, ["BNB Chain"], "按合约对:地址是 DUSD 的就是 DUSD,不管接口传来的符号写什么");
  // 真的截止日历也一样:BNB Chain 上的假 DUSD(前 8 种里、rest 里、只有符号的)哪一条都不提醒
  assert.deepEqual(hit(REAL, { wallet: [bsc(`DUSD@${FAKE}`, "DUSD"), { ...bsc(...top8), rest: [{ sym: "DUSD", addr: FAKE }, "DUSD"] }] }), []);
});

test("截止提醒:过了的不提;没定日子的照样提醒、排在最后;最急的排最前", () => {
  const held = { wallet: [wallet("sophon", "Sophon", "SOPH"), wallet("abstract", "Abstract", "ETH"), wallet("opbnb", "Opbnb", `CAKE@${CAKE}`), wallet("ethereum", "Ethereum", "ETH")], defi: [defi("OldVault", "ethereum", "Ethereum", "USDC")] };
  assert.deepEqual(ids(hit(EV, held)), ["opbnb-cake-bridge-end", "sophon-chain-shutdown", "abstract-chain-shutdown"], "OldVault 10-31 就截止了,不提");
  assert.deepEqual(hit(EV, held).map((m) => m.left), [18, 20, 40]);
  const m = hit([...EV, { ...ev("abstract-chain-shutdown"), id: "abstract-tbd", deadline: null }], held);
  assert.equal(m.at(-1).e.id, "abstract-tbd");
  assert.equal(m.at(-1).left, null);
  assert.deepEqual(upcoming(EV, TODAY).map((e) => e.id), ["sophon-chain-shutdown", "abstract-chain-shutdown", "opbnb-cake-bridge-end"]);
});

test("截止提醒:只写了日子的按那一天 UTC 结束算(和截止日历页同一个算法)——截止日当天(UTC)还提醒、写还剩几小时,UTC 第二天零点起不提", () => {
  assert.equal(daysLeft("2026-11-25", new Date("2026-11-05T00:00:00Z")), 20);
  assert.equal(daysLeft("2027-01-01", new Date("2026-12-31T23:59:59Z")), 1);
  const held = { wallet: [wallet("sophon", "Sophon", "SOPH")] };
  const last = hit(EV, held, new Date("2026-11-25T23:59:59Z"));
  assert.deepEqual(ids(last), ["sophon-chain-shutdown"]);
  assert.equal(last[0].left, 0);
  // 北京时间已经是 11-26 早上 7 点,UTC 还是 11-25:照样提醒,卡上写「按 UTC 算,今天是截止日(11 月 25 日)」,不写几小时(官方没写几点截止)
  const bj7 = new Date("2026-11-25T23:00:00Z");
  assert.equal(hit(EV, held, bj7)[0].left, 0);
  assert.equal(tagText(dueCard(matchDue(embedded("zh", bj7), holdings(held), bj7)[0], makeT("zh"), "zh", bj7), "b")[0], "按 UTC 算，今天是截止日（11 月 25 日）");
  assert.equal(tagText(dueCard(matchDue(embedded("en", bj7), holdings(held), bj7)[0], makeT("en"), "en", bj7), "b")[0], "Deadline day (UTC): Nov 25");
  // 前一天(UTC 11-24 中午):倒数算到 11-25 00:00 UTC,还剩 12 小时
  const d1 = new Date("2026-11-24T12:00:00Z");
  assert.equal(tagText(dueCard(matchDue(embedded("zh", d1), holdings(held), d1)[0], makeT("zh"), "zh", d1), "b")[0], "还剩 12 小时");
  assert.deepEqual(hit(EV, held, new Date("2026-11-26T00:00:00Z")), [], "UTC 11-26 零点,已经过了");
  // 构建时也按 UTC 放:当天还放进页面,第二天就不放
  assert.ok(dueList("zh", EV, new Date("2026-11-25T12:00:00Z")).includes("sophon-chain-shutdown"));
  assert.ok(!dueList("zh", EV, new Date("2026-11-26T00:00:00Z")).includes("sophon-chain-shutdown"));
});

test("提醒卡:标题说在哪儿、哪天前要提回;还剩多少时间、这是什么事、怎么办;官方链接新窗口打开、不带来源、写出域名;截止日历链到 /deadlines/#编号", () => {
  const zhE = embedded("zh").find((e) => e.id === "sophon-chain-shutdown");
  const z = dueCard({ e: zhE, where: ["Sophon"] }, makeT("zh"), "zh", TODAY);
  assert.equal(z.tag, "article");
  assert.equal(z.attrs["data-due"], "sophon-chain-shutdown");
  assert.deepEqual(tagText(z, "h2"), ["你在 Sophon 上还有资产：11 月 25 日前要转出来"]);
  assert.equal(tagText(z, "b")[0], "还有 19 天", "只写了 11-25:算到 11-25 00:00 UTC(19 天 12 小时)");
  const body = text(z);
  for (const s of ["Sophon 链停止运行", "官方桥不再处理", "用官方桥把 Sophon 上的币提回以太坊主网", "私信你的「客服」都是骗子"]) assert.ok(body.includes(s), s);
  assert.ok(!body.includes("**"), "标记去掉了,只放纯文字");
  const links = all(z, (n) => n.tag === "a");
  assert.deepEqual(links.map((n) => n.attrs.href), ["https://example.com/sophon/shutdown", "/deadlines/#sophon-chain-shutdown"]);
  assert.equal(links[0].attrs.rel, "noopener noreferrer");
  assert.equal(links[0].attrs.target, "_blank");
  assert.equal(text(links[0]), "官方公告 example.com", "链接上写出域名");
  assert.equal(text(links[1]), "看截止日历");
  assert.ok(all(z, (n) => n.tag === "svg").length >= 1, "带警示图标(只是图标,字里也写着)");

  const enE = embedded("en").find((e) => e.id === "sophon-chain-shutdown");
  const e = dueCard({ e: enE, where: ["Sophon"] }, makeT("en"), "en", TODAY);
  assert.deepEqual(tagText(e, "h2"), ["You still have assets on Sophon: move them out before Nov 25"], "只写了日子的说 before(宁早勿晚)");
  assert.equal(tagText(e, "b")[0], "19 days left");
  assert.ok(text(e).includes("Sophon chain shuts down"));
  assert.deepEqual(all(e, (n) => n.tag === "a").map((n) => n.attrs.href), ["https://example.com/sophon/shutdown", "/en/deadlines/#sophon-chain-shutdown"]);
  assert.equal(text(all(e, (n) => n.tag === "a")[1]), "See the deadline calendar");
});

test("提醒卡:48 小时以内写还剩几小时(不说今天、明天截止);没定日子的;不是今年的写上年份;不是 https:// 的官方链接不显示", () => {
  const zh = makeT("zh"), en = makeT("en");
  const base = { id: "x", type: "chain-shutdown", name: "X", todo: "do it", official: [{ label: "坏链接", url: "javascript:alert(1)" }, { label: "明文", url: "http://example.com/" }, { label: "坏网址", url: "https://%zz/" }] };
  const card = (deadline, where = ["X"], t = zh, lang = "zh", now = TODAY, deadlineAt) => dueCard({ e: { ...base, deadline, deadlineAt }, where }, t, lang, now);
  // 「现在」是 11-05 的 UTC 中午,只写了日子的算到那一天 00:00 UTC:11-05 当天写截止日(不写几小时),11-06 的还剩 12 小时,
  // 11-07 的还剩 36 小时,11-08 的还有 2 天
  const ds = [DAY, "2026-11-06", "2026-11-07", "2026-11-08"];
  assert.deepEqual(ds.map((d) => tagText(card(d), "b")[0]), ["按 UTC 算，今天是截止日（11 月 5 日）", "还剩 12 小时", "还剩 36 小时", "还有 2 天"]);
  assert.deepEqual(ds.map((d) => tagText(card(d, ["X"], en, "en"), "b")[0]), ["Deadline day (UTC): Nov 5", "12 hours left", "36 hours left", "2 days left"]);
  // 写了截止时间的,最后几十分钟写「不到 1 小时」
  const late = new Date("2026-11-05T23:30:00Z");
  assert.equal(tagText(card("2026-11-06", ["X"], zh, "zh", late, "2026-11-06T00:00:00Z"), "b")[0], "还剩不到 1 小时");
  assert.equal(tagText(card("2026-11-06", ["X"], en, "en", late, "2026-11-06T00:00:00Z"), "b")[0], "Less than 1 hour left");
  const tbd = card(null);
  assert.deepEqual(tagText(tbd, "h2"), ["这个项目有退出安排，看官方怎么说"], "没定日子的,标题说得中性");
  assert.equal(tagText(tbd, "b")[0], "官方没定截止日期", "不说「还没公布」:有的官方说了没有截止日");
  assert.equal(tagText(card(null, ["X"], en, "en"), "b")[0], "No deadline set");
  assert.deepEqual(tagText(card(null, ["X"], en, "en"), "h2"), ["This project has an exit plan: check the official notice"]);
  assert.deepEqual(tagText(card("2027-01-31", ["X", "Y"]), "h2"), ["你在 X、Y 上还有资产：2027 年 1 月 31 日前要转出来"]);
  assert.deepEqual(tagText(card("2027-01-31", ["X", "Y"], en, "en"), "h2"), ["You still have assets on X, Y: move them out before Jan 31, 2027"]);
  // 写了截止时间、截止在那一天里的说 by;截止在那一天 00:00 的说 before
  assert.deepEqual(tagText(card("2026-11-11", ["X"], en, "en", TODAY, "2026-11-11T23:59:59-05:00"), "h2"), ["You still have assets on X: move them out by Nov 11"]);
  assert.deepEqual(tagText(card("2026-11-23", ["X"], en, "en", TODAY, "2026-11-23T00:00:00Z"), "h2"), ["You still have assets on X: move them out before Nov 23"]);
  // 汉字的链名、项目名前后不空格
  assert.deepEqual(tagText(card("2026-11-25", ["某链"]), "h2"), ["你在某链上还有资产：11 月 25 日前要转出来"]);
  // 审查报的:Silicon 12-31 12:00(UTC+9)截止,北京时间 12-30 中午看,卡上写还剩 23 小时,不写「今天截止」
  const bj = new Date("2026-12-30T12:00:00+08:00");
  assert.equal(tagText(card("2026-12-31", ["Silicon"], zh, "zh", bj, "2026-12-31T12:00:00+09:00"), "b")[0], "还剩 23 小时");
  assert.equal(tagText(card("2026-12-31", ["Silicon"], en, "en", bj, "2026-12-31T12:00:00+09:00"), "b")[0], "23 hours left");
  // 只剩本站截止日历那一条链接
  assert.deepEqual(all(tbd, (n) => n.tag === "a").map((n) => n.attrs.href), ["/deadlines/#x"]);
  assert.equal(httpsHost("https://Example.COM/a?b=1"), "example.com");
  for (const u of ["http://example.com/", "javascript:alert(1)", "https://%zz/", "https://defiexit.com@example.com/", "", undefined]) assert.equal(httpsHost(u), "", String(u));
});

test("提醒卡标题按事件类型说:要转出来的、要换新的币、要赎回的稳定币、往期奖励;别的类型和没定日子的说得中性;标题里不写领取类的词", () => {
  const zh = makeT("zh"), en = makeT("en");
  const h2 = (type, deadline, t = zh, lang = "zh") => tagText(dueCard({ e: { id: "x", type, name: "X", deadline }, where: ["opBNB"] }, t, lang, TODAY), "h2")[0];
  for (const type of ["chain-shutdown", "withdraw-only", "frontend-down", "bridge-route-end"]) {
    assert.equal(h2(type, "2026-11-23"), "你在 opBNB 上还有资产：11 月 23 日前要转出来", type);
    assert.equal(h2(type, "2026-11-23", en, "en"), "You still have assets on opBNB: move them out before Nov 23", type);
  }
  assert.equal(h2("token-migration", "2026-12-15"), "你有要换新的币：12 月 15 日前换，过了换得少或换不了");
  assert.equal(h2("token-migration", "2026-12-15", en, "en"), "You hold a token being migrated: convert it before Dec 15");
  assert.equal(h2("stablecoin-redemption", "2026-11-11"), "你有要清盘的稳定币：11 月 11 日前赎回");
  assert.equal(h2("stablecoin-redemption", "2026-11-11", en, "en"), "You hold a stablecoin being wound down: redeem it before Nov 11");
  // 往期奖励:说成「如果」(手里有币不等于还有奖励没领,截止的只是领奖励)
  assert.equal(h2("rewards-deadline", "2027-02-01"), "如果你还有往期奖励没领，2027 年 2 月 1 日前去领");
  assert.equal(h2("rewards-deadline", "2027-02-01", en, "en"), "If you still have uncollected past rewards, collect them before Feb 1, 2027");
  // 别的类型、没定日子的:中性
  for (const [type, d] of [["other", "2026-11-17"], ["chain-shutdown", null], ["token-migration", null], ["no-such-type", "2026-12-01"]]) {
    assert.equal(h2(type, d), "这个项目有退出安排，看官方怎么说", `${type} ${d}`);
    assert.equal(h2(type, d, en, "en"), "This project has an exit plan: check the official notice", `${type} ${d}`);
  }
  // 截止日历用的每一种类型都有说法,标题里都不写 claim / recover / 领取 / 找回
  assert.deepEqual(DL_TYPES.map(dueKind), ["move", "move", "move", "swap", "move", "redeem", "rewards", "other"]);
  for (const type of DL_TYPES) for (const [t, lang] of [[zh, "zh"], [en, "en"]]) for (const d of ["2026-12-01", null]) assert.ok(!TITLE_BAN.test(h2(type, d, t, lang)), `${lang} ${type} ${d}`);
});

test("构建:截止日历按页面语言嵌进体检结果页;过了的不放;英文版里没有中文;没有事件就是一个空列表", () => {
  const zh = embedded("zh"), en = embedded("en");
  assert.deepEqual(zh.map((e) => e.id), ["sophon-chain-shutdown", "abstract-chain-shutdown", "opbnb-cake-bridge-end"], "10-31 截止的 OldVault 过了,不放");
  assert.deepEqual(en.map((e) => e.id), zh.map((e) => e.id));
  const [s, a, c] = zh;
  assert.equal(s.name, "Sophon 链停止运行");
  assert.equal(en[0].name, "Sophon chain shuts down");
  assert.equal(s.todo, "用官方桥把 Sophon 上的币提回以太坊主网。提现要等几个小时,别拖到最后一天。", "**、` 标记去掉");
  assert.deepEqual(s.official, [{ label: "官方公告", url: "https://example.com/sophon/shutdown" }]);
  assert.deepEqual([s.deadline, s.type, s.chainKeys, s.protocolKeys], ["2026-11-25", "chain-shutdown", ["sophon"], ["sophon"]]);
  // 按币对的只嵌核对过的合约(链 + 地址 + 核对过的币名),不嵌出处
  assert.deepEqual(c.tokenContracts, [{ chain: "opbnb", address: CAKE, symbol: "CAKE" }]);
  assert.ok(!("tokenKeys" in c));
  assert.deepEqual(s.tokenContracts, []);
  assert.equal(a.caution, "", "没写的就是空的");
  assert.equal(dueList("en", EV, TODAY).match(/[　-〿一-鿿＀-￯]/), null);
  // 嵌在属性里:引号、尖括号都转义了,写不进 HTML
  const odd = checkDeadlines({ checked: "2026-11-05", events: [{ ...structuredClone(FIX.events[1]), name: { zh: '"><img src=x>', en: '"><img src=x>' } }] }).events;
  assert.ok(!dueList("zh", odd, TODAY).includes("<img"));
  assert.equal(JSON.parse(unesc(dueList("zh", odd, TODAY).match(/data-event="([^"]*)"/)[1])).name, '"><img src=x>');
  // 没有事件:空列表,页面照常
  assert.equal(dueList("zh", []), '<ul id="due" hidden></ul>');
});

// 截止日历只经一个校验(build.mjs 的 checkDeadlines,更多的规矩见 test/deadlines.test.mjs);体检结果页要用的这几项写错了,同样直接报错
test("构建:截止日历写错了直接报错——没有事件、id 当不了锚点或者重复、日期不对、缺名字、网址不是 https://、键不是一组字符串、英文里有中文", () => {
  const one = (patch) => ({ checked: "2026-11-05", events: [{ ...structuredClone(FIX.events[0]), ...patch }] });
  const check = (x) => checkDeadlines(x, "t.json");
  assert.throws(() => check({ checked: "2026-11-05" }), /events/);
  assert.throws(() => check(one({ id: "Sophon Shutdown" })), /id 只能用/);
  assert.throws(() => check({ checked: "2026-11-05", events: [structuredClone(FIX.events[0]), structuredClone(FIX.events[0])] }), /id 重复/);
  for (const d of ["2026-11-31", "11/25/2026", "2026-11"]) assert.throws(() => check(one({ deadline: d })), /deadline/, d);
  assert.throws(() => check(one({ name: { zh: "只有中文" } })), /name\.en/);
  for (const url of ["javascript:alert(1)", "http://example.com/", "example.com", "https://defiexit.com@example.com/"]) assert.throws(() => check(one({ official: [{ label: { zh: "公告", en: "Notice" }, url }] })), /https/, url);
  assert.throws(() => check(one({ chainKeys: "sophon" })), /chainKeys/);
  for (const k of [[""], "cake", [], ["CAKE"]]) assert.throws(() => check(one({ tokenKeys: k })), /tokenKeys/, JSON.stringify(k));
  assert.throws(() => check(one({ todo: { zh: "提回", en: "提回 by Nov 25" } })), /todo\.en 里有中文「提回」/);
  // 还没定日子写 null;不写不行(截止日历页要把它放进「没定日期」那一段)
  assert.equal(check(one({ deadline: null })).events[0].deadline, null);
  assert.throws(() => check(one({ deadline: undefined })), /deadline/);
});

test("截止提醒·真的截止日历:每一条都写明怎么对;CAKE、VAI(bnb 认作 bsc)、GYEN、STG、uSOL 对得上(合约是编的);审查报的几处误报不再出现", () => {
  assert.ok(REAL.every((e) => "matchBy" in e), "每一条都要写明 matchBy");
  const r = hit(SIM, { wallet: [wallet("opbnb", "Opbnb", sim("pancakeswap-opbnb-cake", "opbnb", "CAKE"), "BNB")], defi: [defi("Venus", "binance-smart-chain", "BNB Chain", sim("venus-vai-lisusd", "bsc", "VAI"))] });
  assert.deepEqual(ids(r), ["pancakeswap-opbnb-cake", "venus-vai-lisusd"], "CAKE 先截止;Venus 没定日子,排在最后");
  assert.deepEqual(r.map((m) => m.where), [["opBNB"], ["BNB Chain"]]);
  assert.deepEqual(ids(hit(SIM, { wallet: [wallet("ethereum", "Ethereum", sim("gmo-gyen-zusd-redemption", "ethereum", "GYEN"), "ETH"), wallet("arbitrum", "Arbitrum", sim("stargate-stg-zro", "arbitrum", "STG")), wallet("base", "Base", sim("universal-uassets-winddown", "base", "uSOL"))] })), ["gmo-gyen-zusd-redemption", "universal-uassets-winddown", "stargate-stg-zro"]);
  // 排在 8 种以后的 STG(接口传符号和合约)也对得上
  assert.deepEqual(ids(hit(SIM, { wallet: [{ ...wallet("arbitrum", "Arbitrum", "ETH", "USDC", "ARB", "GMX", "LINK", "UNI", "WBTC", "USDT"), rest: [coin(sim("stargate-stg-zro", "arbitrum", "STG"))] }] })), ["stargate-stg-zro"]);
  // 同样的币,只有符号、或者合约对不上:真的截止日历和编的都不提醒
  for (const cal of [REAL, SIM]) {
    assert.deepEqual(hit(cal, { wallet: [wallet("opbnb", "Opbnb", "CAKE", `CAKE@${FAKE}`), wallet("ethereum", "Ethereum", "GYEN", "ZUSD"), wallet("arbitrum", "Arbitrum", "STG", `STG@${FAKE}`), wallet("base", "Base", "uSOL", "uBTC")], defi: [defi("Venus", "binance-smart-chain", "BNB Chain", "VAI", `VAI@${FAKE}`)] }), []);
  }
  // 审查报的误报:opBNB 上 PancakeSwap 的 USDT/WBNB 池子不算 CAKE;Stargate V2(和没写版本的 Stargate)的仓位不算 V1、也不算 STG 换 ZRO;
  // 随便一个 QuickSwap 仓位不当成拿着旧 QUICK;Venus 别的市场(lisUSD)不提醒
  assert.deepEqual(hit(REAL, { defi: [
    defi("PancakeSwap V3", "opbnb", "Opbnb", "USDT", "WBNB"), defi("Stargate V2", "arbitrum", "Arbitrum", "USDC"), defi("Stargate", "ethereum", "Ethereum", "ETH"),
    defi("QuickSwap", "polygon", "Polygon", "QUICK", "USDC"), defi("Venus", "binance-smart-chain", "BNB Chain", "lisUSD"),
  ] }), []);
  // 以太坊上只有 ETH、BNB Chain 上只有 BNB:没有要提醒的
  assert.deepEqual(hit(REAL, { wallet: [wallet("ethereum", "Ethereum", "ETH"), wallet("binance-smart-chain", "BNB Chain", "BNB")] }), []);
  // 对不准的(matchBy 是 null)不嵌进体检结果页
  assert.ok(realEmb("zh").every((e) => e.matchBy) && !realEmb("zh").some((e) => e.id === "quickswap-old-quick" || e.id === "stargate-v1-pools"));
  // 提醒卡上「看截止日历」链到 /deadlines/#编号:截止日历页上每一条都有同样的锚点(中英一样)
  const up = upcoming(REAL, TODAY);
  assert.ok(up.length > 30);
  for (const lang of ["zh", "en"]) {
    const page = deadlinesPage(texts(lang), { checked: "2026-11-05", events: REAL }, TODAY);
    for (const e of up) assert.ok(page.includes(`<article class="dl" id="${e.id}"`), `${lang} ${e.id}`);
  }
});

// 按数据里写了什么就测什么:数据换了地址、加了链,这一项跟着变,不用改
test("截止提醒·真的截止日历里写的每个合约:那条链上那个地址的币提醒那一条(钱包里的、排在后面的、仓位里的);同名换了地址的、同一个地址到了没写它的链上,都不提醒", () => {
  const live = new Set(upcoming(REAL, TODAY).map((e) => e.id));
  let n = 0;
  for (const e of REAL.filter((x) => x.matchBy === "token" && live.has(x.id))) {
    for (const c of e.tokenContracts) {
      const sym = c.token.toUpperCase(), on = (k, a) => wallet(k, k, `${sym}@${a}`);
      for (const held of [{ wallet: [on(c.chain, c.address)] }, { wallet: [{ ...wallet(c.chain, c.chain, "X"), rest: [{ sym, addr: c.address }] }] }, { defi: [defi("Some Pool", c.chain, c.chain, `${sym}@${c.address}`)] }]) {
        assert.ok(ids(hit(REAL, held)).includes(e.id), `${e.id} ${c.chain} ${JSON.stringify(held).slice(0, 60)}`);
      }
      assert.ok(!ids(hit(REAL, { wallet: [on(c.chain, FAKE), wallet(c.chain, c.chain, sym)] })).includes(e.id), `${e.id} ${c.chain}:同名的假币、只有符号的`);
      for (const k of e.chainKeys.filter((x) => !e.tokenContracts.some((y) => y.chain === x && y.address === c.address))) {
        assert.ok(!ids(hit(REAL, { wallet: [on(k, c.address)] })).includes(e.id), `${e.id}:${c.chain} 的地址到了 ${k} 上`);
      }
      n++;
    }
  }
  assert.ok(n > 0, "真的截止日历里有还没过的、按币对的事件");
});

test("截止提醒·截止的那一刻和分几步截止:GYEN 按美东 23:59:59 算;StandX 标题说最后一天、下面一行说下一步;Balancer 没有截止日、标题中性;最急的(下一步)排前面", () => {
  const gyen = { wallet: [wallet("ethereum", "Ethereum", sim("gmo-gyen-zusd-redemption", "ethereum", "GYEN"))] };
  // UTC 已经是 11-12 凌晨 3 点,美东还是 11-11:照样提醒(还剩 1 小时 59 分,卡上写还剩 1 小时);美东过了 23:59:59 就不提
  const at3 = new Date("2026-11-12T03:00:00Z");
  assert.equal(hit(SIM, gyen, at3)[0].left, 0);
  assert.equal(tagText(dueCard(matchDue(simEmb("zh", at3), holdings(gyen), at3)[0], makeT("zh"), "zh", at3), "b")[0], "还剩 1 小时");
  assert.deepEqual(hit(SIM, gyen, new Date("2026-11-12T05:00:00Z")), []);
  // StandX:最后一天是 2027-01-31(提款、赎回截止),下一步是 12-31 08:00 UTC 的空投
  const zh = makeT("zh"), en = makeT("en");
  const dusd = { wallet: [wallet("binance-smart-chain", "BNB Chain", sim("standx-winddown", "bsc", "DUSD"))] };
  const [sx] = matchDue(simEmb("zh"), holdings(dusd), TODAY);
  assert.equal(sx.e.id, "standx-winddown");
  const c = dueCard(sx, zh, "zh", TODAY);
  // 按币对上的:标题说出币(DUSD)和要做的事(事件写了 dueKind: redeem),不说「还有资产」
  assert.deepEqual(tagText(c, "h2"), ["你在 BNB Chain 上有 DUSD：2027 年 1 月 31 日前赎回"]);
  assert.deepEqual(tagText(dueCard(matchDue(simEmb("en"), holdings(dusd), TODAY)[0], en, "en", TODAY), "h2"), ["You hold DUSD on BNB Chain: redeem it before Jan 31, 2027"]);
  assert.equal(tagText(c, "b")[0], "还有 86 天", "只写了 1-31:算到 1-31 00:00 UTC");
  assert.equal(text(all(c, (n) => n.className === "due-next")[0]), "下一步 12 月 31 日：DUSD 空投到期作废（还有 55 天）");
  const ce = dueCard(matchDue(simEmb("en"), holdings(dusd), TODAY)[0], en, "en", TODAY);
  assert.equal(text(all(ce, (n) => n.className === "due-next")[0]), "Next on Dec 31: The DUSD airdrop expires (55 days left)");
  // 空投那一步过了:下一行换成强平那一步
  const later = new Date("2026-12-31T09:00:00Z");
  const c2 = dueCard(matchDue(simEmb("zh", later), holdings(dusd), later)[0], zh, "zh", later);
  assert.equal(text(all(c2, (n) => n.className === "due-next")[0]), "下一步 2027 年 1 月 15 日：强平全部仓位、金库结算（还有 14 天）");
  // Balancer:没有截止日(官方说取款一直开着),标题中性;下一行说 11-30 剩下的 v3 池转为只能取
  const [bal] = matchDue(simEmb("zh"), holdings({ defi: [defi("Balancer V2", "ethereum", "Ethereum", "WETH", "USDC")] }), TODAY);
  assert.equal(bal.e.id, "balancer-winddown");
  const cb = dueCard(bal, zh, "zh", TODAY);
  assert.deepEqual(tagText(cb, "h2"), ["这个项目有退出安排，看官方怎么说"]);
  assert.equal(tagText(cb, "b")[0], "官方没定截止日期");
  assert.equal(text(all(cb, (n) => n.className === "due-next")[0]), "下一步 11 月 30 日：剩下的 v3 池也转为只能取（v3 Vault 暂停），取款照常（还有 24 天）");
  // 排序按最近要做的那一步:STG(12-15)排在 StandX(下一步 12-31)前面,Balancer(下一步 11-30)更前
  const bscBoth = wallet("binance-smart-chain", "BNB Chain", sim("standx-winddown", "bsc", "DUSD"), sim("stargate-stg-zro", "bsc", "STG"));
  assert.deepEqual(ids(matchDue(simEmb("zh"), holdings({ wallet: [bscBoth], defi: [defi("Balancer V2", "ethereum", "Ethereum", "WETH")] }), TODAY)), ["balancer-winddown", "stargate-stg-zro", "standx-winddown"]);
});

test("审查报的:分几步截止的,一步过了再查,卡上的下一步跟着换——StandX 12-31 08:00 UTC 空投截止前后,最后一天的倒数一样(都是还有 31 天),重画的依据也要变", () => {
  const zh = makeT("zh"), en = makeT("en");
  const dusd = { wallet: [wallet("binance-smart-chain", "BNB Chain", sim("standx-winddown", "bsc", "DUSD"))] };
  // 体检结果页每查完一路就这样算一次(check.js 的 paintDue):对上了哪些 → 依据没变就不重画
  const look = (iso, lang = "zh") => {
    const now = new Date(iso), list = matchDue(simEmb(lang, now), holdings(dusd), now);
    return { list, key: dueKey(list, now), next: text(all(dueCard(list[0], lang === "en" ? en : zh, lang, now), (n) => n.className === "due-next")[0]) };
  };
  const before = look("2026-12-31T07:59:59Z"), after = look("2026-12-31T08:00:01Z");
  assert.deepEqual([before.list[0].left, after.list[0].left], [31, 31], "最后一天(2027-01-31)还有几天,前后一样");
  assert.equal(before.next, "下一步 12 月 31 日：DUSD 空投到期作废（还剩不到 1 小时）");
  assert.equal(after.next, "下一步 2027 年 1 月 15 日：强平全部仓位、金库结算（还有 14 天）");
  assert.equal(look("2026-12-31T08:00:01Z", "en").next, "Next on Jan 15, 2027: All positions are force-closed and vaults settled (14 days left)");
  assert.notEqual(before.key, after.key, "下一步换了:要重画");
  // 什么都没变(同一时刻再算一次):依据一样,不重画(重查时不闪、读屏不重念)
  assert.equal(look("2026-12-31T07:59:59Z").key, before.key);
  // 下一步的倒数换了一档也重画:还剩 2 小时(2 小时 30 分)→ 还剩 1 小时(1 小时 30 分)
  const h2 = look("2026-12-31T05:30:00Z"), h1 = look("2026-12-31T06:30:00Z");
  assert.ok(h2.next.endsWith("（还剩 2 小时）") && h1.next.endsWith("（还剩 1 小时）"), `${h2.next} / ${h1.next}`);
  assert.notEqual(h2.key, h1.key);
  // 旧的依据(只看事件、对上了什么、最后一天的天数)在空投前后是一样的,所以以前不重画
  const old = (x) => JSON.stringify(x.list.map((m) => [m.e.id, m.where, m.left]));
  assert.equal(old(before), old(after));
});

test("截止日历的几处说法:cmETH 只说「如果还有往期奖励没领」、本金不急;VAI 没有截止日、卡上不说「还没公布」;STG 写明要在以太坊上才能换", () => {
  const zh = makeT("zh"), en = makeT("en");
  const card = (id, chain, sym, lang = "zh") => {
    const m = matchDue(simEmb(lang), holdings({ wallet: [wallet(chain, chain, sim(id, chain, sym))] }), TODAY).find((x) => x.e.id === id);
    return dueCard(m, lang === "en" ? en : zh, lang, TODAY);
  };
  // cmETH:手里有币不等于还有奖励没领;截止的只是领奖励,本金随时可以解押
  const meth = card("meth-cmeth-rewards", "ethereum", "cmETH");
  assert.deepEqual(tagText(meth, "h2"), ["你有 cmETH：如果还有往期奖励没领，11 月 7 日前去领"]);
  assert.ok(text(meth).includes("cmETH 不急"), "本金不用赶在 11 月 7 日前动");
  assert.deepEqual(tagText(card("meth-cmeth-rewards", "ethereum", "cmETH", "en"), "h2"), ["You hold cmETH: if you still have uncollected past rewards, collect them before Nov 7"]);
  // VAI:官方说金库里的 VAI 随时可取,没有硬截止
  const vai = card("venus-vai-lisusd", "bsc", "VAI");
  assert.deepEqual(tagText(vai, "h2"), ["你有 VAI：这个项目有退出安排，看官方怎么说"]);
  assert.equal(tagText(vai, "b")[0], "官方没定截止日期");
  assert.ok(text(vai).includes("没有硬截止") && text(vai).includes("随时可取"));
  // STG:官方兑换页说要在以太坊上换,别的链上的先跨回去;卡上带这一页的链接
  const stg = card("stargate-stg-zro", "polygon", "STG");
  assert.ok(text(stg).includes("STG 要在以太坊上才能换") && !text(stg).includes("没写清"));
  // 兑换比例是官方兑换说明写的(不说「第三方报道」)
  assert.ok(text(stg).includes("官方兑换说明写的固定比例是 1 STG = 0.08634 ZRO") && !text(stg).includes("第三方"));
  assert.ok(text(card("stargate-stg-zro", "polygon", "STG", "en")).includes("Stargate's official conversion guide gives the fixed rate: 1 STG = 0.08634 ZRO"));
  assert.ok(all(stg, (n) => n.tag === "a").some((n) => n.attrs.href === "https://stargate.finance/stake"));
  assert.ok(text(card("stargate-stg-zro", "polygon", "STG", "en")).includes("your STG must be on Ethereum to convert"));
});

// 嵌进页面的那一份(任意一组事件):页面是早先打开的,之后按现在的时间重算(check.js 每分钟、切回来时调 paintDue)
const embedOf = (events, lang, at) => [...dueList(lang, events, at).matchAll(/<li data-event="([^"]*)"><\/li>/g)].map((m) => JSON.parse(unesc(m[1])));

test("审查报的:cmETH 11 月 7 日前领(deadlineAt 11-07 00:00 UTC)——11-05 21:00 还剩 27 小时、11-06 00:00 还剩 24 小时、11-07 10:00 卡没了;标题说 before", () => {
  const zh = makeT("zh"), en = makeT("en");
  const held = { wallet: [wallet("ethereum", "Ethereum", sim("meth-cmeth-rewards", "ethereum", "cmETH"))] };
  const page = { zh: simEmb("zh", new Date("2026-11-05T12:00:00Z")), en: simEmb("en", new Date("2026-11-05T12:00:00Z")) };
  const paint = (iso, lang = "zh") => {
    const now = new Date(iso), list = matchDue(page[lang], holdings(held), now).filter((m) => m.e.id === "meth-cmeth-rewards");
    return list.map((m) => { const c = dueCard(m, lang === "en" ? en : zh, lang, now); return [tagText(c, "h2")[0], tagText(c, "b")[0]]; });
  };
  assert.deepEqual(paint("2026-11-05T21:00:00Z"), [["你有 cmETH：如果还有往期奖励没领，11 月 7 日前去领", "还剩 27 小时"]]);
  assert.deepEqual(paint("2026-11-05T21:00:00Z", "en"), [["You hold cmETH: if you still have uncollected past rewards, collect them before Nov 7", "27 hours left"]]);
  assert.deepEqual(paint("2026-11-06T00:00:00Z"), [["你有 cmETH：如果还有往期奖励没领，11 月 7 日前去领", "还剩 24 小时"]]);
  assert.deepEqual(paint("2026-11-07T10:00:00Z"), [], "11-07 00:00 UTC 就截止了");
  assert.equal(REAL.find((e) => e.id === "meth-cmeth-rewards").deadlineAt, "2026-11-07T00:00:00Z");
});

test("审查报的:页面开着不刷新,过了的卡也会去掉——只写了日子的(11-07)11-07 20:00 写「按 UTC 算,今天是截止日」,11-08 03:00 就没了,重画的依据跟着变", () => {
  const zh = makeT("zh");
  const D7 = checkDeadlines({ checked: "2026-11-05", events: [{ ...structuredClone(FIX.events[0]), id: "sophon-d7", deadline: "2026-11-07" }] }).events;
  const page = embedOf(D7, "zh", new Date("2026-11-05T12:00:00Z")), held = holdings({ wallet: [wallet("sophon", "Sophon", "SOPH")] });
  const paint = (iso) => { const now = new Date(iso), list = matchDue(page, held, now); return { key: dueKey(list, now), b: list.map((m) => tagText(dueCard(m, zh, "zh", now), "b")[0]) }; };
  const a = paint("2026-11-06T20:00:00Z"), b = paint("2026-11-07T20:00:00Z"), c = paint("2026-11-08T03:00:00Z");
  assert.deepEqual(a.b, ["还剩 4 小时"], "前一天:算到 11-07 00:00 UTC");
  assert.deepEqual(b.b, ["按 UTC 算，今天是截止日（11 月 7 日）"], "那一天里不写几小时(官方没写几点)");
  assert.deepEqual(c.b, [], "11-07 过完(UTC)就去掉");
  assert.ok(a.key !== b.key && b.key !== c.key, "每一次都要重画");
  // cmETH 那一张(11-07 00:00 截止):11-07 20:00 再算时已经没了
  const meth = matchDue(simEmb("zh", new Date("2026-11-05T12:00:00Z")), holdings({ wallet: [wallet("ethereum", "Ethereum", sim("meth-cmeth-rewards", "ethereum", "cmETH"))] }), new Date("2026-11-07T20:00:00Z"));
  assert.ok(!meth.some((m) => m.e.id === "meth-cmeth-rewards"));
});

test("审查报的:按币对上的,标题说出是哪个币、要做什么,不说「还有资产」(那样像是这条链上的东西都得搬走);每一条按币对的事件中英都对", () => {
  const zh = makeT("zh"), en = makeT("en");
  const title = (id, chain, sym, now, lang) => {
    const m = matchDue(simEmb(lang, now), holdings({ wallet: [wallet(chain, chain, sim(id, chain, sym))] }), now).find((x) => x.e.id === id);
    return tagText(dueCard(m, lang === "en" ? en : zh, lang, now), "h2")[0];
  };
  const NOV = new Date("2026-11-05T12:00:00Z"), SEP = new Date("2026-09-01T00:00:00Z");
  const want = [
    ["meth-cmeth-rewards", "ethereum", "cmETH", NOV, "你有 cmETH：如果还有往期奖励没领，11 月 7 日前去领", "You hold cmETH: if you still have uncollected past rewards, collect them before Nov 7"],
    ["gmo-gyen-zusd-redemption", "ethereum", "GYEN", NOV, "你在 Ethereum 上有 GYEN：11 月 11 日前赎回", "You hold GYEN on Ethereum: redeem it by Nov 11"],
    ["universal-uassets-winddown", "base", "uSOL", NOV, "你有 uSOL：这个项目有退出安排，看官方怎么说", "You hold uSOL: this project has an exit plan, check the official notice"],
    ["pancakeswap-opbnb-cake", "opbnb", "CAKE", NOV, "你在 opBNB 上有 CAKE：11 月 23 日前要桥出来", "You hold CAKE on opBNB: bridge it out before Nov 23"],
    ["stargate-stg-zro", "bsc", "STG", NOV, "你在 BNB Chain 上有 STG：12 月 15 日前换，过了换得少或换不了", "You hold STG on BNB Chain: convert it before Dec 15"],
    ["standx-winddown", "bsc", "DUSD", NOV, "你在 BNB Chain 上有 DUSD：2027 年 1 月 31 日前赎回", "You hold DUSD on BNB Chain: redeem it before Jan 31, 2027"],
    ["parasail-pfil", "filecoin", "pFIL", NOV, "你有 pFIL：这个项目有退出安排，看官方怎么说", "You hold pFIL: this project has an exit plan, check the official notice"],
    ["parasail-stpeaq", "peaq", "stPEAQ", NOV, "你有 stPEAQ：这个项目有退出安排，看官方怎么说", "You hold stPEAQ: this project has an exit plan, check the official notice"],
    ["aero-merger", "optimism", "VELO", NOV, "你有 VELO：这个项目有退出安排，看官方怎么说", "You hold VELO: this project has an exit plan, check the official notice"],
    ["venus-vai-lisusd", "bsc", "VAI", NOV, "你有 VAI：这个项目有退出安排，看官方怎么说", "You hold VAI: this project has an exit plan, check the official notice"],
    // 已经过了的两条,按过截止日以前看
    ["awe-stpt-migration", "ethereum", "STPT", SEP, "你在 Ethereum 上有 STPT：9 月 21 日前换，过了换得少或换不了", "You hold STPT on Ethereum: convert it before Sep 21"],
    ["vanar-vanry-migration", "ethereum", "VANRY", SEP, "你在 Ethereum 上有 VANRY：9 月 10 日前换，过了换得少或换不了", "You hold VANRY on Ethereum: convert it by Sep 10"],
  ];
  assert.deepEqual(want.map((w) => w[0]).sort(), REAL.filter((e) => e.matchBy === "token").map((e) => e.id).sort(), "每一条按币对的都查到");
  for (const [id, chain, sym, now, z, e] of want) {
    assert.equal(title(id, chain, sym, now, "zh"), z, id);
    assert.equal(title(id, chain, sym, now, "en"), e, id);
    assert.ok(!z.includes("还有资产") && !TITLE_BAN.test(z) && !TITLE_BAN.test(e), id);
  }
  // 同一条链上对上两个币:都写出来(数据里写了哪两个合约就用哪两个)
  const gmo = REAL.find((x) => x.id === "gmo-gyen-zusd-redemption").tokenContracts.filter((c) => c.chain === "ethereum");
  const both = holdings({ wallet: [wallet("ethereum", "Ethereum", ...gmo.map((c) => `${c.token.toUpperCase()}@${c.address}`))] });
  const m = matchDue(realEmb("en"), both, NOV).find((x) => x.e.id === "gmo-gyen-zusd-redemption");
  assert.equal(tagText(dueCard(m, en, "en", NOV), "h2")[0], "You hold GYEN, ZUSD on Ethereum: redeem them by Nov 11");
  assert.equal(tagText(dueCard(matchDue(realEmb("zh"), both, NOV).find((x) => x.e.id === "gmo-gyen-zusd-redemption"), zh, "zh", NOV), "h2")[0], "你在 Ethereum 上有 GYEN、ZUSD：11 月 11 日前赎回");
});

test("审查报的:仓位里借来的币(Zerion 的 loan)不算拿着——在 Aave 借了 STG 不提醒 STG 换 ZRO;事件写了 matchLoans 的(铸了 VAI 要还)才算,标题写明是借款", () => {
  const zh = makeT("zh"), en = makeT("en");
  const pos = (app, cid, chain, ...items) => ({ app, cid, chain, usd: 10, debt: 0, items: items.map(([type, s]) => ({ type, ...coin(s), qty: 1, usd: 10 })) });
  const stg = sim("stargate-stg-zro", "arbitrum", "STG"), vai = sim("venus-vai-lisusd", "bsc", "VAI");
  // 借了 STG(只有借款):不提醒;存进去的 STG:提醒
  assert.ok(!ids(matchDue(simEmb("zh"), holdings({ defi: [pos("Aave V3", "arbitrum", "Arbitrum", ["deposit", "USDC"], ["loan", stg])] }), TODAY)).includes("stargate-stg-zro"));
  assert.ok(ids(matchDue(simEmb("zh"), holdings({ defi: [pos("Aave V3", "arbitrum", "Arbitrum", ["deposit", stg], ["loan", "USDC"])] }), TODAY)).includes("stargate-stg-zro"));
  // 铸了 VAI(在 Venus 里是借款):这一条写了 matchLoans,提醒,标题写「VAI 借款」
  const minted = holdings({ defi: [pos("Venus", "binance-smart-chain", "BNB Chain", ["deposit", "BNB"], ["loan", vai])] });
  const [v] = matchDue(simEmb("zh"), minted, TODAY).filter((x) => x.e.id === "venus-vai-lisusd");
  assert.equal(tagText(dueCard(v, zh, "zh", TODAY), "h2")[0], "你有 VAI 借款：这个项目有退出安排，看官方怎么说");
  const [ve] = matchDue(simEmb("en"), minted, TODAY).filter((x) => x.e.id === "venus-vai-lisusd");
  assert.equal(tagText(dueCard(ve, en, "en", TODAY), "h2")[0], "You hold VAI debt: this project has an exit plan, check the official notice");
  // 没写 matchLoans 的事件,同一个合约的借款不算(把 VAI 那一条的 matchLoans 去掉看)
  const noLoans = simEmb("zh").map((e) => (e.id === "venus-vai-lisusd" ? { ...e, matchLoans: false } : e));
  assert.ok(!ids(matchDue(noLoans, minted, TODAY)).includes("venus-vai-lisusd"));
  assert.equal(REAL.find((e) => e.id === "venus-vai-lisusd").matchLoans, true, "Venus 这一条写明铸了 VAI 的要准备还款");
});

test("审查报的:重查还没查完时,过了截止的卡也要去掉——cmETH 11-06 23:59:30 画上;点了重查、还没有结果,11-07 00:10、03:00 再算(每分钟那一次、切回来、从缓存回来都是这样算)都去掉", () => {
  const held = holdings({ wallet: [wallet("ethereum", "Ethereum", sim("meth-cmeth-rewards", "ethereum", "cmETH"))] });
  const page = simEmb("zh", new Date("2026-11-05T12:00:00Z")), empty = holdings({});
  const has = (v) => v.list.some((m) => m.e.id === "meth-cmeth-rewards");
  // 第一轮三路都查完:画上 cmETH
  const v1 = dueView(page, held, true, null, new Date("2026-11-06T23:59:30Z"));
  assert.ok(has(v1) && !v1.skip);
  // 点了「重新查」:三路清空、还在查——接着按上一轮查完的算,重画的依据不变,卡不闪
  const v2 = dueView(page, empty, false, v1.last, new Date("2026-11-06T23:59:30Z"));
  assert.ok(!v2.skip && has(v2));
  assert.equal(v2.key, v1.key);
  // 还没查完,时间过了 11-07 00:00:cmETH 那张去掉(过期优先于不闪)
  for (const iso of ["2026-11-07T00:10:00Z", "2026-11-07T03:00:00Z"]) {
    const v = dueView(page, empty, false, v2.last, new Date(iso));
    assert.ok(!v.skip && !has(v) && v.key !== v1.key, iso);
  }
  // 重查查完了:换成新查到的(这里什么都没有),下一次接着按它算
  const v3 = dueView(page, empty, true, v2.last, new Date("2026-11-06T23:59:50Z"));
  assert.deepEqual(v3.list, []);
  assert.equal(v3.last, empty);
  // 第一次打开、三路都还没查完、也没对上:先不动
  assert.ok(dueView(page, empty, false, null, new Date("2026-11-06T23:59:30Z")).skip);
});

test("审查报的:标题里的币名用数据里核对过的,不用接口传来的符号——真 StandX DUSD 的合约、接口写成 USDT,标题照样说 DUSD;说不出币名的说得中性", () => {
  const zh = makeT("zh"), en = makeT("en");
  const dusd = REAL.find((e) => e.id === "standx-winddown").tokenContracts.find((c) => c.chain === "bsc");
  const held = holdings({ wallet: [wallet("binance-smart-chain", "BNB Chain", `USDT@${dusd.address}`)] });
  const card = (events, t, lang) => tagText(dueCard(matchDue(events, held, TODAY).find((x) => x.e.id === "standx-winddown"), t, lang, TODAY), "h2")[0];
  assert.equal(card(realEmb("zh"), zh, "zh"), "你在 BNB Chain 上有 DUSD：2027 年 1 月 31 日前赎回");
  assert.equal(card(realEmb("en"), en, "en"), "You hold DUSD on BNB Chain: redeem it before Jan 31, 2027");
  // 合约没写币名(数据缺了这一项):照样提醒,标题说得中性——不用接口的符号,也不退回「还有资产」
  const bare = (lang) => realEmb(lang).map((e) => (e.id === "standx-winddown" ? { ...e, tokenContracts: e.tokenContracts.map(({ symbol, ...c }) => c) } : e));
  assert.equal(card(bare("zh"), zh, "zh"), "这个项目有退出安排，看官方怎么说");
  assert.equal(card(bare("en"), en, "en"), "This project has an exit plan: check the official notice");
  // 数据里每一个核对过的合约都写了币名,大小写照官方(cmETH、uSOL、stPEAQ…),和 token 只差大小写
  assert.ok(REAL.every((e) => (e.tokenContracts || []).every((c) => typeof c.symbol === "string" && c.symbol.toLowerCase() === c.token)));
  assert.deepEqual([...new Set(REAL.flatMap((e) => (e.tokenContracts || []).map((c) => c.symbol)))].filter((s) => /[a-z]/.test(s)).sort(), ["cmETH", "pFIL", "stPEAQ", "uADA", "uBTC", "uDOGE", "uLTC", "uSOL", "uXRP"]);
});
