// 退出截止日历、专题:数据校验、页面(中英)、倒数、「转给朋友」的链接、专题渲染。
// 只调构建脚本里的函数,不读 dist/(build.test.mjs 会删了重建 dist/,测试文件是并行跑的)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { checkDeadlines, deadlinesPage, shareHref, checkTopic, loadTopics, topicPage, topicsIndex, texts, DL_TYPES, TITLE_BAN } from "../scripts/build.mjs";
import { daysLeft, timeLeft, nextMilestone, urgency } from "../src/js/lib/deadline.js";
import { STR } from "../src/js/lib/i18n.js";
import { zh as zhPunct } from "../src/js/lib/zh.js";

const D = JSON.parse(readFileSync("data/deadlines.json", "utf8"));
// 11-05 UTC 早上 8 点:ApolloX 那一条 10:00 UTC 才截止,这时候还是「今天截止」
const DAY = new Date("2026-11-05T08:00:00Z");
const ZH = texts("zh"), EN = texts("en");
const CJK = /[　-〿一-鿿＀-￯]/;
const noLangNav = (h) => h.replace(/<nav class="langs"[\s\S]*?<\/nav>/g, "");
const entry = (h, id) => h.slice(h.indexOf(`<article class="dl" id="${id}"`), h.indexOf("</article>", h.indexOf(`<article class="dl" id="${id}"`)));

test("截止日历数据:现在这份通过校验;60 件 EVM 事件,id 不重复,只放 https 的官方链接,日期照调研原文和官方原文", () => {
  assert.doesNotThrow(() => checkDeadlines(structuredClone(D)));
  assert.equal(D.checked, "2026-11-06");
  assert.equal(D.events.length, 60);
  assert.equal(new Set(D.events.map((e) => e.id)).size, 60);
  for (const e of D.events) {
    assert.ok(DL_TYPES.includes(e.type), e.id);
    assert.ok(e.official.length && e.official.every((o) => o.url.startsWith("https://")), e.id);
    assert.ok(!TITLE_BAN.test(e.name.zh) && !TITLE_BAN.test(e.name.en), e.id);
    assert.ok(["2026-11-05", "2026-11-06"].includes(e.checked), e.id);
  }
  const at = (id) => D.events.find((e) => e.id === id).deadline;
  assert.deepEqual(["sophon-chain-shutdown", "abstract-chain-shutdown", "blast-l2-shutdown", "lisk-chain-closed", "standx-winddown", "harmony-shutdown", "quickswap-old-quick", "balancer-winddown", "stargate-metis-pools"].map(at), ["2026-11-25", "2026-12-15", "2027-11-04", "2026-11-02", "2027-01-31", null, "2027-02-05", null, "2026-10-23"]);
  // 按 11-05 早上算:27 件还没到(含今天截止的)、15 件没定日期(Balancer 取款一直开着,也在这里)、18 件已过
  const n = (f) => D.events.filter(f).length;
  assert.equal(n((e) => e.deadline && daysLeft(e.deadline, DAY, e.deadlineAt) >= 0), 27);
  assert.equal(n((e) => !e.deadline), 15);
  assert.equal(n((e) => e.deadline && daysLeft(e.deadline, DAY, e.deadlineAt) < 0), 18);
  // 公开仓库:正文里不带我们内部的笔记,也不放地址(链接里的提案编号不算)。
  // 合约地址只放在 tokenContracts 里:体检拿去按地址对,页面上不显示(出处网址里可以带地址,比如区块浏览器的代币页)
  const body = D.events.map(({ official, tokenContracts, ...e }) => ({ ...e, labels: official.map((o) => o.label) }));
  const text = JSON.stringify(body.map((e, i) => ({ ...e, sources: (D.events[i].tokenContracts || []).map((c) => c.source) })));
  for (const w of ["机器人", "诊所", "DefiLlama", "Codex", "fxtwitter", "HANDOFF", "非官方", "币安相关", "L2BEAT", "naki", "Grok"]) assert.ok(!text.includes(w), `数据里有内部的词:${w}`);
  assert.ok(!/0x[0-9a-fA-F]{40}/.test(JSON.stringify(body)), "正文里不放钱包或合约地址");
});

// 按币对的事件,体检只按「链 + 合约地址」对(同名的仿冒币不算):地址是从项目官方页面抄来的,出处写在 source 里。
// 这里只查样子(真地址是数据的事,测试里不写);对不对得上,见 test/due.test.mjs
test("截止日历数据:按币对的每一条都写了核对过的合约(链、哪个币、小写地址、官方出处);非 EVM 链上的不写", () => {
  const token = D.events.filter((e) => e.matchBy === "token");
  assert.ok(token.length, "现在有按币对的事件");
  for (const e of token) {
    assert.ok(e.tokenContracts.length, e.id);
    for (const c of e.tokenContracts) {
      assert.ok(e.chainKeys.includes(c.chain) && e.tokenKeys.includes(c.token), `${e.id} ${c.chain}`);
      assert.match(c.address, /^0x[0-9a-f]{40}$/, `${e.id} ${c.chain}`);
      assert.ok(c.source.startsWith("https://"), `${e.id} ${c.chain}`);
    }
  }
  // 链名和 chainKeys 一一对应(卡片标题、截止日历页的链图标按位置取)
  for (const e of token) assert.equal(e.chains.length, e.chainKeys.length, e.id);
  // 非 EVM 链上的不写地址(Stellar 上的 GYEN、ZUSD,Solana 上的 DUSD):那几条链照样列在 chainKeys 里,只是对不上、不提醒
  assert.ok(D.events.every((e) => (e.tokenContracts || []).every((c) => !["stellar", "solana"].includes(c.chain))));
  // 不按币对的不写合约
  assert.ok(D.events.every((e) => e.matchBy === "token" || e.tokenContracts === undefined));
});

