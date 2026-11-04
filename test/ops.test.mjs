// 运营台(functions/api/admin、functions/admin、server/ops):用本地 SQLite 当 D1、用假的 fxtwitter 测。不连 Cloudflare、不连 X。
import { test } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { LocalD1 } from "../scripts/d1-local.mjs";
import { handle } from "../functions/api/admin/[[path]].js";
import { serve } from "../functions/admin/[[path]].js";
import { checkText, signedText, SKEW_MS } from "../server/ops/ingest.js";
import { waitFor, MIN_PASSWORD } from "../server/ops/auth.js";
import { hostOk } from "../server/ops/http.js";
import { taskText, exportText, LIMIT } from "../server/ops/task.js";

const HOST = "https://defiexit.com";
const kp = () => generateKeyPairSync("ed25519");
const pubOf = (k) => k.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64url");
const PROD = kp(), PREV = kp(), TASK = kp();
const CODE = "setup-code-0123456789abcdef";
const PW = "correct-horse-battery-staple-42";
const baseEnv = (db, extra = {}) => ({ OPS: db, ADMIN_HOSTS: "defiexit.com", OPS_ENV: "production", INGEST_PUBKEYS: pubOf(PROD), TASK_PUBKEYS: pubOf(TASK), SETUP_CODE: CODE, ...extra });

// Cloudflare 上的 fetch 只认 redirect: "follow" / "manual",写 "error" 当场报错(Node 却照常跑,11-04 正式站的刷新因此一条都没读到):假 fetch 照 Cloudflare 的来
const edgeFetch = (inner) => (u, o = {}) => {
  if (o.redirect !== undefined && o.redirect !== "follow" && o.redirect !== "manual") throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"');
  return inner(u, o);
};

function world() {
  const w = { db: new LocalD1(), clock: Date.parse("2026-11-03T10:00:00Z"), fetchImpl: async () => new Response("{}", { status: 500 }) };
  w.now = () => new Date(w.clock);
  w.edge = edgeFetch((u, o) => w.fetchImpl(u, o));
  w.call = async (path, { method = "GET", body, cookie, origin = HOST, host = HOST, ip = "203.0.113.7", env = {}, type = "application/json" } = {}) => {
    const h = { "CF-Connecting-IP": ip };
    if (body !== undefined) h["Content-Type"] = type;
    if (origin) h.Origin = origin;
    if (cookie) h.Cookie = cookie;
    const r = await handle(new Request(host + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), baseEnv(w.db, env), w.edge, w.now());
    return { status: r.status, json: await r.json().catch(() => ({})), headers: r.headers };
  };
  w.ingest = async (payload, { key = PROD.privateKey, envName = "production", ts = w.clock, nonce = randomUUID().replace(/-/g, ""), path = "/api/admin/ingest" } = {}) => {
    const raw = JSON.stringify({ v: 1, ts, nonce, ...payload });
    const sig = sign(null, Buffer.from(signedText(envName, "POST", path, raw)), key).toString("base64url");
    const r = await handle(new Request(HOST + path, { method: "POST", headers: { "X-DX-Sig": sig, "Content-Type": "application/json" }, body: raw }), baseEnv(w.db), w.edge, w.now());
    return { status: r.status, json: await r.json(), raw, sig };
  };
  // 定时任务(小钥匙)和导出(投递钥匙)各签各的,签的文字开头不一样
  const signedCall = async (path, text, payload, key, { envName = "production", ts = w.clock, nonce = randomUUID().replace(/-/g, "") } = {}) => {
    const raw = JSON.stringify({ v: 1, ts, nonce, ...payload });
    const sig = sign(null, Buffer.from(text(envName, "POST", path, raw)), key).toString("base64url");
    const r = await handle(new Request(HOST + path, { method: "POST", headers: { "X-DX-Sig": sig, "Content-Type": "application/json" }, body: raw }), baseEnv(w.db), w.edge, w.now());
    return { status: r.status, json: await r.json(), raw, sig, nonce };
  };
  w.task = (payload, o = {}) => signedCall("/api/admin/task", taskText, payload, o.key || TASK.privateKey, o);
  w.exp = (payload, o = {}) => signedCall("/api/admin/export", exportText, payload, o.key || PROD.privateKey, o);
  w.login = async () => {
    const r = await w.call("/api/admin/setup", { method: "POST", body: { code: CODE, name: "admin1", password: PW } });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    return r.headers.get("Set-Cookie").split(";")[0];
  };
  return w;
}

const TARGET = { id: "2116000000000000001", handle: "someone", url: "https://x.com/someone/status/2116000000000000001", postedAt: "2026-11-01T08:00:00Z", protocol: "OpenEden", chain: "BNB Chain", type: "到期", summary: "活动结束后官网没有提取按钮" };
const OUT = (over = {}) => ({ id: "r-openeden-1", target: TARGET, why: "原帖写明自己的钱卡在到期金库", draft: "到期金库可以在官方合约上自己取出,步骤在 defiexit.com/r/woofi 。", ...over });

test("主机名门禁:只认 ADMIN_HOSTS;没配就谁都不认", () => {
  const r = (u) => new Request(u);
  assert.equal(hostOk(r("https://defiexit.com/api/admin/state"), { ADMIN_HOSTS: "defiexit.com" }), true);
  assert.equal(hostOk(r("https://www.defiexit.com/api/admin/state"), { ADMIN_HOSTS: "defiexit.com" }), false);
  assert.equal(hostOk(r("https://DEFIEXIT.com/x"), { ADMIN_HOSTS: "defiexit.com" }), true);
  assert.equal(hostOk(r("https://defiexit.com.evil.example/x"), { ADMIN_HOSTS: "defiexit.com" }), false);
  assert.equal(hostOk(r("https://ops.defiexit.pages.dev/x"), { ADMIN_HOSTS: "ops.defiexit.pages.dev" }), true);
  assert.equal(hostOk(r("https://abc123.defiexit.pages.dev/x"), { ADMIN_HOSTS: "ops.defiexit.pages.dev" }), false);
  assert.equal(hostOk(r("https://defiexit.pages.dev/x"), { ADMIN_HOSTS: "*.defiexit.pages.dev" }), false);
  assert.equal(hostOk(r("https://defiexit.com/x"), {}), false);
});

test("别的主机上接口和网页都是 404", async () => {
  const w = world();
  assert.equal((await w.call("/api/admin/state", { host: "https://www.defiexit.com" })).status, 404);
  const assets = { fetch: async () => new Response("<!doctype html>", { status: 200 }) };
  const env = { ADMIN_HOSTS: "defiexit.com", ASSETS: assets };
  assert.equal((await serve(new Request("https://www.defiexit.com/admin/"), env)).status, 404);
  assert.equal((await serve(new Request("https://defiexit.pages.dev/admin/"), env)).status, 404);
  const ok = await serve(new Request(HOST + "/admin/"), env);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("Content-Security-Policy"), /connect-src 'self';/);
  assert.equal(ok.headers.get("Cache-Control"), "no-store");
  assert.equal((await serve(new Request(HOST + "/admin"), env)).status, 301);
  assert.equal((await serve(new Request(HOST + "/admin/../index.html"), env)).status, 404);
  assert.equal((await serve(new Request(HOST + "/admin/secret.json"), env)).status, 404);
  assert.equal((await serve(new Request(HOST + "/admin/", { method: "POST" }), env)).status, 404);
});

test("没接数据库:回 need db", async () => {
  const r = await handle(new Request(HOST + "/api/admin/state"), { ADMIN_HOSTS: "defiexit.com" });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).need, "db");
});

test("第一次设管理员:设置码、密码长度、只能设一次;cookie 是 __Host- 的", async () => {
  const w = world();
  assert.equal((await w.call("/api/admin/state")).json.need, "setup");
  assert.equal((await w.call("/api/admin/setup", { method: "POST", body: { code: CODE, name: "admin1", password: PW }, env: { SETUP_CODE: "short" } })).json.error, "nocode");
  assert.equal((await w.call("/api/admin/setup", { method: "POST", body: { code: "wrong-code-wrong-code", name: "admin1", password: PW } })).status, 403);
  assert.equal((await w.call("/api/admin/setup", { method: "POST", body: { code: CODE, name: "admin1", password: "x".repeat(MIN_PASSWORD - 1) } })).json.error, "weak");
  assert.equal((await w.call("/api/admin/setup", { method: "POST", body: { code: CODE, name: "<b>", password: PW } })).json.error, "name");
  const r = await w.call("/api/admin/setup", { method: "POST", body: { code: CODE, name: "admin1", password: PW, remember: true } });
  assert.equal(r.status, 200);
  const sc = r.headers.get("Set-Cookie");
  assert.match(sc, /^__Host-dx_ops=[A-Za-z0-9_-]{40,}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=2592000$/);
  assert.equal((await w.call("/api/admin/setup", { method: "POST", body: { code: CODE, name: "admin2", password: PW } })).json.error, "exists");
  const st = await w.call("/api/admin/state", { cookie: sc.split(";")[0] });
  assert.equal(st.status, 200);
  assert.equal(st.json.me.name, "admin1");
  assert.equal((await w.call("/api/admin/state")).json.need, "login");
});

