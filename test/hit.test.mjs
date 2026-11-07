// 体检计数的服务端(functions/api/hit.js、server/ops/db.js 的 hitCounts,本地预览 scripts/serve.mjs 的 /api/hit):
// 用本地 SQLite 当 D1 测。不连 Cloudflare。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LocalD1 } from "../scripts/d1-local.mjs";
import { handle, onRequest, overCap, LIMIT, CAP } from "../functions/api/hit.js";
import { ensure, bjDay, hitCounts } from "../server/ops/db.js";

const ORIGIN = "https://defiexit.com";
const BODY = '{"k":"checkup"}';
// 编的 IP、浏览器信息、地址:请求里带着,看库里有没有留下
const IP = "203.0.113.77", UA = "Mozilla/5.0 (fake-agent-77)", ADDR = "0x" + "7".repeat(40);
// 和浏览器一样带上请求体的实际长度(Content-Length);len 写了就照写,写 null 就不带
function req(body = BODY, { origin = ORIGIN, method = "POST", type = "application/json", url = `${ORIGIN}/api/hit`, len } = {}) {
  const headers = { "CF-Connecting-IP": IP, "User-Agent": UA };
  const hasBody = !["GET", "HEAD"].includes(method);
  if (origin) headers.Origin = origin;
  if (type) headers["Content-Type"] = type;
  const n = len === undefined && hasBody ? Buffer.byteLength(body) : len;
  if (n !== undefined && n !== null) headers["Content-Length"] = String(n);
  return new Request(url, { method, headers, body: hasBody ? body : undefined });
}
const at = (s) => new Date(s);
const count = async (db, day) => (await db.prepare("SELECT n FROM hits WHERE day = ? AND kind = 'checkup'").bind(day).first("n")) ?? 0;

test("体检计数:不是 POST、不是本站页面、不是 JSON、没写长度、太大、形状不对(多带一个字段也算),一律不数", async () => {
  const db = new LocalD1();
  await ensure(db);
  const env = { OPS: db };
  const cases = [
    [req(BODY, { method: "GET" }), 405, "method"],
    [req(BODY, { method: "PUT" }), 405, "method"],
    [req(BODY, { origin: null }), 403, "origin"],
    [req(BODY, { origin: "https://evil.example" }), 403, "origin"],
    [req(BODY, { origin: "http://defiexit.com" }), 403, "origin"],
    [req(BODY, { url: "https://www.defiexit.com/api/hit" }), 403, "origin"], // Origin 要和请求的主机一模一样
    [req(BODY, { type: "text/plain" }), 415, "type"],
    [req(BODY, { type: null }), 415, "type"],
    [req(BODY, { len: null }), 411, "length"],
    [req(BODY, { len: "abc" }), 411, "length"],
    [req(BODY, { len: LIMIT.body + 1 }), 413, "big"],
    [req(`{"k":"checkup","x":"${"y".repeat(LIMIT.body)}"}`), 413, "big"],
    [req(""), 400, "bad"],
    [req("{not json"), 400, "bad"],
    [req("null"), 400, "bad"],
    [req('"checkup"'), 400, "bad"],
    [req('["checkup"]'), 400, "bad"],
    [req("{}"), 400, "bad"],
    [req('{"k":"guide"}'), 400, "bad"],
    [req('{"k":"Checkup"}'), 400, "bad"],
    [req('{"k":["checkup"]}'), 400, "bad"],
    [req(`{"k":"checkup","a":"${ADDR}"}`), 400, "bad"], // 想顺带塞个地址进来:不收
  ];
  for (const [request, status, error] of cases) {
    const r = await handle(request, env, at("2026-11-05T02:00:00Z"));
    assert.equal(r.status, status, error);
    assert.equal((await r.json()).error, error);
  }
  assert.equal((await handle(req(BODY, { method: "GET" }), env)).headers.get("Allow"), "POST");
  assert.equal(await count(db, "2026-11-05"), 0, "一次都没数");
});

test("没接数据库(预览环境没有库):回 503", async () => {
  const r = await handle(req(), {}, at("2026-11-05T02:00:00Z"));
  assert.equal(r.status, 503);
  assert.equal((await r.json()).need, "db");
});

