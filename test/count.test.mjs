// 体检计数的浏览器这一半(src/js/lib/count.js):去重、管理员的浏览器、本地存储用不了的时候、发出去的到底是什么。
// 本地存储、fetch、地址栏都用假的,不连网。最后一项用很小的假页面把真的 site.js 跑起来(看 #owner)。
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { seenKey, markNew, countCheckup, ping, markOwner, takeOwnerHash, countView, OFF_KEY, OWNER_KEY, SEEN_KEY, SEEN_MAX, HIT_BODY, VIEW_BODY, VISIT_BODY, VISIT_KEY } from "../src/js/lib/count.js";

// 编的地址
const A = "0x" + "ab".repeat(20), B = "0x" + "cd".repeat(20);
const upper = (a) => "0x" + a.slice(2).toUpperCase();
class Store {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
}
// 浏览器禁了本地存储:读写都报错
const broken = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("SecurityError"); } };
const sender = () => { const s = () => { s.n++; }; s.n = 0; return s; };

test("摘要:大小写不同算同一个地址;16 位十六进制,看不出地址;不同地址不一样", async () => {
  const k = await seenKey(A);
  assert.match(k, /^[0-9a-f]{16}$/);
  assert.equal(await seenKey(upper(A)), k);
  assert.notEqual(await seenKey(B), k);
  assert.ok(!k.includes(A.slice(2, 10)));
});

test("去重:新地址数一次,数过的不再数(大小写不同也算数过),另一个地址照样数;本地存储里只有摘要", async () => {
  const store = new Store(), send = sender();
  assert.equal(await countCheckup(A, { store, send }), true);
  assert.equal(await countCheckup(A, { store, send }), false);
  assert.equal(await countCheckup(upper(A), { store, send }), false);
  assert.equal(await countCheckup(B, { store, send }), true);
  assert.equal(send.n, 2);
  const saved = store.getItem(SEEN_KEY);
  assert.deepEqual(JSON.parse(saved), [await seenKey(A), await seenKey(B)]);
  assert.ok(!saved.includes(A.slice(2)) && !saved.includes(B.slice(2)), "本地存储里没有地址");
});

test("管理员的浏览器不数(登进运营台或打开过 #owner,记着 dx-owner),连摘要也不记", async () => {
  const store = new Store(), send = sender();
  assert.equal(markOwner(store), true);
  assert.equal(store.getItem(OWNER_KEY), "1");
  assert.equal(await countCheckup(A, { store, send }), false);
  assert.equal(send.n, 0);
  assert.equal(store.getItem(SEEN_KEY), null);
});

test("存不了就不数:读写报错、存满了、浏览器连 localStorage 都不让读、没有本地存储、没有 crypto.subtle(不是 https)", async () => {
  const send = sender();
  assert.equal(await countCheckup(A, { store: broken, send }), false);
  const full = new Store();
  full.setItem = () => { throw new Error("QuotaExceededError"); };
  assert.equal(await countCheckup(A, { store: full, send }), false);
  assert.equal(await countCheckup(A, { store: new Store(), subtle: null, send }), false);
  // 页面里不传 store,用的是 globalThis.localStorage:浏览器禁了本地存储时,读这个属性就报错
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("SecurityError: access is denied"); } });
  try {
    assert.equal(await countCheckup(A, { send }), false);
    assert.equal(markOwner(), false);
  } finally {
    delete globalThis.localStorage;
  }
  assert.equal(await countCheckup(A, { send }), false, "没有本地存储");
  assert.equal(send.n, 0);
  assert.equal(markNew(broken, "k"), false);
  assert.equal(markOwner(broken), false);
});

test("只记最近 500 个:满了挤掉最早的(被挤掉的再查会再数一次,所以是约数);存的东西坏了就从头记", () => {
  const store = new Store();
  for (let i = 0; i < SEEN_MAX; i++) assert.equal(markNew(store, "k" + i), true);
  assert.equal(markNew(store, "k0"), false);
  assert.equal(markNew(store, "new"), true);
  const list = JSON.parse(store.getItem(SEEN_KEY));
  assert.equal(list.length, SEEN_MAX);
  assert.deepEqual([list[0], list.at(-1)], ["k1", "new"]);
  assert.equal(markNew(store, "k0"), true, "被挤掉的再来算新的");
  for (const junk of ["{oops", '{"a":1}', "42"]) {
    const s = new Store();
    s.setItem(SEEN_KEY, junk);
    assert.equal(markNew(s, "x"), true, junk);
    assert.deepEqual(JSON.parse(s.getItem(SEEN_KEY)), ["x"]);
  }
});