test("改东西的请求:没有 Origin、Origin 不对、不是 JSON,一律拒绝", async () => {
  const w = world();
  const c = await w.login();
  assert.equal((await w.call("/api/admin/outbox", { method: "POST", body: { id: "x" }, cookie: c, origin: null })).json.error, "origin");
  assert.equal((await w.call("/api/admin/outbox", { method: "POST", body: { id: "x" }, cookie: c, origin: "https://evil.example" })).json.error, "origin");
  assert.equal((await w.call("/api/admin/outbox", { method: "POST", body: { id: "x" }, cookie: c, type: "text/plain" })).status, 415);
  assert.equal((await w.call("/api/admin/outbox", { method: "POST", body: { id: "x" } })).json.need, "login");
  assert.equal((await w.call("/api/admin/state", { method: "PUT" })).status, 405);
});

test("登录:输错递增等待(按 IP),等够了能进;别的 IP 不受影响", async () => {
  const w = world();
  await w.login();
  const bad = () => w.call("/api/admin/login", { method: "POST", body: { name: "admin1", password: "wrong-password-wrong-password" } });
  assert.equal((await bad()).status, 401);
  assert.equal((await bad()).status, 401);
  assert.equal((await bad()).status, 401); // 第 3 次错:开始要等 5 秒
  const r = await w.call("/api/admin/login", { method: "POST", body: { name: "admin1", password: PW } });
  assert.equal(r.status, 429);
  assert.ok(r.json.seconds >= 1 && r.json.seconds <= 5);
  assert.equal((await w.call("/api/admin/login", { method: "POST", body: { name: "admin1", password: PW }, ip: "198.51.100.1" })).status, 200);
  w.clock += 6000;
  const ok = await w.call("/api/admin/login", { method: "POST", body: { name: "admin1", password: PW } });
  assert.equal(ok.status, 200);
  assert.equal(waitFor(2), 0);
  assert.equal(waitFor(3), 5);
  assert.equal(waitFor(4), 10);
  assert.equal(waitFor(40), 3600);
});

test("登录凭证:勾了「30 天内免登录」30 天有效、不勾 1 天;退出、全部退出立刻失效", async () => {
  const w = world();
  await w.login();
  const loginAs = async (remember) => (await w.call("/api/admin/login", { method: "POST", body: { name: "admin1", password: PW, remember } })).headers.get("Set-Cookie");
  const long = await loginAs(true);
  assert.match(long, /Max-Age=2592000$/);
  const short = await loginAs(false);
  assert.match(short, /Max-Age=86400$/);
  const cl = long.split(";")[0], cs = short.split(";")[0];
  w.clock += 25 * 3600e3;
  assert.equal((await w.call("/api/admin/state", { cookie: cs })).json.need, "login"); // 不勾:过了一天要重新登
  w.clock += 20 * 864e5;
  assert.equal((await w.call("/api/admin/state", { cookie: cl })).status, 200); // 勾了:20 多天没打开也不用登
  w.clock += 10 * 864e5;
  assert.equal((await w.call("/api/admin/state", { cookie: cl })).json.need, "login"); // 满 30 天
  const c2 = (await loginAs(true)).split(";")[0];
  await w.call("/api/admin/logout", { method: "POST", body: {}, cookie: c2 });
  assert.equal((await w.call("/api/admin/state", { cookie: c2 })).json.need, "login");
  const c3 = (await loginAs(true)).split(";")[0];
  const c4 = (await loginAs(true)).split(";")[0];
  await w.call("/api/admin/logout-all", { method: "POST", body: {}, cookie: c3 });
  assert.equal((await w.call("/api/admin/state", { cookie: c4 })).json.need, "login");
});

test("管理员改的草稿也只许本站链接、不许敏感词", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ outbox: [OUT()] });
  const bad = await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-openeden-1", draft: "去 https://evil.example/claim 领" }, cookie: c });
  assert.equal(bad.json.error, "draftbad");
  assert.ok(bad.json.why);
  const ok = await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-openeden-1", draft: "步骤在 defiexit.com/r/woofi 。" }, cookie: c });
  assert.equal(ok.json.item.draft_admin, "步骤在 defiexit.com/r/woofi 。");
});

