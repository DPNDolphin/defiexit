// 运营台网页(admin/admin.js):用一个很小的假 DOM 把真的 admin.js 跑起来,接口换成假的,看按钮点不点得了、提醒出不出。不连网,不用浏览器。
// 假 DOM 只做 admin.js 用到的那几样;每个用例 import 一份新的 admin.js(网址后面带 ?编号,模块不复用)。
// 单独一个文件:要换掉全局的 document、fetch(node --test 每个文件一个进程,不影响别的测试)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkText, outHosts, webUrl } from "../server/ops/ingest.js";

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

// 起一个运营台:state 是 /api/admin/state 回的(status 不是 200 就是没登进去);改待发照服务器的规矩回(草稿过 checkText,不合格回 400 draftbad);
// 改宣传卡片也照服务器的规矩回(回音只给已发的记,链接过 webUrl;改成已发以外的清掉回音)
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
  const calls = [], signals = [];
  const res = (status, json) => ({ status, json: async () => JSON.parse(JSON.stringify(json)) });
  globalThis.fetch = async (url, opt) => {
    const path = String(url).replace("/api/admin/", ""), b = opt.body ? JSON.parse(opt.body) : {};
    calls.push([path, b]);
    if (path === "state") return res(status, state);
    // 点过的宣传卡片往前翻一页:按顺序回 state.donePages 里准备好的;signals 记下每一次的取消信号
    // (写成函数的:测试自己控制什么时候回,用来造「刷新以前发出去、刷新以后才回来」的那一页。
    // 和浏览器一样,请求被取消就当场报错;函数上标了 slow 的不理取消,用来造「取消了、过一会儿才报错回来」)
    if (path.startsWith("outreach-done")) {
      const p = (state.donePages || []).shift(), sig = opt.signal || null;
      signals.push(sig);
      if (typeof p !== "function") return res(200, p || { ok: true, items: [], more: 0, after: null });
      if (p.slow || !sig) return p();
      return new Promise((ok, no) => {
        const stop = () => no(new DOMException("The operation was aborted.", "AbortError"));
        if (sig.aborted) return stop();
        sig.addEventListener("abort", stop);
        p().then(ok, no);
      });
    }
    if (path === "outreach") {
      const it = state.outreach.find((x) => x.id === b.id), at = new Date().toISOString();
      if ("status" in b) Object.assign(it, { status: b.status, decided_at: b.status === "待发" ? null : at }, b.status === "已发" ? {} : { result_note: null, result_url: null, result_at: null });
      else {
        if (it.status !== "已发") return res(409, { error: "notsent" });
        const url = b.result_url ? webUrl(b.result_url) : null;
        if (b.result_url && !url) return res(400, { error: "badurl" });
        Object.assign(it, { result_note: b.result_note || null, result_url: url, result_at: b.result_note || url ? at : null });
      }
      return res(200, { ok: true, item: it });
    }
    // 巡检开关:照服务器回(记下点的时间);state.patrolFail 写了就回那个错
    if (path === "patrol") return state.patrolFail ? res(state.patrolFail[0], state.patrolFail[1]) : res(200, { ok: true, patrol: (state.patrol = { paused: b.paused, at: new Date().toISOString() }) });
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
  // 宣传卡片:在渠道分组里,或者下面「发过的」里
  const rcard = (id) => {
    const c = find($("reach-cards"), (e) => e.getAttribute("data-id") === id) || find($("reach-done-cards"), (e) => e.getAttribute("data-id") === id);
    if (!c) return null;
    const byId = (x) => find(c, (e) => e.getAttribute("id") === x);
    return { el: c, go: find(c, (e) => e.tagName === "A" && e.classList.contains("primary")), app: find(c, (e) => e.tagName === "A" && e.classList.contains("mailapp")), btn: (text) => find(c, (e) => e.tagName === "BUTTON" && e.textContent === text),
      fold: find(c, (e) => e.tagName === "DETAILS"), saved: find(c, (e) => e.classList.contains("saved")), said: find(c, (e) => e.classList.contains("result")), tip: find(c, (e) => e.classList.contains("count")),
      note: byId("echo-note-" + id), link: byId("echo-url-" + id), form: find(c, (e) => e.classList.contains("echo")) };
  };
  return { $, card, canOpen, calls, rcard, signals };
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
  const WAIT = "排队:今天上限 2 条(已打开 1 条,上面 1 条先发),明天放出";
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

// ---------- 宣传(11-06):媒体投稿、给项目团队的邮件、安全清单的提交、技术社区的帖子 ----------
const RM = { channel: "media", target: "PANews 投稿", lang: "zh", url: "https://www.panewslab.com/zh/contribute", title: "链关停了,钱怎么取", body: "短正文。", why: "页面底部有投稿入口" };
const rc = (id, mine = {}, over = {}) => ({ id, mine: { ...RM, ...mine }, status: "待发", decided_at: null, result_note: null, result_url: null, result_at: null, created_at: ago(100), ...over });
const EMAIL = { channel: "project", target: "Sophon 团队", lang: "en", url: undefined, title: undefined, to: "team@sophon.example", subject: "Corrections welcome", body: "Hi team,\nSee https://defiexit.com/deadlines/ ." };
// 剪贴板换成假的,记下复制了什么;on 是 false 就是这个浏览器用不了剪贴板
function clipboard(on = true) {
  const got = [];
  Object.defineProperty(globalThis.navigator, "clipboard", { value: on ? { writeText: async (t) => { got.push(t); } } : undefined, configurable: true });
  return got;
}
const chipsOf = (c) => find(c.el, (e) => e.className === "chips").children.map((x) => x.textContent);

test("宣传:按渠道分组(媒体投稿、项目团队、安全清单、技术社区),每组带数;卡片上有目标、渠道、语言、标题、正文(长的收起来)、说明;「打开投稿页」新标签打开;「写邮件」把收件人、邮件标题、正文填进 mailto;顶上的数和「今天要你做的」", async () => {
  clipboard();
  const d = await desk({ ...base([]), outreach: [
    rc("o-media-1"),
    rc("o-mail-1", EMAIL),
    rc("o-list-1", { channel: "list", target: "SlowMist 区块链黑暗森林自救手册", lang: "en", url: "https://github.com/slowmist/Blockchain-dark-forest-selfguard-handbook", title: "Add DeFiExit", body: "长".repeat(401) }),
    rc("o-hn-1", { channel: "community", target: "Hacker News", lang: "en", url: "https://news.ycombinator.com/submit", title: "Show HN: DeFiExit", body: "一\n二\n三\n四\n五\n六\n七\n八\n九\n十\n十一" }),
    rc("o-media-2", { target: "Odaily 投稿", lang: "zh-TW" }, { created_at: ago(50) }),
    rc("o-sent-1", {}, { status: "已发", decided_at: ago(10) }),
  ] });
  // 分组按固定顺序,只显示有卡片的;组里先送来的在上面
  const groups = d.$("reach-cards").children;
  assert.deepEqual(groups.map((g) => [g.hidden, g.children[0].textContent]), [[false, "媒体投稿2"], [false, "项目团队1"], [false, "安全清单1"], [false, "技术社区1"], [true, "其他0"]]);
  assert.deepEqual(groups[0].children[1].children.map((e) => e.getAttribute("data-id")), ["o-media-1", "o-media-2"]);
  assert.deepEqual([d.$("n-reach").textContent, d.$("n-reach").classList.contains("due"), d.$("reach-empty").hidden, d.$("reach-done").hidden], ["5", true, true, false]);
  assert.match(d.$("todo").textContent, /5 份宣传等你发/);
  // 投稿页:新标签打开,不带来源
  const m = d.rcard("o-media-1");
  assert.ok(m.el.textContent.includes("PANews 投稿") && m.el.textContent.includes("页面底部有投稿入口") && m.el.textContent.includes("链关停了,钱怎么取"));
  assert.deepEqual([m.go.textContent, m.go.href, m.go.getAttribute("target"), m.go.getAttribute("rel"), m.go.hidden], ["打开投稿页 ↗", RM.url, "_blank", "noopener noreferrer", false]);
  assert.deepEqual(chipsOf(m), ["媒体投稿", "中文"]);
  assert.deepEqual(chipsOf(d.rcard("o-media-2")), ["媒体投稿", "中文(zh-TW)"]);
  assert.deepEqual([m.fold.open, m.btn("复制标题").hidden, m.btn("复制收件人").hidden, m.btn("复制邮件标题").hidden], [true, false, true, true]);
  // 长的正文收起来(超过 400 字,或者超过 10 行)
  const list = d.rcard("o-list-1");
  assert.deepEqual([list.fold.open, find(list.fold, (e) => e.tagName === "SUMMARY").textContent], [false, "正文(共 401 字,点开看全文)"]);
  assert.equal(d.rcard("o-hn-1").fold.open, false);
  // 写邮件:主按钮新标签打开网页版 Gmail 的写信窗口(换行写成 \n),一直提醒发件人选项目邮箱;
  // 旁边的小链接是 mailto(换行写成 \r\n),同一个窗口里打开电脑上的邮件程序
  const e = d.rcard("o-mail-1");
  assert.equal(e.go.href, "https://mail.google.com/mail/?view=cm&fs=1&to=team%40sophon.example&su=Corrections%20welcome&body=" + encodeURIComponent("Hi team,\nSee https://defiexit.com/deadlines/ ."));
  assert.deepEqual([e.go.getAttribute("target"), e.go.textContent, e.tip.hidden, e.tip.textContent], ["_blank", "用 Gmail 写,字已填好 ↗", false, "Gmail 打开后,「发件人」选 hello@defiexit.com 再发。"]);
  assert.equal(e.app.href, "mailto:team@sophon.example?subject=Corrections%20welcome&body=" + encodeURIComponent("Hi team,\r\nSee https://defiexit.com/deadlines/ ."));
  assert.deepEqual([e.app.hidden, e.app.getAttribute("target")], [false, null]);
  assert.deepEqual([e.btn("复制收件人").hidden, e.btn("复制标题").hidden, chipsOf(e)], [false, false, ["项目团队", "英文"]]);
  // 发过的在下面:主按钮收起来,能记回音
  const s = d.rcard("o-sent-1");
  assert.ok(find(d.$("reach-done-cards"), (x) => x.getAttribute("data-id") === "o-sent-1"));
  assert.deepEqual([s.go.hidden, s.app.hidden, s.btn("有回音").hidden, s.btn("改回待发").hidden], [true, true, false, false]);
});

test("写邮件:邮件程序的链接超过 1800 字就不放正文(点的时候先把正文复制好),再长连邮件标题也不放;Gmail 的写信链接到 8000 字才这样,提示里说;复制正文、标题、收件人;剪贴板用不了就说一声", async () => {
  const got = clipboard();
  const fits = "a".repeat(1700), long = "中".repeat(200), huge = "中".repeat(900);
  const d = await desk({ ...base([]), outreach: [rc("o-fit", { ...EMAIL, body: fits }), rc("o-long", { ...EMAIL, body: long }), rc("o-huge", { ...EMAIL, subject: "标".repeat(200), body: long }),
    rc("o-giant", { ...EMAIL, body: huge }), rc("o-gsub", { ...EMAIL, subject: "标".repeat(1000), body: long })] });
  const fit = d.rcard("o-fit");
  assert.ok(fit.app.href.length <= 1800 && fit.app.href.endsWith("&body=" + fits), fit.app.href.length);
  // 邮件程序的链接放不下正文,Gmail 的放得下:主按钮照常填好,小链接点的时候先复制正文
  const L = d.rcard("o-long");
  assert.deepEqual([L.app.href, L.go.textContent, L.go.href.endsWith("&body=" + encodeURIComponent(long))], ["mailto:team@sophon.example?subject=Corrections%20welcome", "用 Gmail 写,字已填好 ↗", true]);
  await L.app.fire("click");
  await tick();
  assert.deepEqual([got, L.saved.textContent], [[long], "正文已复制:邮件窗口打开后,长按粘贴进正文"]);
  assert.deepEqual(d.calls.filter(([p]) => p === "outreach"), [], "打开邮件不算发了");
  assert.equal(d.rcard("o-huge").app.href, "mailto:team@sophon.example");
  // Gmail 的也放不下正文(900 个汉字编码后超过 8000):点「用 Gmail 写」先复制正文
  const G = d.rcard("o-giant");
  assert.deepEqual([G.go.href.includes("&body="), G.go.textContent, G.tip.hidden], [false, "用 Gmail 写,正文先复制好 ↗", false]);
  assert.match(G.tip.textContent, /^正文太长,放不进写信链接.*hello@defiexit\.com/);
  await G.go.fire("click");
  await tick();
  assert.equal(got.at(-1), huge);
  // 邮件标题也放不下:先复制标题
  const S = d.rcard("o-gsub");
  assert.equal(S.go.href, "https://mail.google.com/mail/?view=cm&fs=1&to=team%40sophon.example");
  assert.match(S.tip.textContent, /^邮件标题和正文太长.*先点「复制标题」/);
  for (const [text, want] of [["复制收件人", "team@sophon.example"], ["复制标题", "Corrections welcome"], ["复制正文", long]]) {
    await L.btn(text).fire("click");
    await tick();
    assert.equal(got.at(-1), want, text);
  }
  // 剪贴板用不了:收起来的正文打开,请他长按复制
  clipboard(false);
  await d.rcard("o-long").btn("复制正文").fire("click");
  await tick();
  assert.deepEqual([L.saved.textContent, L.saved.classList.contains("bad"), L.fold.open], ["复制不了:长按上面的字自己复制", true, true]);
});

test("宣传的已发、跳过、改回待发、有回音:发了挪到「发过的」;回音的链接服务器拒了留着表单、说为什么;不看发帖节奏,也不占对人首回的名额", async () => {
  clipboard();
  const sent = [1, 2, 3, 4, 5].map((i) => reply("s" + i, 10 + i, { status: "已发", decided_at: ago(25 - 4 * i) }));
  const d = await desk({ ...base([...sent, reply("r1", 20)], { dailyReplyCap: 6 }), outreach: [rc("o-a"), rc("o-b", EMAIL)] });
  await d.rcard("o-a").btn("已发").fire("click");
  await tick();
  assert.equal(d.$("pace").hidden, true, "宣传不看发帖节奏");
  assert.equal(d.canOpen("r1"), true, "也不占对人首回的名额");
  let a = d.rcard("o-a");
  assert.ok(find(d.$("reach-done-cards"), (x) => x.getAttribute("data-id") === "o-a"), "挪到「发过的」");
  assert.deepEqual([d.$("n-reach").textContent, d.$("reach-msg").textContent, a.go.hidden], ["1", "点了「已发」,这条挪到下面的「发过的」了", true]);
  // 有回音:http 的链接服务器不收,表单留着;改好了记下
  await a.btn("有回音").fire("click");
  assert.equal(a.form.hidden, false);
  a.note.value = "编辑回邮件说下周发";
  a.link.value = "http://www.panewslab.com/a";
  await a.btn("记下").fire("click");
  await tick();
  assert.deepEqual([a.form.hidden, a.saved.textContent], [false, "没存上:链接不对:要 https:// 开头的完整网址(不带账号密码、IP 地址、端口)"]);
  a.link.value = "https://www.panewslab.com/zh/articles/123";
  await a.btn("记下").fire("click");
  await tick();
  a = d.rcard("o-a");
  const link = find(a.said, (e) => e.tagName === "A");
  assert.deepEqual([a.form.hidden, a.said.hidden, a.saved.textContent, link.href, link.getAttribute("rel"), a.btn("改回音").hidden], [true, false, "回音记下了", "https://www.panewslab.com/zh/articles/123", "noopener noreferrer", false]);
  assert.match(a.said.textContent, /^回音:编辑回邮件说下周发 · 看 ↗ · \d\d-\d\d 记$/);
  // 改回待发:回到上面的分组,回音清掉
  await a.btn("改回待发").fire("click");
  await tick();
  a = d.rcard("o-a");
  assert.ok(find(d.$("reach-cards"), (x) => x.getAttribute("data-id") === "o-a"));
  assert.deepEqual([a.said.hidden, a.btn("有回音").hidden, a.go.hidden, d.$("n-reach").textContent, d.$("reach-msg").textContent], [true, true, false, "2", "这条挪回上面了"]);
  await d.rcard("o-b").btn("跳过").fire("click");
  await tick();
  assert.equal(d.rcard("o-b").btn("有回音").hidden, true, "跳过的没有回音");
  assert.deepEqual(d.calls.filter(([p]) => p === "outreach").map(([, b]) => b), [
    { id: "o-a", status: "已发" }, { id: "o-a", result_note: "编辑回邮件说下周发", result_url: "http://www.panewslab.com/a" },
    { id: "o-a", result_note: "编辑回邮件说下周发", result_url: "https://www.panewslab.com/zh/articles/123" }, { id: "o-a", status: "待发" }, { id: "o-b", status: "跳过" }]);
});

test("宣传卡片的收件邮箱 180 天到了删掉以后:卡片上写明是到期删的,没有「复制收件人」;改回待发也不会拿一个空的收件人去写邮件", async () => {
  clipboard();
  const gone = { ...EMAIL, to: undefined, toGone: true };
  const d = await desk({ ...base([]), outreach: [rc("o-old", gone, { status: "已发", decided_at: ago(181 * 1440) }), rc("o-back", gone)] });
  const old = d.rcard("o-old");
  assert.ok(old.el.textContent.includes("收件人点过「已发 / 跳过」满 180 天,邮箱已删"), old.el.textContent);
  assert.deepEqual([old.btn("复制收件人").hidden, old.go.hidden], [true, true]);
  const back = d.rcard("o-back");
  assert.deepEqual([back.go.hidden, back.go.href, back.app.hidden, back.el.textContent.includes("写邮件"), back.el.textContent.includes("Gmail")], [true, "", true, false, false], "没有收件人:不出写邮件的按钮");
});

test("宣传卡片里有坏掉的字符(以前收进来的):写邮件的链接照样编得出来(换成替换符);哪张卡片画的时候出错,只坏那一张,后面的卡片和顶上的数照常", async () => {
  clipboard();
  const HI = String.fromCharCode(0xd800);
  const d = await desk({ ...base([]), outreach: [rc("o-bad-1", { ...EMAIL, body: "hello" + HI }), rc("o-ok-1"), rc("o-ok-2", EMAIL)] });
  assert.ok(d.rcard("o-bad-1").go.href.endsWith("&body=hello%EF%BF%BD"), d.rcard("o-bad-1").go.href);
  assert.deepEqual([d.rcard("o-ok-1").go.textContent, d.rcard("o-ok-2").go.href.startsWith("https://mail.google.com/"), d.$("n-reach").textContent], ["打开投稿页 ↗", true, "3"]);
  // 编链接当场出错(模拟别的毛病):只坏这一张,后面照常
  const real = globalThis.encodeURIComponent;
  globalThis.encodeURIComponent = (s) => { if (String(s).includes("BOOM")) throw new URIError("URI malformed"); return real(s); };
  try {
    const d2 = await desk({ ...base([]), outreach: [rc("o-a", { ...EMAIL, body: "BOOM" }), rc("o-b"), rc("o-c", EMAIL)] });
    assert.equal(d2.rcard("o-a").el.classList.contains("broken"), true);
    assert.deepEqual([d2.rcard("o-b").go.textContent, d2.rcard("o-c").go.href.startsWith("https://mail.google.com/"), d2.$("n-reach").textContent], ["打开投稿页 ↗", true, "3"]);
  } finally {
    globalThis.encodeURIComponent = real;
  }
});

test("宣传「发过的」分页:还有更早的就出「再看早一点的(还有 N 张)」,点了从服务器给的位置往前翻;刷新以后照服务器这一次给的重来(翻出来的更早的几页不留,还有几张照服务器说的)", async () => {
  clipboard();
  const sent = (id, min) => rc(id, {}, { status: "已发", decided_at: ago(min) });
  const state = { ...base([]), outreach: [rc("o-p"), sent("o-s1", 10), sent("o-s2", 20)], outreachMore: { handled: 2, after: { at: ago(20), id: "o-s2" } },
    donePages: [{ ok: true, items: [sent("o-s3", 30), sent("o-s4", 40)], more: 0, after: { at: ago(40), id: "o-s4" } }] };
  const d = await desk(state);
  const more = d.$("reach-more");
  assert.deepEqual([more.hidden, more.textContent, d.$("n-reach").textContent], [false, "再看早一点的(还有 2 张)", "1"]);
  await more.fire("click");
  await tick();
  assert.deepEqual(d.calls.filter(([p]) => p.startsWith("outreach-done")).map(([p]) => p), ["outreach-done?at=" + encodeURIComponent(ago(20)) + "&id=o-s2"]);
  const ids = () => d.$("reach-done-cards").children.map((e) => e.getAttribute("data-id"));
  assert.deepEqual([ids(), more.hidden], [["o-s1", "o-s2", "o-s3", "o-s4"], true]);
  // 刷新:服务器照旧给最近一页、还有 2 张;翻出来的那一页不留,按钮照服务器说的回来
  await d.$("refresh").fire("click");
  await tick();
  assert.deepEqual([ids(), d.$("reach-more").hidden, d.$("reach-more").textContent], [["o-s1", "o-s2"], false, "再看早一点的(还有 2 张)"]);
});

// 点过的宣传卡片 h1…hN:编号越大越新;cur(n) 是服务器给的翻页位置(那一页最早那张)
const hh = (n) => rc("o-h" + n, {}, { status: "已发", decided_at: ago(100 - n) });
const cur = (n) => ({ at: ago(100 - n), id: "o-h" + n });
const doneIds = (d) => d.$("reach-done-cards").children.map((e) => e.getAttribute("data-id"));

test("宣传「发过的」翻页不漏:别处又点了几张以后刷新,接着翻从服务器这一次给的位置往前,一张不漏", async () => {
  clipboard();
  // 一开始库里点过的是 h1–h4,一页 2 张:页面上 h4、h3
  const state = { ...base([]), outreach: [hh(4), hh(3)], outreachMore: { handled: 2, after: cur(3) }, donePages: [] };
  const d = await desk(state);
  // 别处又点了 h5、h6、h7,刷新:服务器给 h7、h6,比 h6 早的还有 5 张
  Object.assign(state, { outreach: [hh(7), hh(6)], outreachMore: { handled: 5, after: cur(6) } });
  state.donePages.push({ ok: true, items: [hh(5), hh(4)], more: 3, after: cur(4) }, { ok: true, items: [hh(3), hh(2)], more: 1, after: cur(2) }, { ok: true, items: [hh(1)], more: 0, after: cur(1) });
  await d.$("refresh").fire("click");
  await tick();
  assert.deepEqual([doneIds(d), d.$("reach-more").textContent], [["o-h7", "o-h6"], "再看早一点的(还有 5 张)"]);
  for (const [want, text] of [[["o-h7", "o-h6", "o-h5", "o-h4"], "再看早一点的(还有 3 张)"], [["o-h7", "o-h6", "o-h5", "o-h4", "o-h3", "o-h2"], "再看早一点的(还有 1 张)"]]) {
    await d.$("reach-more").fire("click");
    await tick();
    assert.deepEqual([doneIds(d), d.$("reach-more").textContent], [want, text]);
  }
  await d.$("reach-more").fire("click");
  await tick();
  assert.deepEqual([doneIds(d), d.$("reach-more").hidden], [["o-h7", "o-h6", "o-h5", "o-h4", "o-h3", "o-h2", "o-h1"], true]);
  assert.deepEqual(d.calls.filter(([p]) => p.startsWith("outreach-done")).map(([p]) => decodeURIComponent(p.split("&id=")[1])), ["o-h6", "o-h4", "o-h2"]);
});

test("宣传「发过的」:别处删了一张以后刷新,还有几张照服务器说的(不拿页面上的去减),删了的那张不再显示,最后一张也翻得到;正在记回音的那张刷新时留着", async () => {
  clipboard();
  // 库里点过的 h1–h5,一页 2 张:页面上 h5、h4,再翻一页 h3、h2
  const state = { ...base([]), outreach: [hh(5), hh(4)], outreachMore: { handled: 3, after: cur(4) }, donePages: [{ ok: true, items: [hh(3), hh(2)], more: 1, after: cur(2) }] };
  const d = await desk(state);
  await d.$("reach-more").fire("click");
  await tick();
  assert.deepEqual([doneIds(d), d.$("reach-more").textContent], [["o-h5", "o-h4", "o-h3", "o-h2"], "再看早一点的(还有 1 张)"]);
  // 管理员在 h2 上点了「有回音」(框开着);别处删了 h3;刷新:服务器给 h5、h4,比 h4 早的还有 2 张(h2、h1)
  await d.rcard("o-h2").btn("有回音").fire("click");
  Object.assign(state, { outreach: [hh(5), hh(4)], outreachMore: { handled: 2, after: cur(4) } });
  state.donePages.push({ ok: true, items: [hh(2), hh(1)], more: 0, after: cur(1) });
  await d.$("refresh").fire("click");
  await tick();
  assert.deepEqual([doneIds(d), d.$("reach-more").textContent, d.rcard("o-h2").form.hidden], [["o-h5", "o-h4", "o-h2"], "再看早一点的(还有 2 张)", false]);
  await d.$("reach-more").fire("click");
  await tick();
  assert.deepEqual([doneIds(d), d.$("reach-more").hidden], [["o-h5", "o-h4", "o-h2", "o-h1"], true]);
});

test("宣传「发过的」:同一时刻只翻一页(翻的时候按钮点不了);刷新以前发出去、刷新以后才回来的那一页不要,位置和还有几张照刷新给的", async () => {
  clipboard();
  let release;
  const gate = new Promise((r) => { release = r; });
  const state = { ...base([]), outreach: [hh(4), hh(3)], outreachMore: { handled: 2, after: cur(3) },
    donePages: [async () => { await gate; return { status: 200, json: async () => ({ ok: true, items: [hh(2), hh(1)], more: 0, after: cur(1) }) }; }] };
  const d = await desk(state);
  const more = d.$("reach-more");
  const pages = () => d.calls.filter(([p]) => p.startsWith("outreach-done")).map(([p]) => decodeURIComponent(p.split("&id=")[1]));
  const pending = more.fire("click");
  await tick();
  assert.deepEqual([more.disabled, more.textContent], [true, "正在翻…"]);
  await more.fire("click"); // 翻的时候再点:点不了,不多发
  await more.on.click[0](); // 绕过按钮直接调(比如别的地方触发):也不多发
  assert.deepEqual(pages(), ["o-h3"]);
  // 别处又点了 h5、h6、h7,这边刷新了:刷新以前那一页当场取消,按钮马上放开,位置和还有几张照刷新给的(11-06 第六轮)
  Object.assign(state, { outreach: [hh(7), hh(6)], outreachMore: { handled: 5, after: cur(6) } });
  state.donePages.push({ ok: true, items: [hh(5), hh(4)], more: 3, after: cur(4) });
  await d.$("refresh").fire("click");
  await tick();
  assert.deepEqual([d.signals[0].aborted, doneIds(d), more.disabled, more.textContent], [true, ["o-h7", "o-h6"], false, "再看早一点的(还有 5 张)"]);
  // 服务器那一页这时候才回来:已经取消了,不要
  release();
  await pending;
  await tick();
  assert.deepEqual([doneIds(d), more.disabled, more.textContent, d.$("reach-msg").textContent], [["o-h7", "o-h6"], false, "再看早一点的(还有 5 张)", ""]);
  await more.fire("click");
  await tick();
  assert.deepEqual([doneIds(d), pages()], [["o-h7", "o-h6", "o-h5", "o-h4"], ["o-h3", "o-h6"]]);
});

// ---------- 11-06 第六轮:两次刷新回来的顺序反了、刷新时取消正在翻的那一页、翻页 20 秒没回来 ----------
const pagesOf = (d) => d.calls.filter(([p]) => p.startsWith("outreach-done")).map(([p]) => decodeURIComponent(p.split("&id=")[1]));

test("宣传「发过的」:两次刷新回来的顺序反了,只认后发的那一次(先发的晚回来,不拿旧的盖掉新的)", async () => {
  clipboard();
  const state = { ...base([]), outreach: [hh(4), hh(3)], outreachMore: { handled: 2, after: cur(3) }, donePages: [] };
  const d = await desk(state);
  // 读 state 的请求先扣住(发出去那一刻服务器是什么样就回什么样),测试自己决定哪一次先回来
  const inner = globalThis.fetch, held = [];
  globalThis.fetch = async (url, opt) => {
    if (!String(url).endsWith("/state")) return inner(url, opt);
    const snap = JSON.parse(JSON.stringify(state));
    await new Promise((go) => held.push(go));
    return { status: 200, json: async () => snap };
  };
  // 第一次刷新:服务器那时候给 h5、h4,还有 3 张;第二次刷新:别处又点了 h6、h7,给 h7、h6,还有 5 张
  Object.assign(state, { outreach: [hh(5), hh(4)], outreachMore: { handled: 3, after: cur(4) } });
  await d.$("refresh").fire("click");
  Object.assign(state, { outreach: [hh(7), hh(6)], outreachMore: { handled: 5, after: cur(6) } });
  await d.$("refresh").fire("click");
  await tick();
  assert.equal(held.length, 2);
  held[1]();
  await tick();
  assert.deepEqual([doneIds(d), d.$("reach-more").textContent], [["o-h7", "o-h6"], "再看早一点的(还有 5 张)"]);
  held[0](); // 先发的那次这时候才回来:不用
  await tick();
  assert.deepEqual([doneIds(d), d.$("reach-more").textContent], [["o-h7", "o-h6"], "再看早一点的(还有 5 张)"]);
  // 接着翻,从后发的那次给的位置
  state.donePages.push({ ok: true, items: [hh(5), hh(4)], more: 3, after: cur(4) });
  await d.$("reach-more").fire("click");
  await tick();
  assert.deepEqual([doneIds(d), pagesOf(d)], [["o-h7", "o-h6", "o-h5", "o-h4"], ["o-h6"]]);
});

test("宣传「发过的」:翻页还没回来就刷新了,接着又翻了一页;取消了的那一次过一会儿才报错回来,也不会放掉后来那一次的锁", async () => {
  clipboard();
  // 第一页:不理取消(浏览器偶尔这样:取消了,过一会儿才报错回来)
  let failOld, release;
  const slow = Object.assign(() => new Promise((_, no) => { failOld = () => no(new DOMException("The operation was aborted.", "AbortError")); }), { slow: true });
  const gate = new Promise((r) => { release = r; });
  const state = { ...base([]), outreach: [hh(4), hh(3)], outreachMore: { handled: 2, after: cur(3) }, donePages: [slow] };
  const d = await desk(state);
  const more = d.$("reach-more");
  const first = more.fire("click");
  await tick();
  assert.deepEqual([more.disabled, more.textContent], [true, "正在翻…"]);
  // 刷新:别处又点了 h5、h6、h7。第一页当场取消,按钮放开
  Object.assign(state, { outreach: [hh(7), hh(6)], outreachMore: { handled: 5, after: cur(6) } });
  state.donePages.push(async () => { await gate; return { status: 200, json: async () => ({ ok: true, items: [hh(5), hh(4)], more: 3, after: cur(4) }) }; });
  await d.$("refresh").fire("click");
  await tick();
  assert.deepEqual([d.signals[0].aborted, more.disabled, more.textContent], [true, false, "再看早一点的(还有 5 张)"]);
  // 接着翻(第二次,还没回来);这时候第一次才报错回来:第二次的锁还在,按钮照样点不了、不多发,也不报错
  const second = more.fire("click");
  await tick();
  failOld();
  await first;
  await tick();
  assert.deepEqual([more.disabled, more.textContent, d.$("reach-msg").textContent], [true, "正在翻…", ""]);
  await more.on.click[0]();
  assert.deepEqual(pagesOf(d), ["o-h3", "o-h6"]);
  assert.equal(d.signals[1].aborted, false);
  release();
  await second;
  await tick();
  assert.deepEqual([doneIds(d), more.disabled, more.textContent], [["o-h7", "o-h6", "o-h5", "o-h4"], false, "再看早一点的(还有 3 张)"]);
});

test("宣传「发过的」:翻页 20 秒还没回来就取消,说一声,按钮放开;再点从同一个位置接着翻", async () => {
  clipboard();
  const realTimeout = globalThis.setTimeout, alarms = [];
  globalThis.setTimeout = (fn, ms, ...a) => (ms === 20000 ? (alarms.push(fn), {}) : realTimeout(fn, ms, ...a));
  try {
    const never = () => new Promise(() => {});
    const state = { ...base([]), outreach: [hh(4), hh(3)], outreachMore: { handled: 2, after: cur(3) }, donePages: [never, { ok: true, items: [hh(2), hh(1)], more: 0, after: cur(1) }] };
    const d = await desk(state);
    const more = d.$("reach-more");
    const pending = more.fire("click");
    await tick();
    assert.deepEqual([alarms.length, more.disabled], [1, true]);
    alarms[0](); // 20 秒到了
    await pending;
    await tick();
    assert.deepEqual([d.signals[0].aborted, more.disabled, more.textContent, d.$("reach-msg").textContent], [true, false, "再看早一点的(还有 2 张)", "没翻出来:等了 20 秒没等到,再点一次"]);
    await more.fire("click");
    await tick();
    assert.deepEqual([doneIds(d), more.hidden, pagesOf(d)], [["o-h4", "o-h3", "o-h2", "o-h1"], true, ["o-h3", "o-h3"]]);
  } finally {
    globalThis.setTimeout = realTimeout;
  }
});

test("宣传卡片删除:先说清楚会删什么(只删这一张;写邮件的,以后写给这个邮箱的也不收),再点一次才删;删完重新读一遍", async () => {
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => (ms >= 1000 ? {} : realTimeout(fn, ms, ...a));
  try {
    const state = { ...base([]), outreach: [rc("o-b", EMAIL)] };
    const d = await desk(state);
    const c = d.rcard("o-b"), del = c.btn("删除这条");
    await del.fire("click");
    assert.deepEqual([del.textContent, c.saved.textContent], ["确定删除?再点一次", "只删这一张宣传卡片,以后不再收;写邮件的,以后写给这个邮箱的也不再收(对方要求删时用;不想发点「跳过」)"]);
    state.outreach = [];
    await del.fire("click");
    await tick();
    assert.deepEqual(d.calls.filter(([p]) => p === "delete"), [["delete", { kind: "outreach", id: "o-b" }]]);
    assert.equal(d.rcard("o-b"), null);
    assert.deepEqual([d.$("n-reach").textContent, d.$("reach-empty").hidden], ["0", false]);
  } finally {
    globalThis.setTimeout = realTimeout;
  }
});

// ---------- 11-06 第七轮:存上了以后,还在路上的刷新回来不盖掉 ----------
// 读 state 的头一次扣住(发出去那一刻服务器是什么样就回什么样),测试自己决定什么时候回来;后面的照常
function holdFirstState(state) {
  const inner = globalThis.fetch, held = [];
  let hold = true;
  globalThis.fetch = async (url, opt) => {
    if (!String(url).endsWith("/state") || !hold) return inner(url, opt);
    hold = false;
    const snap = JSON.parse(JSON.stringify(state));
    await new Promise((go) => held.push(go));
    return { status: 200, json: async () => snap };
  };
  return held;
}

test("待发:刷新还在路上时点了「已发」,那次刷新晚回来也不盖掉(库里已发,页面不会变回待发、「在 X 打开」不会又出来);再读一次,照服务器的", async () => {
  clipboard();
  const state = base([reply("r-w1", 1), reply("r-w2", 2)]);
  const d = await desk(state);
  const held = holdFirstState(state);
  await d.$("refresh").fire("click"); // 刷新:读的是点「已发」以前的
  await tick();
  assert.equal(held.length, 1);
  await d.card("r-w1").sent.fire("click");
  await tick();
  held[0](); // 点「已发」以前读的那次这时候才回来:不用
  await tick();
  const inOut = (id) => !!find(d.$("out-cards"), (e) => e.getAttribute("data-id") === id);
  assert.deepEqual([state.outbox[0].status, inOut("r-w1"), d.card("r-w1").open.hidden, inOut("r-w2")], ["已发", false, true, true]);
  // 存上以后重新读了一次(照服务器的)
  const paths = d.calls.map(([p]) => p).filter((p) => p === "state" || p === "outbox");
  assert.deepEqual(paths.slice(-2), ["outbox", "state"]);
});

test("宣传:刷新还在路上时点了「已发」、记了回音,那次刷新晚回来也不盖掉;没有刷新在路上时,存东西不多读一次", async () => {
  clipboard();
  const state = { ...base([]), outreach: [rc("o-w1"), rc("o-w2")] };
  const d = await desk(state);
  const states = () => d.calls.filter(([p]) => p === "state").length;
  // 没有刷新在路上:点「已发」不多读
  const before = states();
  await d.rcard("o-w2").btn("已发").fire("click");
  await tick();
  assert.equal(states(), before);
  // 刷新在路上:点「已发」
  const held = holdFirstState(state);
  await d.$("refresh").fire("click");
  await tick();
  await d.rcard("o-w1").btn("已发").fire("click");
  await tick();
  held[0]();
  await tick();
  const inDone = (id) => !!find(d.$("reach-done-cards"), (e) => e.getAttribute("data-id") === id);
  assert.deepEqual([state.outreach[0].status, inDone("o-w1"), d.rcard("o-w1").go.hidden], ["已发", true, true]);
  // 刷新在路上:记回音
  const held2 = holdFirstState(state);
  await d.$("refresh").fire("click");
  await tick();
  const c = d.rcard("o-w1");
  await c.btn("有回音").fire("click");
  c.note.value = "编辑回信了";
  await c.btn("记下").fire("click");
  await tick();
  held2[0]();
  await tick();
  assert.deepEqual([state.outreach[0].result_note, d.rcard("o-w1").said.textContent.includes("编辑回信了")], ["编辑回信了", true]);
});

// ---------- 11-06 第八轮:一张卡片一次只存一个,晚回来的旧结果不盖掉 ----------
// 头一个合 pred 的请求:服务器当场照它改(回的结果那时候就定了),回到页面上扣住,测试自己决定什么时候放
function holdCall(pred) {
  const inner = globalThis.fetch, held = [];
  let taken = false;
  globalThis.fetch = async (url, opt) => {
    const path = String(url).replace("/api/admin/", ""), b = opt.body ? JSON.parse(opt.body) : {};
    if (taken || !pred(path, b)) return inner(url, opt);
    taken = true;
    const r = await inner(url, opt), j = await r.json();
    await new Promise((go) => held.push(go));
    return { status: r.status, json: async () => j };
  };
  return held;
}
const statusCalls = (d, path) => d.calls.filter(([p, b]) => p === path && "status" in b).map(([, b]) => b.status);
const inBox = (d, box, id) => !!find(d.$(box), (e) => e.getAttribute("data-id") === id);

test("待发:草稿自动存的那次还没回来就点了「已发」:等它回来再发「已发」,卡片不会被晚回来的那次盖回待发(「在 X 打开」不会又出来)", async () => {
  clipboard();
  const state = base([reply("r-q1", 1)]);
  const d = await desk(state);
  const held = holdCall((p, b) => p === "outbox" && "draft" in b);
  const c = d.card("r-q1");
  c.ta.value = "改过的草稿,到期金库可以在官方合约上自己取出。";
  await c.ta.fire("input");
  const typed = c.ta.fire("blur"); // 离开输入框就存(这一次慢)
  await tick();
  assert.equal(held.length, 1);
  const click = c.sent.fire("click");
  await tick();
  assert.deepEqual(statusCalls(d, "outbox"), [], "草稿那次还没回来,「已发」先不发");
  held[0]();
  await typed;
  await click;
  await tick();
  assert.deepEqual([statusCalls(d, "outbox"), state.outbox[0].status, state.outbox[0].draft_admin, inBox(d, "out-cards", "r-q1"), d.card("r-q1").open.hidden],
    [["已发"], "已发", "改过的草稿,到期金库可以在官方合约上自己取出。", false, true]);
});

test("待发:备注存的那次还没回来就点了「已发」:排在它后面发,晚回来的那次不盖掉已发", async () => {
  clipboard();
  const state = base([reply("r-q2", 2)]);
  const d = await desk(state);
  const held = holdCall((p, b) => p === "outbox" && "note" in b);
  const el = find(d.$("out-cards"), (e) => e.getAttribute("data-id") === "r-q2");
  const memo = find(el, (e) => e.getAttribute("id") === "memo-out-r-q2");
  memo.value = "这条先发";
  const noted = memo.fire("change");
  await tick();
  const click = d.card("r-q2").sent.fire("click");
  await tick();
  assert.deepEqual(statusCalls(d, "outbox"), [], "备注那次还没回来,「已发」排在后面");
  held[0]();
  await noted;
  await click;
  await tick();
  assert.deepEqual([d.calls.filter(([p]) => p === "outbox").map(([, x]) => x.note || x.status), state.outbox[0].status, inBox(d, "out-cards", "r-q2"), d.card("r-q2").open.hidden], [["这条先发", "已发"], "已发", false, true]);
});

test("宣传:点了「已发」还没回来又点「跳过」:排在后面发,页面照最后那次(跳过),不被晚回来的「已发」盖掉", async () => {
  clipboard();
  const state = { ...base([]), outreach: [rc("o-q1")] };
  const d = await desk(state);
  const held = holdCall((p, b) => p === "outreach" && b.status === "已发");
  const sent = d.rcard("o-q1").btn("已发").fire("click");
  await tick();
  const skip = d.rcard("o-q1").btn("跳过").fire("click");
  await tick();
  assert.deepEqual(statusCalls(d, "outreach"), ["已发"], "「已发」还没回来,「跳过」排在后面");
  held[0]();
  await sent;
  await skip;
  await tick();
  assert.deepEqual([statusCalls(d, "outreach"), state.outreach[0].status, inBox(d, "reach-done-cards", "o-q1"), d.rcard("o-q1").el.textContent.includes("跳过")], [["已发", "跳过"], "跳过", true, true]);
});

test("宣传:存的那次还没回来就删了这张卡片:晚回来的不让它又冒出来", async () => {
  clipboard();
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...a) => (ms >= 1000 ? {} : realTimeout(fn, ms, ...a));
  try {
    const state = { ...base([]), outreach: [rc("o-q2"), rc("o-q3")] };
    const d = await desk(state);
    const held = holdCall((p, b) => p === "outreach" && b.id === "o-q2");
    const sent = d.rcard("o-q2").btn("已发").fire("click");
    await tick();
    const del = d.rcard("o-q2").btn("删除这条");
    await del.fire("click");
    state.outreach = state.outreach.filter((x) => x.id !== "o-q2");
    await del.fire("click");
    await tick();
    assert.equal(d.rcard("o-q2"), null);
    held[0](); // 删以前那次存这时候才回来
    await sent;
    await tick();
    assert.deepEqual([d.rcard("o-q2"), !!d.rcard("o-q3")], [null, true]);
  } finally {
    globalThis.setTimeout = realTimeout;
  }
});