test("截止日历数据:缺字段、英文混中文、不是 https、类型或日期不对、名字里写「领取」,构建直接报错", () => {
  const bad = (mut, re) => {
    const x = structuredClone(D);
    mut(x);
    assert.throws(() => checkDeadlines(x, "t.json"), re);
  };
  bad((x) => delete x.events[0].name.en, /aster-apollox-offline: 缺 name\.en/);
  bad((x) => delete x.events[3].who, /blur-frontend-blend: 缺 who\.zh/);
  bad((x) => { x.events[0].todo.en = "去官网取"; }, /todo\.en 里有中文/);
  bad((x) => { x.events[0].official[0].url = "http://x.com/Aster_DEX"; }, /official\[0\]\.url/);
  bad((x) => { x.events[0].official[0].url = "javascript:alert(1)"; }, /official\[0\]\.url/);
  bad((x) => { x.events[0].official = []; }, /官方链接/);
  bad((x) => { x.events[0].type = "shutdown"; }, /type 只能是/);
  bad((x) => { x.events[0].deadline = "2026-02-30"; }, /deadline/);
  bad((x) => { x.events[0].deadline = "11-25"; }, /deadline/);
  bad((x) => { x.events[0].announced = "2026-11"; }, /announced/);
  bad((x) => { x.checked = "2026/11/05"; }, /checked/);
  bad((x) => { x.events[1].id = x.events[0].id; }, /id 重复/);
  bad((x) => { x.events[0].id = "Aster ApolloX"; }, /id 只能用/);
  bad((x) => { x.events[0].name.en = "Claim your ApolloX funds"; }, /claim/);
  bad((x) => { x.events[0].name.zh = "教你找回 ApolloX 的钱"; }, /找回/);
  bad((x) => { x.events[0].chainKeys = ["BNB Chain"]; }, /chainKeys/);
  bad((x) => { x.events[0].chainKeys = []; x.events[0].protocolKeys = []; }, /至少写一个/);
  bad((x) => { x.events[0].chains = []; }, /chains/);
  bad((x) => { x.events[0].summary.zh = "长".repeat(130); }, /太长/);
  // 两边都是字母的半角冒号 zh() 换不了,页面上会是「Aster:ApolloX」
  bad((x) => { x.events[0].name.zh = "Aster:ApolloX 下线"; }, /半角标点/);
  bad((x) => { x.events[0].official[0].label.zh = "Aster 官方 X:11 月 3 日"; }, /official\[0\]\.label\.zh/);
  // 时间、比例、代码里的冒号照常;注意可以不写
  const ok = structuredClone(D);
  ok.events[0].deadlineNote.zh = "11 月 3 日 10:00(UTC)起,比例 1:750,网址 `https://x.com`。";
  delete ok.events[0].caution;
  assert.doesNotThrow(() => checkDeadlines(ok, "t.json"));
});

test("倒数:只往少里说——写了截止时间的,48 小时以内写整小时(向下取整)、不到 1 小时单说;只写了日子的算到那一天 00:00(UTC),那一天里写「按 UTC 算,今天是截止日」,过完才算过了", () => {
  // 「还没到 / 已过」按 daysLeft:只写了日子的,那一天(UTC)过完才算过
  assert.equal(daysLeft("2026-11-05", new Date("2026-11-05T00:00:00Z")), 0);
  assert.equal(daysLeft("2026-11-05", new Date("2026-11-05T23:59:59Z")), 0);
  assert.equal(daysLeft("2026-11-06", new Date("2026-11-05T23:59:59Z")), 1);
  assert.equal(daysLeft("2026-11-04", new Date("2026-11-05T00:00:01Z")), -1);
  assert.equal(daysLeft("2027-01-01", new Date("2026-12-31T12:00:00Z")), 1);
  const zh = (...a) => STR.zh.dlLeft(timeLeft(...a)), en = (...a) => STR.en.dlLeft(timeLeft(...a));
  const at = (s) => new Date(s);
  // 只写了日子的:倒数算到那一天 00:00 UTC(官方可能是「那一天前」);那一天里不写几小时;过完了才算已过
  assert.deepEqual(timeLeft("2026-11-25", at("2026-11-05T12:00:00Z")), { days: 19, hours: null, day: null });
  assert.deepEqual(timeLeft("2026-11-06", at("2026-11-05T12:00:00Z")), { days: 0, hours: 12, day: null });
  assert.deepEqual(timeLeft("2026-11-05", at("2026-11-05T12:00:00Z")), { days: 0, hours: null, day: "2026-11-05" });
  assert.deepEqual(timeLeft("2026-11-05", at("2026-11-05T00:00:00Z")), { days: 0, hours: null, day: "2026-11-05" }, "那一天 00:00 起就是截止日");
  assert.deepEqual(timeLeft("2026-11-04", at("2026-11-05T00:00:00Z")), { days: -1, hours: null, day: null }, "那一天过完就过了");
  const days = ["2026-11-25", "2026-11-08", "2026-11-07", "2026-11-06", "2026-11-05", "2026-11-04"];
  assert.deepEqual(days.map((d) => zh(d, at("2026-11-05T12:00:00Z"))), ["还有 19 天", "还有 2 天", "还剩 36 小时", "还剩 12 小时", "按 UTC 算,今天是截止日(11 月 5 日)", "已过截止日"]);
  assert.deepEqual(days.map((d) => en(d, at("2026-11-05T12:00:00Z"))), ["19 days left", "2 days left", "36 hours left", "12 hours left", "Deadline day (UTC): Nov 5", "Deadline passed"]);
  // 写了截止时间的:48 小时整还写小时,多 1 毫秒写 2 天;47 小时 59 分是 47 小时(不说 2 天);22 小时 10 分是 22 小时;
  // 1 小时 1 分、1 小时 59 分都是 1 小时;不到 1 小时单说;到了那一刻就过了
  const AT = "2026-11-06T00:00:00Z", cut = Date.parse(AT), min = 6e4;
  const zhAt = (ms) => zh("2026-11-06", new Date(cut - ms), AT);
  assert.deepEqual([48 * 36e5, 48 * 36e5 + 1, 47 * 36e5 + 59 * min, 22 * 36e5 + 10 * min, 36e5 + 59 * min, 36e5 + min, 36e5, 36e5 - 1, 1, 0].map(zhAt),
    ["还剩 48 小时", "还有 2 天", "还剩 47 小时", "还剩 22 小时", "还剩 1 小时", "还剩 1 小时", "还剩 1 小时", "还剩不到 1 小时", "还剩不到 1 小时", "已过截止日"]);
  assert.deepEqual([36e5 + 59 * min, 36e5, 36e5 - 1].map((ms) => en("2026-11-06", new Date(cut - ms), AT)), ["1 hour left", "1 hour left", "Less than 1 hour left"]);
  // 只往少里说:从 1 分钟到 10 天,每隔 7 分钟看一次,写出来的小时数、天数都不超过真剩下的(写了时间的到那一刻,只写了日子的到那一天 00:00 UTC)
  for (let ms = min; ms <= 240 * 36e5; ms += 7 * min) {
    for (const s of [zhAt(ms), zh("2026-11-06", new Date(cut - ms))]) {
      const n = Number((s.match(/\d+/) || ["0"])[0]);
      const said = s.includes("不到") ? 0 : s.includes("小时") ? n * 36e5 : s.includes("天") ? n * 864e5 : 0;
      assert.ok(said <= ms, `${s}:真剩下 ${(ms / 36e5).toFixed(2)} 小时`);
    }
  }
  // 审查报的:Silicon 截止是 12-31 12:00(UTC+9),也就是北京时间 12-31 11:00。北京时间 12-30 中午看,不能说「今天截止」(北京还是 12-30,而且还有将近一整天)
  const bj = at("2026-12-30T12:00:00+08:00");
  assert.deepEqual(timeLeft("2026-12-31", bj, "2026-12-31T12:00:00+09:00"), { days: 0, hours: 23, day: null });
  assert.equal(zh("2026-12-31", bj, "2026-12-31T12:00:00+09:00"), "还剩 23 小时");
  assert.equal(en("2026-12-31", bj, "2026-12-31T12:00:00+09:00"), "23 hours left");
  // 不说没带 UTC 的「今天」「明天」:只写了日子的那一天写的是「按 UTC 算,今天是截止日」
  for (const ms of [1, 36e5, 23 * 36e5, 25 * 36e5, 47 * 36e5, -36e5, -23 * 36e5]) {
    for (const s of [zh("2026-11-06", new Date(cut - ms)), zhAt(Math.max(ms, 1)), en("2026-11-06", new Date(cut - ms))]) {
      assert.ok(!/今天|明天/.test(s.replace(/按 UTC 算,今天/g, "")) && !/today|tomorrow/i.test(s), s);
    }
  }
  assert.deepEqual([null, -1, 0, 7, 8, 30, 31].map(urgency), ["none", "past", "soon", "soon", "near", "near", "far"]);
  // 写了截止时间的按那个时间:GYEN 美东 11-11 23:59:59;CAKE 11-23 00:00 UTC 起停(最后一天其实是 11-22)
  assert.equal(daysLeft("2026-11-11", new Date("2026-11-12T03:00:00Z"), "2026-11-11T23:59:59-05:00"), 0);
  assert.equal(daysLeft("2026-11-11", new Date("2026-11-12T05:00:00Z"), "2026-11-11T23:59:59-05:00"), -1);
  assert.equal(daysLeft("2026-11-23", new Date("2026-11-22T12:00:00Z"), "2026-11-23T00:00:00Z"), 0);
  assert.equal(daysLeft("2026-11-23", new Date("2026-11-23T00:00:00Z"), "2026-11-23T00:00:00Z"), -1);
  assert.equal(daysLeft("2026-11-23", new Date("2026-11-05T12:00:00Z"), "2026-11-23T00:00:00Z"), 17);
  // 分几步截止的:还没过的第一步
  const sx = D.events.find((e) => e.id === "standx-winddown");
  assert.equal(nextMilestone(sx, DAY).date, "2026-12-31");
  assert.equal(nextMilestone(sx, new Date("2026-12-31T08:30:00Z")).date, "2027-01-15", "空投那一步 08:00 UTC 就过了");
  assert.equal(nextMilestone(sx, new Date("2027-01-20T00:00:00Z")), null);
});