test("投递:签名、环境、时间、nonce、旧包", async () => {
  const w = world();
  const ok = await w.ingest({ docs: { summary: { updatedAt: "2026-11-03T10:00:00Z", asks: [] } } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.docs, 1);
  assert.equal((await w.ingest({ docs: {} }, { key: PREV.privateKey, envName: "preview", ts: w.clock + 1 })).json.error, "sig"); // 预览的钥匙投不进正式库
  assert.equal((await w.ingest({ docs: {} }, { envName: "preview", ts: w.clock + 1 })).json.error, "sig"); // 签名里的环境不对
  assert.notEqual((await w.ingest({ docs: {} }, { path: "/api/admin/ingest2", ts: w.clock + 1 })).status, 200); // 路径不对:不收
  assert.equal((await w.ingest({ docs: {} }, { ts: w.clock - SKEW_MS - 1 })).json.error, "stale");
  assert.equal((await w.ingest({ docs: {} }, { ts: w.clock - 1 })).json.error, "old"); // 比上一包早
  const again = await w.ingest({ docs: {} }, { ts: w.clock + 2, nonce: "nonce-aaaaaaaaaaaaaaaa" });
  assert.equal(again.status, 200);
  assert.equal((await w.ingest({ docs: {} }, { ts: w.clock + 3, nonce: "nonce-aaaaaaaaaaaaaaaa" })).json.error, "replay");
  // 改一个字节,签名就对不上
  const r = await handle(new Request(HOST + "/api/admin/ingest", { method: "POST", headers: { "X-DX-Sig": ok.sig }, body: ok.raw.replace("2026", "2027") }), baseEnv(w.db), w.edge, w.now());
  assert.equal((await r.json()).error, "sig");
  // 没登录的人拿不到数据:回执里没有库里的内容
  assert.deepEqual(Object.keys(again.json).sort(), ["docs", "inbox", "ok", "outbox", "receipt", "rejected", "setup"]);
});

test("草稿检查:站外链接、敏感词一律不收", () => {
  assert.equal(checkText("步骤在 defiexit.com/r/woofi 。"), null);
  assert.equal(checkText("看 https://defiexit.com/r/hyperliquid/"), null);
  assert.match(checkText("去 evil-claim.xyz 领"), /领取|站外|claim/);
  assert.match(checkText("打开 https://app.example.io/withdraw"), /站外链接/);
  assert.match(checkText("可以私信我"), /私信/);
  assert.match(checkText("别把助记词给任何人"), /助记词/);
  assert.match(checkText("DM me for help"), /dm me/);
  assert.match(checkText("x".repeat(1001)), /超过/);
  assert.equal(checkText("取出 0.5 个 ETH,大约 1.2 美元"), null);
});

test("待发:管理员点过以后,投递改不了草稿和目标;目标帖子不能换;回复链接能补", async () => {
  const w = world();
  const c = await w.login();
  let r = await w.ingest({ outbox: [OUT(), OUT({ id: "r-bad-1", draft: "私信我" }), OUT({ id: "r-bad-2", target: { ...TARGET, url: "https://x.com/someone/status/1" } })] });
  assert.equal(r.json.outbox, 1);
  assert.deepEqual(r.json.rejected.map((x) => x.id), ["r-bad-1", "r-bad-2"]);
  w.clock += 1000;
  r = await w.ingest({ outbox: [OUT({ target: { ...TARGET, id: "2116000000000000009", url: "https://x.com/someone/status/2116000000000000009" } })] });
  assert.match(r.json.rejected[0].why, /不能换/);
  // 管理员改草稿、点已发
  assert.equal((await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-openeden-1", draft: "管理员改过的话" }, cookie: c })).json.item.draft_admin, "管理员改过的话");
  const sent = await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-openeden-1", status: "已发" }, cookie: c });
  assert.equal(sent.json.item.status, "已发");
  assert.equal(sent.json.item.sent_text, "管理员改过的话");
  assert.equal((await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-openeden-1", draft: "再改" }, cookie: c })).json.error, "locked");
  w.clock += 1000;
  r = await w.ingest({ outbox: [OUT({ draft: "Claude 想再改一版" })] });
  assert.match(r.json.rejected[0].why, /管理员已经处理过/);
  w.clock += 1000;
  r = await w.ingest({ outbox: [OUT({ replyUrl: "https://x.com/owner_acct/status/2116000000000000002" })] });
  assert.equal(r.json.rejected.length, 0);
  const st = await w.call("/api/admin/state", { cookie: c });
  const item = st.json.outbox.find((x) => x.id === "r-openeden-1");
  assert.equal(item.status, "已发");
  assert.equal(item.draft_admin, "管理员改过的话");
  assert.equal(item.mine.draft, OUT().draft);
  assert.equal(item.reply_url, "https://x.com/owner_acct/status/2116000000000000002");
});

test("自己发的帖子:没有目标帖子也收;点「已发」不要目标,刷新不去找它;回帖和帖子不能互换;到期留题目和草稿", async () => {
  const w = world();
  const c = await w.login();
  const POST = (over = {}) => ({ id: "p-zksync-lite-1104", kind: "post", topic: "关停提醒", why: "ZKsync Lite 5 月关停,还有人卡着", draft: "ZKsync Lite 关停了,钱还是你的:官方取款页能查余额,取到以太坊。", ...over });
  let r = await w.ingest({ outbox: [POST(), POST({ id: "p-bad-1", kind: "story" }), POST({ id: "p-bad-2", draft: "私信我" })] });
  assert.equal(r.json.outbox, 1);
  assert.deepEqual(r.json.rejected.map((x) => x.id), ["p-bad-1", "p-bad-2"]);
  w.clock += 1000;
  r = await w.ingest({ outbox: [OUT(), OUT({ id: "p-zksync-lite-1104" })] });
  assert.deepEqual(r.json.rejected.map((x) => [x.id, x.why]), [["p-zksync-lite-1104", "回帖和自己发的帖子不能互换"]]);
  w.clock += 1000;
  r = await w.ingest({ outbox: [POST({ id: "r-openeden-1" })] });
  assert.match(r.json.rejected[0].why, /不能互换/);
  let st = (await w.call("/api/admin/state", { cookie: c })).json;
  const p = st.outbox.find((x) => x.id === "p-zksync-lite-1104");
  assert.equal(p.mine.kind, "post");
  assert.equal(p.mine.topic, "关停提醒");
  assert.equal(p.mine.target, undefined);
  const sent = await w.call("/api/admin/outbox", { method: "POST", body: { id: "p-zksync-lite-1104", status: "已发" }, cookie: c });
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  assert.equal(sent.json.item.status, "已发");
  assert.equal(sent.json.item.sent_text, POST().draft);
  // 刷新:只读被监控的帖子,不为自己发的帖子去找「目标帖子」
  await w.ingest({ docs: { x_posts: { posts: [{ name: "X 长文", id: "3000000000000000005", points: [] }] } } }, { ts: (w.clock += 1000) });
  const asked = [];
  w.fetchImpl = async (u) => { asked.push(String(u).split("/").pop()); return new Response(JSON.stringify({ code: 200, status: { id: "3000000000000000005", author: { id: "1", screen_name: "owner_acct" }, views: 1 } }), { status: 200 }); };
  const s = await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.deepEqual(asked, ["3000000000000000005"]);
  // 帖子的链接能补
  w.clock += 1000;
  r = await w.ingest({ outbox: [POST({ replyUrl: "https://x.com/owner_acct/status/3000000000000000009" })] });
  assert.equal(r.json.rejected.length, 0);
  // 30 天到期:留题目和草稿
  w.clock += 31 * 864e5;
  const c2 = (await w.call("/api/admin/login", { method: "POST", body: { name: "admin1", password: PW } })).headers.get("Set-Cookie").split(";")[0];
  st = (await w.call("/api/admin/state", { cookie: c2 })).json;
  const q = st.outbox.find((x) => x.id === "p-zksync-lite-1104");
  assert.equal(q.purged, true);
  assert.equal(q.mine.kind, "post");
  assert.equal(q.mine.topic, "关停提醒");
  assert.equal(q.mine.draft, POST().draft);
  assert.equal(q.status, "已发");
});

const LEAD = (over = {}) => ({ kind: "事件", key: "event|balancer-v2|1793318400|withdrawals-only", protocol: "Balancer V2", when: "2026-10-30", text: "Most Balancer pools become withdrawals-only", source: "https://defillama.com/protocol/balancer-v2", site: "https://balancer.fi/", x: "@Balancer", category: "Dexs", chains: ["Ethereum"], tvl: 17000000, ...over });

test("定时任务的小钥匙:能刷新、能加线索(去重、来源白名单);改不了别的;和投递钥匙互不通用;nonce 只能用一次", async () => {
  const w = world();
  const c = await w.login();
  let r = await w.task({ do: "sync" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  w.clock += 1000;
  assert.equal((await w.task({ do: "sync" })).json.error, "busy"); // 两分钟一次
  w.clock += 1000;
  assert.equal((await w.task({ do: "docs", docs: { funnel: { target: 5, stages: [] } } })).json.error, "do");
  w.clock += 1000;
  r = await w.task({ do: "leads", read: 19, failed: ["Curve(HTTP 403)"], leads: [LEAD(), LEAD({ key: "forum|aave|25965", kind: "论坛", protocol: "Aave", text: "tBTC Mint & Redeem Pause", source: "https://governance.aave.com/t/x/25965" }), LEAD({ key: "bad", source: "https://evil.example/claim" })] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.stored, 2);
  assert.match(r.json.rejected[0], /白名单/);
  w.clock += 1000;
  r = await w.task({ do: "leads", leads: [LEAD()] });
  assert.equal(r.json.stored, 0);
  assert.equal(r.json.duplicate, 1);
  // 同一个 nonce 再来一次
  w.clock += 1000;
  const once = await w.task({ do: "leads", leads: [] }, { nonce: "same-nonce-0123456789ab" });
  assert.equal(once.status, 200);
  w.clock += 1000;
  assert.equal((await w.task({ do: "leads", leads: [] }, { nonce: "same-nonce-0123456789ab" })).json.error, "replay");
  // 小钥匙投不进 ingest,投递钥匙也签不了 task
  w.clock += 1000;
  assert.equal((await w.ingest({ outbox: [OUT()] }, { key: TASK.privateKey })).json.error, "sig");
  assert.equal((await w.task({ do: "sync" }, { key: PROD.privateKey })).json.error, "sig");
  // 运营台看得到线索和定时任务的情况
  const st = (await w.call("/api/admin/state", { cookie: c })).json;
  assert.equal(st.leads.length, 2);
  assert.deepEqual(st.leads.map((l) => l.kind).sort(), ["事件", "论坛"]);
  assert.equal(st.leads.find((l) => l.kind === "事件").site, "balancer.fi");
  assert.equal(st.auto.sync.ok, true);
  assert.equal(st.auto.monitor.stored, 0);
  assert.equal(st.outbox.length, 0);
});

test("监控的论坛和运营台收线索的白名单对得上(加论坛要两边一起加)", async () => {
  const { LEAD_HOSTS } = await import("../server/ops/task.js");
  const src = JSON.parse(readFileSync(new URL("../scripts/monitor/sources.json", import.meta.url), "utf8"));
  for (const f of src.forums) assert.ok(LEAD_HOSTS.has(new URL(f.url).hostname), f.url);
  assert.ok(LEAD_HOSTS.has("defillama.com"));
});

test("按钮和定时任务同时刷新:只有一个刷得了", async () => {
  const w = world();
  const c = await w.login();
  const [a, b] = await Promise.all([w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c }), w.task({ do: "sync" })]);
  assert.deepEqual([a.status, b.status].sort(), [200, 429]);
});

test("刷新太慢、中间被新的一次刷新顶掉:旧的不写,读数不被盖掉;每天的刷新名额先占后用", async () => {
  const w = world();
  await w.login();
  await w.ingest({ docs: { x_posts: { posts: [{ name: "X 长文", id: "3000000000000000005", points: [] }] } } });
  w.fetchImpl = async () => {
    // 读的时候,另一次刷新抢走了锁
    await w.db.prepare("UPDATE kv SET v = ? WHERE k = 'sync_at_ms'").bind(String(w.clock + 999999)).run();
    return new Response(JSON.stringify({ code: 200, status: { id: "3000000000000000005", author: { id: "1", screen_name: "owner_acct" }, views: 5 } }), { status: 200 });
  };
  w.clock += 1000;
  const r = await w.task({ do: "sync" });
  assert.equal(r.json.error, "superseded");
  const x = JSON.parse((await w.db.prepare("SELECT v FROM docs WHERE k = 'x_posts'").first("v")));
  assert.equal(x.posts[0].points.length, 0);
  // 名额:没刷成的退回;到了上限就不刷
  assert.equal(await w.db.prepare("SELECT v FROM kv WHERE k = ?").bind("auto_sync_day:" + new Date(w.clock).toISOString().slice(0, 10)).first("v"), "0");
  await w.db.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind("auto_sync_day:" + new Date(w.clock).toISOString().slice(0, 10), String(LIMIT.syncPerDay)).run();
  w.clock += 10 * 60 * 1000;
  assert.equal((await w.task({ do: "sync" })).json.error, "sync-day");
});

test("导出之前先清到期的:30 天前的评论和备注导不出来", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ inbox: [{ id: "3000000000000000301", source: "X 长文", author: "user_y", url: "https://x.com/user_y/status/3000000000000000301", text: "老评论", type: "提问", need: "无" }] });
  await w.call("/api/admin/inbox", { method: "POST", body: { id: "3000000000000000301", decision: "不采纳", note: "这人是 user_y" }, cookie: c });
  w.clock += 31 * 864e5;
  const r = await w.exp({});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.inbox.length, 0);
  assert.equal(JSON.stringify(r.json).includes("user_y"), false);
});

test("导出:只认投递钥匙;回管理员的决定和状态、线索,不回评论原文和账号", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ outbox: [OUT()], inbox: [{ id: "3000000000000000201", source: "X 长文", author: "user_x", url: "https://x.com/user_x/status/3000000000000000201", text: "能不能加个先别取的提醒", type: "产品建议", need: "想知道该不该动", suggestion: "采纳" }] });
  await w.call("/api/admin/inbox", { method: "POST", body: { id: "3000000000000000201", decision: "采纳", note: "跟下一份指南一起做" }, cookie: c });
  await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-openeden-1", status: "跳过" }, cookie: c });
  await w.task({ do: "leads", leads: [LEAD()] });
  w.clock += 1000;
  const r = await w.exp({ since: "2026-11-01T00:00:00Z" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const it = r.json.inbox.find((x) => x.id === "3000000000000000201");
  assert.equal(it.decision, "采纳");
  assert.equal(it.note, "跟下一份指南一起做");
  assert.equal(JSON.stringify(r.json).includes("能不能加个先别取的提醒"), false);
  assert.equal(JSON.stringify(r.json).includes("user_x"), false);
  assert.equal(r.json.outbox.find((x) => x.id === "r-openeden-1").status, "跳过");
  assert.equal(r.json.leads.length, 1);
  w.clock += 1000;
  assert.equal((await w.exp({}, { key: TASK.privateKey })).json.error, "sig");
});

test("收件:刷新读进来的评论,投递补上分析;管理员的决定不被覆盖;发帖人自己的回复会标成已回复", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ docs: { x_posts: { posts: [{ key: "promo", name: "X 推广帖", id: "3000000000000000001", url: "https://x.com/owner_acct/status/3000000000000000001", points: [] }] } } });
  const OWNER = { id: "1000000000000000001", screen_name: "owner_acct" };
  w.fetchImpl = async (u) => {
    assert.ok(String(u).startsWith("https://api.fxtwitter.com/2/conversation/"));
    return new Response(JSON.stringify({
      code: 200,
      status: { id: "3000000000000000001", author: OWNER, views: 270, likes: 0, replies: 1, reposts: 0, bookmarks: 0 },
      replies: [
        { id: "3000000000000000002", text: "@owner_acct 最好把「暂时别取」的情况也标出来", created_timestamp: 1761669780, author: { id: "999", screen_name: "user_a" }, replying_to: { status: "3000000000000000001" } },
        { id: "3000000000000000003", text: "@user_a 感谢指导", created_timestamp: 1761774180, author: OWNER, replying_to: { status: "3000000000000000002" } },
      ],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  const s = await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.equal(s.json.newReplies, 1);
  assert.equal(s.json.marked, 1);
  assert.equal((await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c })).json.error, "busy");
  let st = (await w.call("/api/admin/state", { cookie: c })).json;
  let it = st.inbox.find((x) => x.id === "3000000000000000002");
  assert.equal(it.replied, true);
  assert.equal(it.mine.yourReply, "@user_a 感谢指导");
  assert.equal(it.mine.author, "user_a");
  assert.equal(st.docs.x_posts.posts[0].points.at(-1).views, 270);
  // 管理员先定了,Claude 再补分析:决定还在,分析合进去
  await w.call("/api/admin/inbox", { method: "POST", body: { id: "3000000000000000002", decision: "采纳" }, cookie: c });
  w.clock += 1000;
  await w.ingest({ inbox: [{ id: "3000000000000000002", type: "产品建议", need: "想先知道该不该动", suggestion: "采纳" }] });
  st = (await w.call("/api/admin/state", { cookie: c })).json;
  it = st.inbox.find((x) => x.id === "3000000000000000002");
  assert.equal(it.decision, "采纳");
  assert.equal(it.mine.type, "产品建议");
  assert.equal(it.mine.author, "user_a");
});