test("待发:草稿自动存的那次还没回来就点了「已发」,那次被服务器拒了:「已发」不发,说一声草稿没存上(字还在框里)", async () => {
  clipboard();
  const state = base([reply("r-q4", 4)]);
  const d = await desk(state);
  const held = holdCall((p, b) => p === "outbox" && "draft" in b);
  const c = d.card("r-q4");
  c.ta.value = "有问题可以私信我";
  await c.ta.fire("input");
  const typed = c.ta.fire("blur");
  await tick();
  const click = c.sent.fire("click");
  await tick();
  held[0](); // 拒了(草稿里有不许用的词)
  await typed;
  await click;
  await tick();
  const el = find(d.$("out-cards"), (e) => e.getAttribute("data-id") === "r-q4");
  assert.deepEqual([statusCalls(d, "outbox"), state.outbox[0].status, c.ta.value, find(el, (e) => e.classList.contains("saved")).textContent],
    [[], "待发", "有问题可以私信我", "草稿没存上,先别点「已发」;字还在框里"]);
});

test("「已发」分成三种:已处理里的卡片写已打开 / 待核实 / 核实已发(旧的没核写「已发(旧,没核)」);待核实的顶上提醒(旧的不算);数据页「你点了发」只数核实已发", async () => {
  const cut = ago(3 * 24 * 60);
  const sentRule = { graceMs: 6 * 3600e3, cutover: cut };
  const opened = (min) => ago(min);
  const v = (min, url) => ({ opened: opened(min), at: ago(min - 5), url });
  const rows = [
    reply("o1", 10, { status: "已发", decided_at: opened(30) }), // 刚点开
    reply("o2", 11, { status: "已发", decided_at: opened(7 * 60), reply_url: "https://x.com/DeFiExit/status/2118000000000000011" }), // 7 小时了,服务器先找到一条但还没核
    reply("o3", 12, { status: "已发", decided_at: opened(8 * 60) }),
    reply("o4", 13, { status: "已发", decided_at: opened(90), reply_url: "https://x.com/DeFiExit/status/2118000000000000013" }),
    reply("o5", 14, { status: "已发", decided_at: opened(4 * 24 * 60) }), // 改版以前点的
    reply("o6", 15, { status: "已发", decided_at: opened(2 * 60) }),
  ];
  rows[3].mine = { ...rows[3].mine, sent: v(90, "https://x.com/DeFiExit/status/2118000000000000013") };
  rows[5].mine = { ...rows[5].mine, sent: { opened: opened(200), at: ago(190) } }; // 核到的是上一次点开的:不算
  const d = await desk({ ...base(rows), sentRule, docs: { funnel: { target: 5, stages: [{ key: "drafted", label: "写好回复", value: 0 }, { key: "posted", label: "你点了发", value: 0 }] } } });
  const pill = (id) => find(find(d.$("done-cards"), (e) => e.getAttribute("data-id") === id), (e) => e.classList.contains("pill")).textContent;
  const line = (id) => find(find(d.$("done-cards"), (e) => e.getAttribute("data-id") === id), (e) => e.tagName === "P" && e.classList.contains("count") && !e.classList.contains("queue")).textContent;
  assert.match(pill("o1"), /^已打开 · /);
  assert.match(pill("o2"), /^待核实 · /);
  assert.match(pill("o3"), /^待核实 · /);
  assert.match(pill("o4"), /^核实已发 · /);
  assert.match(pill("o5"), /^已发\(旧,没核\) · /);
  assert.match(pill("o6"), /^已打开 · /);
  assert.match(line("o1"), /^等核实:/);
  assert.match(line("o2"), /^点开 6 小时还没在 X 上核到你这条回复.*先找到的一条:看 ↗/);
  assert.match(line("o4"), /^你的回复\(核实发出了\):看 ↗/);
  assert.match(line("o5"), /^改版以前点的,还没核过/);
  // 顶上:待核实的 2 条(旧的不算)
  assert.match(d.$("todo").textContent, /2 条点了「在 X 打开」6 小时还没在 X 上核到你发的/);
  // 数据页:回帖试验的「你点了发」只数核实的 1 条,另写没核到的 5 条;「我们发的」写最近 7 天的三种(旧的那条 4 天前点的,也在 7 天里)
  const text = d.$("data-body").textContent;
  assert.ok(text.includes("「你点了发」只数核实发出了的(我经 fxtwitter 在 X 上核到的);点开了还没核到的 5 条不算。"), text);
  assert.ok(text.includes("最近 7 天点开的:核实已发 1 · 已打开 2 · 待核实 2 · 已发(旧,没核) 1"), text);
});