test("截止日历页:中英两套;还没到的按截止日从近到远,没定日期的单独一段,已过的收起来(最近过的在前);倒数是字", () => {
  for (const tx of [ZH, EN]) {
    const h = deadlinesPage(tx, D, DAY);
    assert.match(h, new RegExp(`<html lang="${tx.lang === "en" ? "en" : "zh-CN"}" data-page="deadlines">`));
    assert.ok(h.includes('<script type="module" src="/assets/js/deadlines.js"></script>'));
    assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/.test(h) && !/\sstyle="/.test(h), "不用内联脚本和内联样式(CSP)");
    const part = (a, b) => h.slice(h.indexOf(a), h.indexOf(b));
    const dates = (s) => [...s.matchAll(/<article class="dl"[^>]*data-deadline="([\d-]+)"/g)].map((m) => m[1]);
    const open = dates(part('id="openList"', 'id="nodate"'));
    assert.equal(open.length, 27);
    assert.deepEqual(open, [...open].sort());
    const none = part('id="nodate"', 'id="passed"');
    assert.equal(none.match(/<article class="dl"/g).length, 15);
    assert.ok(!/<article class="dl"[^>]*data-deadline=/.test(none), "没定日期的条目本身不带截止日(分几步的那几行可以带)");
    const passed = part('id="passed"', 'aria-labelledby="moreH"');
    assert.ok(passed.includes('<details class="dl-passed"><summary>'), "已过的默认收起");
    assert.deepEqual(dates(passed), [...dates(passed)].sort().reverse());
    assert.equal(dates(passed).length, 18);
    // 每一条:锚点、标题、官方链接、最后核对日期;页面顶上也写最后核对(整份和 11-06 补的 7 条写 11-06)
    assert.equal(h.match(/<article class="dl" id="[a-z0-9-]+" aria-labelledby="h-[a-z0-9-]+"/g).length, 60);
    assert.equal(h.split(tx.t("lastChecked", "2026-11-05")).length - 1, 53);
    assert.equal(h.split(tx.t("lastChecked", "2026-11-06")).length - 1, 8);
    assert.equal(h.match(/<div class="dl-off">/g).length, 60);
    assert.ok(![...h.matchAll(/<div class="dl-off">[\s\S]*?<\/div>/g)].some((m) => /href="(?!https:\/\/)/.test(m[0])), "官方链接都是 https");
    // 倒数是字,不只是颜色;快截止的最醒目。ApolloX 10:00 UTC 截止,这时候还剩 2 小时(不写「今天截止」)
    assert.match(entry(h, "aster-apollox-offline"), new RegExp(`<span class="dl-left soon">[\\s\\S]*?<span>${tx.lang === "en" ? "2 hours left" : "还剩 2 小时"}</span>`));
    // Sophon 只写了 11-25:倒数算到 11-25 00:00 UTC(还有 19 天 16 小时,写 19 天)
    assert.match(entry(h, "sophon-chain-shutdown"), new RegExp(`<span class="dl-left near">[\\s\\S]*?<span>${tx.lang === "en" ? "19 days left" : "还有 19 天"}</span>[\\s\\S]*?<time class="mono" datetime="2026-11-25">2026-11-25</time>`));
    assert.match(entry(h, "lisk-chain-closed"), /<span class="dl-left past">/);
    assert.match(entry(h, "harmony-shutdown"), new RegExp(`<span class="dl-left none">[\\s\\S]*?<span>${tx.t("dlNoDate")}</span>`));
    // 标题、描述、og
    assert.ok(!TITLE_BAN.test(h.match(/<title>([^<]*)<\/title>/)[1]));
    assert.ok(h.includes(`<link rel="canonical" href="https://defiexit.com${tx.lang === "en" ? "/en" : ""}/deadlines/">`));
    assert.match(h, /<meta property="og:description" content="[^"]+">/);
  }
  // 英文页里没有中文(语言切换按钮上的「中文」除外)
  const cjk = noLangNav(deadlinesPage(EN, D, DAY)).match(CJK);
  assert.equal(cjk, null, `英文页里有中文:${cjk?.[0]}`);
  // 中文页的标点换成了全角;英文名字两边不加
  const zh = deadlinesPage(ZH, D, DAY);
  assert.ok(entry(zh, "aster-apollox-offline").includes("<h3 id=\"h-aster-apollox-offline\">Aster：ApolloX 网页和 API 下线</h3>"));
  // 「不限哪条链」显示成字,不是一个叫 EVM 的链
  assert.ok(entry(zh, "stargate-v1-pools").includes('<li class="chip">多条 EVM 链</li>'));
});

test("截止日历页:构建以后过了几天,快到期的挪进「已过」,倒数跟着变", () => {
  const h = deadlinesPage(ZH, D, new Date("2026-11-13T00:00:00Z"));
  const open = h.slice(h.indexOf('id="openList"'), h.indexOf('id="nodate"'));
  const passed = h.slice(h.indexOf('id="passedList"'));
  for (const id of ["aster-apollox-offline", "meth-cmeth-rewards", "gmo-gyen-zusd-redemption", "blur-frontend-blend"]) {
    assert.ok(!open.includes(`id="${id}"`) && passed.includes(`id="${id}"`), id);
  }
  assert.ok(h.includes('<span class="count" data-n="open">23</span>') && h.includes('<span class="count" data-n="passed">22</span>'));
  assert.match(entry(h, "sophon-chain-shutdown"), /<span>还有 12 天<\/span>/);
});

test("截止日历数据:11-06 补的 7 条只加在最后;Stader 的申请地址和邮箱不转抄、体检先不提醒;Moonbeam、Moonriver、DFK Chain 已过,没定日子的 3 条单独一段", () => {
  const added = ["stader-bnbx-redemption", "stader-maticx-fixed-rate", "moonbeam-glmr-base", "moonriver-movr-base", "dfk-chain-sunset", "robin-markets-v1", "summerfi-winddown"];
  assert.deepEqual(D.events.slice(-7).map((e) => e.id), added);
  const e = (id) => D.events.find((x) => x.id === id);
  for (const id of added) assert.equal(e(id).checked, "2026-11-06", id);
  // BNBx 改成「把币发到一个地址、再发邮件」:骗子最爱照抄这种流程。地址和邮箱只留在官方博客,本页不写,还要提醒别信别人给的地址
  const bnbx = e("stader-bnbx-redemption");
  const body = JSON.stringify({ ...bnbx, official: bnbx.official.map((o) => o.label) });
  assert.ok(!/0x[0-9a-fA-F]{4,}/.test(body) && !body.includes("@"), "不写申请地址和邮箱");
  assert.ok(bnbx.caution.zh.includes("骗局") && bnbx.caution.en.includes("scam"));
  assert.ok(bnbx.official.every((o) => new URL(o.url).hostname === "www.staderlabs.com" || o.url.startsWith("https://x.com/staderlabs/")));
  // 钱包里的 BNBx、MaticX 要按合约地址对币,先不提醒;Robin Markets、Summer.fi 在 Zerion 里叫什么对不准,也不提醒
  for (const id of ["stader-bnbx-redemption", "stader-maticx-fixed-rate", "robin-markets-v1", "summerfi-winddown"]) assert.equal(e(id).matchBy, null, id);
  assert.deepEqual(added.map((id) => e(id).deadline), [null, "2029-08-03", "2026-07-31", "2026-07-31", "2026-08-28", null, null]);
  const h = deadlinesPage(ZH, D, DAY);
  const open = h.slice(h.indexOf('id="openList"'), h.indexOf('id="nodate"'));
  const none = h.slice(h.indexOf('id="nodate"'), h.indexOf('id="passed"'));
  const passed = h.slice(h.indexOf('id="passedList"'));
  assert.ok(open.includes('id="stader-maticx-fixed-rate"'));
  for (const id of ["stader-bnbx-redemption", "robin-markets-v1", "summerfi-winddown"]) assert.ok(none.includes(`id="${id}"`), id);
  for (const id of ["moonbeam-glmr-base", "moonriver-movr-base", "dfk-chain-sunset"]) assert.ok(passed.includes(`id="${id}"`), id);
  // 没有图标的链显示首字母;HyperEVM 用 Hyperliquid 的图标
  assert.ok(entry(h, "moonbeam-glmr-base").includes('<span class="clogo letter" aria-hidden="true">M</span>Moonbeam'));
  assert.ok(entry(h, "summerfi-winddown").includes('<img class="clogo" src="/assets/chains/hyperliquid.svg"'));
});

test("转给朋友:X 的发帖链接,文字是这一条的一句话加上带 #这一条 的本页网址;编码对,新窗口打开,不带来源", () => {
  const e = D.events.find((x) => x.id === "sophon-chain-shutdown");
  for (const [tx, url, text] of [[ZH, "https://defiexit.com/deadlines/#sophon-chain-shutdown", zhPunct(e.summary.zh)], [EN, "https://defiexit.com/en/deadlines/#sophon-chain-shutdown", e.summary.en]]) {
    const a = entry(deadlinesPage(tx, D, DAY), e.id).match(/<a class="xshare" href="([^"]+)"([^>]*)>/);
    assert.ok(a, "缺「转给朋友」");
    const href = a[1].replace(/&amp;/g, "&");
    assert.ok(href.startsWith("https://x.com/intent/tweet?text="));
    assert.ok(!/[\s#]/.test(href) && href.includes("%23sophon-chain-shutdown"), "空格、# 都要编码");
    assert.equal(new URL(href).searchParams.get("text"), `${text}\n${url}`);
    assert.ok(a[2].includes('target="_blank" rel="noopener noreferrer"'));
    assert.ok(a[2].includes(`aria-label="${tx.attr("shareXAria", e.name[tx.lang])}"`));
  }
  // 发出去的字里不带 ** 和 ` 这种标记
  assert.equal(shareHref("a&b #c", "https://d.com/x/#y"), "https://x.com/intent/tweet?text=a%26b%20%23c%0Ahttps%3A%2F%2Fd.com%2Fx%2F%23y");
  const blast = entry(deadlinesPage(ZH, D, DAY), "blast-l2-shutdown").match(/<a class="xshare" href="([^"]+)"/)[1];
  assert.ok(!decodeURIComponent(blast).includes("`") && !decodeURIComponent(blast).includes("**"));
});

// 专题:test/fixtures/topics/demo.json 是测试用的样例(不是真内容)
const topics = loadTopics(join("test", "fixtures", "topics"));
const T0 = JSON.parse(readFileSync(join("test", "fixtures", "topics", "demo.json"), "utf8"));
const ctx = (lang) => ({ topics, events: D.events, recipes: [{ id: "woofi", title: lang === "en" ? "Get your WOOFi stake and vault back to your wallet" : "WOOFi 质押和金库取回钱包" }] });

test("专题:样例渲染出标题、目录、每一段、常见问题、相关、依据和「转给朋友」;英文版没有中文", () => {
  assert.deepEqual(topics.map((t) => t.slug), ["demo"]);
  for (const tx of [ZH, EN]) {
    const P = tx.lang === "en" ? "/en" : "";
    const h = topicPage(tx, topics[0], ctx(tx.lang));
    assert.match(h, /data-page="topic"/);
    assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/.test(h) && !/\sstyle="/.test(h));
    assert.ok(h.includes(`<link rel="canonical" href="https://defiexit.com${P}/topics/demo/">`));
    assert.ok(h.includes(`<a class="back" href="${P}/topics/">`));
    assert.equal(h.match(/<h1 class="display">/g).length, 1);
    // 三段以上才放目录;每段一个 h2,锚点中英一样
    assert.ok(h.includes('<nav class="toc" aria-labelledby="tocH">'));
    for (const i of [1, 2, 3]) assert.ok(h.includes(`<a href="#s${i}">`) && h.includes(`<section class="tp-sec" id="s${i}" aria-labelledby="s${i}h">`));
    assert.ok(h.includes("<b>") && h.includes("<code>example.com</code>"), "**粗体** 和 `代码` 照常换");
    assert.equal(h.split('<section class="tp-sec tp-faq"')[1].match(/<h3>/g).length, 2);
    // 相关:截止日历的一条、一份指南
    assert.ok(h.includes(`<a href="${P}/deadlines/#sophon-chain-shutdown">`) && h.includes(`<a href="${P}/r/woofi/">`));
    assert.ok(h.includes('<a href="https://example.com/two?a=1&amp;b=2" rel="noopener nofollow">'));
    assert.ok(h.includes(tx.t("lastChecked", "2026-11-05")));
    const share = h.match(/<a class="xshare" href="([^"]+)"/)[1].replace(/&amp;/g, "&");
    assert.ok(new URL(share).searchParams.get("text").endsWith(`\nhttps://defiexit.com${P}/topics/demo/`));
  }
  assert.equal(noLangNav(topicPage(EN, topics[0], ctx("en"))).match(CJK), null);
  // 中文标题照常换全角标点
  assert.ok(topicPage(ZH, topics[0], ctx("zh")).includes("<title>示例专题：网站下线以后 · DeFiExit</title>"));
});

test("专题列表:列出每一篇;还没有专题时说正在整理,并指去截止日历", () => {
  const h = topicsIndex(ZH, topics);
  assert.ok(h.includes('<ul class="tp-list"><li><a href="/topics/demo/">') && h.includes("最后核对 2026-11-05"));
  assert.ok(topicsIndex(EN, topics).includes('<a href="/en/topics/demo/">'));
  const empty = topicsIndex(ZH, []);
  assert.ok(!empty.includes('class="tp-list"') && empty.includes(ZH.h("tpEmpty")) && empty.includes('<a href="/deadlines/">'));
});

test("专题:缺字段、英文混中文、依据不是 https、标题写「找回」、相关对不上、文件名和 slug 不一样,都报错;正文里的尖括号不会变成标签", () => {
  const bad = (mut, re) => {
    const x = structuredClone(T0);
    mut(x);
    assert.throws(() => checkTopic(x, "t.json"), re);
  };
  bad((x) => delete x.title.en, /缺 title\.en/);
  bad((x) => { x.sections[0].p[0].en = "网站"; }, /sections\[0\]\.p\[0\]\.en 里有中文/);
  bad((x) => { x.sources[0].url = "javascript:alert(1)"; }, /sources\[0\]\.url/);
  bad((x) => { x.sources = []; }, /sources/);
  bad((x) => { x.sections = []; }, /sections/);
  bad((x) => { x.sections[1] = { h: x.sections[1].h }; }, /sections\[1\] 没有正文/);
  bad((x) => { x.title.zh = "教你找回被困的钱"; }, /标题/);
  bad((x) => { x.related = ["Not A Slug"]; }, /related/);
  bad((x) => { x.faq = [{ q: x.faq[0].q }]; }, /faq\[0\]\.a/);
  bad((x) => { x.checked = "昨天"; }, /checked/);
  // 相关里的编号哪儿都对不上:出页面时报错
  const x = structuredClone(T0);
  x.related = ["no-such-thing"];
  assert.throws(() => topicPage(ZH, checkTopic(x, "t.json"), ctx("zh")), /no-such-thing/);
  // 文件名要和 slug 一样
  const dir = mkdtempSync(join(tmpdir(), "dx-topics-"));
  try {
    writeFileSync(join(dir, "other.json"), JSON.stringify(T0));
    assert.throws(() => loadTopics(dir), /文件名要和 slug 一样/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // 内容是另一份文件写的:里面的 HTML 一律转义
  const y = structuredClone(T0);
  y.sections[0].p[0].zh = "<img src=x onerror=alert(1)>";
  const h = topicPage(ZH, checkTopic(y, "t.json"), ctx("zh"));
  assert.ok(h.includes("&lt;img src=x onerror=alert(1)&gt;") && !h.includes("<img src=x"));
});

test("截止日历数据:体检怎么对(matchBy)、截止的时间(deadlineAt)、分几步截止(milestones)写错了,构建直接报错", () => {
  const bad = (mut, re) => {
    const x = structuredClone(D);
    mut(x);
    assert.throws(() => checkDeadlines(x, "t.json"), re);
  };
  const e = (x, id) => x.events.find((y) => y.id === id);
  bad((x) => delete x.events[0].matchBy, /matchBy/);
  bad((x) => { x.events[0].matchBy = "name"; }, /matchBy/);
  bad((x) => { e(x, "sophon-chain-shutdown").chainKeys = []; }, /matchBy 是 chain,要写 chainKeys/);
  bad((x) => { e(x, "blur-frontend-blend").protocolKeys = []; }, /matchBy 是 protocol,要写 protocolKeys/);
  bad((x) => { delete e(x, "pancakeswap-opbnb-cake").tokenKeys; }, /matchBy 是 token,要写 tokenKeys/);
  bad((x) => { e(x, "sophon-chain-shutdown").tokenKeys = ["soph"]; }, /tokenKeys 只在 matchBy 是 token 时写/);
  // 按币对的:要写核对过的合约(链 + 哪个币 + 小写地址 + 官方出处),写错了直接报错
  const tok = (x) => x.events.find((y) => y.matchBy === "token"), c0 = (x) => tok(x).tokenContracts[0];
  bad((x) => { delete tok(x).tokenContracts; }, /matchBy 是 token,要写 tokenContracts/);
  bad((x) => { tok(x).tokenContracts = []; }, /matchBy 是 token,要写 tokenContracts/);
  for (const a of [`0x${"AB".repeat(20)}`, "0x1234", `0x${"g".repeat(40)}`, "DUSDt4AeLZHWYmcXnVGYdgAzjtzU5mXUVnTMdnSzAttM", undefined]) bad((x) => { c0(x).address = a; }, /tokenContracts\[0\]\.address/);
  bad((x) => { c0(x).chain = "no-such-chain"; }, /tokenContracts\[0\]\.chain/);
  bad((x) => { c0(x).token = "no-such-token"; }, /tokenContracts\[0\]\.token/);
  for (const u of ["http://example.com/", "javascript:alert(1)", "https://defiexit.com@example.com/", undefined]) bad((x) => { c0(x).source = u; }, /tokenContracts\[0\]\.source/);
  bad((x) => { tok(x).tokenContracts.push({ ...c0(x) }); }, /重复/);
  bad((x) => { e(x, "sophon-chain-shutdown").tokenContracts = [{ chain: "sophon", token: "soph", address: `0x${"1".repeat(40)}`, source: "https://example.com/" }]; }, /tokenContracts 只在 matchBy 是 token 时写/);
  // 占位地址(0x000…0、0xeee…e)不是币的合约;非 EVM 链(Stellar、Solana…)的不写
  for (const a of [`0x${"0".repeat(40)}`, `0x${"e".repeat(40)}`]) bad((x) => { c0(x).address = a; }, /占位地址/);
  bad((x) => { e(x, "gmo-gyen-zusd-redemption").tokenContracts.push({ chain: "stellar", token: "gyen", address: `0x${"12".repeat(20)}`, source: "https://example.com/" }); }, /stellar 没登记成 EVM 链/);
  // 按链、按币对的:chains 和 chainKeys 一样多、顺序一样(卡片标题按位置取链名,不然 Mantle 上的币写成 Ethereum)
  bad((x) => { e(x, "meth-cmeth-rewards").chains.reverse(); }, /chains\[0\]「Mantle」和 chainKeys\[0\]「ethereum」对不上/);
  bad((x) => { e(x, "stargate-stg-zro").chains.pop(); }, /一样多/);
  bad((x) => { e(x, "sophon-chain-shutdown").chains = ["Abstract"]; }, /对不上/);
  // 链名照 CHAIN_REGISTRY 登记的一模一样(不按「名字里有这个键」):「Ethereum Classic」对不上 ethereum;
  // 没登记的键不收;tokenContracts 只收登记成 EVM 的链(sui-mainnet 这种没登记的不收,不靠黑名单)
  bad((x) => { e(x, "stargate-stg-zro").chains[0] = "Ethereum Classic"; }, /chains\[0\]「Ethereum Classic」和 chainKeys\[0\]「ethereum」对不上/);
  bad((x) => { const s = e(x, "stargate-stg-zro"); s.chains.push("Sui Mainnet"); s.chainKeys.push("sui-mainnet"); s.tokenContracts.push({ chain: "sui-mainnet", token: "stg", symbol: "STG", address: `0x${"12".repeat(20)}`, source: "https://example.com/" }); }, /sui-mainnet 没登记成 EVM 链/);
  bad((x) => { const s = e(x, "sophon-chain-shutdown"); s.chains = ["Sui Mainnet"]; s.chainKeys = ["sui-mainnet"]; }, /chainKeys\[0\]「sui-mainnet」还没登记/);
  // 卡片标题里的币名:每个合约都要写,和 token 只差大小写
  bad((x) => { delete c0(x).symbol; }, /tokenContracts\[0\]\.symbol/);
  bad((x) => { c0(x).symbol = "USDT"; }, /tokenContracts\[0\]\.symbol/);
  // 仓位里借来的默认不算;写 matchLoans 只能写 true,只给按币对的;标题说法 dueKind 只能是那几种
  bad((x) => { e(x, "venus-vai-lisusd").matchLoans = "yes"; }, /matchLoans/);
  bad((x) => { e(x, "sophon-chain-shutdown").matchLoans = true; }, /matchLoans/);
  bad((x) => { e(x, "standx-winddown").dueKind = "withdraw"; }, /dueKind 只能是/);
  // 一个地址都核对不了的:matchBy 写 null(tokenKeys、tokenContracts 都不写),照样通过——截止日历页照样列着,体检不提醒
  const off = structuredClone(D), t0 = tok(off);
  t0.matchBy = null;
  delete t0.tokenKeys;
  delete t0.tokenContracts;
  assert.doesNotThrow(() => checkDeadlines(off, "t.json"));
  // 截止时间:带时区、日子和 deadline 一样;没定日子的不能写
  bad((x) => { e(x, "gmo-gyen-zusd-redemption").deadlineAt = "2026-11-12T04:59:59Z"; }, /deadlineAt/);
  bad((x) => { e(x, "gmo-gyen-zusd-redemption").deadlineAt = "2026-11-11 23:59"; }, /deadlineAt/);
  bad((x) => { e(x, "balancer-winddown").deadlineAt = "2026-11-30T00:00:00Z"; }, /deadlineAt/);
  // 分几步截止:从早到晚、都早于最后一步(deadline)、中英都有、标点照样查
  bad((x) => { e(x, "standx-winddown").milestones.reverse(); }, /从早到晚/);
  bad((x) => { e(x, "standx-winddown").milestones[1].date = "2027-02-01"; }, /早于 deadline/);
  bad((x) => { delete e(x, "standx-winddown").milestones[0].note.en; }, /milestones\[0\]\.note\.en/);
  bad((x) => { e(x, "standx-winddown").milestones[0].deadlineAt = "2026-12-30T08:00:00Z"; }, /milestones\[0\]\.deadlineAt/);
  bad((x) => { e(x, "standx-winddown").milestones = []; }, /milestones/);
  bad((x) => { e(x, "quickswap-old-quick").milestones[0].note.zh = "比例降到 QUICK:NEW"; }, /milestones\[0\]\.note\.zh 里/);
});

test("截止日历页:写了截止时间的按那个时间分「还没到 / 已过」;分几步截止的每一步一行,下一步加粗、过了的标「已过」", () => {
  const inOpen = (h, id) => h.slice(h.indexOf('id="openList"'), h.indexOf('id="nodate"')).includes(`id="${id}"`);
  // GYEN 美东 11-11 23:59:59 截止:UTC 11-12 凌晨 3 点还没到(还剩 1 小时 59 分,写还剩 1 小时,不写「今天截止」),5 点就过了
  const at3 = deadlinesPage(ZH, D, new Date("2026-11-12T03:00:00Z")), at5 = deadlinesPage(ZH, D, new Date("2026-11-12T05:00:00Z"));
  assert.ok(inOpen(at3, "gmo-gyen-zusd-redemption") && !inOpen(at5, "gmo-gyen-zusd-redemption"));
  assert.match(entry(at3, "gmo-gyen-zusd-redemption"), /<span class="dl-left soon">[\s\S]*?<span>还剩 1 小时<\/span>/);
  assert.ok(entry(at3, "gmo-gyen-zusd-redemption").includes('data-at="2026-11-11T23:59:59-05:00"'), "页面上的脚本按同一个时间重算");
  // Silicon 12-31 12:00(UTC+9)也就是 03:00 UTC 停:UTC 2 点还没到,4 点已过
  assert.ok(inOpen(deadlinesPage(ZH, D, new Date("2026-12-31T02:00:00Z")), "silicon-network-shutdown"));
  assert.ok(!inOpen(deadlinesPage(ZH, D, new Date("2026-12-31T04:00:00Z")), "silicon-network-shutdown"));
  // 审查报的:北京时间 12-30 中午看 Silicon,还剩 23 小时,不说「今天截止」(中英都一样)
  const bj = new Date("2026-12-30T12:00:00+08:00");
  assert.match(entry(deadlinesPage(ZH, D, bj), "silicon-network-shutdown"), /<span class="dl-left soon">[\s\S]*?<span>还剩 23 小时<\/span>/);
  assert.match(entry(deadlinesPage(EN, D, bj), "silicon-network-shutdown"), /<span class="dl-left soon">[\s\S]*?<span>23 hours left<\/span>/);
  for (const tx of [ZH, EN]) assert.ok(!/今天截止|明天截止|Deadline today|Last day today|Ends tomorrow/.test(deadlinesPage(tx, D, bj)));
  // StandX:截止日是最后一步 2027-01-31,前面两步一步一行,下一步加粗
  const steps = (h) => [...h.matchAll(/<li data-deadline="([\d-]+)"(?: data-at="[^"]*")?(?: class="(\w+)")?>[\s\S]*?<span class="dl-step-left">([^<]*)<\/span>/g)].map((m) => [m[1], m[2] || "", m[3]]);
  const sx = entry(deadlinesPage(ZH, D, DAY), "standx-winddown");
  assert.ok(sx.includes('data-deadline="2027-01-31"') && sx.includes(`<dt>${ZH.h("dlSteps")}</dt>`));
  // 空投那一步写了 12-31 08:00 UTC(正好还有 56 天);强平那一步只写了 1-15,算到 1-15 00:00 UTC(70 天 16 小时,写 70 天)
  assert.deepEqual(steps(sx), [["2026-12-31", "next", "还有 56 天"], ["2027-01-15", "", "还有 70 天"]]);
  // 过了第一步:标「已过」,第二步加粗
  assert.deepEqual(steps(entry(deadlinesPage(ZH, D, new Date("2027-01-01T00:00:00Z")), "standx-winddown")), [["2026-12-31", "done", "已过"], ["2027-01-15", "next", "还有 14 天"]]);
  // Balancer:取款一直开着,在「没定日期」那一段;11-30 那一步照样列出来
  const h = deadlinesPage(ZH, D, DAY);
  assert.ok(h.slice(h.indexOf('id="nodate"'), h.indexOf('id="passed"')).includes('id="balancer-winddown"'));
  assert.ok(entry(h, "balancer-winddown").includes('<li data-deadline="2026-11-30" class="next">'));
  // Metis 上的 Stargate 池子单列一条(10-23 已过);V1 那一条说明 Metis 除外
  assert.ok(h.slice(h.indexOf('id="passedList"')).includes('id="stargate-metis-pools"'));
  assert.ok(entry(h, "stargate-v1-pools").includes("Metis"));
  assert.ok(entry(deadlinesPage(EN, D, DAY), "standx-winddown").includes(`<dt>${EN.h("dlSteps")}</dt>`));
});

test("截止日历页:只写了日子的,那一天(UTC)里写「按 UTC 算,今天是截止日」、还算没到,过完才挪进已过;cmETH 官方说 11 月 7 日前领,11-07 00:00 UTC 起就算过了", () => {
  const inOpen = (h, id) => h.slice(h.indexOf('id="openList"'), h.indexOf('id="nodate"')).includes(`id="${id}"`);
  const d25 = new Date("2026-11-25T05:00:00Z");
  assert.ok(inOpen(deadlinesPage(ZH, D, d25), "sophon-chain-shutdown"));
  assert.match(entry(deadlinesPage(ZH, D, d25), "sophon-chain-shutdown"), /<span class="dl-left soon">[\s\S]*?<span>按 UTC 算，今天是截止日（11 月 25 日）<\/span>/);
  assert.match(entry(deadlinesPage(EN, D, d25), "sophon-chain-shutdown"), /<span>Deadline day \(UTC\): Nov 25<\/span>/);
  assert.ok(!inOpen(deadlinesPage(ZH, D, new Date("2026-11-26T00:00:00Z")), "sophon-chain-shutdown"), "UTC 11-26 零点起已过");
  // 前一天:算到 11-25 00:00 UTC
  assert.match(entry(deadlinesPage(ZH, D, new Date("2026-11-24T15:00:00Z")), "sophon-chain-shutdown"), /<span>还剩 9 小时<\/span>/);
  // cmETH:写了 deadlineAt 11-07 00:00 UTC
  const m = D.events.find((e) => e.id === "meth-cmeth-rewards");
  assert.equal(m.deadlineAt, "2026-11-07T00:00:00Z");
  assert.match(entry(deadlinesPage(ZH, D, new Date("2026-11-06T00:00:00Z")), "meth-cmeth-rewards"), /<span>还剩 24 小时<\/span>/);
  assert.ok(inOpen(deadlinesPage(ZH, D, new Date("2026-11-06T23:59:00Z")), "meth-cmeth-rewards"));
  assert.ok(!inOpen(deadlinesPage(ZH, D, new Date("2026-11-07T00:00:00Z")), "meth-cmeth-rewards"));
  assert.ok(!inOpen(deadlinesPage(ZH, D, new Date("2026-11-07T10:00:00Z")), "meth-cmeth-rewards"));
});

test("截止日历数据:QuickSwap 旧 QUICK 的说法照官方帖——1:750「until December 5, 2026」,「After December 5」降到 1:500(不说「12 月 5 日起」)", () => {
  const q = D.events.find((e) => e.id === "quickswap-old-quick");
  assert.ok(q.deadlineNote.zh.includes("1:750 的比例到 2026 年 12 月 5 日为止,12 月 5 日以后降到 1:500"));
  assert.ok(q.deadlineNote.en.includes("1:750 rate remains available until Dec 5, 2026, and drops to 1:500 after Dec 5"));
  for (const s of [q.summary.zh, q.summary.en, q.deadlineNote.zh, q.deadlineNote.en, q.todo.zh, q.todo.en, ...q.milestones.flatMap((m) => [m.note.zh, m.note.en])]) {
    assert.ok(!/12 月 5 日起|from Dec 5|on Dec 5/.test(s), s);
  }
  // 1:750 这一档到 12-05 为止:只写了日子,12-05(UTC)那一天还算没过,过完才轮到下一档
  assert.deepEqual(q.milestones.map((m) => [m.date, m.deadlineAt]), [["2026-12-05", undefined], ["2027-01-05", undefined]]);
  assert.equal(nextMilestone(q, new Date("2026-12-05T20:00:00Z")).date, "2026-12-05");
  assert.equal(nextMilestone(q, new Date("2026-12-06T00:00:00Z")).date, "2027-01-05");
});

test("截止日历页开着时重标(lib/relabel.js):倒数、颜色、条数没变就一处都不写;时间过了,过了的挪进「已过」、条数跟着改,再算一次又是一处都不写", async () => {
  const { relabel } = await import("../src/js/lib/relabel.js");
  const { makeT } = await import("../src/js/lib/i18n.js");
  // 很小的假页面:只够 relabel 用到的几样(按 id 找、那几个选择器、querySelector、closest、contains、prepend、children)
  class N {
    constructor(tag, cls = "", data = {}) { Object.assign(this, { tag, className: cls, dataset: data, textContent: "", children: [], parent: null, kids: {} }); }
    add(c) { c.parent = this; this.children.push(c); return c; }
    querySelector(sel) { return this.kids[sel] || null; }
    closest(tag) { let p = this; while (p && p.tag !== tag) p = p.parent; return p; }
    contains(x) { for (let p = x; p; p = p.parent) if (p === this) return true; return false; }
    prepend(c) { if (c.parent) c.parent.children.splice(c.parent.children.indexOf(c), 1); c.parent = this; this.children.unshift(c); }
  }
  const openList = new N("ol"), passedList = new N("ol"), openN = new N("b"), passedN = new N("b");
  // 一条写了截止时间的(cmETH:11-07 00:00 UTC),里面带两步:一步只写了日子(11-06),一步 11-20
  const art = new N("article", "dl", { deadline: "2026-11-07", at: "2026-11-07T00:00:00Z" });
  const pill = new N("span", "dl-left"), pillText = new N("span");
  pill.kids.span = pillText;
  art.kids[".dl-left"] = pill;
  openList.add(new N("li")).add(art);
  const steps = new N("ol", "dl-steps");
  for (const d of ["2026-11-06", "2026-11-20"]) { const li = steps.add(new N("li", "", { deadline: d })); li.kids[".dl-step-left"] = new N("span"); }
  const sel = { ".dl[data-deadline]": [art], ".dl-steps": [steps], '[data-n="open"]': [openN], '[data-n="passed"]': [passedN] };
  const doc = { getElementById: (id) => ({ openList, passedList })[id] || null, querySelectorAll: (s) => sel[s] || [] };
  const t = makeT("zh"), at = (s) => new Date(s);
  assert.ok(relabel(doc, t, at("2026-11-06T00:00:30Z")) > 0, "第一次:写上");
  assert.equal(pillText.textContent, "还剩 23 小时");
  assert.equal(pill.className, "dl-left soon");
  assert.deepEqual(steps.children.map((li) => [li.className, li.kids[".dl-step-left"].textContent]), [["next", "按 UTC 算，今天是截止日（11 月 6 日）"], ["", "还有 13 天"]]);
  assert.deepEqual([openN.textContent, passedN.textContent], ["1", "0"]);
  assert.equal(relabel(doc, t, at("2026-11-06T00:01:30Z")), 0, "一分钟后什么字都没变:一处都不写");
  // 过了 11-07 00:00:挪进「已过」,写「已过截止日」,条数改;第一步(11-06)那一天也过完了
  assert.ok(relabel(doc, t, at("2026-11-07T00:00:10Z")) > 0);
  assert.ok(passedList.contains(art) && !openList.contains(art));
  assert.deepEqual([pillText.textContent, pill.className, openN.textContent, passedN.textContent], ["已过截止日", "dl-left past", "0", "1"]);
  assert.deepEqual(steps.children.map((li) => [li.className, li.kids[".dl-step-left"].textContent]), [["done", "已过"], ["next", "还有 12 天"]]);
  assert.equal(relabel(doc, t, at("2026-11-07T00:01:10Z")), 0, "再算一次没变:一处都不写");
});