test("刷新:读不到的帖子写进 errors,不算「没有新评论」", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ docs: { x_posts: { posts: [{ name: "X 长文", id: "3000000000000000005", points: [] }] } } });
  w.fetchImpl = async () => { throw new Error("down"); };
  const s = await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c });
  assert.deepEqual(s.json.errors, ["X 长文(读不到)"]);
  assert.equal(s.json.read, 0);
  assert.equal((await w.call("/api/admin/state", { cookie: c })).json.synced.note, "1 条没读到");
});

test("刷新:回跳转算读不到(不跟着跳);定时任务记下读到几条、哪条为什么没读到;一条都没读到也记下来", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ docs: { x_posts: { posts: [{ name: "项目帖", id: "3000000000000000005", points: [] }, { name: "X 长文", id: "3000000000000000006", points: [] }] } } });
  w.fetchImpl = async (u, o) => {
    assert.equal(o.redirect, "manual");
    const id = String(u).split("/").pop();
    if (id === "3000000000000000006") return new Response(null, { status: 302, headers: { Location: "https://evil.example/" } });
    return new Response(JSON.stringify({ status: { id, author: { id: "1", screen_name: "owner_acct" }, views: 5, replies: 0 }, replies: [] }), { status: 200 });
  };
  let r = await w.task({ do: "sync" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.read, 1);
  assert.deepEqual(r.json.errors, ["X 长文(HTTP 302)"]);
  let a = (await w.call("/api/admin/state", { cookie: c })).json.auto.sync;
  assert.deepEqual([a.ok, a.read, a.failed, a.errors], [true, 1, 1, ["X 长文(HTTP 302)"]]);
  w.clock += 3 * 60 * 1000;
  w.fetchImpl = async () => { throw new Error("down"); };
  r = await w.task({ do: "sync" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  a = (await w.call("/api/admin/state", { cookie: c })).json.auto.sync;
  assert.deepEqual([a.ok, a.read, a.failed], [true, 0, 2]);
});

test("已发的回复:刷新时去目标帖子底下按账号编号找,找到才填链接", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ docs: { x_posts: { posts: [{ name: "X 长文", id: "3000000000000000005", points: [] }] } }, outbox: [OUT()] });
  await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-openeden-1", status: "已发" }, cookie: c });
  const OWNER = { id: "1000000000000000001", screen_name: "owner_acct" };
  w.fetchImpl = async (u) => {
    const id = String(u).split("/").pop();
    const base = { code: 200, status: { id, author: id === TARGET.id ? { id: "555", screen_name: "someone" } : OWNER, views: 1, replies: 1 } };
    if (id === TARGET.id) base.replies = [
      { id: "2116000000000000003", author: { id: "777", screen_name: "owner_acct_fake" }, replying_to: { status: TARGET.id } },
      { id: "2116000000000000004", author: OWNER, replying_to: { status: TARGET.id } },
    ];
    return new Response(JSON.stringify(base), { status: 200 });
  };
  const s = await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c });
  const st = (await w.call("/api/admin/state", { cookie: c })).json;
  assert.equal(st.outbox[0].reply_url, "https://x.com/owner_acct/status/2116000000000000004");
  // 刚核到链接的回复,这一次就接着读了(读数、别人接着回的)
  assert.equal(s.json.read, 2);
  assert.equal(st.outStats["r-openeden-1"].views, 1);
});