test("服务器还没给 sentRule(旧服务器):「已发」照样显示,不报错;没核到的满 6 小时算待核实", async () => {
  const d = await desk(base([reply("o1", 10, { status: "已发", decided_at: ago(30) }), reply("o2", 11, { status: "已发", decided_at: ago(7 * 60) })]));
  const pill = (id) => find(find(d.$("done-cards"), (e) => e.getAttribute("data-id") === id), (e) => e.classList.contains("pill")).textContent;
  assert.match(pill("o1"), /^已打开 · /);
  assert.match(pill("o2"), /^待核实 · /);
});

test("点「复制」:页面顺手告诉服务器这一批发送从现在算起(不用多点,不改卡片);点过「已发」的不再告诉", async () => {
  const d = await desk(base([reply("r1", 10), reply("s1", 11, { status: "已发", decided_at: ago(5) })]));
  await d.card("r1").copy.fire("click");
  await tick();
  assert.deepEqual(d.calls.filter(([p, b]) => p === "outbox" && b.copied), [["outbox", { id: "r1", copied: true }]]);
});

test("巡检:「定时任务」里写上次报到的时间和一句话;白天超过 2 小时没报到首页提醒(暂停中、没报到过不提醒);点「暂停巡检」一下就存,按钮变「恢复巡检」,不再提醒", async () => {
  const todo = (d) => d.$("todo").textContent;
  const btn = (d, text) => find(d.$("data-body"), (e) => e.tagName === "BUTTON" && e.textContent === text);
  const LATE = "巡检超过 2 小时没跑,看「数据」最下面";
  // 刚报到过:不提醒,写上次的时间和那句话
  let d = await desk({ ...base([]), auto: { patrol: { at: ago(1), ok: true, note: "新评论 2 条,起草 1 条" } } });
  assert.equal(todo(d).includes(LATE), false);
  assert.ok(d.$("data-body").textContent.includes("上次 "), d.$("data-body").textContent);
  assert.ok(d.$("data-body").textContent.includes(" · 新评论 2 条,起草 1 条"));
  // 两天前报到的(不管现在几点,白天都过了 16 小时以上):提醒、标红
  const old = { at: ago(2 * 24 * 60), ok: true, note: "没有新评论" };
  d = await desk({ ...base([]), auto: { patrol: old } });
  assert.ok(todo(d).includes(LATE));
  assert.ok(d.$("data-body").textContent.includes("超过 2 小时没跑"));
  // 没报到过:不提醒
  d = await desk({ ...base([]), auto: {} });
  assert.equal(todo(d).includes(LATE), false);
  assert.ok(d.$("data-body").textContent.includes("还没报到过"));
  // 暂停中:不提醒,写「暂停中」,按钮是「恢复巡检」
  d = await desk({ ...base([]), auto: { patrol: old }, patrol: { paused: true, at: ago(60) } });
  assert.equal(todo(d).includes(LATE), false);
  assert.ok(d.$("data-body").textContent.includes("暂停中"));
  assert.ok(btn(d, "恢复巡检"));
  // 点「暂停巡检」:存进服务器,按钮变「恢复巡检」,首页的提醒去掉;再点恢复,提醒回来
  const st = { ...base([]), auto: { patrol: old } };
  d = await desk(st);
  assert.ok(todo(d).includes(LATE));
  await btn(d, "暂停巡检").fire("click");
  await tick();
  assert.deepEqual(d.calls.filter(([p]) => p === "patrol"), [["patrol", { paused: true }]]);
  assert.ok(btn(d, "恢复巡检"));
  assert.equal(todo(d).includes(LATE), false);
  await btn(d, "恢复巡检").fire("click");
  await tick();
  assert.deepEqual(d.calls.filter(([p]) => p === "patrol").at(-1), ["patrol", { paused: false }]);
  assert.ok(btn(d, "暂停巡检"));
  assert.ok(todo(d).includes(LATE));
  // 服务器没存上:按钮照旧能点,说为什么;登录过期回登录页
  st.patrolFail = [403, { error: "origin" }];
  await btn(d, "暂停巡检").fire("click");
  await tick();
  assert.ok(btn(d, "暂停巡检") && !btn(d, "暂停巡检").disabled);
  assert.ok(d.$("data-body").textContent.includes("请求来源不对"));
  st.patrolFail = [401, { need: "login" }];
  await btn(d, "暂停巡检").fire("click");
  await tick();
  assert.equal(d.$("desk").hidden, true);
});