test("发出去的只有固定的一小段:不带地址、摘要、cookie、来源页;离开页面也发得完;发不出去也不报错", async () => {
  const calls = [];
  ping((url, opt) => { calls.push([url, opt]); return Promise.resolve(new Response(null, { status: 204 })); });
  assert.equal(calls.length, 1);
  const [url, opt] = calls[0];
  assert.equal(url, "/api/hit");
  assert.equal(HIT_BODY, '{"k":"checkup"}');
  assert.deepEqual(opt, { method: "POST", headers: { "Content-Type": "application/json" }, body: HIT_BODY, keepalive: true, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
  // 真的数一次:发出去的东西里没有地址和摘要
  const sent = [];
  assert.equal(await countCheckup(A, { store: new Store(), send: () => ping((u, o) => { sent.push(JSON.stringify([u, o])); return Promise.resolve(); }) }), true);
  assert.equal(sent.length, 1);
  assert.ok(!sent[0].toLowerCase().includes(A.slice(2)) && !sent[0].includes(await seenKey(A)));
  // fetch 当场报错、或者返回失败:都不往外抛(返回失败的被接住,不会变成没人管的报错)
  assert.doesNotThrow(() => ping(() => { throw new TypeError("Failed to fetch"); }));
  assert.doesNotThrow(() => ping(() => Promise.reject(new TypeError("Failed to fetch"))));
  await new Promise((r) => setTimeout(r, 5));
});

test("#owner:记上管理员的浏览器,把 #owner 从地址栏抹掉;别的 # 不动、不记;抹不掉、存不了也不报错", () => {
  const store = new Store();
  const hist = { calls: [], replaceState(...a) { this.calls.push(a); } };
  assert.equal(takeOwnerHash({ hash: "#a=" + A, pathname: "/check/", search: "" }, hist, store), false);
  assert.equal(takeOwnerHash({ hash: "#owner=1", pathname: "/", search: "" }, hist, store), false);
  assert.deepEqual([hist.calls.length, store.getItem(OWNER_KEY)], [0, null]);
  assert.equal(takeOwnerHash({ hash: "#owner", pathname: "/en/", search: "" }, hist, store), true);
  assert.deepEqual(hist.calls, [[null, "", "/en/"]]);
  assert.equal(store.getItem(OWNER_KEY), "1");
  assert.equal(takeOwnerHash({ hash: "#owner", pathname: "/", search: "" }, { replaceState() { throw new Error("SecurityError"); } }, broken), false);
});

test("运营台记的是同一个记号;页面代码里只有 count.js 往 /api/hit 发", () => {
  const admin = readFileSync(new URL("../admin/admin.js", import.meta.url), "utf8");
  assert.ok(admin.includes(`localStorage.setItem(${JSON.stringify(OWNER_KEY)}, "1")`), "admin.js 记的 dx-owner 要和 count.js 对得上");
  const root = fileURLToPath(new URL("../src/js", import.meta.url));
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (p.endsWith(".js")) files.push(p); } };
  walk(root);
  const users = files.filter((f) => readFileSync(f, "utf8").includes("/api/hit")).map((f) => f.slice(root.length + 1).replace(/\\/g, "/"));
  assert.deepEqual(users, ["lib/count.js"]);
});