test("我们发出去的回复:7 天内的也读;别人接着回的进收件(写明是回我们哪条);我们又回了就标已回复;读数记进 outStats", async () => {
  const w = world();
  const c = await w.login();
  const OWNER = { id: "1000000000000000001", screen_name: "owner_acct" };
  const MINE = "2116000000000000004";
  await w.ingest({ docs: { x_posts: { posts: [{ name: "X 长文", id: "3000000000000000005", points: [] }] } }, outbox: [OUT()] });
  await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-openeden-1", status: "已发" }, cookie: c });
  w.clock += 1000; // 投递的包要比上一包新
  await w.ingest({ outbox: [{ ...OUT(), replyUrl: "https://x.com/owner_acct/status/" + MINE }] });
  const asked = [];
  w.fetchImpl = async (u) => {
    const id = String(u).split("/").pop();
    asked.push(id);
    if (id === MINE) return new Response(JSON.stringify({ status: { id, author: OWNER, views: 41, likes: 1, replies: 2, reposts: 0 }, replies: [
      { id: "2116000000000000007", text: "But the bridge stopped working", author: { id: "555", screen_name: "someone" }, replying_to: { status: MINE }, created_timestamp: 1793750000 },
      { id: "2116000000000000008", text: "Lisk said on Nov 3 ...", author: OWNER, replying_to: { status: "2116000000000000007" }, created_timestamp: 1793750100 },
    ] }));
    return new Response(JSON.stringify({ status: { id, author: OWNER, views: 1, replies: 0 }, replies: [] }));
  };
  const s = await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.equal(s.json.read, 2);
  assert.ok(asked.includes(MINE), "读了我们那条回复");
  const st = (await w.call("/api/admin/state", { cookie: c })).json;
  const got = st.inbox.find((x) => x.id === "2116000000000000007");
  assert.ok(got, "别人接着回的进了收件");
  assert.equal(got.mine.source, "我们的回复 · OpenEden");
  assert.equal(got.mine.replyToId, "2116000000000000007");
  assert.equal(got.replied, true);
  assert.equal(got.mine.yourReply, "Lisk said on Nov 3 ...");
  assert.deepEqual([st.outStats["r-openeden-1"].views, st.outStats["r-openeden-1"].likes, st.outStats["r-openeden-1"].replies], [41, 1, 2]);
  assert.ok(!st.inbox.find((x) => x.id === "2116000000000000008"), "我们自己的回复不进收件");
  // 导出也带读数
  assert.equal((await w.exp({})).json.outStats["r-openeden-1"].views, 41);
});

test("我们发出去的多了:一次读帖总数有上限(第一次被监控的在前),下一次先读没读过的;7 天前点「已发」的不读", async () => {
  const w = world();
  const c = await w.login();
  const sid = (i) => "22160000000000001" + String(i).padStart(2, "0");
  const tid = (i) => "21160000000000002" + String(i).padStart(2, "0");
  const items = Array.from({ length: 31 }, (_, i) => OUT({ id: "r-x-" + i, target: { ...TARGET, id: tid(i), url: "https://x.com/someone/status/" + tid(i) } }));
  await w.ingest({ docs: { x_posts: { posts: [{ name: "X 长文", id: "3000000000000000005", points: [] }] } }, outbox: items });
  for (const it of items) await w.call("/api/admin/outbox", { method: "POST", body: { id: it.id, status: "已发" }, cookie: c });
  w.clock += 1000;
  await w.ingest({ outbox: items.map((it, i) => ({ ...it, replyUrl: "https://x.com/owner_acct/status/" + sid(i) })) });
  await w.db.prepare("UPDATE outbox SET decided_at = ? WHERE id = ?").bind(new Date(w.clock - 8 * 864e5).toISOString(), "r-x-0").run();
  let asked = [];
  w.fetchImpl = async (u) => { const id = String(u).split("/").pop(); asked.push(id); return new Response(JSON.stringify({ status: { id, author: { id: "1", screen_name: "owner_acct" }, views: 3, replies: 0 }, replies: [] })); };
  await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c });
  assert.equal(asked.length, MAX_FETCH);
  assert.equal(asked[0], "3000000000000000005", "被监控的帖子先读");
  assert.ok(!asked.includes(sid(0)), "8 天前的不读");
  const first = new Set(asked);
  w.clock += 3 * 60 * 1000;
  asked = [];
  await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c });
  assert.equal(asked.length, MAX_FETCH);
  const unread = Array.from({ length: 30 }, (_, i) => sid(i + 1)).filter((x) => !first.has(x));
  assert.equal(unread.length, 30 - (MAX_FETCH - 1));
  assert.deepEqual(asked.slice(0, unread.length).sort(), unread.sort(), "上次没轮到的先读");
  assert.ok(!asked.includes(sid(0)));
});

test("我们回复底下:只收这一串里的评论(别的分支不收);贴的链接不是我们账号发的,不收它底下的评论", async () => {
  const w = world();
  const c = await w.login();
  const OWNER = { id: "1000000000000000001", screen_name: "owner_acct" };
  const MINE = "2116000000000000004", STRANGER = "2116000000000000044";
  const POST = { id: "p-wrong-1105", kind: "post", topic: "关停提醒", why: "测试", draft: "测试项目帖。" };
  await w.ingest({ docs: { x_posts: { posts: [{ name: "X 长文", id: "3000000000000000005", points: [] }] } }, outbox: [OUT(), POST] });
  await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-openeden-1", status: "已发" }, cookie: c });
  await w.call("/api/admin/outbox", { method: "POST", body: { id: POST.id, status: "已发" }, cookie: c });
  w.clock += 1000;
  await w.ingest({ outbox: [{ ...OUT(), replyUrl: "https://x.com/owner_acct/status/" + MINE }] });
  await w.call("/api/admin/outbox", { method: "POST", body: { id: POST.id, reply_url: "https://x.com/someone_else/status/" + STRANGER }, cookie: c });
  w.fetchImpl = async (u) => {
    const id = String(u).split("/").pop();
    if (id === MINE) return new Response(JSON.stringify({ status: { id, author: OWNER, views: 9, replies: 2 }, replies: [
      { id: "2116000000000000007", text: "in our thread", author: { id: "555", screen_name: "someone" }, replying_to: { status: MINE } },
      { id: "2116000000000000017", text: "deeper in our thread", author: { id: "556", screen_name: "another" }, replying_to: { status: "2116000000000000007" } },
      { id: "2116000000000000027", text: "another branch", author: { id: "557", screen_name: "elsewhere" }, replying_to: { status: "2116000000000000999" } },
    ] }));
    if (id === STRANGER) return new Response(JSON.stringify({ status: { id, author: { id: "777", screen_name: "someone_else" }, views: 5, replies: 1 }, replies: [
      { id: "2116000000000000037", text: "not about us", author: { id: "558", screen_name: "visitor" }, replying_to: { status: STRANGER } },
    ] }));
    return new Response(JSON.stringify({ status: { id, author: OWNER, views: 1, replies: 0 }, replies: [] }));
  };
  const s = await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  const ids = (await w.call("/api/admin/state", { cookie: c })).json.inbox.map((x) => x.id).sort();
  assert.deepEqual(ids, ["2116000000000000007", "2116000000000000017"]);
  assert.ok(s.json.errors.some((e) => /不是我们账号发的/.test(e)), JSON.stringify(s.json.errors));
});

test("贴链接:只收 x.com 的帖子链接(去掉 ?s=20 这类尾巴),只给「已发」的贴;贴了刷新就读它", async () => {
  const w = world();
  const c = await w.login();
  const POST = { id: "p-balancer-1105", kind: "post", topic: "关停提醒 · Balancer", why: "官方论坛写明大部分池子只能取", draft: "Balancer 正在关停,先看看自己有没有仓位。" };
  await w.ingest({ docs: { x_posts: { posts: [{ name: "项目帖 · ZKsync", id: "2117764004450045982", points: [] }] } }, outbox: [POST] });
  const put = (url) => w.call("/api/admin/outbox", { method: "POST", body: { id: POST.id, reply_url: url }, cookie: c });
  assert.equal((await put("https://x.com/Ilikecoin2023/status/2117778827250409695")).status, 409); // 还是待发
  await w.call("/api/admin/outbox", { method: "POST", body: { id: POST.id, status: "已发" }, cookie: c });
  for (const bad of ["https://evil.example/Ilikecoin2023/status/2117778827250409695", "http://x.com/Ilikecoin2023/status/2117778827250409695", "javascript:alert(1)", "https://x.com/Ilikecoin2023", "https://x.com/a/status/1/photo/1"]) {
    const r = await put(bad);
    assert.equal(r.status, 400, bad);
    assert.equal(r.json.error, "badlink", bad);
  }
  const ok = await put("https://x.com/Ilikecoin2023/status/2117778827250409695?a=tPG3jbVDUS4clhsExLU&s=20");
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.item.reply_url, "https://x.com/Ilikecoin2023/status/2117778827250409695");
  const asked = [];
  w.fetchImpl = async (u) => { const id = String(u).split("/").pop(); asked.push(id); return new Response(JSON.stringify({ status: { id, author: { id: "1", screen_name: "Ilikecoin2023" }, views: 14, likes: 0, replies: 0 }, replies: [] })); };
  await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c });
  assert.deepEqual(asked, ["2117764004450045982", "2117778827250409695"]);
  assert.equal((await w.call("/api/admin/state", { cookie: c })).json.outStats[POST.id].views, 14);
  // 到期删过的不能再贴回去
  await w.db.prepare("UPDATE outbox SET purged = 1, reply_url = NULL WHERE id = ?").bind(POST.id).run();
  assert.equal((await put("https://x.com/Ilikecoin2023/status/2117778827250409695")).status, 409);
});