test("巡检开关:刷新还在路上时点了「暂停巡检」,那次刷新晚回来也不把开关显示反;再读一次,照服务器的", async () => {
  const btn = (d, text) => find(d.$("data-body"), (e) => e.tagName === "BUTTON" && e.textContent === text);
  const st = { ...base([]), auto: { patrol: { at: ago(1), ok: true, note: "没有新评论" } } };
  const d = await desk(st);
  const held = holdFirstState(st);
  await d.$("refresh").fire("click"); // 刷新:读的是点「暂停巡检」以前的(没暂停)
  await tick();
  assert.equal(held.length, 1);
  await btn(d, "暂停巡检").fire("click");
  await tick();
  assert.equal(st.patrol.paused, true);
  held[0](); // 点以前读的那次这时候才回来:不用
  await tick();
  assert.ok(btn(d, "恢复巡检"), d.$("data-body").textContent);
  assert.ok(d.$("data-body").textContent.includes("暂停中"));
  const paths = d.calls.map(([p]) => p).filter((p) => p === "state" || p === "patrol");
  assert.deepEqual(paths.slice(-2), ["patrol", "state"]);
});

// 一页 10 张(老板 11-07「每页就展示10条」):待发多了分页;「已处理」「发过的」平时收着,展开记在这台浏览器里
const btnsOf = (d, id) => d.$(id).children.filter((e) => e.tagName === "BUTTON");
test("待发超过 10 条分页:先摆前 10 条,点「下一页」换后面的;第一页「上一页」点不了;不到 10 条不出翻页", async () => {
  const outbox = Array.from({ length: 25 }, (_, i) => reply("p" + String(i).padStart(2, "0"), i, { mine: { kind: "post", topic: "t" + i, draft: "项目帖 " + i } }));
  const d = await desk(base(outbox));
  const ids = () => d.$("out-cards").children.map((e) => e.getAttribute("data-id"));
  assert.equal(ids().length, 10);
  assert.equal(ids()[0], "p00", "先送来的在上面");
  assert.equal(d.$("out-pager").hidden, false);
  assert.match(d.$("out-pager").textContent, /第 1 \/ 3 页 · 共 25 条/);
  const [prev, next] = btnsOf(d, "out-pager");
  assert.deepEqual([prev.disabled, next.disabled], [true, false]);
  await next.fire("click");
  assert.deepEqual([ids().length, ids()[0]], [10, "p10"]);
  await btnsOf(d, "out-pager")[1].fire("click");
  assert.deepEqual([ids().length, ids()[0], btnsOf(d, "out-pager")[1].disabled], [5, "p20", true]);
  assert.equal(d.$("n-out").textContent, "25", "顶上的数还是全部");
  const d2 = await desk(base(outbox.slice(0, 9)));
  assert.equal(d2.$("out-pager").hidden, true);
});