test("体检计数:按北京时间的日期加一,北京 0 点(UTC 16:00)换一天;回 204,不带内容、不设 cookie;第一次用自己建表", async () => {
  assert.equal(bjDay(at("2026-11-05T15:59:59.999Z")), "2026-11-05");
  assert.equal(bjDay(at("2026-11-05T16:00:00.000Z")), "2026-11-06");
  assert.equal(bjDay(at("2026-12-31T16:00:00Z")), "2027-01-01");
  const db = new LocalD1();
  const env = { OPS: db };
  const r = await handle(req(), env, at("2026-11-04T16:00:00.000Z")); // 北京 11-05 00:00
  assert.equal(r.status, 204);
  assert.equal(await r.text(), "");
  assert.equal(r.headers.get("Set-Cookie"), null);
  assert.equal(r.headers.get("Cache-Control"), "no-store");
  assert.equal((await handle(req(BODY, { type: "application/json; charset=utf-8" }), env, at("2026-11-05T15:59:59.999Z"))).status, 204); // 北京 11-05 23:59
  assert.equal((await handle(req(), env, at("2026-11-05T16:00:00.000Z"))).status, 204); // 北京 11-06 00:00
  assert.equal(await count(db, "2026-11-04"), 0);
  assert.equal(await count(db, "2026-11-05"), 2);
  assert.equal(await count(db, "2026-11-06"), 1);
  // Cloudflare 调的入口:用当下的时间
  const r2 = await onRequest({ request: req(), env });
  assert.equal(r2.status, 204);
  assert.ok((await count(db, bjDay(new Date()))) >= 1);
});

test("只存日期、种类、次数:库里找不到 IP、浏览器信息、地址,也没有每一次的时间", async () => {
  const db = new LocalD1();
  const env = { OPS: db };
  assert.equal((await handle(req(), env, at("2026-11-05T02:03:04Z"))).status, 204);
  assert.equal((await handle(req(`{"k":"checkup","a":"${ADDR}"}`), env, at("2026-11-05T02:05:06Z"))).status, 400);
  const cols = (await db.prepare("SELECT name FROM pragma_table_info('hits')").all()).results.map((r) => r.name);
  assert.deepEqual(cols, ["day", "kind", "n"]);
  // 整个库倒出来找
  const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).results.map((r) => r.name);
  let dump = "";
  for (const t of tables) dump += JSON.stringify((await db.prepare(`SELECT * FROM ${t}`).all()).results);
  for (const s of [IP, UA, ADDR, "02:03", "02:05", "T02"]) assert.ok(!dump.includes(s), `库里有 ${s}`);
  assert.equal(dump, tables.map((t) => (t === "hits" ? '[{"day":"2026-11-05","kind":"checkup","n":1}]' : "[]")).join(""));
});

test("上限:每种每天数到上限就不再加(库里带条件的写);每个实例每天另有内存里的上限,换一天清零", async () => {
  const db = new LocalD1();
  const env = { OPS: db };
  assert.equal((await handle(req(), env, at("2026-11-05T02:00:00Z"))).status, 204);
  await db.prepare("UPDATE hits SET n = ? WHERE day = '2026-11-05'").bind(LIMIT.perDay).run();
  const r = await handle(req(), env, at("2026-11-05T03:00:00Z"));
  assert.deepEqual([r.status, (await r.json()).error], [429, "day"]);
  assert.equal(await count(db, "2026-11-05"), LIMIT.perDay);
  assert.equal((await handle(req(), env, at("2026-11-05T16:00:00Z"))).status, 204, "第二天照常数");
  const m = { day: "", n: 0 };
  for (let i = 0; i < LIMIT.perIsolate; i++) assert.equal(overCap("2026-11-05", m), false);
  assert.equal(overCap("2026-11-05", m), true);
  assert.equal(overCap("2026-11-06", m), false, "换一天清零");
});

test("数据库出错:回 503,不往外抛", async () => {
  const down = { prepare() { throw new Error("D1 down"); }, batch: async () => { throw new Error("D1 down"); } };
  const r = await handle(req(), { OPS: down }, at("2026-11-05T02:00:00Z"));
  assert.deepEqual([r.status, (await r.json()).error], [503, "db"]);
});

test("读数:每种的总数、开始数的那天,和最近 60 天(北京时间)每天的数;60 天以前的只算进总数", async () => {
  const db = new LocalD1();
  await ensure(db);
  const now = at("2026-11-05T02:00:00Z"); // 北京 11-05;最近 60 天从 09-07 算起
  assert.deepEqual(await hitCounts(db, now), { checkup: { total: 0, since: null, byDay: {} }, view: { total: 0, since: null, byDay: {} }, visit: { total: 0, since: null, byDay: {} } });
  for (const t of ["2026-09-06T15:59:00Z", "2026-09-06T16:00:00Z", "2026-11-04T16:30:00Z", "2026-11-05T02:00:00Z"]) assert.equal((await handle(req(), { OPS: db }, at(t))).status, 204);
  assert.deepEqual(await hitCounts(db, now), { checkup: { total: 4, since: "2026-09-06", byDay: { "2026-09-07": 1, "2026-11-05": 2 } }, view: { total: 0, since: null, byDay: {} }, visit: { total: 0, since: null, byDay: {} } });
});

