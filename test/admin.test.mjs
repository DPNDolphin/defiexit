// 运营台网页(admin/admin.js):用一个很小的假 DOM 把真的 admin.js 跑起来,接口换成假的,看按钮点不点得了、提醒出不出。不连网,不用浏览器。
// 假 DOM 只做 admin.js 用到的那几样;每个用例 import 一份新的 admin.js(网址后面带 ?编号,模块不复用)。
// 单独一个文件:要换掉全局的 document、fetch(node --test 每个文件一个进程,不影响别的测试)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkText, outHosts } from "../server/ops/ingest.js";

class FakeNode {
  constructor() { this.parentNode = null; this.kids = []; }
  get children() { return this.kids.filter((k) => k instanceof FakeEl); }
  append(...ns) {
    for (const n of ns) {
      const node = n instanceof FakeNode ? n : new FakeText(String(n));
      if (node.parentNode) node.parentNode.kids = node.parentNode.kids.filter((k) => k !== node);
      node.parentNode = this;
      this.kids.push(node);
    }
  }
  prepend(...ns) { const keep = this.kids; this.kids = []; this.append(...ns); this.kids.push(...keep); }
  replaceChildren(...ns) { for (const k of this.kids) k.parentNode = null; this.kids = []; this.append(...ns); }
  remove() { if (this.parentNode) this.parentNode.kids = this.parentNode.kids.filter((k) => k !== this); this.parentNode = null; }
  get textContent() { return this.kids.map((k) => k.textContent).join(""); }
  set textContent(v) { this.replaceChildren(); if (v !== "" && v != null) this.append(String(v)); }
}
class FakeText extends FakeNode {
  constructor(t) { super(); this.data = t; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}
class FakeEl extends FakeNode {
  constructor(tag) {
    super();
    this.tagName = tag.toUpperCase(); this.attrs = new Map(); this.on = {}; this.style = {}; this.value = ""; this.disabled = false; this.readOnly = false;
    const cls = new Set(), put = () => this.attrs.set("class", [...cls].join(" "));
    this.classList = {
      add: (...c) => { c.forEach((x) => cls.add(x)); put(); }, remove: (...c) => { c.forEach((x) => cls.delete(x)); put(); },
      toggle: (c, f = !cls.has(c)) => { if (f) cls.add(c); else cls.delete(c); put(); return f; }, contains: (c) => cls.has(c),
      set: (v) => { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((x) => cls.add(x)); put(); },
    };
  }
  get className() { return this.attrs.get("class") || ""; }
  set className(v) { this.classList.set(v); }
  setAttribute(k, v) { if (k === "class") this.className = v; else this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { this.attrs.delete(k); }
  get hidden() { return this.attrs.has("hidden"); }
  set hidden(v) { if (v) this.attrs.set("hidden", ""); else this.attrs.delete("hidden"); }
  get href() { return this.getAttribute("href") || ""; }
  set href(v) { this.setAttribute("href", v); }
  addEventListener(t, fn) { (this.on[t] ||= []).push(fn); }
  // 点一下:和浏览器一样,点不了(disabled)的按钮不触发
  async fire(t) { if (this.disabled) return; for (const fn of this.on[t] || []) await fn({ currentTarget: this, target: this, preventDefault() {} }); }
  focus() {}
  select() {}
  querySelectorAll() { return []; }
  get clientWidth() { return 600; }
  get offsetWidth() { return 140; }
}
const find = (el, ok) => { for (const k of el.children) { if (ok(k)) return k; const x = find(k, ok); if (x) return x; } return null; };
const tick = () => new Promise((r) => setTimeout(r, 5));

// 起一个运营台:state 是 /api/admin/state 回的(status 不是 200 就是没登进去);改待发照服务器的规矩回(草稿过 checkText,不合格回 400 draftbad)
let copies = 0;
async function desk(state, status = 200) {
  const els = new Map();
  globalThis.document = {
    getElementById: (id) => { if (!els.has(id)) { const e = new FakeEl("div"); e.setAttribute("id", id); els.set(id, e); } return els.get(id); },
    createElement: (t) => new FakeEl(t), createElementNS: (ns, t) => new FakeEl(t), createTextNode: (t) => new FakeText(t),
    activeElement: null, visibilityState: "visible", addEventListener() {},
  };
  Object.assign(globalThis, { Node: FakeNode, window: globalThis, location: { hash: "", pathname: "/admin/" }, history: { replaceState() {} }, requestAnimationFrame: (fn) => setTimeout(fn, 0) });
  const $ = (id) => document.getElementById(id);
  $("desk").hidden = true; // index.html 里一开始都收着
  $("pace").hidden = true;
  const calls = [];
  const res = (status, json) => ({ status, json: async () => JSON.parse(JSON.stringify(json)) });
  globalThis.fetch = async (url, opt) => {
    const path = String(url).replace("/api/admin/", ""), b = opt.body ? JSON.parse(opt.body) : {};
    calls.push([path, b]);
    if (path === "state") return res(status, state);
    if (path !== "outbox") return res(200, { ok: true });
    const it = state.outbox.find((x) => x.id === b.id);
    if (typeof b.draft === "string") { const why = checkText(b.draft, undefined, outHosts(it.mine)); if (why) return res(400, { error: "draftbad", why }); }
    if ("draft" in b) it.draft_admin = b.draft;
    if ("status" in b) { it.status = b.status; it.decided_at = b.status === "待发" ? null : new Date().toISOString(); }
    return res(200, { ok: true, item: it });
  };
  await import(new URL("../admin/admin.js?" + ++copies, import.meta.url).href);
  await tick();
  assert.equal($("desk").hidden, status !== 200, status === 200 ? "进了运营台" : "没进运营台");
  const card = (id) => {
    const c = find($("out-cards"), (e) => e.getAttribute("data-id") === id) || find($("done-cards"), (e) => e.getAttribute("data-id") === id);
    const btn = (text) => find(c, (e) => e.tagName === "BUTTON" && e.textContent === text);
    return { ta: find(c, (e) => e.tagName === "TEXTAREA"), open: find(c, (e) => e.tagName === "A" && e.classList.contains("primary")), copy: btn("复制"), sent: btn("已发"), skip: btn("跳过"), restore: btn("用回我原来写的"), wait: find(c, (e) => e.className === "queue") };
  };
  // 「在 X 打开」点不点得了:有链接、没被收起来
  const canOpen = (id) => { const { open } = card(id); return !!open.href && !open.classList.contains("off"); };
  return { $, card, canOpen, calls };
}

const now = Date.now();
const ago = (min) => new Date(now - min * 60e3).toISOString();
const tg = (n) => ({ id: "21160000000000001" + n, handle: "u" + n, url: "https://x.com/u" + n + "/status/21160000000000001" + n, protocol: "P" + n });
const reply = (id, n, over = {}) => ({ id, mine: { target: tg(n), draft: "到期金库可以在官方合约上自己取出。" }, status: "待发", decided_at: null, created_at: ago(300 - n), draft_admin: null, purged: false, ...over });
const base = (outbox, rules) => ({ ok: true, me: { name: "admin1" }, docs: rules ? { rules } : {}, outbox, inbox: [], needs: [], leads: [], auto: {}, outStats: {}, watchOff: [], synced: { at: null, note: "" } });

test("改过的草稿被服务器拒了:「在 X 打开」「复制」先收起来(不把拒掉的字发出去),改好存上、或点「用回我原来写的」才放开", async () => {
  const d = await desk(base([reply("r1", 10)]));
  let r = d.card("r1");
  assert.deepEqual([d.canOpen("r1"), r.copy.disabled, r.restore.hidden], [true, false, true]);
  // 改成带链接的(对人的首回一个都不许):服务器不收
  r.ta.value = "步骤在 defiexit.com/r/woofi 。";
  await r.ta.fire("input");
  await r.ta.fire("blur"); // 离开输入框就存,不用等 1.2 秒
  await tick();
  r = d.card("r1");
  assert.equal(d.canOpen("r1"), false, "拒掉的字不能拿去 X 上发");
  assert.equal(r.copy.disabled, true);
  assert.equal(r.restore.hidden, false, "第一次改就被拒,也能用回原来写的");
  await r.open.fire("click");
  assert.equal(d.calls.filter(([p, b]) => p === "outbox" && "status" in b).length, 0, "点了也不记成已发");
  // 接着改:还没存上之前照样收着;存上了才放开,链接里带的是改好的字
  r.ta.value = "到期金库可以在官方合约上自己取出,不用等官网的按钮。";
  await r.ta.fire("input");
  assert.equal(d.canOpen("r1"), false);
  await r.ta.fire("blur");
  await tick();
  assert.ok(d.canOpen("r1"));
  assert.ok(decodeURIComponent(d.card("r1").open.href).includes("不用等官网的按钮"));
  assert.equal(d.card("r1").copy.disabled, false);
  // 再改坏一次,点「用回我原来写的」:放开,框里回到原来的字
  r = d.card("r1");
  r.ta.value = "去 https://evil.example/ 看";
  await r.ta.fire("input");
  await r.ta.fire("blur");
  await tick();
  assert.equal(d.canOpen("r1"), false);
  await d.card("r1").restore.fire("click");
  await tick();
  r = d.card("r1");
  assert.deepEqual([d.canOpen("r1"), r.copy.disabled, r.ta.value], [true, false, "到期金库可以在官方合约上自己取出。"]);
});

test("点「已发」也看发送节奏:30 分钟里第 6 条照样提醒歇一会儿;点「知道了」收起;「在 X 打开」也一样", async () => {
  const sent = [1, 2, 3, 4, 5].map((i) => reply("s" + i, 10 + i, { status: "已发", decided_at: ago(25 - 4 * i) }));
  const d = await desk(base([...sent, reply("r1", 20), reply("r2", 21)], { dailyReplyCap: 50 }));
  assert.equal(d.$("pace").hidden, true);
  await d.card("r1").sent.fire("click");
  await tick();
  assert.deepEqual([d.$("pace").hidden, d.$("pace-text").textContent], [false, "30 分钟里已经发了 6 条,歇一会儿"]);
  await d.$("pace-ok").fire("click");
  assert.equal(d.$("pace").hidden, true);
  await d.card("r2").open.fire("click");
  await tick();
  assert.deepEqual([d.$("pace").hidden, d.$("pace-text").textContent], [false, "30 分钟里已经发了 7 条,歇一会儿"]);
});

test("每天的上限:到了上限,多的排队(「在 X 打开」「复制」「已发」点不了,「跳过」能点);项目帖不受影响;到期删了目标帖子编号的不占名额、也不排队", async () => {
  const purged = reply("old", 1, { mine: { target: { protocol: "OpenEden" }, draft: "旧的" }, purged: true });
  const post = { id: "p1", mine: { kind: "post", topic: "提醒", draft: "项目帖" }, status: "待发", decided_at: null, created_at: ago(100), draft_admin: null, purged: false };
  const d = await desk(base([reply("s1", 9, { status: "已发", decided_at: new Date(now).toISOString() }), purged, reply("r1", 10), reply("r2", 11), reply("r3", 12), post], { dailyReplyCap: 2 }));
  const q = (id) => { const c = d.card(id); return [d.canOpen(id), c.wait.hidden ? null : c.wait.textContent, c.copy.disabled, c.sent.disabled, c.skip.disabled]; };
  const WAIT = "排队:今天上限 2 条(已发 1 条,上面 1 条先发),明天放出";
  assert.deepEqual(q("r1"), [true, null, false, false, false]);
  assert.deepEqual(q("r2"), [false, WAIT, true, true, false]);
  assert.deepEqual(q("r3"), [false, WAIT, true, true, false]);
  assert.equal(d.card("old").wait.hidden, true, "到期删了编号的不排队,也没占掉 r1 的名额");
  assert.equal(d.canOpen("p1"), true, "项目帖不受上限影响");
  await d.card("r2").open.fire("click"); // 排队的点了没用
  assert.equal(d.calls.filter(([p, b]) => p === "outbox" && "status" in b).length, 0);
  await d.card("r1").open.fire("click");
  await tick();
  assert.equal(q("r2")[1], "排队:今天已到上限 2 条,明天放出");
  assert.match(d.$("todo").textContent, /2 条回复在排队:今天已到上限 2 条,明天放出/);
});

test("登进运营台的浏览器记成管理员的(dx-owner,主站在这个浏览器里体检就不计数);没登进去的不记", async () => {
  const m = new Map();
  globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
  try {
    await desk({ need: "login" }, 401);
    assert.equal(m.get("dx-owner"), undefined);
    await desk(base([]));
    assert.equal(m.get("dx-owner"), "1");
  } finally {
    delete globalThis.localStorage;
  }
  await desk(base([])); // 没有本地存储(或者存不了)也照常进运营台
});

test("目标里「陌生人来体检」那一行下面加一行网站自己数的(总数、今天、从哪天起);别的行不加;服务器没给就不加", async () => {
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10);
  const goal = { deadline: "2026-12-15", items: [
    { key: "recipes", label: "网站上的取回指南", value: 4, goal: 15, unit: " 份" },
    { key: "checks", label: "陌生人来体检", value: null, goal: 100, unit: " 个地址", note: "我送来的说明" },
  ] };
  const d = await desk({ ...base([]), docs: { goal_1215: goal }, hits: { checkup: { total: 12, since: "2026-11-05", byDay: { [today]: 3, "2000-01-01": 9 } } } });
  const text = d.$("data-body").textContent;
  assert.ok(text.includes("陌生人来体检还没开始数我送来的说明网站自己数的:共 12 个地址,今天 3 个(11-05 起)。"), text);
  assert.equal(text.match(/网站自己数的/g).length, 1);
  const d2 = await desk({ ...base([]), docs: { goal_1215: goal }, hits: { checkup: { total: "x" } } });
  assert.ok(!d2.$("data-body").textContent.includes("网站自己数的"));
  assert.ok(d2.$("data-body").textContent.includes("陌生人来体检还没开始数"));
});

// 服务器给的问题记录的数(db.js 的 problemCounts):一段时间一份
const PZ = (over = {}) => ({ since: "2026-10-30", total: 0, replied: 0, repliedShare: null, byType: {}, byProtocol: [], byWeek: {}, ...over });
const rowsOf = (body) => { const tb = find(body, (e) => e.tagName === "TBODY"); return tb ? tb.children.map((tr) => tr.children.map((td) => td.textContent)) : null; };

test("数据里的「大家最常问」:7 天、30 天每种几条(两边都没有的不列,「其他」放最后,不认识的种类照写)、我们回了几条、问得多的协议", async () => {
  const d = await desk({ ...base([]), problems: {
    d7: PZ({ total: 6, replied: 4, byType: { "bridge-wait": 3, migration: 1, other: 2, scam: 0 }, byProtocol: [{ protocol: "Hyperliquid", n: 3 }, { protocol: "Scroll", n: 2 }] }),
    d30: PZ({ total: 30, replied: 20, byType: { "bridge-wait": 12, migration: 3, "chain-shutdown": 5, other: 9, scam: 0, "new-kind": 1 }, byProtocol: [{ protocol: "Hyperliquid", n: 8 }, { protocol: "ZKsync Lite", n: 5 }] }),
  } });
  const body = d.$("data-body"), text = body.textContent.replace(/\u00a0/g, "_"); // 协议名和条数之间是不换行的空格,这里写成 _
  assert.ok(text.includes("大家最常问7 天我们回了 4 条 / 共 6 条问得多的协议:Hyperliquid_3 · Scroll_2"), text);
  assert.ok(text.includes("30 天我们回了 20 条 / 共 30 条问得多的协议:Hyperliquid_8 · ZKsync Lite_5"), text);
  assert.deepEqual(rowsOf(body), [["跨链 / L2 提款要等", "3", "12"], ["链关停", "0", "5"], ["换币迁移", "1", "3"], ["new-kind", "0", "1"], ["其他", "2", "9"]]);
  assert.ok(text.indexOf("大家最常问") < text.indexOf("大家卡在哪些协议"), "放在「大家卡在哪些协议」上面");
  // 最近 7 天一条都没有、30 天有:7 天那行写「还没有」,不列协议
  const d2 = await desk({ ...base([]), problems: { d7: PZ(), d30: PZ({ total: 2, replied: 0, byType: { scam: 2 }, byProtocol: [{ protocol: "FakeBridge", n: 2 }] }) } });
  assert.ok(d2.$("data-body").textContent.includes("7 天还没有30 天我们回了 0 条 / 共 2 条问得多的协议:FakeBridge\u00a02"), d2.$("data-body").textContent);
  assert.deepEqual(rowsOf(d2.$("data-body")), [["遇到骗子", "0", "2"]]);
});

test("「大家最常问」:都还没有时说一句还没有记录(不出表格);服务器没给就整块不显示", async () => {
  const d = await desk({ ...base([]), problems: { d7: PZ(), d30: PZ() } });
  const text = d.$("data-body").textContent;
  assert.ok(text.includes("大家最常问还没有记录。"), text);
  assert.equal(rowsOf(d.$("data-body")), null);
  const d2 = await desk(base([]));
  assert.ok(!d2.$("data-body").textContent.includes("大家最常问"));
  const d3 = await desk({ ...base([]), problems: { d7: PZ() } }); // 少了一段:不显示,别的照常
  assert.ok(!d3.$("data-body").textContent.includes("大家最常问"));
  assert.ok(d3.$("data-body").textContent.includes("大家卡在哪些协议"));
});

test("删除:先点一下写清楚会删什么(这条帖子在待发、收件、问题记录里的记录,同一条帖子的别的卡片也删;项目帖只删这一张);删完重新读一遍,同一条帖子的别的卡片、收件、数字都照服务器的", async () => {
  // 「再点一次」等 5 秒、提示 2.5 秒后收起:这里不真等(长的计时不跑,短的照常),免得测试干等
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => (ms >= 1000 ? {} : realTimeout(fn, ms, ...a));
  try {
    const same = tg(10);
    const one = PZ({ total: 1, byType: { other: 1 }, byProtocol: [{ protocol: "P10", n: 1 }] });
    const post = { id: "p1", mine: { kind: "post", topic: "提醒", draft: "项目帖" }, status: "待发", decided_at: null, created_at: ago(100), draft_admin: null, purged: false };
    const state = { ...base([reply("r1", 10), reply("r2", 10), reply("r3", 11), post]), problems: { d7: one, d30: one },
      inbox: [{ id: same.id, mine: { source: "X 长文", author: "u10", url: same.url, type: "求助" }, text: "钱卡住了", decision: null, replied: false, created_at: ago(50), purged: false }] };
    const d = await desk(state);
    const parts = (id) => { const c = find(d.$("out-cards"), (e) => e.getAttribute("data-id") === id); return { del: find(c, (e) => e.tagName === "BUTTON" && /删除/.test(e.textContent)), saved: find(c, (e) => e.className === "saved") }; };
    const p = parts("p1");
    await p.del.fire("click");
    assert.deepEqual([p.del.textContent, p.saved.textContent], ["确定删除?再点一次", "只删这一张自己发的帖子,以后不再收"]);
    const r1 = parts("r1");
    await r1.del.fire("click");
    assert.equal(r1.saved.textContent, "会删掉这条帖子在待发、收件、问题记录里的全部记录(同一条帖子的别的卡片也删),以后也不再收");
    // 服务器那边:同一条帖子的 r2、收件一起删了,问题记录也少了一条
    state.outbox = state.outbox.filter((x) => x.id !== "r1" && x.id !== "r2");
    state.inbox = [];
    state.problems = { d7: PZ(), d30: PZ() };
    await r1.del.fire("click");
    await tick();
    assert.deepEqual(d.calls.filter(([path]) => path === "delete"), [["delete", { kind: "outbox", id: "r1" }]]);
    assert.equal(d.calls.filter(([path]) => path === "state").length, 2, "删完又读了一遍");
    const ids = (box) => d.$(box).children.map((e) => e.getAttribute("data-id"));
    assert.deepEqual([ids("out-cards").sort(), ids("in-cards")], [["p1", "r3"], []]);
    assert.ok(d.$("data-body").textContent.includes("大家最常问还没有记录。"));
  } finally {
    globalThis.setTimeout = realTimeout;
  }
});

test("删除还没查完(服务器回 more):提示还有记录没查完、再点删除并确认接着查;卡片留着,页面重新读一遍", async () => {
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => (ms >= 1000 ? {} : realTimeout(fn, ms, ...a));
  try {
    const d = await desk(base([reply("r1", 10)]));
    const inner = globalThis.fetch;
    globalThis.fetch = async (url, opt) => (String(url).endsWith("/delete") ? { status: 409, json: async () => ({ error: "more" }) } : inner(url, opt));
    const card = () => find(d.$("out-cards"), (e) => e.getAttribute("data-id") === "r1");
    const del = find(card(), (e) => e.tagName === "BUTTON" && /删除/.test(e.textContent)), saved = find(card(), (e) => e.className === "saved");
    await del.fire("click");
    await del.fire("click");
    await tick();
    assert.equal(saved.textContent, "这条帖子还有记录没查完,再点「删除这条」并确认,接着往下查、往下删");
    assert.ok(card(), "卡片还在");
    assert.equal(d.calls.filter(([p]) => p === "state").length, 2, "重新读了一遍");
  } finally {
    globalThis.setTimeout = realTimeout;
  }
});