test("「已处理」平时收着:按钮写「展开(几条)」,点了展开、每页 10 条,展开记在这台浏览器里;点顶上的「已处理」也展开;没有处理过的不出按钮", async () => {
  const m = new Map();
  globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
  try {
    const done = Array.from({ length: 12 }, (_, i) => reply("s" + String(i).padStart(2, "0"), i, { status: "跳过", decided_at: ago(60 - i) }));
    const d = await desk(base([reply("r1", 50), ...done]));
    assert.deepEqual([d.$("done-body").hidden, d.$("done-toggle").hidden, d.$("done-toggle").textContent], [true, false, "展开(12 条)"]);
    assert.equal(d.$("done-cards").children.length, 10, "收着也摆好第一页,点了「已发」挪过去的展开就在");
    await d.$("done-toggle").fire("click");
    assert.deepEqual([d.$("done-body").hidden, d.$("done-toggle").textContent, d.$("done-toggle").getAttribute("aria-expanded")], [false, "收起", "true"]);
    assert.match(d.$("done-pager").textContent, /第 1 \/ 2 页 · 共 12 条/);
    assert.equal(JSON.parse(m.get("dx-ops-open")).done, true);
    const d2 = await desk(base(done));
    assert.equal(d2.$("done-body").hidden, false, "下次打开还展开着");
    await d2.$("done-toggle").fire("click");
    assert.equal(d2.$("done-body").hidden, true);
    await d2.$("nav-done").fire("click");
    assert.equal(d2.$("done-body").hidden, false, "点顶上的「已处理」顺手展开");
    m.clear();
    const d3 = await desk(base([reply("r1", 50)]));
    assert.deepEqual([d3.$("done-toggle").hidden, d3.$("done-empty").hidden], [true, false]);
  } finally {
    delete globalThis.localStorage;
  }
  const d4 = await desk(base([reply("s1", 1, { status: "跳过", decided_at: ago(5) })])); // 没有本地存储:照样收着,点了照样展开
  assert.equal(d4.$("done-body").hidden, true);
  await d4.$("done-toggle").fire("click");
  assert.equal(d4.$("done-body").hidden, false);
});