test("site.js:打开时带着 #owner 的、已经开着的页面在地址后面补上 #owner 的,都记上、抹掉、提示一句;别的 # 不管", async () => {
  // site.js 只用到这几样;提示条 4 秒后收起的定时器换成假的,不拖着测试不退出
  const store = new Store(), replaced = [], on = {};
  const bar = { textContent: "", parentElement: null, classList: { add() {}, remove() {} } };
  Object.assign(globalThis, {
    document: { documentElement: { lang: "zh-CN", dataset: {} }, querySelector: () => null, querySelectorAll: () => [], getElementById: (id) => (id === "toast" ? bar : null), body: { append() {} } },
    window: { addEventListener: (type, fn) => { on[type] = fn; } },
    location: { hash: "#owner", pathname: "/", search: "" },
    history: { replaceState: (...a) => { replaced.push(a); location.hash = ""; } },
    localStorage: store,
  });
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    await import("../src/js/site.js");
    assert.deepEqual([store.getItem(OWNER_KEY), replaced, bar.textContent], ["1", [[null, "", "/"]], "这个浏览器已记成管理员的：在这里体检、打开页面都不计数。"], "打开时带着 #owner");
    store.m.delete(OWNER_KEY);
    bar.textContent = "";
    location.hash = "#a=" + A;
    on.hashchange();
    assert.deepEqual([store.getItem(OWNER_KEY), replaced.length, bar.textContent], [null, 1, ""], "别的 # 不管");
    location.hash = "#owner";
    on.hashchange();
    assert.deepEqual([store.getItem(OWNER_KEY), replaced.length, location.hash], ["1", 2, ""], "开着的页面补上 #owner");
    assert.match(bar.textContent, /不计数/);
  } finally {
    mock.timers.reset();
    for (const k of ["document", "window", "location", "history", "localStorage"]) delete globalThis[k];
  }
});

test("打开页面的计数:每次发 view;这个浏览器今天(北京时间)第一次来再发一个 visit(只记日期);管理员的不数;存不了本地存储只发 view", () => {
  const sent = [], send = (b) => sent.push(b);
  const store = new Store(), day1 = Date.parse("2026-11-07T15:59:00Z"), day2 = Date.parse("2026-11-07T16:01:00Z"); // 北京 11-07 23:59、11-08 00:01
  assert.equal(countView({ store, send, now: day1 }), 2);
  assert.deepEqual([sent, store.getItem(VISIT_KEY)], [[VIEW_BODY, VISIT_BODY], "2026-11-07"]);
  assert.equal(countView({ store, send, now: day1 }), 1, "同一天再打开只数 view");
  assert.equal(countView({ store, send, now: day2 }), 2, "过了北京时间零点算新的一天");
  assert.deepEqual([VIEW_BODY, VISIT_BODY], ['{"k":"view"}', '{"k":"visit"}']);
  sent.length = 0;
  const owner = new Store();
  owner.setItem(OWNER_KEY, "1");
  assert.deepEqual([countView({ store: owner, send, now: day1 }), sent, owner.getItem(VISIT_KEY)], [0, [], null], "管理员的浏览器两样都不数");
  assert.deepEqual([countView({ store: broken, send, now: day1 }), sent], [1, [VIEW_BODY]], "禁了本地存储:只数 view");
  sent.length = 0;
  assert.deepEqual([countView({ store: null, send, now: day1 }), sent], [1, [VIEW_BODY]]);
  const calls = [];
  ping((url, opt) => { calls.push([url, opt.body, opt.credentials, opt.referrerPolicy]); return Promise.resolve(); }, VIEW_BODY);
  assert.deepEqual(calls, [["/api/hit", VIEW_BODY, "omit", "no-referrer"]], "发的是固定的一小段,不带 cookie 和来源页");
});

test("打开页面的计数:服务器回 429(今天数满了),这个浏览器今天不再发,第二天照常", async () => {
  const store = new Store(), day1 = Date.parse("2026-11-07T03:00:00Z"), day2 = Date.parse("2026-11-08T03:00:00Z");
  const calls = [], real = globalThis.fetch;
  globalThis.fetch = (url, opt) => { calls.push(opt.body); return Promise.resolve(new Response(null, { status: 429 })); };
  try {
    assert.equal(countView({ store, now: day1 }), 2);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(store.getItem(OFF_KEY), "2026-11-07");
    assert.equal(countView({ store, now: day1 }), 0, "今天不再发");
    assert.equal(calls.length, 2);
    globalThis.fetch = (url, opt) => { calls.push(opt.body); return Promise.resolve(new Response(null, { status: 204 })); };
    assert.equal(countView({ store, now: day2 }), 2, "第二天照常");
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(store.getItem(OFF_KEY), "2026-11-07", "204 不记");
    globalThis.fetch = () => Promise.resolve(new Response(null, { status: 429 }));
    const s2 = new Store(); // 今天(11-08)已经记过;昨天(11-07)那一页发出去的请求现在才回 429
    s2.setItem(OFF_KEY, "2026-11-08");
    countView({ store: s2, now: day1 });
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(s2.getItem(OFF_KEY), "2026-11-08", "晚到的旧 429 不把今天的记号改回昨天");
  } finally {
    globalThis.fetch = real;
  }
});