test("评论多:被我们回过的全收(收进来就标好),其余一次最多 100 条(新的先),没收完的下次接着收,不漏", async () => {
  const w = world();
  const c = await w.login();
  const OWNER = { id: "1000000000000000001", screen_name: "owner_acct" };
  const POST = "3000000000000000005";
  await w.ingest({ docs: { x_posts: { posts: [{ name: "X 长文", id: POST, points: [] }] } } });
  // 160 条别人的评论;发帖人回了最早的 40 条(一共 200 条,读帖接口一次最多给 200 条)
  const cid = (k) => String(2117000000000000000n + BigInt(k));
  const rid = (k) => String(2117000000000001000n + BigInt(k));
  const replies = [];
  for (let k = 0; k < 160; k++) replies.push({ id: cid(k), text: "q" + k, author: { id: String(5000 + k), screen_name: "v" + k }, replying_to: { status: POST } });
  for (let k = 0; k < 40; k++) replies.push({ id: rid(k), text: "a" + k, author: OWNER, replying_to: { status: cid(k) } });
  w.fetchImpl = async () => new Response(JSON.stringify({ status: { id: POST, author: OWNER, replies: 200 }, replies }));
  const got = [];
  for (let i = 0; i < 3; i++) {
    const r = await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    got.push([r.json.newReplies, r.json.marked]);
    w.clock += 121000;
  }
  assert.deepEqual(got, [[140, 40], [20, 0], [0, 0]]); // 回过的 40 条全收、收进来就标好,其余 120 条先收 100
  const inbox = (await w.call("/api/admin/state", { cookie: c })).json.inbox;
  assert.equal(inbox.length, 160);
  assert.equal(inbox.filter((x) => x.replied === true).length, 40);
});

test("上游这次少给了几条:下次给了照样收(晚到的、父评论这次没返回的子评论);同一条评论在两条帖子底下只算一次;一条帖子评论再多也挤不掉别的", async () => {
  const w = world();
  const c = await w.login();
  const OWNER = { id: "1000000000000000001", screen_name: "owner_acct" };
  const A = "3000000000000000005", B = "3000000000000000006";
  await w.ingest({ docs: { x_posts: { posts: [{ name: "A", id: A, points: [] }, { name: "B", id: B, points: [] }] } } });
  const cm = (id, to, k) => ({ id, text: "t" + k, author: { id: String(7000 + k), screen_name: "u" + k }, replying_to: { status: to } });
  let round = 0;
  const busy = (n) => Array.from({ length: 150 }, (_, k) => cm(String(2118000000000000000n + BigInt(n * 1000 + k)), A, k));
  w.fetchImpl = async (u) => {
    const id = String(u).split("/").pop();
    let replies = [];
    if (id === A) replies = round === 0 ? [cm("2117000000000000102", A, 2), cm("2117000000000000101", A, 1)] : round === 1 ? [cm("2117000000000000102", A, 2), cm("2117000000000000201", "2117000000000000200", 3), cm("2117000000000000103", A, 4)] : [cm("2117000000000000200", A, 5), cm("2117000000000000201", "2117000000000000200", 3), cm("2117000000000000103", A, 4), ...busy(2)];
    if (id === B) replies = round >= 2 ? [cm("2117000000000000103", B, 4), cm("2117000000000000301", B, 6)] : [];
    return new Response(JSON.stringify({ status: { id, author: OWNER, replies: replies.length }, replies }));
  };
  const ids = async () => (await w.call("/api/admin/state", { cookie: c })).json.inbox.map((x) => x.id);
  round = 0; await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c }); w.clock += 121000;
  assert.deepEqual((await ids()).sort(), ["2117000000000000101", "2117000000000000102"]);
  round = 1; await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c }); w.clock += 121000;
  assert.ok((await ids()).includes("2117000000000000103"));
  assert.ok(!(await ids()).includes("2117000000000000201"), "父评论这次没返回,先不收");
  round = 2;
  const r = await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c }); w.clock += 121000;
  assert.equal(r.json.newReplies, 100, "一次最多 100 条;B 底下那条和 A 底下那条重复的只算一次");
  assert.ok((await ids()).includes("2117000000000000301"), "A 底下一下来了 150 条,B 那条也收了");
  round = 3;
  const r2 = await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c });
  const now = await ids();
  assert.ok(now.includes("2117000000000000200") && now.includes("2117000000000000201"), "父评论回来了,子评论也收(上一次没收完的这次接着收)");
  assert.equal(r2.json.newReplies, 53);
  assert.equal(now.length, 2 + 1 + 100 + 53);
});

test("回复串很深、倒着返回:顺着找到底,都收;停了读评论的帖子,也在已发记录里也不读", async () => {
  const w = world();
  const c = await w.login();
  const OWNER = { id: "1000000000000000001", screen_name: "owner_acct" };
  const POST = "3000000000000000005", MINE = "2117780000000000001";
  const ITEM = { id: "p-deep-1105", kind: "post", topic: "关停提醒", why: "测试", draft: "测试项目帖。" };
  await w.ingest({ docs: { x_posts: { posts: [{ name: "X 长文", id: POST, points: [] }] } }, outbox: [ITEM] });
  await w.call("/api/admin/outbox", { method: "POST", body: { id: ITEM.id, status: "已发" }, cookie: c });
  await w.call("/api/admin/outbox", { method: "POST", body: { id: ITEM.id, reply_url: "https://x.com/owner_acct/status/" + MINE }, cookie: c });
  // 8 层:第 1 层回帖子,第 n 层回第 n-1 层;倒着给
  const lv = (n) => String(2117790000000000000n + BigInt(n));
  const chain = Array.from({ length: 8 }, (_, i) => ({ id: lv(i + 1), text: "l" + (i + 1), author: { id: String(6000 + i), screen_name: "d" + i }, replying_to: { status: i === 0 ? POST : lv(i) }, created_timestamp: 1793760000 + i }));
  const asked = [];
  w.fetchImpl = async (u) => {
    const id = String(u).split("/").pop();
    asked.push(id);
    return new Response(JSON.stringify({ status: { id, author: OWNER, replies: 8 }, replies: id === POST ? chain.slice().reverse() : [] }));
  };
  let r = await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c });
  assert.equal(r.json.newReplies, 8);
  assert.ok(asked.includes(MINE), "项目帖贴了链接,读它");
  // 管理员停了读项目帖的评论:就算它也在已发记录里,也不读
  await w.call("/api/admin/watch", { method: "POST", body: { id: MINE, on: false }, cookie: c });
  w.clock += 121000;
  asked.length = 0;
  r = await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.ok(!asked.includes(MINE), "停了就不读");
});

test("删过的评论再多也挡不住别的:更早的那条照样收;我们回了、但那条评论这次没返回,收件里的也照样标已回复;计数按实际写进去的", async () => {
  const w = world();
  const c = await w.login();
  const OWNER = { id: "1000000000000000001", screen_name: "owner_acct" };
  const POST = "3000000000000000005";
  await w.ingest({ docs: { x_posts: { posts: [{ name: "X 长文", id: POST, points: [] }] } } });
  const id = (k) => String(2117000000000000000n + BigInt(k));
  const cm = (k, to = POST) => ({ id: id(k), text: "t" + k, author: { id: String(8000 + k), screen_name: "u" + k }, replying_to: { status: to } });
  // 新的 150 条都按要求删过(gone),最早的第 0 条没删
  for (let k = 1; k <= 150; k++) await (await goneStmt(w.db, id(k), w.now())).run();
  let replies = Array.from({ length: 151 }, (_, k) => cm(k));
  w.fetchImpl = async () => new Response(JSON.stringify({ status: { id: POST, author: OWNER, replies: replies.length }, replies }));
  let r = await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c });
  assert.equal(r.json.newReplies, 1);
  assert.deepEqual((await w.call("/api/admin/state", { cookie: c })).json.inbox.map((x) => x.id), [id(0)]);
  // 第 0 条收件里已经有;这次只返回我们回它的那条,第 0 条本身没返回:照样标已回复
  w.clock += 121000;
  replies = [{ id: id(900), text: "我们回的", author: OWNER, replying_to: { status: id(0) } }];
  r = await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c });
  assert.equal(r.json.marked, 1);
  const it = (await w.call("/api/admin/state", { cookie: c })).json.inbox[0];
  assert.equal(it.replied, true);
  assert.equal(it.mine.yourReply, "我们回的");
  // 查重之后、写之前,投递先把同一条写进去了:刷新这条写进去 0 行,也就不算新评论
  w.clock += 121000;
  replies = [cm(1000)];
  const raw = w.db;
  let raced = false;
  w.db = { prepare: (sql) => raw.prepare(sql), batch: async (ss) => {
    if (!raced && ss.some((x) => /INSERT INTO inbox/.test(x.sql || ""))) { raced = true; await raw.prepare("INSERT INTO inbox (id, mine, text, created_at, updated_at, purge_after) VALUES (?, '{}', 'x', ?, ?, ?)").bind(id(1000), "t", "t", "2099-01-01").run(); }
    return raw.batch(ss);
  } };
  r = await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c });
  w.db = raw;
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.newReplies, 0);
});