test("宣传「发过的」收着、每页 10 条;「再看早一点的」只在最后一页出,翻出来的直接翻到它们那一页", async () => {
  clipboard();
  const sent = (n) => rc("o-s" + String(n).padStart(2, "0"), {}, { status: "已发", decided_at: ago(n) });
  const state = { ...base([]), outreach: Array.from({ length: 12 }, (_, i) => sent(i + 1)), outreachMore: { handled: 3, after: { at: ago(12), id: "o-s12" } },
    donePages: [{ ok: true, items: [sent(13), sent(14), sent(15)], more: 0, after: { at: ago(15), id: "o-s15" } }] };
  const d = await desk(state);
  assert.deepEqual([d.$("reach-done-body").hidden, d.$("reach-done-toggle").textContent, d.$("n-reach-done").textContent], [true, "展开(12+ 条)", "12+"]);
  await d.$("reach-done-toggle").fire("click");
  assert.equal(d.$("reach-done-body").hidden, false);
  assert.deepEqual([doneIds(d).length, d.$("reach-more").hidden], [10, true], "第一页不出「再看早一点的」");
  await btnsOf(d, "reach-done-pager")[1].fire("click");
  assert.deepEqual([doneIds(d), d.$("reach-more").hidden], [["o-s11", "o-s12"], false]);
  await d.$("reach-more").fire("click");
  await tick();
  assert.deepEqual([doneIds(d), d.$("reach-more").hidden], [["o-s11", "o-s12", "o-s13", "o-s14", "o-s15"], true], "15 张:第二页接着摆");
});