test("请求体不整个读进内存:长度写小了、实际灌 1 MiB,读过 64 字节就停;分几段到的照样拼对", async () => {
  const db = new LocalD1();
  const env = { OPS: db };
  const stream = (body, len) => new Request(`${ORIGIN}/api/hit`, { method: "POST", duplex: "half", headers: { Origin: ORIGIN, "Content-Type": "application/json", "Content-Length": String(len) }, body });
  let sent = 0;
  const flood = new ReadableStream({ pull(c) { if (sent >= 1 << 20) return c.close(); sent += 1024; c.enqueue(new Uint8Array(1024).fill(0x20)); } });
  const r = await handle(stream(flood, BODY.length), env, at("2026-11-05T02:00:00Z"));
  assert.deepEqual([r.status, (await r.json()).error], [413, "big"]);
  assert.ok(sent <= 16 * 1024, `读了 ${sent} 字节`);
  const parts = ['{"k":', '"check', 'up"}'].map((s) => new TextEncoder().encode(s));
  const trickle = new ReadableStream({ pull(c) { const p = parts.shift(); if (p) c.enqueue(p); else c.close(); } });
  assert.equal((await handle(stream(trickle, BODY.length), env, at("2026-11-05T02:00:00Z"))).status, 204);
  assert.equal(await count(db, "2026-11-05"), 1);
});

// 本地预览跑在没有 node:sqlite 的 Node 上(22.5 以前):用加载钩子把 node:sqlite 藏起来,起一个真的 scripts/serve.mjs
const HIDE_SQLITE = 'export async function resolve(s, c, next) { if (s === "node:sqlite") throw Object.assign(new Error("No such built-in module: node:sqlite"), { code: "ERR_UNKNOWN_BUILTIN_MODULE" }); return next(s, c); }';
const PRELOAD = `import { register } from "node:module"; register(${JSON.stringify("data:text/javascript," + encodeURIComponent(HIDE_SQLITE))});`;

test("本地预览:Node 没有 node:sqlite 时 /api/hit 回 503,预览不倒,别的接口照常", async () => {
  const child = spawn(process.execPath, ["--import", "data:text/javascript," + encodeURIComponent(PRELOAD), "scripts/serve.mjs", "0"], { cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: ["ignore", "pipe", "pipe"] });
  try {
    const base = await new Promise((resolve, reject) => {
      let out = "";
      const timer = setTimeout(() => reject(new Error("预览没起来:" + out)), 15000);
      child.stdout.on("data", (d) => {
        out += d;
        const m = /http:\/\/127\.0\.0\.1:(\d+)\//.exec(out);
        if (m) { clearTimeout(timer); resolve(`http://127.0.0.1:${m[1]}`); }
      });
      child.stderr.on("data", (d) => { out += d; });
      child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`预览退出了(${code}):${out}`)); });
    });
    const ping = () => fetch(base + "/api/hit", { method: "POST", headers: { Origin: base, "Content-Type": "application/json" }, body: BODY });
    const r = await ping();
    assert.deepEqual([r.status, await r.json()], [503, { need: "db" }]);
    assert.equal((await ping()).status, 503, "再来一次也一样");
    assert.equal((await fetch(base + "/api/see")).status, 405, "别的接口照常回");
  } finally {
    child.kill();
  }
});

test("打开页面(view)和访客(visit)各数各的:三种分开记,互不影响;每种的上限分开(打开页面多了挤不掉体检)", async () => {
  const db = new LocalD1();
  await ensure(db);
  const env = { OPS: db }, now = at("2026-11-07T03:00:00Z");
  for (const b of ['{"k":"view"}', '{"k":"view"}', '{"k":"visit"}', BODY]) assert.equal((await handle(req(b), env, now)).status, 204);
  assert.equal((await handle(req('{"k":"views"}'), env, now)).status, 400, "不认识的种类不收");
  const c = await hitCounts(db, now);
  assert.deepEqual([c.view.total, c.visit.total, c.checkup.total, c.view.byDay["2026-11-07"]], [2, 1, 1, 2]);
  const rows = await db.prepare("SELECT * FROM hits").all();
  assert.ok(!JSON.stringify(rows.results).includes(IP) && !JSON.stringify(rows.results).includes(UA), "不记 IP 和浏览器信息");
  assert.ok(CAP.view.perIsolate > LIMIT.perIsolate && CAP.view.perDay > LIMIT.perDay && CAP.checkup.perDay === LIMIT.perDay);
  assert.ok(CAP.checkup.perDay + CAP.view.perDay + CAP.visit.perDay <= 50000, "三种加起来远低于 D1 每天 10 万次写的免费额度");
  const m = { day: "", n: 0 };
  for (let i = 0; i < 3; i++) assert.equal(overCap("2026-11-07", m, 3), false);
  assert.equal(overCap("2026-11-07", m, 3), true, "按传进来的上限挡");
  await db.prepare("UPDATE hits SET n = ? WHERE kind = 'view'").bind(CAP.view.perDay).run();
  assert.equal((await handle(req('{"k":"view"}'), env, now)).status, 429, "打开页面到了当天上限就不再加");
  assert.equal((await handle(req(BODY), env, now)).status, 204, "体检照数");
});