test("帖子底下:别人 A → 我们回 A(B)→ C 又回我们,C 收进来;我们另一个账号回的不当别人的评论,还把它回的那条标成已回复", async () => {
  const w = world();
  const c = await w.login();
  const BIG = { id: "1000000000000000001", screen_name: "big_acct" }, PROJ = { id: "1000000000000000002", screen_name: "proj_acct" };
  const P1 = "3000000000000000005", P2 = "3000000000000000006";
  await w.ingest({ docs: { x_posts: { posts: [{ name: "大号帖", id: P1, points: [] }, { name: "项目帖", id: P2, points: [] }] } } });
  const A = "2117000000000000001", B = "2117000000000000002", C = "2117000000000000003", D = "2117000000000000004", E = "2117000000000000005";
  w.fetchImpl = async (u) => {
    const id = String(u).split("/").pop();
    if (id === P1) return new Response(JSON.stringify({ status: { id, author: BIG, replies: 4 }, replies: [
      { id: A, text: "怎么取?", author: { id: "9001", screen_name: "user_a" }, replying_to: { status: P1 } },
      { id: B, text: "看官方取款页", author: BIG, replying_to: { status: A } },
      { id: C, text: "谢谢,还是不行", author: { id: "9003", screen_name: "user_c" }, replying_to: { status: B } },
      { id: E, text: "我们项目号回的", author: PROJ, replying_to: { status: D } },
      { id: D, text: "另一个问题", author: { id: "9004", screen_name: "user_d" }, replying_to: { status: P1 } },
    ] }));
    return new Response(JSON.stringify({ status: { id, author: PROJ, replies: 0 }, replies: [] }));
  };
  // 第一次:认出两个账号(大号帖、项目帖的发帖人);第二次项目号就算我们的了
  await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c });
  w.clock += 121000;
  await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c });
  const inbox = (await w.call("/api/admin/state", { cookie: c })).json.inbox;
  const ids = inbox.map((x) => x.id).sort();
  assert.ok(ids.includes(C), "C 回的是我们那条 B,收进来");
  assert.ok(!ids.includes(B) && !ids.includes(E), "我们自己的(大号、项目号)不进收件");
  assert.equal(inbox.find((x) => x.id === D).replied, true, "项目号回了 D,D 标已回复");
  assert.equal(inbox.find((x) => x.id === A).replied, true, "大号回了 A,A 标已回复");
});

test("一次刷新最坏情况:fetch 加数据库查询不超过 50 个(免费计划的上限)", async () => {
  const w = world();
  const c = await w.login();
  const OWNER = { id: "1000000000000000001", screen_name: "owner_acct" };
  const posts = Array.from({ length: 10 }, (_, i) => ({ name: "帖子 " + i, id: "30000000000000001" + String(i).padStart(2, "0"), points: [] }));
  const tid = (i) => "21160000000000003" + String(i).padStart(2, "0");
  const items = Array.from({ length: 40 }, (_, i) => OUT({ id: "r-y-" + i, target: { ...TARGET, id: tid(i), url: "https://x.com/someone/status/" + tid(i) } }));
  await w.ingest({ docs: { x_posts: { posts } }, outbox: items });
  for (const it of items) await w.call("/api/admin/outbox", { method: "POST", body: { id: it.id, status: "已发" }, cookie: c });
  w.clock += 1000;
  await w.ingest({ outbox: items.slice(0, 30).map((it, i) => ({ ...it, replyUrl: "https://x.com/owner_acct/status/22160000000000002" + String(i).padStart(2, "0") })) });
  let fetches = 0;
  w.fetchImpl = async (u) => {
    fetches++;
    const id = String(u).split("/").pop();
    const replies = Array.from({ length: 200 }, (_, k) => ({ id: id.slice(0, 15) + String(1000 + k), text: "c" + k, author: { id: String(900 + k), screen_name: "v" + k }, replying_to: { status: id }, created_timestamp: 1793750000 + k }));
    return new Response(JSON.stringify({ status: { id, author: OWNER, views: 1, replies: 200 }, replies }));
  };
  const raw = w.db;
  let queries = 0;
  const wrap = (st) => ({ inner: st, bind: (...a) => wrap(st.bind(...a)), first: (...a) => { queries++; return st.first(...a); }, all: () => { queries++; return st.all(); }, run: () => { queries++; return st.run(); } });
  w.db = { prepare: (sql) => wrap(raw.prepare(sql)), batch: (ss) => { queries++; return raw.batch(ss.map((x) => x.inner)); } };
  const r = await w.task({ do: "sync" });
  w.db = raw;
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(fetches, MAX_FETCH);
  assert.ok(fetches + queries <= 50, `fetch ${fetches} + 查库 ${queries} = ${fetches + queries}`);
});

test("30 天到期:评论整行删掉、编号只留哈希,只留不带账号的需求摘要;再投递也收不回来", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ inbox: [{ id: "3000000000000000004", source: "X 长文", author: "user_b", url: "https://x.com/user_b/status/3000000000000000004", text: "@某个机器人 画个图", type: "提问", need: "想看行情数据", suggestion: "不采纳", draft: "数据已经有人答了" }], outbox: [OUT({ draft: "@someone 步骤在 defiexit.com/r/woofi 。" })] });
  await w.call("/api/admin/inbox", { method: "POST", body: { id: "3000000000000000004", note: "这人是 user_b", decision: "不采纳" }, cookie: c });
  await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-openeden-1", status: "已发" }, cookie: c });
  w.clock += 31 * 864e5;
  const c2 = (await w.call("/api/admin/login", { method: "POST", body: { name: "admin1", password: PW } })).headers.get("Set-Cookie").split(";")[0];
  let st = (await w.call("/api/admin/state", { cookie: c2 })).json;
  assert.equal(st.inbox.length, 0);
  assert.equal(st.needs.length, 1);
  assert.deepEqual({ ...st.needs[0], month: undefined }, { month: undefined, source: "X 长文", type: "提问", need: "想看行情数据", suggestion: "不采纳", decision: "不采纳" });
  assert.equal(JSON.stringify(st.needs).includes("user_b"), false);
  assert.equal((await w.db.prepare("SELECT COUNT(*) AS n FROM gone WHERE id = '3000000000000000004'").first()).n, 0); // 存的是哈希
  const o = st.outbox[0];
  assert.equal(o.mine.target.handle, undefined);
  assert.equal(o.mine.target.url, undefined);
  assert.equal(o.mine.target.id, undefined);
  assert.equal(o.mine.target.protocol, "OpenEden");
  assert.equal(o.mine.draft.includes("@someone"), false);
  assert.equal(o.sent_text.includes("@someone"), false);
  w.clock += 1000;
  const r = await w.ingest({ inbox: [{ id: "3000000000000000004", text: "又送来一遍原文", author: "user_b" }] });
  assert.match(r.json.rejected[0].why, /删过/);
  st = (await w.call("/api/admin/state", { cookie: c2 })).json;
  assert.equal(st.inbox.length, 0);
});

test("草稿里的链接:带协议的、IP、中文域名都拦;本站的放行", () => {
  assert.equal(checkText("在defiexit.com上查一下"), null);
  assert.equal(checkText("https://defiexit.com/r/woofi/"), null);
  assert.match(checkText("http://defiexit.com/r/woofi/"), /站外链接/); // 只认 https
  assert.match(checkText("打开 http://1.2.3.4/claim"), /站外|IP|claim/);
  assert.match(checkText("访问 1.2.3.4 就行"), /IP/);
  assert.match(checkText("访问 例子.中国 就行"), /中文域名/);
  assert.match(checkText("ftp://files.example.org/a"), /站外链接/);
  assert.match(checkText("看 xn--fiqs8s.xn--fiqz9s"), /站外链接/);
  assert.match(checkText("去 app.uniswap.org 撤"), /站外链接/);
  assert.equal(checkText("取出 0.5 个 ETH,大约 1.2 美元;版本 1.2.3"), null);
});