test("宣传「发过的」里正在写回音的那张,点「下一页」不被翻走(焦点到了按钮上也算正在改);宣传待发超过 10 张也分页,组上的数还是全部", async () => {
  clipboard();
  const sent = (n) => rc("o-s" + String(n).padStart(2, "0"), {}, { status: "已发", decided_at: ago(n) });
  const d = await desk({ ...base([]), outreach: Array.from({ length: 12 }, (_, i) => sent(i + 1)) });
  await d.$("reach-done-toggle").fire("click");
  await d.rcard("o-s01").btn("有回音").fire("click");
  d.rcard("o-s01").note.value = "编辑说下周发";
  await btnsOf(d, "reach-done-pager")[1].fire("click");
  assert.deepEqual(doneIds(d), ["o-s11", "o-s12", "o-s01"], "写了一半的那张接着摆在这一页最后");
  assert.equal(d.rcard("o-s01").note.value, "编辑说下周发");
  const pend = Array.from({ length: 25 }, (_, i) => rc("o-p" + String(i).padStart(2, "0"), { channel: i < 15 ? "media" : "project" }, { created_at: ago(200 - i) }));
  const d2 = await desk({ ...base([]), outreach: pend });
  const shown = () => d2.$("reach-cards").children.flatMap((g) => g.children.filter((x) => x.classList.contains("cards")).flatMap((b) => b.children.map((e) => e.getAttribute("data-id"))));
  assert.equal(shown().length, 10);
  assert.match(d2.$("reach-pager").textContent, /第 1 \/ 3 页 · 共 25 条/);
  assert.deepEqual(d2.$("reach-cards").children.filter((g) => !g.hidden).map((g) => g.textContent.match(/(媒体投稿|项目团队)(\d+)/)?.slice(1).join("")).filter(Boolean), ["媒体投稿15"], "第一页只有媒体投稿那组,组上写全部 15");
  await btnsOf(d2, "reach-pager")[1].fire("click");
  assert.deepEqual([shown().length, shown()[0], shown()[5]], [10, "o-p10", "o-p15"]);
  assert.equal(d2.$("n-reach").textContent, "25");
});

test("数据区的长列表一页 10 行:我们发的帖子和回复(最近 40 条)多了出翻页,点「下一页」只重画数据区", async () => {
  const sentOut = Array.from({ length: 23 }, (_, i) => reply("s" + String(i).padStart(2, "0"), i, { status: "已发", decided_at: ago(i + 1) }));
  const d = await desk(base(sentOut));
  const panel = () => find(d.$("data-body"), (e) => e.classList.contains("panel") && e.textContent.startsWith("我们发的帖子和回复"));
  const rows = () => find(panel(), (e) => e.classList.contains("list")).children.length;
  const pager = () => find(panel(), (e) => e.classList.contains("pager"));
  assert.equal(rows(), 10);
  assert.match(pager().textContent, /第 1 \/ 3 页 · 共 23 条/);
  const n = d.calls.length, first = d.$("data-body").children[0], same = panel();
  await pager().children.filter((e) => e.tagName === "BUTTON")[1].fire("click");
  assert.ok(d.$("data-body").children[0] === first && panel() === same, "翻页不重画整个数据区");
  assert.match(pager().textContent, /第 2 \/ 3 页/);
  assert.equal(d.calls.length, n, "翻页不重新读服务器");
  assert.ok(find(d.$("data-body"), (e) => e === panel()), "只重画这一块,数据区别的东西不动");
  await pager().children.filter((e) => e.tagName === "BUTTON")[1].fire("click");
  assert.equal(rows(), 3);
});