test("看板数据格式不对:整项不收,页面不会坏", async () => {
  const w = world();
  const r = await w.ingest({ docs: { funnel: { target: 5, stages: {} }, goal_1215: { deadline: "12-15", items: [] }, summary: { asks: [{ text: "x", href: "javascript:alert(1)" }] }, protocols: { rows: [{ protocol: "A", posts: -1 }] } } });
  assert.deepEqual(r.json.rejected.map((x) => x.id).sort(), ["funnel", "goal_1215", "protocols", "summary"]);
  assert.equal(r.json.docs, 0);
});

test("按要求删掉一条;帖子可以停止读评论", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ inbox: [{ id: "3000000000000000004", text: "x", author: "a" }] });
  assert.equal((await w.call("/api/admin/delete", { method: "POST", body: { kind: "inbox", id: "3000000000000000004" }, cookie: c })).status, 200);
  assert.equal((await w.call("/api/admin/state", { cookie: c })).json.inbox.length, 0);
  assert.equal((await w.call("/api/admin/delete", { method: "POST", body: { kind: "admin", id: "1" }, cookie: c })).status, 400);
  await w.call("/api/admin/watch", { method: "POST", body: { id: "3000000000000000005", on: false }, cookie: c });
  assert.deepEqual((await w.call("/api/admin/state", { cookie: c })).json.watchOff, ["3000000000000000005"]);
});

// ---------- 代码审查复现过的问题(修了以后留着防回归) ----------
import { failed, mustWait } from "../server/ops/auth.js";
import { sync, MAX_FETCH } from "../server/ops/sync.js";
import { ensure, putDoc, goneStmt } from "../server/ops/db.js";

test("投递一次只处理一包:锁着就回 busy;锁超过 60 秒算失效", async () => {
  const w = world();
  await w.ingest({ docs: {} }); // 建表
  await w.db.prepare("INSERT INTO kv (k, v) VALUES ('ingest_lock', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(w.clock)).run();
  assert.equal((await w.ingest({ docs: {} }, { ts: w.clock + 1 })).json.error, "busy");
  await w.db.prepare("UPDATE kv SET v = ? WHERE k = 'ingest_lock'").bind(String(w.clock - 61000)).run();
  assert.equal((await w.ingest({ docs: {} }, { ts: w.clock + 2 })).status, 200);
  assert.equal(await w.db.prepare("SELECT v FROM kv WHERE k = 'ingest_lock'").first(), null); // 用完就放
});

test("投递读完状态、还没写的时候管理员点了「已发」:草稿不被改", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ outbox: [OUT()] });
  // 包一层库:投递刚读完待发的状态,就让管理员点「已发」
  const real = w.db;
  const sneaky = {
    prepare(sql) {
      const st = real.prepare(sql);
      if (!sql.startsWith("SELECT id, mine, status, purged FROM outbox")) return st;
      return { bind: (...a) => ({ all: async () => { const r = await st.bind(...a).all(); await real.prepare("UPDATE outbox SET status = '已发' WHERE id = ?").bind("r-openeden-1").run(); return r; } }) };
    },
    batch: (s) => real.batch(s),
  };
  w.clock += 1000;
  const raw = JSON.stringify({ v: 1, ts: w.clock, nonce: randomUUID().replace(/-/g, ""), outbox: [OUT({ draft: "在途的新草稿" })] });
  const sig = sign(null, Buffer.from(signedText("production", "POST", "/api/admin/ingest", raw)), PROD.privateKey).toString("base64url");
  const r = await handle(new Request(HOST + "/api/admin/ingest", { method: "POST", headers: { "X-DX-Sig": sig }, body: raw }), baseEnv(sneaky), w.edge, w.now());
  assert.equal(r.status, 200);
  const item = (await w.call("/api/admin/state", { cookie: c })).json.outbox[0];
  assert.equal(item.status, "已发");
  assert.equal(item.mine.draft, OUT().draft);
});

test("到期删过的待发:回复链接不能再写回", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ outbox: [OUT()] });
  await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-openeden-1", status: "已发" }, cookie: c });
  w.clock += 31 * 864e5;
  const c2 = (await w.call("/api/admin/login", { method: "POST", body: { name: "admin1", password: PW } })).headers.get("Set-Cookie").split(";")[0];
  await w.call("/api/admin/state", { cookie: c2 }); // 触发到期删除
  const r = await w.ingest({ outbox: [OUT({ replyUrl: "https://x.com/owner_acct/status/2116000000000000002" })] });
  assert.match(r.json.rejected[0].why, /处理过/);
  assert.equal((await w.call("/api/admin/state", { cookie: c2 })).json.outbox[0].reply_url, null);
});

test("按要求删掉的评论:刷新不再收进来,投递也不收", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ docs: { x_posts: { posts: [{ name: "X 长文", id: "3000000000000000005", points: [] }] } } });
  w.fetchImpl = async () => new Response(JSON.stringify({ status: { id: "3000000000000000005", author: { id: "1", screen_name: "owner_acct" }, replies: 1 }, replies: [{ id: "3000000000000000009", text: "hi", author: { id: "9", screen_name: "visitor" } }] }));
  assert.equal((await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c })).json.newReplies, 1);
  await w.call("/api/admin/delete", { method: "POST", body: { kind: "inbox", id: "3000000000000000009" }, cookie: c });
  w.clock += 121000;
  assert.equal((await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c })).json.newReplies, 0);
  assert.equal((await w.call("/api/admin/state", { cookie: c })).json.inbox.length, 0);
  w.clock += 1000;
  const r = await w.ingest({ inbox: [{ id: "3000000000000000009", text: "hi", author: "visitor" }] });
  assert.match(r.json.rejected[0].why, /删过/);
});

test("同一时刻连错 20 次:次数照样累加,要等", async () => {
  const db = new LocalD1();
  await ensure(db);
  const now = new Date("2026-11-03T10:00:00Z");
  await Promise.all(Array.from({ length: 20 }, () => failed(db, "203.0.113.9", now)));
  assert.equal((await db.prepare("SELECT n FROM fails").first()).n, 20);
  assert.ok((await mustWait(db, "203.0.113.9", now)) > 0);
});

test("刷新读到 200 条评论:查库次数不跟着涨", async () => {
  const db = new LocalD1();
  await ensure(db);
  const now = new Date("2026-11-03T10:00:00Z");
  await putDoc(db, "x_posts", { posts: [{ id: "1234", name: "our-post", points: [] }] }, now);
  let calls = 0;
  const counted = {
    prepare(sql) {
      const wrap = (st) => ({ inner: st, bind: (...a) => wrap(st.bind(...a)), first: (...a) => { calls++; return st.first(...a); }, all: () => { calls++; return st.all(); }, run: () => { calls++; return st.run(); } });
      return wrap(db.prepare(sql));
    },
    batch: (s) => { calls++; return db.batch(s.map((x) => x.inner)); },
  };
  const replies = Array.from({ length: 200 }, (_, i) => ({ id: String(2000 + i), text: "c", author: { id: "9", screen_name: "visitor" } }));
  const r = await sync(counted, edgeFetch(async () => new Response(JSON.stringify({ status: { id: "1234", author: { id: "1", screen_name: "owner" }, replies: 200 }, replies }))), now);
  assert.equal(r.body.newReplies, 100); // 一次最多收 100 条(最新的在前),剩下的下次再收
  assert.ok(calls <= 20, "查库 " + calls + " 次");
});

test("一次性设置链接:没有管理员时才收;有效期内能设一次,用过作废;过期不认", async () => {
  const { createHash } = await import("node:crypto");
  const hexOf = (t) => createHash("sha256").update(t).digest("hex");
  const w = world();
  const env = { SETUP_CODE: "" };
  assert.equal((await w.call("/api/admin/setup", { method: "POST", body: { code: "x", name: "admin1", password: PW }, env })).json.error, "nocode");
  const token = "tok_" + "a".repeat(40);
  const r = await w.ingest({ setup: { hash: hexOf(token), hours: 24 } });
  assert.equal(r.json.setup, true);
  assert.equal((await w.call("/api/admin/setup", { method: "POST", body: { code: "wrong-wrong-wrong-wrong", name: "admin1", password: PW }, env })).json.error, "code");
  const ok = await w.call("/api/admin/setup", { method: "POST", body: { code: token, name: "admin1", password: PW }, env });
  assert.equal(ok.status, 200);
  assert.equal(await w.db.prepare("SELECT v FROM kv WHERE k = 'setup_hash'").first(), null); // 用过就删
  w.clock += 1000;
  const again = await w.ingest({ setup: { hash: hexOf("other"), hours: 24 } });
  assert.match(again.json.rejected[0].why, /已经有管理员/);
  // 过期
  const w2 = world();
  await w2.ingest({ setup: { hash: hexOf(token), hours: 1 } });
  w2.clock += 2 * 3600e3;
  assert.equal((await w2.call("/api/admin/setup", { method: "POST", body: { code: token, name: "admin1", password: PW }, env })).json.error, "nocode");
});
