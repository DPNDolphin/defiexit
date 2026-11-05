// 运营台(functions/api/admin、functions/admin、server/ops、admin/pace.js):用本地 SQLite 当 D1、用假的 fxtwitter 测。不连 Cloudflare、不连 X。
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
import { capOf, gate, waitText, paceNote } from "../admin/pace.js";
import { handle as hit } from "../functions/api/hit.js";

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
// 对人的首回不带任何链接、域名(回复写法 11-05)
const OUT = (over = {}) => ({ id: "r-openeden-1", target: TARGET, why: "原帖写明自己的钱卡在到期金库", draft: "到期金库可以在官方合约上自己取出,不用等官网的按钮。我们不会主动找你,也不会要你的钱包信息。", ...over });

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

test("管理员改的草稿也过一样的检查:不许敏感词;对人的首回一个链接都不许(连本站也不许),项目帖只许本站链接", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ outbox: [OUT(), { id: "p-edit-1106", kind: "post", topic: "关停提醒", why: "测试", draft: "测试项目帖。" }] });
  const edit = (id, draft) => w.call("/api/admin/outbox", { method: "POST", body: { id, draft }, cookie: c });
  const bad = await edit("r-openeden-1", "去 https://evil.example/claim 领");
  assert.equal(bad.json.error, "draftbad");
  assert.ok(bad.json.why);
  const site = await edit("r-openeden-1", "步骤在 defiexit.com/r/woofi 。");
  assert.equal(site.json.error, "draftbad");
  assert.match(site.json.why, /对人的首回一个都不带/);
  assert.equal((await edit("r-openeden-1", "到期金库可以在官方合约上自己取出。")).json.item.draft_admin, "到期金库可以在官方合约上自己取出。");
  assert.equal((await edit("p-edit-1106", "步骤在 defiexit.com/r/woofi 。")).json.item.draft_admin, "步骤在 defiexit.com/r/woofi 。");
  assert.equal((await edit("p-edit-1106", "去 app.uniswap.org 撤")).json.error, "draftbad");
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
  assert.deepEqual(Object.keys(again.json).sort(), ["docs", "inbox", "ok", "outbox", "problems", "receipt", "rejected", "setup"]);
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

test("项目帖引用官方原帖:只收 x.com 原帖链接、只许项目帖带;草稿里照样不许别的链接;到期连同引用一起删", async () => {
  const w = world();
  const c = await w.login();
  const QUOTE = "https://x.com/Scroll_ZKP/status/2117620208819167673";
  const POST = (over = {}) => ({ id: "p-scroll-1106", kind: "post", topic: "迁移提醒 · Scroll", quote: QUOTE, why: "官方提案", draft: "Scroll 提案:$SCR 迁到以太坊主网,要 DAO 投票。", ...over });
  const r = await w.ingest({ outbox: [
    POST(),
    POST({ id: "p-bad-q1", quote: "https://evil.example/Scroll_ZKP/status/1" }),
    POST({ id: "p-bad-q2", quote: "https://x.com/Scroll_ZKP" }),
    POST({ id: "p-bad-q3", quote: "http://x.com/Scroll_ZKP/status/2117620208819167673" }),
    POST({ id: "p-bad-q4", quote: QUOTE, draft: "看这里 " + QUOTE }),
    OUT({ id: "r-bad-q5", quote: QUOTE }),
  ] });
  assert.equal(r.json.outbox, 1);
  assert.deepEqual(r.json.rejected.map((x) => x.id), ["p-bad-q1", "p-bad-q2", "p-bad-q3", "p-bad-q4", "r-bad-q5"]);
  assert.match(r.json.rejected[0].why, /引用的原帖链接不合格/);
  assert.match(r.json.rejected[3].why, /站外链接/);
  assert.match(r.json.rejected[4].why, /回帖不能带引用/);
  let st = (await w.call("/api/admin/state", { cookie: c })).json;
  assert.equal(st.outbox.find((x) => x.id === "p-scroll-1106").mine.quote, QUOTE);
  const sent = await w.call("/api/admin/outbox", { method: "POST", body: { id: "p-scroll-1106", status: "已发" }, cookie: c });
  assert.equal(sent.json.item.sent_text, POST().draft);
  // 30 天到期:目标帖子的账号信息一律删,引用的原帖也一样
  w.clock += 31 * 864e5;
  const c2 = (await w.call("/api/admin/login", { method: "POST", body: { name: "admin1", password: PW } })).headers.get("Set-Cookie").split(";")[0];
  st = (await w.call("/api/admin/state", { cookie: c2 })).json;
  const q = st.outbox.find((x) => x.id === "p-scroll-1106");
  assert.equal(q.purged, true);
  assert.equal(q.mine.quote, undefined);
  assert.equal(q.mine.draft, POST().draft);
});

test("引用的原帖建好以后不能换、不能去掉;原来没有的,老板没改过草稿才能补", async () => {
  const w = world();
  const c = await w.login();
  const Q1 = "https://x.com/Scroll_ZKP/status/2117620208819167673", Q2 = "https://x.com/Scroll_ZKP/status/2117620210727579787";
  const POST = (over = {}) => ({ id: "p-q-1106", kind: "post", topic: "迁移提醒", why: "测试", draft: "Scroll 提案:$SCR 迁到以太坊主网。", ...over });
  const push = async (items) => { w.clock += 1000; return (await w.ingest({ outbox: items })).json; };
  const quoteNow = async (id) => (await w.call("/api/admin/state", { cookie: c })).json.outbox.find((x) => x.id === id).mine.quote;
  // 旧版建的(没有引用),老板没改草稿:能补上
  assert.equal((await push([POST()])).outbox, 1);
  assert.deepEqual((await push([POST({ quote: Q1 })])).rejected, []);
  assert.equal(await quoteNow("p-q-1106"), Q1);
  // 有了以后:换成别的、去掉,都不收;同一条照样能改别的字段
  let r = await push([POST({ quote: Q2 }), POST({ id: "p-q-1106" })]);
  assert.deepEqual(r.rejected.map((x) => x.why), ["引用的原帖建好以后不能换", "引用的原帖建好以后不能换"]);
  assert.deepEqual((await push([POST({ quote: Q1, why: "改了理由" })])).rejected, []);
  assert.equal(await quoteNow("p-q-1106"), Q1);
  // 没有引用的,老板改过草稿:不能再补(他的字可能和原帖对不上)
  assert.equal((await push([POST({ id: "p-q2-1106" })])).outbox, 1);
  const ed = await w.call("/api/admin/outbox", { method: "POST", body: { id: "p-q2-1106", draft: "老板改过的项目帖。" }, cookie: c });
  assert.equal(ed.status, 200, JSON.stringify(ed.json));
  r = await push([POST({ id: "p-q2-1106", quote: Q1 })]);
  assert.deepEqual(r.rejected.map((x) => x.why), ["引用的原帖建好以后不能换"]);
  assert.equal(await quoteNow("p-q2-1106"), undefined);
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

test("导出和运营台都带体检次数(hits):总数、开始数的那天、最近 60 天(北京时间)每天的数;导出的 since 不管它", async () => {
  const w = world();
  const c = await w.login();
  assert.deepEqual((await w.exp({})).json.hits, { checkup: { total: 0, since: null, byDay: {} } });
  const ping = (at) => hit(new Request(HOST + "/api/hit", { method: "POST", headers: { Origin: HOST, "Content-Type": "application/json", "Content-Length": "15" }, body: '{"k":"checkup"}' }), { OPS: w.db }, new Date(at));
  // 现在是北京 11-03 18:00:最近 60 天从 09-05 算起;11-02 16:01(UTC)已经是北京 11-03
  for (const at of ["2026-09-01T02:00:00Z", "2026-11-02T15:59:00Z", "2026-11-02T16:01:00Z", "2026-11-03T09:00:00Z"]) assert.equal((await ping(at)).status, 204);
  w.clock += 1000;
  const r = await w.exp({ since: "2026-11-03T00:00:00Z" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.hits, { checkup: { total: 4, since: "2026-09-01", byDay: { "2026-11-02": 1, "2026-11-03": 2 } } });
  const st = await w.call("/api/admin/state", { cookie: c });
  assert.deepEqual(st.json.hits, r.json.hits);
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
  await w.ingest({ inbox: [{ id: "3000000000000000004", source: "X 长文", author: "user_b", url: "https://x.com/user_b/status/3000000000000000004", text: "@某个机器人 画个图", type: "提问", need: "想看行情数据", suggestion: "不采纳", draft: "数据已经有人答了" }], outbox: [OUT({ draft: "@someone 到期金库可以在官方合约上自己取出。" })] });
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
  assert.equal(checkText("在 defiexit.com 上查一下"), null);
  assert.match(checkText("在defiexit.com上查一下"), /可疑网址「defiexit\.com」/); // 紧挨着汉字:真正的网址比它长,前后要空开
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

// ---------- 扩大可回复范围(决策记录 11-05):草稿链接分三种、运营规则、每天放出的上限、发送节奏 ----------
test("草稿里的链接分三种:对人的首回一个都不许(连 defiexit.com 也不许);项目帖照旧只许本站;收件续答照旧许本站", async () => {
  const w = world();
  await w.login();
  const tg = (n) => ({ ...TARGET, id: "21160000000000005" + n, url: "https://x.com/someone/status/21160000000000005" + n });
  const POST = (over = {}) => ({ id: "p-link-1106", kind: "post", topic: "关停提醒", why: "测试", draft: "官方取款页的步骤在 defiexit.com/r/woofi 。", ...over });
  const r = await w.ingest({
    outbox: [
      OUT({ id: "r-link-1", target: tg("01"), draft: "步骤在 defiexit.com/r/woofi 。" }),
      OUT({ id: "r-link-2", target: tg("02"), draft: "看 https://defiexit.com/r/woofi/" }),
      OUT({ id: "r-link-3", target: tg("03"), draft: "去 www.defiexit.com 查" }),
      OUT({ id: "r-link-4", target: tg("04"), draft: "官方入口在 app.example.org 。" }),
      OUT({ id: "r-ok-5", target: tg("05") }),
      POST(),
      POST({ id: "p-link-2", draft: "去 app.example.org 撤" }),
    ],
    inbox: [{ id: "3000000000000000401", text: "钱还在里面,怎么取?", author: "user_q", draft: "步骤在 defiexit.com/r/woofi 。" }],
  });
  assert.deepEqual(r.json.rejected.map((x) => x.id), ["r-link-1", "r-link-2", "r-link-3", "r-link-4", "p-link-2"]);
  for (const x of r.json.rejected.slice(0, 3)) assert.match(x.why, /^草稿含链接或域名「(www\.)?defiexit\.com」\(对人的首回一个都不带,连 defiexit\.com 也不带\)$/);
  assert.match(r.json.rejected[3].why, /含链接或域名「app\.example\.org」/);
  assert.match(r.json.rejected[4].why, /含站外链接「app\.example\.org」/);
  assert.deepEqual([r.json.outbox, r.json.inbox], [2, 1]);
  assert.equal(checkText("到期金库可以自己取出", undefined, []), null);
  assert.match(checkText("访问 1.2.3.4 就行", undefined, []), /IP/);
  assert.match(checkText("可以私信我", undefined, []), /私信/);
});

test("长得像的写法绕不过去(三种规矩都一样):英文之间的「。」「．」「｡」、全角字母照网址查;英文网址紧挨着别的字母、数字、附加符号、连字号不收;正常的中文句号照旧", () => {
  const REPLY = [], POST = ["defiexit.com", "www.defiexit.com"], IN = [...POST, "blast.io"];
  // 看着像点的,换成点再查:首回一个都不许,项目帖只许本站,续答只许名单里的
  for (const s of ["evil。com", "evil．com", "evil｡com", "ｅｖｉｌ．ｃｏｍ", "https：／／evil．com"]) {
    assert.match(checkText("去 " + s + " 看", undefined, REPLY), /含链接或域名「evil\.com」/, s);
    assert.match(checkText("去 " + s + " 看", undefined, POST), /含站外链接「evil\.com」/, s);
    assert.match(checkText("去 " + s + " 看", undefined, IN), /含站外链接「evil\.com」/, s);
  }
  assert.match(checkText("访问 1。2。3。4 就行"), /IP/);
  // 换完就是名单里的那个:照样放行
  for (const s of ["blast。io", "ｂｌａｓｔ．ｉｏ"]) assert.equal(checkText("官方页面是 " + s + " 。", undefined, IN), null, s);
  assert.equal(checkText("在 defiexit。com 上查", undefined, POST), null);
  // 紧挨着别的字母、数字、附加符号、连字号:真正的主机名比看上去的长(éblast.io 其实是 xn--blast-9ra.io),名单里有也不收
  for (const s of ["éblast.io", "e\u0301blast.io", "官网blast.io上", "官网blast.io", "\u0661blast.io", "é-blast.io", "blast.ioé", "x\u0334blast.io", "blast.io\u0301"]) {
    assert.match(checkText("去 " + s + " 看", undefined, IN), /可疑网址/, s);
    assert.notEqual(checkText("去 " + s + " 看", undefined, POST), null, s);
    assert.notEqual(checkText("去 " + s + " 看", undefined, REPLY), null, s);
  }
  // 正常的中文句号、标点不受影响
  for (const s of ["钱还在 Lisk。官方入口在官方 X 上。", "我们不会主动找你。钱包信息不要给任何人。", "取出0.5个ETH,1.2美元", "版本1.2.3已经发布", "U.S. 的用户"]) {
    for (const hosts of [REPLY, POST, IN]) assert.equal(checkText(s, undefined, hosts), null, s);
  }
  for (const s of ["官方页面是 blast.io。不要点别的链接。", "去官方页面。blast.io 上看"]) assert.equal(checkText(s, undefined, IN), null, s);
  // 代价:英文、「。」、英文连着写,会当成网址(写成「Withdraw。 Scroll」或中间夹汉字)
  assert.match(checkText("点 Withdraw。Scroll 那边", undefined, REPLY), /「withdraw\.scroll」/);
});

test("新规矩以前收进库里的、带链接的首回:照常显示、照常能点;再送来的改动才按新规矩查", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ docs: {} }); // 建表
  const OLD = "步骤在 defiexit.com/r/woofi 。", t = new Date(w.clock).toISOString();
  await w.db.prepare("INSERT INTO outbox (id, mine, created_at, updated_at, purge_after) VALUES (?, ?, ?, ?, ?)").bind("r-old-1104", JSON.stringify({ target: TARGET, why: "旧的", draft: OLD }), t, t, "2099-01-01T00:00:00.000Z").run();
  const mineOf = async () => (await w.call("/api/admin/state", { cookie: c })).json.outbox.find((x) => x.id === "r-old-1104");
  assert.equal((await mineOf()).mine.draft, OLD);
  w.clock += 1000;
  assert.match((await w.ingest({ outbox: [OUT({ id: "r-old-1104", draft: OLD })] })).json.rejected[0].why, /含链接或域名/);
  assert.equal((await mineOf()).mine.draft, OLD, "不收的那次不动库里的");
  const sent = await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-old-1104", status: "已发" }, cookie: c });
  assert.equal(sent.status, 200, JSON.stringify(sent.json));
  assert.equal(sent.json.item.sent_text, OLD);
});

test("收件续答:本站以外只放行运营规则里列的官方网址(主机名一模一样,带协议的只认 https);首回和项目帖不认这份名单;敏感词照旧", async () => {
  const w = world();
  const c = await w.login();
  const IN = (n, draft) => ({ id: "30000000000000005" + n, text: "钱还在里面,怎么取?", author: "user_" + n, draft });
  const push = async (payload) => { w.clock += 1000; return (await w.ingest(payload)).json; };
  // 还没有运营规则:官方网址也不收
  let r = await push({ inbox: [IN("01", "官方页面在 https://blast.io/ 。")] });
  assert.match(r.rejected[0].why, /含站外链接「blast\.io」/);
  // 规则和草稿同一包:按这一包的规则查
  r = await push({ docs: { rules: { dailyReplyCap: 15, officialHosts: ["blast.io", "withdraw.example.org"] } }, inbox: [IN("02", "官方页面在 https://blast.io/withdraw 。"), IN("03", "去 blast.io 看看"), IN("04", "官方页面:https://withdraw.example.org/x?y=1")] });
  assert.deepEqual([r.rejected, r.inbox], [[], 3]);
  // 之后的包不带规则:按库里的;子域名、后缀、前缀、http、借道 @ 和路径的,都不算
  const tricks = ["blast.io.evil.com", "xblast.io", "https://blast.io.evil.com/", "https://xblast.io/", "http://blast.io/", "https://blast.io@evil.com/", "https://evil.com/blast.io", "app.blast.io", "withdraw.example.org.evil.com", "example.org"];
  r = await push({ inbox: [IN("05", "去 BLAST.IO 看看"), ...tricks.map((s, i) => IN(String(10 + i), "官方页面 " + s))] });
  assert.equal(r.inbox, 1);
  assert.deepEqual(r.rejected.map((x) => x.id), tricks.map((s, i) => "30000000000000005" + (10 + i)));
  for (const x of r.rejected) assert.match(x.why, /含站外链接/, x.id);
  // 名单只给续答用:对人的首回、项目帖照旧
  r = await push({ outbox: [OUT({ draft: "官方页面在 blast.io 。" }), { id: "p-blast-1106", kind: "post", topic: "提醒", why: "测试", draft: "官方页面在 blast.io 。" }] });
  assert.deepEqual(r.rejected.map((x) => x.id), ["r-openeden-1", "p-blast-1106"]);
  // 敏感词照旧:名单里有也写不进去(名单换成只有这一个,blast.io 就不在了)
  r = await push({ docs: { rules: { officialHosts: ["claim.example.org"] } }, inbox: [IN("06", "官方页面在 claim.example.org")] });
  assert.match(r.rejected[0].why, /含不许用的词「claim」/);
  // 不合格的规则不收,也不会放宽名单:还按库里的
  r = await push({ docs: { rules: { dailyReplyCap: 99, officialHosts: ["blast.io"] } }, inbox: [IN("07", "去 blast.io 看看")] });
  assert.deepEqual(r.rejected.map((x) => [x.kind, x.id]), [["doc", "rules"], ["inbox", "3000000000000000507"]]);
  // 名单里去掉以后:库里已有的照常显示,再送来不收
  const st = (await w.call("/api/admin/state", { cookie: c })).json;
  assert.equal(st.inbox.find((x) => x.id === "3000000000000000502").mine.draft, "官方页面在 https://blast.io/withdraw 。");
  r = await push({ inbox: [IN("02", "官方页面在 https://blast.io/withdraw 。")] });
  assert.match(r.rejected[0].why, /含站外链接「blast\.io」/);
});

test("运营规则(rules):上限只收 1–50 的整数,官方网址只收小写主机名、最多 200 个;不合格整份不收、库里的照旧;没送过就按 15", async () => {
  const w = world();
  const c = await w.login();
  const state = async () => (await w.call("/api/admin/state", { cookie: c })).json;
  assert.equal((await state()).docs.rules, undefined);
  assert.equal(capOf((await state()).docs.rules), 15);
  const push = async (rules) => { w.clock += 1000; return (await w.ingest({ docs: { rules } })).json; };
  const good = { dailyReplyCap: 20, officialHosts: ["blast.io", "www.example.org"], note: "11-09 升到 20", updatedAt: "2026-11-09T21:00:00+08:00" };
  assert.equal((await push(good)).docs, 1);
  const bads = [{ dailyReplyCap: 0 }, { dailyReplyCap: 51 }, { dailyReplyCap: 15.5 }, { dailyReplyCap: "20" }, { dailyReplyCap: null },
    { officialHosts: "blast.io" }, { officialHosts: ["Blast.io"] }, { officialHosts: ["https://blast.io"] }, { officialHosts: ["blast.io/x"] }, { officialHosts: ["*.blast.io"] },
    { officialHosts: ["blast"] }, { officialHosts: ["1.2.3.4"] }, { officialHosts: ["xn--80ak6aa92e.com"] }, { officialHosts: [""] },
    { officialHosts: Array.from({ length: 201 }, (_, i) => "h" + i + ".example.org") }, { note: "x".repeat(301) }, []];
  for (const bad of bads) {
    const r = await push(bad);
    assert.deepEqual([r.docs, r.rejected.map((x) => [x.kind, x.id])], [0, [["doc", "rules"]]], JSON.stringify(bad).slice(0, 80));
  }
  const st = await state();
  assert.deepEqual(st.docs.rules, good);
  assert.equal(capOf(st.docs.rules), 20);
  // 页面那边也兜一层:读出来不像样的按 15
  for (const r of [null, {}, { dailyReplyCap: 0 }, { dailyReplyCap: 51 }, { dailyReplyCap: "30" }]) assert.equal(capOf(r), 15);
  assert.equal(capOf({ dailyReplyCap: 35 }), 35);
});

test("每天放出的对人首回:按北京时间的一天数今天已发的,剩下的名额按待发的顺序给,多的排队;项目帖、跳过的、收件续答、到期删了目标的不算;过了北京零点重新数", () => {
  const reply = (id, status = "待发", decided_at = null) => ({ id, mine: { target: { id: "2116000000000000001" }, draft: "x" }, status, decided_at });
  const post = (id, status = "待发", decided_at = null) => ({ id, mine: { kind: "post", topic: "提醒", draft: "x" }, status, decided_at });
  // 30 天到期删掉了目标帖子编号的(状态可能还是待发):发不出去,不占名额,也不排队
  const purged = (id, status = "待发", decided_at = null) => ({ id, mine: { target: { protocol: "OpenEden" }, draft: "x" }, status, decided_at, purged: true });
  const done = [
    purged("old2", "已发", "2026-11-06T10:00:00.000Z"),
    reply("c", "已发", "2026-11-05T15:59:59.000Z"), // 北京 11-05 23:59:59:昨天的,不算
    reply("a", "已发", "2026-11-05T16:00:00.000Z"), // 北京 11-06 00:00:00(UTC 还是 11-05):今天的
    reply("b", "已发", "2026-11-06T15:59:00.000Z"), // 北京 11-06 23:59
    reply("d", "跳过", "2026-11-06T10:00:00.000Z"), // 跳过的不算
    post("e", "已发", "2026-11-06T10:00:00.000Z"), // 项目帖不算
    // 收件里的续答(回过了、点了决定)不算
    { id: "3000000000000000001", mine: { source: "我们的回复 · X", replyToId: "3000000000000000001", draft: "x" }, decision: "采纳", decided_at: "2026-11-06T10:00:00.000Z", replied: true, replied_at: "2026-11-06T10:00:00.000Z" },
  ];
  const pend = [purged("old1"), reply("p1"), post("p2"), reply("p3"), reply("p4")];
  const all = [...done, ...pend];
  const lastSecond = Date.parse("2026-11-06T15:59:59Z"); // 北京 11-06 23:59:59
  let g = gate(all, pend, 4, lastSecond);
  assert.deepEqual([g.cap, g.used, [...g.queued]], [4, 2, ["p4"]]); // 名额 4 - 2:p1、p3 放出,项目帖不占名额
  assert.equal(waitText(g), "排队:今天上限 4 条(已发 2 条,上面 2 条先发),明天放出");
  g = gate(all, pend, 2, lastSecond);
  assert.deepEqual([...g.queued], ["p1", "p3", "p4"]);
  assert.equal(waitText(g), "排队:今天已到上限 2 条,明天放出");
  // 北京零点一过重新数;零点整发的算新的一天
  const midnight = Date.parse("2026-11-06T16:00:00Z");
  assert.deepEqual([gate(all, pend, 2, midnight).used, [...gate(all, pend, 2, midnight).queued]], [0, ["p4"]]);
  assert.equal(gate([...all, reply("f", "已发", "2026-11-06T16:00:00.000Z")], pend, 2, midnight).used, 1);
  // 上限往下调了(已发的比上限多):剩下的全排队,不出负数
  assert.deepEqual([...gate(all, pend, 1, lastSecond).queued], ["p1", "p3", "p4"]);
});

test("30 天到期删了目标帖子编号、还挂在待发里的回复:不占当天的名额,也不排队(不然会一直挡着后面新来的)", async () => {
  const w = world();
  await w.login();
  await w.ingest({ outbox: [OUT()] });
  w.clock += 31 * 864e5;
  await w.ingest({ outbox: [OUT({ id: "r-new-1", target: { ...TARGET, id: "2116000000000000099", url: "https://x.com/someone/status/2116000000000000099" } })] });
  const c2 = (await w.call("/api/admin/login", { method: "POST", body: { name: "admin1", password: PW } })).headers.get("Set-Cookie").split(";")[0];
  const st = (await w.call("/api/admin/state", { cookie: c2 })).json;
  const old = st.outbox.find((x) => x.id === "r-openeden-1");
  assert.deepEqual([old.purged, old.status, old.mine.target.id, old.mine.target.protocol], [true, "待发", undefined, "OpenEden"]);
  const pend = st.outbox.filter((x) => x.status === "待发").sort((a, b) => a.created_at.localeCompare(b.created_at));
  assert.deepEqual(pend.map((x) => x.id), ["r-openeden-1", "r-new-1"]);
  const g = gate(st.outbox, pend, 1, w.clock);
  assert.deepEqual([g.used, [...g.queued]], [0, []]); // 名额 1 给了新来的那条
});

test("发送节奏提醒(不拦人):30 分钟里第 6 条请他歇一会儿;一次坐下(相邻隔不到 2 小时)第 10 条请他隔两小时;隔够 2 小时重新算", () => {
  const at = (min) => new Date(Date.parse("2026-11-06T02:00:00Z") + min * 60e3).toISOString();
  const every = (n, gap) => Array.from({ length: n }, (_, i) => at(i * gap));
  assert.equal(paceNote([]), null);
  assert.equal(paceNote(every(5, 5)), null);
  assert.equal(paceNote(every(6, 5)), "30 分钟里已经发了 6 条,歇一会儿");
  assert.equal(paceNote(every(6, 6)), "30 分钟里已经发了 6 条,歇一会儿"); // 头尾正好 30 分钟也算
  assert.equal(paceNote(every(6, 7)), null); // 最早那条在 30 分钟以外
  // 每 20 分钟一条:30 分钟里最多 2 条,但一次坐下到第 10 条就提醒
  assert.equal(paceNote(every(9, 20)), null);
  assert.equal(paceNote(every(10, 20)), "这一次已经发了 10 条,隔两小时再来");
  assert.equal(paceNote(every(12, 20)), "这一次已经发了 12 条,隔两小时再来");
  assert.equal(paceNote([...every(9, 20), at(160 + 120)]), null, "隔了正好 2 小时:新的一次坐下");
  assert.equal(paceNote([...every(9, 20), at(160 + 119)]), "这一次已经发了 10 条,隔两小时再来", "隔 1 小时 59 分:还是同一次");
  assert.equal(paceNote(every(10, 3)), "这一次已经发了 10 条,隔两小时再来", "两条都够:先说隔两小时");
  assert.equal(paceNote([...every(6, 5).reverse(), null, "bad"]), "30 分钟里已经发了 6 条,歇一会儿", "顺序乱的、读不出的时间不影响");
});

test("运营台网页:admin.js 按模块加载,它引的文件都在放行名单里(少一个整页都跑不起来)", async () => {
  const { FILES } = await import("../functions/admin/[[path]].js");
  assert.match(readFileSync(new URL("../admin/index.html", import.meta.url), "utf8"), /<script type="module" src="\/admin\/admin\.js"><\/script>/);
  const deps = [...readFileSync(new URL("../admin/admin.js", import.meta.url), "utf8").matchAll(/^import [^;]+ from "\.\/([a-z]+\.js)";$/gm)].map((m) => m[1]);
  assert.deepEqual(deps, ["pace.js"]);
  const env = { ADMIN_HOSTS: "defiexit.com", ASSETS: { fetch: async () => new Response("export {};", { status: 200 }) } };
  for (const d of deps) {
    assert.ok(FILES["/admin/" + d], d);
    const r = await serve(new Request(HOST + "/admin/" + d), env);
    assert.equal(r.status, 200, d);
    assert.match(r.headers.get("Content-Type"), /^text\/javascript/);
  }
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
      if (!/^SELECT id, mine, status, purged\b.* FROM outbox WHERE id IN/.test(sql)) return st;
      return { bind: (...a) => ({ all: async () => { const r = await st.bind(...a).all(); await real.prepare("UPDATE outbox SET status = '已发' WHERE id = ?").bind("r-openeden-1").run(); return r; } }) };
    },
    batch: (s) => real.batch(s),
  };
  w.clock += 1000;
  const raw = JSON.stringify({ v: 1, ts: w.clock, nonce: randomUUID().replace(/-/g, ""), outbox: [OUT({ draft: "在途的新草稿" })] });
  const sig = sign(null, Buffer.from(signedText("production", "POST", "/api/admin/ingest", raw)), PROD.privateKey).toString("base64url");
  const r = await handle(new Request(HOST + "/api/admin/ingest", { method: "POST", headers: { "X-DX-Sig": sig }, body: raw }), baseEnv(sneaky), w.edge, w.now());
  assert.equal(r.status, 200);
  // 回执照实说:这一条没改上(不算进 outbox 的条数)
  const rc = await r.json();
  assert.deepEqual([rc.outbox, rc.rejected], [0, [{ kind: "outbox", id: "r-openeden-1", why: "管理员刚处理过这条(点了「已发 / 跳过」或改了草稿),这次没改" }]]);
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
  assert.equal(r.json.rejected[0].why, "30 天到期删过,不再改"); // 点过「已发」的,到期删过也先说到期
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

// ---------- 问题记录(大家最常问):建表、投递、更新、到期删、导出、运营台、按要求删 ----------
import { problemKey, goneKey, expKey, isoWeek, purge, PROBLEM_TYPES, SCAN, NEEDS_FIX } from "../server/ops/db.js";
import { safeLabel } from "../server/ops/names.js";

const PROB = (over = {}) => ({ id: "2117000000000000501", protocol: "Scroll", chain: "Scroll", type: "migration", source: "bot", day: "2026-11-02", url: "https://x.com/user_p/status/2117000000000000501", handle: "user_p", ...over });
const pid = (n) => "21170000000000006" + String(n).padStart(2, "0");
const probRows = async (w) => (await w.db.prepare("SELECT * FROM problems ORDER BY id").all()).results;
const probOf = async (w, id) => w.db.prepare("SELECT * FROM problems WHERE id = ?").bind(await problemKey(id)).first(); // 库里的编号是帖子编号的哈希
const whyOf = (r) => Object.fromEntries(r.json.rejected.filter((x) => x.kind === "problems").map((x) => [x.id, x.why]));
const ZERO = Object.fromEntries(PROBLEM_TYPES.map((k) => [k, 0]));
const NAME_WHY = "只写名字:字母、数字、空格和 . - ( );像网址的不收,比如 ether.fi 写成 ether fi;不带链接、@、钱包地址(0x 加 6 位以上十六进制、连着 25 个以上的字母数字)和连着 6 位以上的数字";

test("问题记录:表和索引在第一次用到时自动建好", async () => {
  const db = new LocalD1();
  await ensure(db);
  const cols = (await db.prepare("SELECT name FROM pragma_table_info('problems') ORDER BY cid").all()).results.map((r) => r.name);
  assert.deepEqual(cols, ["id", "protocol", "chain", "type", "source", "day", "replied", "url", "handle", "created_at", "updated_at", "purge_after", "purged"]);
  const idx = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'problems' AND sql IS NOT NULL ORDER BY name").all()).results.map((r) => r.name);
  assert.deepEqual(idx, ["problems_day", "problems_due"]);
});

test("问题记录投递:种类、来源只认那几个;编号是帖子编号(字符串,库里只存哈希);日期是真日子、不晚于今天(北京时间);链接和编号对得上、账号不带 @;协议、链太长截掉;不合格的写进回执", async () => {
  const w = world(); // 北京时间 11-03 18:00
  const LONG_P = "Pool ".repeat(14), LONG_C = "Chain ".repeat(9); // 70、54 个字(连着 25 个以上的字母数字不收,所以带空格)
  const r = await w.ingest({ problems: [
    PROB(),
    PROB({ id: pid(1), protocol: LONG_P, chain: LONG_C, day: "2026-11-03", source: "comment", type: "other", url: undefined, handle: undefined }),
    PROB({ id: pid(2), type: "bridge" }),
    PROB({ id: pid(3), type: undefined }),
    PROB({ id: pid(4), source: "dm" }),
    PROB({ id: "x-1" }),
    PROB({ id: 2117000000000000601 }), // 写成数字:JSON 里已经变成别的编号了,不收
    PROB({ id: pid(5), protocol: "  " }),
    PROB({ id: pid(6), day: "11-02" }),
    PROB({ id: pid(7), day: "2026-02-30" }),
    PROB({ id: pid(8), day: "2026-11-04" }),
    PROB({ id: pid(9), replied: 1 }),
    PROB({ id: pid(10) }), // 链接是别的帖子的
    PROB({ id: pid(11), url: "https://evil.example/user_p/status/" + pid(11) }),
    PROB({ id: pid(12), url: undefined, handle: "@user_p" }),
    PROB({ id: pid(13), url: undefined, chain: 56 }),
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.problems, 2);
  assert.equal(r.json.rejected.length, 14);
  assert.deepEqual(r.json.rejected.filter((x) => x.id === "?").map((x) => x.why), ["id 要是帖子编号(写成字符串)", "id 要是帖子编号(写成字符串)"]);
  const why = whyOf(r);
  assert.deepEqual(Object.keys(why).sort(), ["?", ...[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].map(pid)].sort());
  assert.match(why[pid(2)], /^type 只能是 bridge-wait、chain-shutdown、migration、/);
  assert.match(why[pid(3)], /^type 只能是/);
  assert.equal(why[pid(4)], "source 只能是 bot、announcement、comment");
  assert.match(why[pid(5)], /缺 protocol/);
  for (const n of [6, 7, 8]) assert.match(why[pid(n)], /^day 要是帖子发的那天/, String(n));
  assert.match(why[pid(9)], /replied 只能是 true 或 false/);
  for (const n of [10, 11]) assert.match(why[pid(n)], /^链接不合格/, String(n));
  assert.match(why[pid(12)], /^handle 不合格/);
  assert.match(why[pid(13)], /chain 要是文字/);
  const t = new Date(w.clock).toISOString(), due = new Date(w.clock + 30 * 864e5).toISOString();
  assert.deepEqual(await probOf(w, PROB().id), { id: await problemKey(PROB().id), protocol: "Scroll", chain: "Scroll", type: "migration", source: "bot", day: "2026-11-02", replied: 0, url: PROB().url, handle: "user_p", created_at: t, updated_at: t, purge_after: due, purged: 0 });
  assert.deepEqual(await probOf(w, pid(1)), { id: await problemKey(pid(1)), protocol: LONG_P.slice(0, 60).trim(), chain: LONG_C.slice(0, 40).trim(), type: "other", source: "comment", day: "2026-11-03", replied: 0, url: null, handle: null, created_at: t, updated_at: t, purge_after: due, purged: 0 });
  assert.deepEqual([(await probOf(w, pid(1))).protocol.length, (await probOf(w, pid(1))).chain.length], [59, 40]);
  const rows = await probRows(w);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((x) => /^[0-9a-f]{64}$/.test(x.id)), "编号只存哈希");
  // 北京时间快到零点:服务器的钟慢几分钟也不错拒,明天的帖子收;后天的不收
  w.clock = Date.parse("2026-11-03T15:55:00Z");
  const r2 = await w.ingest({ problems: [PROB({ id: pid(14), url: undefined, day: "2026-11-04" }), PROB({ id: pid(15), url: undefined, day: "2026-11-05" })] });
  assert.deepEqual([r2.json.problems, r2.json.rejected.map((x) => x.id)], [1, [pid(15)]]);
});

test("问题记录投递:协议、链只收名字(字母、数字、空格、. - ( ) 和汉字);带链接、像网址的(Curve.fi 这种名字也算)、@、连着 6 位以上数字的不收(这两样到期也不删);全角换成半角、连着的空白并成一个再存", async () => {
  const w = world();
  const bad = ["https://x.com/user_p/status/1", "x.com/user_p", "app.uniswap.org", "Curve.fi", "evil。com", "ｅｖｉｌ．ｃｏｍ", "例子.中国", "1.2.3.4", "@user_p", "user＠mail", "Lido 2117000000000000501", "Scroll 123456", "user_p", "Fantom/Sonic"];
  const good = [["Hyperliquid (HyperEVM)", "Hyperliquid (HyperEVM)"], ["Avalanche C-Chain", "Avalanche C-Chain"], ["Lido v2.0", "Lido v2.0"], ["币安钱包", "币安钱包"], ["ＺＫｓｙｎｃ　 Lite", "ZKsync Lite"], ["U.S. Bank 12345", "U.S. Bank 12345"]];
  const r = await w.ingest({ problems: [
    ...bad.map((p, i) => PROB({ id: pid(20 + i), url: undefined, protocol: p })),
    PROB({ id: pid(39), url: undefined, chain: "bridge.evil.com" }),
    ...good.map(([p], i) => PROB({ id: pid(40 + i), url: undefined, protocol: p, chain: p })),
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.problems, good.length);
  const why = whyOf(r);
  bad.forEach((p, i) => assert.equal(why[pid(20 + i)], "protocol " + NAME_WHY, p));
  assert.equal(why[pid(39)], "chain " + NAME_WHY);
  for (const [i, [, want]] of good.entries()) {
    const row = await probOf(w, pid(40 + i));
    assert.deepEqual([row.protocol, row.chain], [want, want], want);
  }
});

test("问题记录投递:字段的类型不对(比如 {\"toString\": null})只拒那一条,同一包里的看板、收件和别的问题记录照收", async () => {
  const w = world();
  const odd = { toString: null };
  const r = await w.ingest({
    docs: { summary: { updatedAt: "2026-11-03T10:00:00Z", asks: [] } },
    inbox: [{ id: "3000000000000000801", text: "钱卡住了", author: "user_i" }],
    problems: [
      PROB({ id: odd }), PROB({ id: pid(50), type: odd }), PROB({ id: pid(51), source: odd }), PROB({ id: pid(52), protocol: odd }), PROB({ id: pid(53), chain: odd }),
      PROB({ id: pid(54), day: odd }), PROB({ id: pid(55), replied: odd }), PROB({ id: pid(56), url: odd }), PROB({ id: pid(57), url: undefined, handle: odd }),
      odd, null, "2117000000000000501", 7, [], PROB({ id: pid(58), url: undefined }),
    ],
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.docs, r.json.inbox, r.json.problems], [1, 1, 1]);
  assert.equal(r.json.rejected.length, 14);
  assert.ok(r.json.rejected.every((x) => x.kind === "problems"));
  assert.ok(await probOf(w, pid(58)));
});

test("问题记录投递:一包最多 50 条(多的不收,回执里说一声)", async () => {
  const w = world();
  const many = Array.from({ length: 53 }, (_, i) => PROB({ id: "2117000000000001" + String(i).padStart(3, "0"), url: undefined }));
  const r = await w.ingest({ problems: many });
  assert.equal(r.json.problems, 50);
  assert.deepEqual(r.json.rejected, [{ kind: "problems", id: "?", why: "一包最多 50 条:第 51 条起的 3 条没收,下一包再送" }]);
  assert.equal((await probRows(w)).length, 50);
});

test("问题记录:按要求删过的(gone 里有那条帖子的 goneKey)不收,查 gone 和写在同一句,和「删除」同时来也写不回去;收件到期写进 gone 的(expKey)挡不住问题记录的更新", async () => {
  const w = world();
  const U62 = "https://x.com/user_p/status/" + pid(62);
  assert.equal((await w.ingest({ problems: [PROB({ id: pid(62), url: U62 })] })).json.problems, 1);
  // 按要求删过:不收,回执里说明
  await w.db.prepare("INSERT INTO gone (id, at) VALUES (?, ?)").bind(await goneKey(pid(60)), "t").run();
  w.clock += 1000;
  let r = await w.ingest({ problems: [PROB({ id: pid(60), url: undefined }), PROB({ id: pid(61), url: undefined })] });
  assert.deepEqual([r.json.problems, r.json.rejected.map((x) => [x.kind, x.id, x.why])], [1, [["problems", pid(60), "管理员按要求删过,不再收"]]]);
  assert.equal(await probOf(w, pid(60)), null);
  // 投递已经在路上,管理员这时点了「删除」(删那一行、记进 gone),紧接着这一包写进来:那条照样写不回去
  const raw = w.db;
  w.db = { prepare: (sql) => raw.prepare(sql), batch: async (ss) => {
    if (ss.some((x) => /INSERT INTO problems/.test(x.sql || ""))) {
      await raw.batch([raw.prepare("DELETE FROM problems WHERE id = ?").bind(await problemKey(pid(62))), raw.prepare("INSERT INTO gone (id, at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING").bind(await goneKey(pid(62)), "t")]);
    }
    return raw.batch(ss);
  } };
  w.clock += 1000;
  r = await w.ingest({ problems: [PROB({ id: pid(62), url: U62, replied: true }), PROB({ id: pid(63), url: undefined })] });
  w.db = raw;
  assert.deepEqual([r.json.problems, r.json.rejected.map((x) => [x.id, x.why])], [1, [[pid(62), "管理员按要求删过,不再收"]]]);
  assert.equal(await probOf(w, pid(62)), null, "删掉的没被写回去,链接、账号也没回来");
  // 收件里的评论 30 天到期:整行删掉、编号记进 gone(防止刷新又收进来);同一条帖子的问题记录照样能改种类、回没回
  const CM = "3000000000000000901";
  w.clock += 1000;
  await w.ingest({ inbox: [{ id: CM, text: "桥上的钱还没到", author: "user_e" }], problems: [PROB({ id: CM, source: "comment", url: undefined, handle: "user_e" })] });
  w.clock += 31 * 864e5;
  assert.equal((await w.exp({})).status, 200); // 到期清理
  assert.equal((await w.db.prepare("SELECT COUNT(*) AS n FROM inbox WHERE id = ?").bind(CM).first()).n, 0);
  w.clock += 1000;
  r = await w.ingest({ problems: [PROB({ id: CM, source: "comment", url: undefined, replied: true, type: "bridge-wait" })] });
  assert.deepEqual([r.json.problems, r.json.rejected], [1, []]);
  const row = await probOf(w, CM);
  assert.deepEqual([row.replied, row.type, row.handle, row.purged], [1, "bridge-wait", null, 1]);
});

test("问题记录更新:按帖子编号改分类;replied 只会从 false 变 true;链、链接、账号这次没写就留原来的;保留期从第一次入库算", async () => {
  const w = world();
  await w.ingest({ problems: [PROB({ replied: true }), PROB({ id: pid(30), url: undefined })] });
  const first = await probOf(w, PROB().id), second = await probOf(w, pid(30));
  w.clock += 3600e3;
  const r = await w.ingest({ problems: [
    PROB({ type: "bridge-wait", source: "announcement", protocol: "Scroll Bridge", day: "2026-11-01", replied: false, chain: undefined, url: undefined, handle: undefined }),
    PROB({ id: pid(30), url: undefined, handle: undefined, replied: true }),
  ] });
  assert.deepEqual([r.json.problems, r.json.rejected], [2, []]);
  const t = new Date(w.clock).toISOString();
  assert.deepEqual(await probOf(w, PROB().id), { ...first, type: "bridge-wait", source: "announcement", protocol: "Scroll Bridge", day: "2026-11-01", replied: 1, updated_at: t });
  assert.deepEqual(await probOf(w, pid(30)), { ...second, replied: 1, updated_at: t });
  assert.equal(first.replied, 1);
  assert.deepEqual([second.replied, second.handle], [0, "user_p"]);
});

test("问题记录 30 天到期:链接、账号删掉(编号本来就只存哈希),协议、链、种类、来源、日期、回没回留着;再送来认得出(不多一行),链接、账号不写回,回没回照样只升不降", async () => {
  const w = world();
  await w.ingest({ problems: [PROB(), PROB({ id: pid(1), replied: true, url: "https://x.com/user_q/status/" + pid(1), handle: "user_q" })] });
  w.clock += 31 * 864e5;
  assert.equal((await w.exp({})).status, 200); // 导出前先跑到期清理
  let rows = await probRows(w);
  assert.equal(rows.length, 2);
  for (const x of rows) {
    assert.match(x.id, /^[0-9a-f]{64}$/);
    assert.deepEqual([x.url, x.handle, x.purged], [null, null, 1]);
  }
  assert.ok(!/user_p|user_q|2117000000000000501|21170000000000006/.test(JSON.stringify(rows)), "库里找不回帖子和账号");
  const a = await probOf(w, PROB().id);
  assert.deepEqual([a.protocol, a.chain, a.type, a.source, a.day, a.replied], ["Scroll", "Scroll", "migration", "bot", "2026-11-02", 0]);
  w.clock += 1000;
  const r = await w.ingest({ problems: [PROB({ replied: true, type: "bridge-wait" })] });
  assert.deepEqual([r.json.problems, r.json.rejected], [1, []]);
  assert.equal((await probRows(w)).length, 2, "认出是同一条,没有多一行");
  const b = await probOf(w, PROB().id);
  assert.deepEqual([b.url, b.handle, b.replied, b.type, b.purged], [null, null, 1, "bridge-wait", 1]);
  w.clock += 1000;
  await w.ingest({ problems: [PROB({ replied: false, type: "bridge-wait" })] });
  assert.equal((await probOf(w, PROB().id)).replied, 1);
  // 只留下的那几样照样数得到
  w.clock += 1000;
  assert.deepEqual((({ total, replied, byType }) => [total, replied, byType["bridge-wait"]])((await w.exp({})).json.problems), [2, 2, 1]);
});

test("问题记录到期:一句把到期的全删(不分批,到期的链接、账号不会多留一会儿);没到期的不动", async () => {
  const db = new LocalD1();
  await ensure(db);
  for (let i = 0; i < 505; i++) await db.prepare("INSERT INTO problems (id, protocol, type, source, day, url, handle, created_at, updated_at, purge_after) VALUES (?, 'P', 'other', 'bot', '2026-11-01', ?, 'user_z', 't', 't', ?)").bind("k" + i, "https://x.com/user_z/status/" + (2117000000000003000n + BigInt(i)), i < 500 ? "2026-12-01T00:00:00.000Z" : "2026-12-31T00:00:00.000Z").run();
  const now = new Date("2026-12-10T00:00:00Z");
  assert.equal((await purge(db, now)).problems, 500);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM problems WHERE url IS NOT NULL OR handle IS NOT NULL").first()).n, 5, "没到期的 5 条还留着");
  assert.equal((await purge(db, now)).problems, 0);
});

test("ISO 周:周一开始,第 1 周是有 1 月 4 日的那周;年头年尾几天算进相邻那年", () => {
  for (const [d, wk] of [["2026-11-02", "2026-W45"], ["2026-11-05", "2026-W45"], ["2026-11-08", "2026-W45"], ["2026-11-09", "2026-W46"], ["2026-01-01", "2026-W01"],
    ["2025-12-29", "2026-W01"], ["2027-01-01", "2026-W53"], ["2027-01-04", "2027-W01"], ["2024-12-30", "2025-W01"], ["2021-01-03", "2020-W53"]]) assert.equal(isoWeek(d), wk, d);
});

test("导出带问题记录的数:最近 90 天(北京时间,按发帖那天)共几条、每种几条(九种都列)、问得多的 20 个协议、每周几条、回了几成;没有编号、账号、链接;since 不管它", async () => {
  const w = world(); // 北京 11-03 18:00:最近 90 天从 08-06 算起
  assert.deepEqual((await w.exp({})).json.problems, { since: "2026-08-06", total: 0, replied: 0, repliedShare: null, byType: ZERO, byProtocol: [], byWeek: {} });
  const recs = [];
  const add = (protocol, type, day, replied = false) => recs.push({ id: "2117000000000002" + String(recs.length).padStart(3, "0"), protocol, type, source: "bot", day, replied });
  add("P01", "migration", "2026-11-03", true); add("P01", "migration", "2026-11-02"); add("P01", "bridge-wait", "2026-10-28", true);
  add("P02", "scam", "2026-11-02"); add("P02", "scam", "2026-08-06", true); // 08-06 正好是 90 天的头一天
  for (let k = 3; k <= 25; k++) add("P" + String(k).padStart(2, "0"), "other", "2026-10-28");
  add("P99", "chain-shutdown", "2026-08-05", true); // 90 天以外,不算
  w.clock += 1000;
  const r = await w.ingest({ problems: recs.map((x) => ({ ...x, url: "https://x.com/user_z/status/" + x.id, handle: "user_z" })) });
  assert.deepEqual([r.json.problems, r.json.rejected], [29, []]);
  w.clock += 1000;
  const e = (await w.exp({ since: "2026-11-03T00:00:00Z" })).json;
  assert.deepEqual(e.problems, {
    since: "2026-08-06", total: 28, replied: 3, repliedShare: 0.107,
    byType: { ...ZERO, migration: 2, "bridge-wait": 1, scam: 2, other: 23 },
    byProtocol: [{ protocol: "P01", n: 3 }, { protocol: "P02", n: 2 }, ...Array.from({ length: 18 }, (_, k) => ({ protocol: "P" + String(k + 3).padStart(2, "0"), n: 1 }))],
    byWeek: { "2026-W32": 1, "2026-W44": 24, "2026-W45": 3 },
  });
  assert.ok(!/user_z|2117000000000002/.test(JSON.stringify(e)), "导出里没有账号和帖子编号");
});

test("问题记录的数不算明天:快到零点时收下的写成明天的帖子,到了那天才算", async () => {
  const w = world();
  w.clock = Date.parse("2026-11-03T15:55:00Z"); // 北京 11-03 23:55
  assert.equal((await w.ingest({ problems: [PROB({ url: undefined, day: "2026-11-04" }), PROB({ id: pid(70), url: undefined, day: "2026-11-03" })] })).json.problems, 2);
  w.clock += 1000;
  let p = (await w.exp({})).json.problems;
  assert.deepEqual([p.total, p.byType.migration, p.byWeek], [1, 1, { "2026-W45": 1 }]);
  w.clock += 10 * 60e3; // 北京 11-04 00:05
  p = (await w.exp({})).json.problems;
  assert.deepEqual([p.total, p.byWeek], [2, { "2026-W45": 2 }]);
});

test("运营台带问题记录的数:最近 7 天、30 天(北京时间,含今天),各带问得多的 10 个协议;没有编号、账号、链接", async () => {
  const w = world(); // 北京 11-03:7 天从 10-28 算起,30 天从 10-05 算起
  const c = await w.login();
  const recs = [];
  const add = (protocol, type, day, replied = false) => { const id = "2117000000000004" + String(recs.length).padStart(3, "0"); recs.push({ id, protocol, type, source: "comment", day, replied, url: "https://x.com/user_s/status/" + id, handle: "user_s" }); };
  add("Hyperliquid", "bridge-wait", "2026-11-03", true); add("Hyperliquid", "bridge-wait", "2026-10-28");
  add("Scroll", "migration", "2026-10-27", true); add("ZKsync Lite", "chain-shutdown", "2026-10-05"); add("Old", "scam", "2026-10-04");
  for (let k = 1; k <= 10; k++) add("Q" + String(k).padStart(2, "0"), "other", "2026-10-20");
  w.clock += 1000;
  assert.equal((await w.ingest({ problems: recs })).json.problems, 15);
  const p = (await w.call("/api/admin/state", { cookie: c })).json.problems;
  assert.deepEqual(Object.keys(p).sort(), ["d30", "d7"]);
  assert.deepEqual(p.d7, { since: "2026-10-28", total: 2, replied: 1, repliedShare: 0.5, byType: { ...ZERO, "bridge-wait": 2 }, byProtocol: [{ protocol: "Hyperliquid", n: 2 }], byWeek: { "2026-W44": 1, "2026-W45": 1 } });
  assert.deepEqual([p.d30.since, p.d30.total, p.d30.replied, p.d30.byType], ["2026-10-05", 14, 2, { ...ZERO, "bridge-wait": 2, migration: 1, "chain-shutdown": 1, other: 10 }]);
  assert.deepEqual(p.d30.byProtocol, [{ protocol: "Hyperliquid", n: 2 }, ...Array.from({ length: 9 }, (_, k) => ({ protocol: "Q0" + (k + 1), n: 1 }))]);
  assert.ok(!/user_s|2117000000000004/.test(JSON.stringify(p)));
});

test("按要求删掉一条:问题记录里同一条帖子的那行一起删(收件:评论本身;待发:要回的那条帖子),以后也不再收", async () => {
  const w = world();
  const c = await w.login();
  const CM = "3000000000000000701";
  await w.ingest({ inbox: [{ id: CM, text: "钱卡在桥上了", author: "user_c" }], outbox: [OUT()], problems: [PROB({ id: CM, source: "comment", url: undefined, handle: "user_c" }), PROB({ id: TARGET.id, url: TARGET.url, handle: TARGET.handle }), PROB({ id: pid(40), url: undefined })] });
  assert.equal((await probRows(w)).length, 3);
  assert.equal((await w.call("/api/admin/delete", { method: "POST", body: { kind: "inbox", id: CM }, cookie: c })).status, 200);
  assert.equal((await w.call("/api/admin/delete", { method: "POST", body: { kind: "outbox", id: "r-openeden-1" }, cookie: c })).status, 200);
  assert.deepEqual((await probRows(w)).map((x) => x.id), [await problemKey(pid(40))]);
  w.clock += 1000;
  const r = await w.ingest({ problems: [PROB({ id: CM, url: undefined }), PROB({ id: TARGET.id, url: undefined })] });
  assert.deepEqual([r.json.problems, r.json.rejected.map((x) => [x.id, x.why])], [0, [[CM, "管理员按要求删过,不再收"], [TARGET.id, "管理员按要求删过,不再收"]]]);
  assert.equal((await probRows(w)).length, 1);
});

test("按要求删掉一条待发:到期删了目标帖子的编号以后(只留哈希 key),问题记录里那条帖子后来记的一行(还带着链接、账号)照样删得掉,以后也不再收", async () => {
  const w = world();
  await w.login();
  await w.ingest({ outbox: [OUT()] });
  w.clock += 31 * 864e5;
  assert.equal((await w.exp({})).status, 200); // 待发到期:目标帖子的账号、链接、编号删掉
  const m = JSON.parse((await w.db.prepare("SELECT mine FROM outbox WHERE id = 'r-openeden-1'").first()).mine);
  assert.deepEqual([m.target.id, m.target.handle, m.target.url, m.target.protocol, m.target.key], [undefined, undefined, undefined, "OpenEden", await problemKey(TARGET.id)]);
  w.clock += 1000;
  await w.ingest({ problems: [PROB({ id: TARGET.id, url: TARGET.url, handle: TARGET.handle })] }); // 待发到期以后才记的,带着链接和账号
  assert.equal((await probOf(w, TARGET.id)).handle, TARGET.handle);
  const c2 = (await w.call("/api/admin/login", { method: "POST", body: { name: "admin1", password: PW } })).headers.get("Set-Cookie").split(";")[0];
  assert.equal((await w.call("/api/admin/delete", { method: "POST", body: { kind: "outbox", id: "r-openeden-1" }, cookie: c2 })).status, 200);
  assert.equal(await probOf(w, TARGET.id), null);
  w.clock += 1000;
  assert.deepEqual((await w.ingest({ problems: [PROB({ id: TARGET.id, url: undefined })] })).json.rejected.map((x) => x.why), ["管理员按要求删过,不再收"]);
});

// ---------- 按要求删除(11-06 审查):挡的是那条帖子,收件、待发、问题记录都查,查和写同一句;收件到期删的另记(expKey),只挡收件 ----------
const GONE_WHY = "管理员按要求删过,不再收";
const T2 = "2116000000000000002", U2 = "https://x.com/user_t/status/" + T2;
const TG2 = { ...TARGET, id: T2, handle: "user_t", url: U2 };
const relogin = async (w) => (await w.call("/api/admin/login", { method: "POST", body: { name: "admin1", password: PW } })).headers.get("Set-Cookie").split(";")[0];
// 整个库倒出来(找账号、帖子编号还在不在)
const dumpDb = async (w) => {
  const out = {};
  for (const { name } of (await w.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).results) out[name] = (await w.db.prepare(`SELECT * FROM ${name}`).all()).results;
  return JSON.stringify(out);
};
// 刷新时我们的帖子(3000000000000000005)底下有一条评论
const OUR_POST = { x_posts: { posts: [{ name: "X 长文", id: "3000000000000000005", points: [] }] } };
const replyUnder = (w, id, sn) => { w.fetchImpl = async () => new Response(JSON.stringify({ status: { id: "3000000000000000005", author: { id: "1", screen_name: "owner_acct" }, replies: 1 }, replies: [{ id, text: "钱卡住了", author: { id: "9", screen_name: sn } }] })); };

test("按要求删掉一张待发卡片:要回的那条帖子以后收件、待发、问题记录都不收(回执写明为什么),刷新也不收;库里找不到它的账号、链接和编号", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ docs: OUR_POST, outbox: [OUT({ id: "r-test-1", target: TG2 })] });
  assert.equal((await w.call("/api/admin/delete", { method: "POST", body: { kind: "outbox", id: "r-test-1" }, cookie: c })).status, 200);
  w.clock += 1000;
  const r = await w.ingest({
    inbox: [{ id: T2, source: "X 长文", url: U2, author: "user_t", text: "我的钱卡在桥上了", type: "求助" }],
    problems: [PROB({ id: T2, url: U2, handle: "user_t" })],
    outbox: [OUT({ id: "r-test-2", target: TG2 }), OUT({ id: "r-test-1", target: TG2 })],
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.inbox, r.json.problems, r.json.outbox], [0, 0, 0]);
  assert.deepEqual(r.json.rejected.map((x) => [x.kind, x.id, x.why]), [["outbox", "r-test-2", GONE_WHY], ["outbox", "r-test-1", GONE_WHY], ["inbox", T2, GONE_WHY], ["problems", T2, GONE_WHY]]);
  replyUnder(w, T2, "user_t");
  assert.equal((await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c })).json.newReplies, 0);
  const all = await dumpDb(w);
  assert.ok(!all.includes("user_t") && !all.includes(T2), "库里没有这个账号和帖子编号");
});

test("待发到期删了目标帖子编号以后再按要求删这张卡片:用到期时留下的哈希,那条帖子收件、待发、问题记录照样都不收", async () => {
  const w = world();
  await w.login();
  await w.ingest({ outbox: [OUT({ id: "r-test-1", target: TG2 })] });
  w.clock += 31 * 864e5;
  assert.equal((await w.exp({})).status, 200); // 到期清理:目标帖子的账号、链接、编号删掉,只留两个哈希
  const m = JSON.parse((await w.db.prepare("SELECT mine FROM outbox WHERE id = 'r-test-1'").first()).mine);
  assert.deepEqual([m.target.id, m.target.handle, m.target.url, m.target.key, m.target.gone], [undefined, undefined, undefined, await problemKey(T2), await goneKey(T2)]);
  assert.ok(!(await dumpDb(w)).includes(T2), "到期以后库里没有编号本身");
  const c2 = await relogin(w);
  assert.equal((await w.call("/api/admin/delete", { method: "POST", body: { kind: "outbox", id: "r-test-1" }, cookie: c2 })).status, 200);
  w.clock += 1000;
  const r = await w.ingest({ inbox: [{ id: T2, author: "user_t", url: U2, text: "还是取不出来" }], outbox: [OUT({ id: "r-test-3", target: TG2 })], problems: [PROB({ id: T2, url: U2, handle: "user_t" })] });
  assert.deepEqual([r.json.inbox, r.json.outbox, r.json.problems], [0, 0, 0]);
  assert.deepEqual(r.json.rejected.map((x) => [x.kind, x.id, x.why]), [["outbox", "r-test-3", GONE_WHY], ["inbox", T2, GONE_WHY], ["problems", T2, GONE_WHY]]);
  const all = await dumpDb(w);
  assert.ok(!all.includes("user_t") && !all.includes(T2));
});

test("收件评论 30 天到期删掉:只挡收件(回执写明是到期删的,刷新也不收回来);同一条帖子的问题记录、待发照样收", async () => {
  const w = world();
  await w.login();
  const CM = "3000000000000000950", UC = "https://x.com/user_e/status/" + CM;
  await w.ingest({ docs: OUR_POST, inbox: [{ id: CM, text: "钱卡在桥上", author: "user_e", url: UC }] });
  w.clock += 31 * 864e5;
  assert.equal((await w.exp({})).status, 200); // 到期清理
  const k = await goneKey(CM);
  const marked = async (id) => !!(await w.db.prepare("SELECT 1 AS x FROM gone WHERE id = ?").bind(id).first());
  assert.deepEqual([await marked(expKey(k)), await marked(k)], [true, false], "到期记的是 expKey,不是按要求删的 goneKey");
  w.clock += 1000;
  const r = await w.ingest({
    inbox: [{ id: CM, text: "又送来一遍原文", author: "user_e" }],
    problems: [PROB({ id: CM, source: "comment", url: UC, handle: "user_e" })],
    outbox: [OUT({ id: "r-cm-1", target: { ...TARGET, id: CM, handle: "user_e", url: UC } })],
  });
  assert.deepEqual([r.json.inbox, r.json.problems, r.json.outbox], [0, 1, 1]);
  assert.deepEqual(r.json.rejected, [{ kind: "inbox", id: CM, why: "30 天到期删过,不再收" }]);
  replyUnder(w, CM, "user_e");
  assert.equal((await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: await relogin(w) })).json.newReplies, 0);
  assert.equal((await w.db.prepare("SELECT COUNT(*) AS n FROM inbox").first()).n, 0);
});

test("正式库里旧版本按要求删时记的 gone(收件评论编号、待发卡片编号的 goneKey)照样认:那条评论收件、待发、问题记录都不收,那张卡片也不收", async () => {
  const w = world();
  await w.ingest({ docs: {} }); // 建表
  const OLD = "3000000000000000960", UO = "https://x.com/user_o/status/" + OLD;
  // 旧版本(main 7d8a2b5)点「删除」写的就是这两种:goneKey(收件的编号)、goneKey(待发卡片的编号)
  await (await goneStmt(w.db, OLD, w.now())).run();
  await (await goneStmt(w.db, "r-old-1", w.now())).run();
  w.clock += 1000;
  const r = await w.ingest({
    inbox: [{ id: OLD, text: "x", author: "user_o", url: UO }],
    problems: [PROB({ id: OLD, url: UO, handle: "user_o" })],
    outbox: [OUT({ id: "r-old-1" }), OUT({ id: "r-new-1", target: { ...TARGET, id: OLD, handle: "user_o", url: UO } }), OUT({ id: "r-new-2" })],
  });
  assert.deepEqual([r.json.inbox, r.json.problems, r.json.outbox], [0, 0, 1]);
  assert.deepEqual(r.json.rejected.map((x) => [x.kind, x.id, x.why]), [["outbox", "r-old-1", GONE_WHY], ["outbox", "r-new-1", GONE_WHY], ["inbox", OLD, GONE_WHY], ["problems", OLD, GONE_WHY]]);
  assert.ok(!(await dumpDb(w)).includes("user_o"));
});

test("投递已经在路上,管理员这时按要求删了那条帖子:待发、收件、问题记录照样写不回去(查 gone 和写在同一句),回执写明", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ outbox: [OUT({ id: "r-test-1", target: TG2 })] });
  // 投递读完库、还没写的时候,管理员点了「删除」
  const raw = w.db;
  w.db = { prepare: (sql) => raw.prepare(sql), batch: async (ss) => {
    if (ss.some((x) => /INTO inbox/.test(x.sql || ""))) {
      w.db = raw;
      assert.equal((await w.call("/api/admin/delete", { method: "POST", body: { kind: "outbox", id: "r-test-1" }, cookie: c })).status, 200);
    }
    return raw.batch(ss);
  } };
  w.clock += 1000;
  const r = await w.ingest({ outbox: [OUT({ id: "r-test-1", target: TG2, draft: "在途的新草稿。" }), OUT({ id: "r-test-2", target: TG2 })], inbox: [{ id: T2, author: "user_t", url: U2, text: "钱卡住了" }], problems: [PROB({ id: T2, url: U2, handle: "user_t" })] });
  w.db = raw;
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.outbox, r.json.inbox, r.json.problems], [0, 0, 0]);
  assert.deepEqual(r.json.rejected.map((x) => [x.kind, x.id, x.why]), [["outbox", "r-test-1", GONE_WHY], ["outbox", "r-test-2", GONE_WHY], ["inbox", T2, GONE_WHY], ["problems", T2, GONE_WHY]]);
  const all = await dumpDb(w);
  assert.ok(!all.includes("user_t") && !all.includes(T2));
});

test("按要求删掉一条:库里同一条帖子的别的几行一起删(删待发:收件里这条帖子、别的要回它的待发,连到期只留哈希的旧卡片;删收件:要回这条评论的待发);别的帖子不动", async () => {
  const w = world();
  await w.login();
  await w.ingest({ outbox: [OUT({ id: "r-old-1", target: TG2 })] });
  w.clock += 31 * 864e5;
  assert.equal((await w.exp({})).status, 200); // r-old-1 到期:目标帖子编号只留哈希
  const c = await relogin(w);
  const CM = "3000000000000000990", UC = "https://x.com/user_c/status/" + CM;
  w.clock += 1000;
  await w.ingest({
    inbox: [{ id: T2, author: "user_t", url: U2, text: "钱卡住了" }, { id: CM, author: "user_c", url: UC, text: "桥上的钱没到" }],
    outbox: [OUT({ id: "r-test-1", target: TG2 }), OUT({ id: "r-test-2", target: TG2 }), OUT({ id: "r-cm-1", target: { ...TARGET, id: CM, handle: "user_c", url: UC } }), OUT({ id: "r-other-1" })],
  });
  assert.equal((await w.call("/api/admin/delete", { method: "POST", body: { kind: "outbox", id: "r-test-1" }, cookie: c })).status, 200);
  assert.equal((await w.call("/api/admin/delete", { method: "POST", body: { kind: "inbox", id: CM }, cookie: c })).status, 200);
  const st = (await w.call("/api/admin/state", { cookie: c })).json;
  assert.deepEqual([st.outbox.map((x) => x.id), st.inbox.map((x) => x.id)], [["r-other-1"], []]);
  const all = await dumpDb(w);
  assert.ok(!/user_t|user_c|2116000000000000002|3000000000000000990/.test(all), "两条帖子的账号、编号都不在了");
  assert.ok(all.includes(TARGET.handle), "别的帖子的待发还在");
});

test("按要求删掉一张到期只留哈希的旧待发:同一条帖子后来进来的收件、新的待发、问题记录一起删(行里不存哈希,删的时候把编号算成哈希比)", async () => {
  const w = world();
  await w.login();
  await w.ingest({ docs: OUR_POST, outbox: [OUT({ id: "r-old-1", target: TG2 })] });
  w.clock += 31 * 864e5;
  assert.equal((await w.exp({})).status, 200); // r-old-1 到期:目标帖子编号只留哈希
  const c = await relogin(w);
  const T4 = "2116000000000000004";
  w.clock += 1000;
  await w.ingest({ inbox: [{ id: T2, author: "user_t", url: U2, text: "钱卡住了" }], outbox: [OUT({ id: "r-test-1", target: TG2 }), OUT({ id: "r-other-1" })], problems: [PROB({ id: T2, url: U2, handle: "user_t" })] });
  replyUnder(w, T4, "user_t"); // 同一个人在我们帖子底下的另一条评论(别的帖子编号):不在这次删的范围里
  assert.equal((await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c })).json.newReplies, 1);
  assert.equal(JSON.parse((await w.db.prepare("SELECT mine FROM inbox WHERE id = ?").bind(T2).first()).mine).gone, undefined, "行里不存哈希");
  assert.equal((await w.call("/api/admin/delete", { method: "POST", body: { kind: "outbox", id: "r-old-1" }, cookie: c })).status, 200);
  assert.deepEqual((await w.db.prepare("SELECT id FROM outbox ORDER BY id").all()).results.map((x) => x.id), ["r-other-1"]);
  assert.deepEqual((await w.db.prepare("SELECT id FROM inbox ORDER BY id").all()).results.map((x) => x.id), [T4]);
  assert.equal(await probOf(w, T2), null);
  assert.ok(!(await dumpDb(w)).includes(T2));
});

test("待发、收件投递:字段的类型不对(比如 {\"toString\": null})只拒那一条,同一包里的看板、别的待发、收件、问题记录照收;看板、设置码、nonce 里这样的也不让整包出错", async () => {
  const w = world();
  const odd = { toString: null };
  const r = await w.ingest({
    docs: { summary: { asks: [{ text: "x", href: odd }] }, funnel: { target: 5, stages: [{ key: "seen", label: "看到", value: 1 }] } },
    setup: { hash: odd, hours: 24 },
    outbox: [
      OUT({ id: odd }), OUT({ id: "r-odd-1", why: odd }), OUT({ id: "r-odd-2", replyUrl: odd }), OUT({ id: "r-odd-3", target: { ...TARGET, url: odd } }),
      OUT({ id: "r-odd-4", target: { ...TARGET, id: odd } }), OUT({ id: "r-odd-5", draft: odd }), { id: "p-odd-6", kind: "post", topic: "迁移提醒", draft: "Scroll 提案。", quote: odd },
      odd, null, 7, "r-odd-7", [], OUT({ id: "r-ok-1" }),
    ],
    inbox: [
      { id: odd, text: "x" }, { id: "3000000000000000970", text: odd }, { id: "3000000000000000971", url: odd }, { id: "3000000000000000972", author: odd },
      { id: "3000000000000000973", replyToId: odd }, { id: "3000000000000000974", replied: odd }, { id: "3000000000000000975", draft: odd },
      odd, null, { id: "3000000000000000979", text: "好的,谢谢", author: "user_k" },
    ],
    problems: [PROB({ id: pid(80), url: undefined })],
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.docs, r.json.outbox, r.json.inbox, r.json.problems, r.json.setup], [1, 1, 1, 1, false]);
  const of = (k) => r.json.rejected.filter((x) => x.kind === k);
  assert.deepEqual(of("doc").map((x) => [x.id, x.why]), [["summary", "格式不对"]]);
  assert.deepEqual(of("setup").map((x) => x.why), ["格式不对"]);
  assert.equal(of("outbox").length, 12);
  assert.equal(of("inbox").length, 9);
  const why = Object.fromEntries([...of("outbox"), ...of("inbox")].filter((x) => x.id !== "?").map((x) => [x.id, x.why]));
  for (const [id, field] of [["r-odd-1", "why"], ["r-odd-2", "replyUrl"], ["r-odd-3", "target.url"], ["r-odd-4", "target.id"], ["r-odd-5", "draft"], ["p-odd-6", "quote"],
    ["3000000000000000970", "text"], ["3000000000000000971", "url"], ["3000000000000000972", "author"], ["3000000000000000973", "replyToId"], ["3000000000000000974", "replied"], ["3000000000000000975", "draft"]]) {
    assert.equal(why[id], field + " 格式不对(不能是对象或数组)", id);
  }
  assert.equal(of("outbox").filter((x) => x.id === "?").length, 6);
  assert.equal(of("inbox").filter((x) => x.id === "?").length, 3);
  assert.deepEqual((await w.db.prepare("SELECT id FROM outbox").all()).results.map((x) => x.id), ["r-ok-1"]);
  assert.deepEqual((await w.db.prepare("SELECT id FROM inbox").all()).results.map((x) => x.id), ["3000000000000000979"]);
  // nonce 是对象:回 400(不是服务器出错)
  assert.equal((await w.ingest({ nonce: odd }, { ts: w.clock + 1 })).status, 400);
});

test("同一包里同一张新的待发卡片送了两遍:第二遍不收(回执写明),别的照收;不再整包被当成重放", async () => {
  const w = world();
  const r = await w.ingest({ outbox: [OUT({ id: "r-dup-1" }), OUT({ id: "r-dup-1", draft: "另一版草稿。" })], inbox: [{ id: "3000000000000000981", text: "x" }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.outbox, r.json.inbox, r.json.rejected], [1, 1, [{ kind: "outbox", id: "r-dup-1", why: "同一包里重复了,只收第一条" }]]);
  assert.equal(JSON.parse((await w.db.prepare("SELECT mine FROM outbox WHERE id = 'r-dup-1'").first()).mine).draft, OUT().draft);
});

test("问题记录投递:协议、链里的钱包地址不收(0x 加 6 位以上十六进制;连着 25 个以上的字母数字:base58、bech32 的地址和长编号);像网址的名字(ether.fi、yearn.finance)不收,回执说写成 ether fi;截断处切在地址中间也不留半截", async () => {
  const w = world();
  const nid = (n) => "2117000000000007" + String(n).padStart(3, "0");
  const SOL = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV", TRON = "TQn9Y2khEsLJW1ChVWFMSMeRDow5KcbLSE", BECH = "bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh";
  const HEX40 = "0x" + "ab".repeat(20);
  const bad = [HEX40, "Lido 0x1234abcd", "pool0xdeadbeef", "０ｘａｂｃｄｅｆ１２", SOL, TRON, BECH, "Pool " + SOL, "a".repeat(25), "ether.fi", "yearn.finance", "ETHER.FI",
    "Lido Finance Staking Pool on Solana chain v2 " + SOL]; // 最后这条截到 60 个字正好切在地址中间(只剩 15 个字),截之前一起查,整条不收
  const good = ["0x Protocol", "0xbabe", "ether fi", "yearn finance", "a".repeat(24)];
  const r = await w.ingest({ problems: [
    ...bad.map((p, i) => PROB({ id: nid(i), url: undefined, protocol: p })),
    PROB({ id: nid(50), url: undefined, chain: HEX40 }), PROB({ id: nid(51), url: undefined, chain: "ether.fi" }), PROB({ id: nid(52), url: undefined, chain: BECH }),
    ...good.map((p, i) => PROB({ id: nid(60 + i), url: undefined, protocol: p, chain: p })),
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.problems, good.length);
  const why = whyOf(r);
  bad.forEach((p, i) => assert.equal(why[nid(i)], "protocol " + NAME_WHY, p));
  for (const n of [50, 51, 52]) assert.equal(why[nid(n)], "chain " + NAME_WHY, String(n));
  assert.match(NAME_WHY, /像网址的不收,比如 ether\.fi 写成 ether fi/);
  assert.match(NAME_WHY, /钱包地址/);
  for (const [i, p] of good.entries()) {
    const row = await probOf(w, nid(60 + i));
    assert.deepEqual([row.protocol, row.chain], [p, p], p);
  }
  // 审查里的例子:原来收下了(到期只删链接和账号,地址一直留在 protocol 里),现在整条不收
  assert.equal(await probOf(w, nid(0)), null);
  const all = await dumpDb(w);
  assert.ok(!/abababab|7EcDhSYG|TQn9Y2kh|bc1qxy2k/.test(all), "库里没有地址");
});

// ---------- 第二轮审查(11-06):链接里的帖子编号、旧行没存哈希、待发的协议和链、到期和管理员同时来、回执说法、评论来源 ----------
const QPOST = (over = {}) => ({ id: "p-quote-1", kind: "post", topic: "迁移提醒", why: "测试", draft: "Scroll 提案:$SCR 迁到以太坊主网。", quote: U2, ...over });
const OWNER_ACCT = { id: "1000000000000000001", screen_name: "owner_acct" };
// 刷新时:目标帖子底下有 replies(别的帖子都是我们账号发的、底下没有评论);onTarget 在读目标帖子时先跑
const underTarget = (w, replies, onTarget) => { w.fetchImpl = async (u) => {
  const id = String(u).split("/").pop();
  const body = { status: { id, author: id === TARGET.id ? { id: "555", screen_name: "someone" } : OWNER_ACCT, views: 1, replies: 1 }, replies: [] };
  if (id === TARGET.id) { body.replies = replies; if (onTarget) await onTarget(); }
  return new Response(JSON.stringify(body));
}; };

test("按要求删掉一条帖子以后:别的字段带着它的也不收(项目帖引用的原帖、回复链接、收件的链接和要回的那条),回执写明;已有的卡片补链接(投递的、管理员贴的)指着它也不收", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ outbox: [OUT({ id: "r-test-1", target: TG2 })] });
  assert.equal((await w.call("/api/admin/delete", { method: "POST", body: { kind: "outbox", id: "r-test-1" }, cookie: c })).status, 200);
  w.clock += 1000;
  const r = await w.ingest({
    outbox: [QPOST(), OUT({ id: "r-other-1", replyUrl: U2 })], // 审查的复现:引用的原帖、回复链接是删过的那条
    inbox: [{ id: "3000000000000000901", url: U2, author: "user_t", text: "x" }, { id: "3000000000000000902", replyToId: T2, author: "user_k", text: "y" }],
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.outbox, r.json.inbox], [0, 0]);
  assert.deepEqual(r.json.rejected.map((x) => [x.kind, x.id, x.why]), [["outbox", "p-quote-1", GONE_WHY], ["outbox", "r-other-1", GONE_WHY], ["inbox", "3000000000000000901", GONE_WHY], ["inbox", "3000000000000000902", GONE_WHY]]);
  assert.ok(!(await dumpDb(w)).includes(T2));
  w.clock += 1000;
  await w.ingest({ outbox: [OUT({ id: "r-sent-1" })] });
  assert.equal((await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-sent-1", status: "已发" }, cookie: c })).status, 200);
  w.clock += 1000;
  const r2 = await w.ingest({ outbox: [OUT({ id: "r-sent-1", replyUrl: U2 })] });
  assert.deepEqual([r2.json.outbox, r2.json.rejected.map((x) => x.why)], [0, [GONE_WHY]]);
  const p = await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-sent-1", reply_url: U2 }, cookie: c });
  assert.deepEqual([p.status, p.json.error], [409, "gone"]);
  assert.equal((await w.db.prepare("SELECT reply_url FROM outbox WHERE id = 'r-sent-1'").first()).reply_url, null);
});

test("按要求删过的那条是我们的回复:刷新时在目标帖子底下找到它,也不把链接补回去", async () => {
  const w = world();
  const c = await w.login();
  const R3 = "2116000000000000033";
  await w.ingest({ docs: OUR_POST, outbox: [OUT()], inbox: [{ id: R3, text: "x", author: "owner_acct" }] });
  await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-openeden-1", status: "已发" }, cookie: c });
  assert.equal((await w.call("/api/admin/delete", { method: "POST", body: { kind: "inbox", id: R3 }, cookie: c })).status, 200);
  underTarget(w, [{ id: R3, author: OWNER_ACCT, replying_to: { status: TARGET.id } }]);
  assert.equal((await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c })).status, 200);
  assert.equal((await w.db.prepare("SELECT reply_url FROM outbox WHERE id = 'r-openeden-1'").first()).reply_url, null);
});

test("按要求删掉一条帖子:库里别的字段带着它的几行一起删(项目帖引用它的、回复链接是它的、收件链接和要回的是它的);别的不动", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({
    outbox: [OUT({ id: "r-test-1", target: TG2 }), QPOST(), OUT({ id: "r-other-1", replyUrl: U2 }), OUT({ id: "r-keep-1" })],
    inbox: [{ id: "3000000000000000901", url: U2, author: "user_t", text: "x" }, { id: "3000000000000000902", replyToId: T2, author: "user_k", text: "y" }, { id: "3000000000000000903", author: "user_m", text: "z" }],
  });
  assert.equal((await w.call("/api/admin/delete", { method: "POST", body: { kind: "outbox", id: "r-test-1" }, cookie: c })).status, 200);
  assert.deepEqual((await w.db.prepare("SELECT id FROM outbox ORDER BY id").all()).results.map((x) => x.id), ["r-keep-1"]);
  assert.deepEqual((await w.db.prepare("SELECT id FROM inbox ORDER BY id").all()).results.map((x) => x.id), ["3000000000000000903"]);
  assert.ok(!(await dumpDb(w)).includes(T2));
});

test("这一版以前收进来的行(没存哈希):11-03 的卡片 A,11-05 同一条帖子的卡片 B、引用它的项目帖和收件;12-03 A 到期以后按要求删 A,别的也一起删,删了就改不了、再送来也不收", async () => {
  const w = world(); // 11-03 10:00(UTC)
  await w.login();
  const day = (d) => new Date(Date.parse(d + "T10:00:00Z")).toISOString();
  const put = (id, mine, made, due) => w.db.prepare("INSERT INTO outbox (id, mine, created_at, updated_at, purge_after) VALUES (?, ?, ?, ?, ?)").bind(id, JSON.stringify(mine), day(made), day(made), day(due)).run();
  // 旧版本写进库的样子:mine 里只有送来的那几样,没有任何哈希
  const card = { target: TG2, why: "原帖写明自己的钱卡在到期金库", draft: "到期金库可以在官方合约上自己取出。" };
  await put("r-a-1", card, "2026-11-03", "2026-12-03");
  await put("r-b-1", card, "2026-11-05", "2026-12-05");
  await put("p-q-1", { kind: "post", topic: "提醒", quote: U2, draft: "项目帖。" }, "2026-11-05", "2026-12-05");
  await w.db.prepare("INSERT INTO inbox (id, mine, text, created_at, updated_at, purge_after) VALUES (?, ?, ?, ?, ?, ?)").bind(T2, JSON.stringify({ url: U2, author: "user_t" }), "钱卡住了", day("2026-11-05"), day("2026-11-05"), day("2026-12-05")).run();
  w.clock = Date.parse("2026-12-03T10:00:01Z");
  assert.equal((await w.exp({})).status, 200); // A 到期:删编号之前从编号算好两个哈希
  const a = JSON.parse((await w.db.prepare("SELECT mine FROM outbox WHERE id = 'r-a-1'").first()).mine);
  assert.deepEqual([a.target.id, a.target.gone, a.target.key], [undefined, await goneKey(T2), await problemKey(T2)]);
  const c = await relogin(w);
  assert.equal((await w.call("/api/admin/delete", { method: "POST", body: { kind: "outbox", id: "r-a-1" }, cookie: c })).status, 200);
  assert.deepEqual([(await w.db.prepare("SELECT COUNT(*) AS n FROM outbox").first()).n, (await w.db.prepare("SELECT COUNT(*) AS n FROM inbox").first()).n], [0, 0]);
  assert.equal((await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-b-1", draft: "再改一版" }, cookie: c })).status, 404);
  assert.equal((await w.call("/api/admin/inbox", { method: "POST", body: { id: T2, note: "备注" }, cookie: c })).status, 404);
  w.clock += 1000;
  const r = await w.ingest({ inbox: [{ id: T2, text: "x", author: "user_t" }], outbox: [OUT({ id: "r-b-1", target: TG2 })] });
  assert.deepEqual([r.json.inbox, r.json.outbox], [0, 0]);
  assert.ok(!(await dumpDb(w)).includes(T2));
});

test("待发目标帖子的协议、链:随手写的名字照收(箭头、斜杠换成「 - 」);钱包地址、像网址的、@ 这一项不存,回执写一句,卡片照收;到期以后也没有;这一版以前收进来的,到期时也过一遍", async () => {
  const w = world();
  const HEX40 = "0x" + "ab".repeat(20);
  const r = await w.ingest({ outbox: [
    OUT({ id: "r-name-1", target: { ...TARGET, protocol: "StandX 有序关停", chain: "Blast L2 → 以太坊" } }),
    OUT({ id: "r-name-2", target: { ...TARGET, protocol: HEX40, chain: HEX40 } }),
    OUT({ id: "r-name-3", target: { ...TARGET, protocol: "ether.fi", chain: "@user_p" } }),
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.outbox, 3);
  assert.deepEqual(r.json.rejected.map((x) => [x.id, x.why.split("(")[0], /钱包地址/.test(x.why) && x.why.endsWith("这张卡片照收")]),
    [["r-name-2", "target.protocol 没存", true], ["r-name-2", "target.chain 没存", true], ["r-name-3", "target.protocol 没存", true], ["r-name-3", "target.chain 没存", true]]);
  const tgt = async (id) => JSON.parse((await w.db.prepare("SELECT mine FROM outbox WHERE id = ?").bind(id).first()).mine).target;
  const names = async (id) => { const t = await tgt(id); return [t.protocol, t.chain]; };
  assert.deepEqual(await names("r-name-1"), ["StandX 有序关停", "Blast L2 - 以太坊"]);
  for (const id of ["r-name-2", "r-name-3"]) assert.deepEqual(await names(id), [undefined, undefined], id);
  // 这一版以前收进来的(库里直接带着地址、账号),到期时也过一遍
  await w.db.prepare("INSERT INTO outbox (id, mine, created_at, updated_at, purge_after) VALUES (?, ?, 't', 't', ?)").bind("r-old-name", JSON.stringify({ target: { ...TARGET, protocol: HEX40, chain: "Fantom/Sonic", type: "到期 @user_p" }, draft: "旧的。" }), new Date(w.clock + 30 * 864e5).toISOString()).run();
  w.clock += 31 * 864e5;
  assert.equal((await w.exp({})).status, 200);
  assert.deepEqual(await names("r-name-1"), ["StandX 有序关停", "Blast L2 - 以太坊"]);
  const old = await tgt("r-old-name");
  assert.deepEqual([old.protocol, old.chain, old.type], [undefined, "Fantom - Sonic", undefined]);
  assert.ok(!/abababab|user_p/.test(await dumpDb(w)), "库里没有地址和账号");
});

test("到期清理和管理员点「已发」交错:点之前读到的卡片已经到期删了,不把目标帖子编号、没换掉账号的草稿写回去(回 409)", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ outbox: [OUT({ draft: "@someone 到期金库可以在官方合约上自己取出。" })] });
  const raw = w.db;
  let once = false;
  w.db = { prepare: (sql) => {
    const st = raw.prepare(sql);
    if (sql !== "SELECT * FROM outbox WHERE id = ?" || once) return st;
    // 管理员这一下刚读完卡片,到期清理就跑了
    return { bind: (...a) => ({ first: async () => { const row = await st.bind(...a).first(); once = true; await purge(raw, new Date(w.clock + 31 * 864e5)); return row; } }) };
  }, batch: (ss) => raw.batch(ss) };
  const r = await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-openeden-1", status: "已发" }, cookie: c });
  w.db = raw;
  assert.deepEqual([r.status, r.json.error], [409, "purged"]);
  const row = await raw.prepare("SELECT status, sent_target, sent_text, purged FROM outbox WHERE id = 'r-openeden-1'").first();
  assert.deepEqual([row.status, row.sent_target, row.sent_text, row.purged], ["待发", null, null, 1]);
  assert.ok(!/someone|2116000000000000001/.test(await dumpDb(w)));
});

test("到期清理和刷新自动补链接交错:读到「已发」的卡片以后它到期删了,不把回复链接写回去", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ docs: OUR_POST, outbox: [OUT()] });
  await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-openeden-1", status: "已发" }, cookie: c });
  const raw = w.db;
  underTarget(w, [{ id: "2116000000000000004", author: OWNER_ACCT, replying_to: { status: TARGET.id } }], () => purge(raw, new Date(w.clock + 31 * 864e5)));
  assert.equal((await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c })).status, 200);
  const row = await raw.prepare("SELECT reply_url, sent_target, purged FROM outbox WHERE id = 'r-openeden-1'").first();
  assert.deepEqual([row.reply_url, row.sent_target, row.purged], [null, null, 1]);
});

test("回执:没人点过、30 天到了自己删掉的待发再送来,写「30 天到期删过」(不是「管理员处理过」);待发、收件一包超过 50 条,多的写进回执", async () => {
  const w = world();
  await w.ingest({ outbox: [OUT()] });
  w.clock += 31 * 864e5;
  assert.equal((await w.exp({})).status, 200);
  w.clock += 1000;
  let r = await w.ingest({ outbox: [OUT({ draft: "改一版。" })] });
  assert.deepEqual([r.json.outbox, r.json.rejected], [0, [{ kind: "outbox", id: "r-openeden-1", why: "30 天到期删过,不再改" }]]);
  w.clock += 1000;
  const outs = Array.from({ length: 51 }, (_, i) => OUT({ id: "r-many-" + i }));
  const ins = Array.from({ length: 51 }, (_, i) => ({ id: String(3000000000000001000n + BigInt(i)), text: "x" }));
  r = await w.ingest({ outbox: outs, inbox: ins });
  assert.deepEqual([r.json.outbox, r.json.inbox], [50, 50]);
  const MORE = "一包最多 50 条:第 51 条起的 1 条没收,下一包再送";
  assert.deepEqual(r.json.rejected, [{ kind: "outbox", id: "?", why: MORE }, { kind: "inbox", id: "?", why: MORE }]);
});

test("我们回复底下的评论:来源不带对方账号(没写协议的写卡片编号);到期留下的需求摘要,来源里的 @账号也换掉(这一版以前收进来的)", async () => {
  const w = world();
  const c = await w.login();
  const MINE = "2116000000000000004", NOPROTO = { ...TARGET, protocol: undefined };
  await w.ingest({ docs: OUR_POST, outbox: [OUT({ target: NOPROTO })] });
  await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-openeden-1", status: "已发" }, cookie: c });
  w.clock += 1000;
  await w.ingest({ outbox: [OUT({ target: NOPROTO, replyUrl: "https://x.com/owner_acct/status/" + MINE })] });
  w.fetchImpl = async (u) => {
    const id = String(u).split("/").pop();
    if (id === MINE) return new Response(JSON.stringify({ status: { id, author: OWNER_ACCT, views: 1, replies: 1 }, replies: [{ id: "2116000000000000007", text: "桥上的钱没到", author: { id: "555", screen_name: "visitor" }, replying_to: { status: MINE } }] }));
    return new Response(JSON.stringify({ status: { id, author: OWNER_ACCT, views: 1, replies: 0 }, replies: [] }));
  };
  assert.equal((await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c })).json.newReplies, 1);
  assert.equal(JSON.parse((await w.db.prepare("SELECT mine FROM inbox WHERE id = '2116000000000000007'").first()).mine).source, "我们的回复 · r-openeden-1");
  await w.db.prepare("INSERT INTO inbox (id, mine, text, created_at, updated_at, purge_after) VALUES (?, ?, 'x', 't', 't', ?)").bind("3000000000000000999", JSON.stringify({ source: "我们的回复 · @someone", author: "visitor2", type: "提问", need: "想知道桥什么时候恢复" }), new Date(w.clock + 30 * 864e5).toISOString()).run();
  w.clock += 31 * 864e5;
  assert.equal((await w.exp({})).status, 200);
  const sources = (await w.db.prepare("SELECT v FROM needs").all()).results.map((x) => JSON.parse(x.v).source).sort();
  assert.deepEqual(sources, ["我们的回复 · r-openeden-1", "我们的回复 · …"]);
  assert.ok(!(await dumpDb(w)).includes("someone"), "库里没有对方账号");
});

// ---------- 第三轮审查(11-06):改一行查改完以后还带着的帖子、按页翻、旧协议名、纯数字卡片编号、补链接遇到期 ----------
test("按要求删一张到期旧卡片,第二步(翻库)出错:gone 已经记下,剩下带着这条帖子的行管理员改不了、投递补不进、刷新补不上链接;再点一次删除全删干净", async () => {
  const w = world();
  await w.login();
  await w.ingest({ docs: OUR_POST, outbox: [OUT({ id: "r-a-1", target: TG2 })] });
  w.clock += 31 * 864e5;
  assert.equal((await w.exp({})).status, 200); // A 到期:只剩哈希
  const c = await relogin(w);
  const MINE = "2116000000000000044";
  w.clock += 1000;
  await w.ingest({ outbox: [OUT({ id: "r-b-1", target: TG2 })], inbox: [{ id: "3000000000000000931", url: U2, author: "user_k", text: "x" }, { id: "3000000000000000932", replyToId: T2, author: "user_k", text: "y" }] });
  assert.equal((await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-b-1", status: "已发" }, cookie: c })).status, 200);
  // 删 A:记完 gone,翻库那一步出错
  const raw = w.db;
  let boom = true;
  w.db = { prepare: (sql) => { if (boom && /FROM inbox WHERE id > \?/.test(sql)) { boom = false; throw new Error("D1 出错了"); } return raw.prepare(sql); }, batch: (ss) => raw.batch(ss) };
  await assert.rejects(w.call("/api/admin/delete", { method: "POST", body: { kind: "outbox", id: "r-a-1" }, cookie: c }));
  w.db = raw;
  assert.deepEqual([(await raw.prepare("SELECT COUNT(*) AS n FROM outbox").first()).n, (await raw.prepare("SELECT COUNT(*) AS n FROM inbox").first()).n], [2, 2], "行还在");
  for (const [path, body] of [["outbox", { id: "r-b-1", note: "备注" }], ["inbox", { id: "3000000000000000931", note: "备注" }], ["inbox", { id: "3000000000000000932", decision: "采纳" }]]) {
    const r = await w.call("/api/admin/" + path, { method: "POST", body, cookie: c });
    assert.deepEqual([r.status, r.json.error], [409, "gone"], path + " " + body.id);
  }
  w.clock += 1000;
  const r = await w.ingest({ inbox: [{ id: "3000000000000000931", need: "想知道桥什么时候恢复" }, { id: "3000000000000000932", need: "同上" }], outbox: [OUT({ id: "r-b-1", target: TG2, replyUrl: "https://x.com/owner_acct/status/" + MINE })] });
  assert.deepEqual([r.json.inbox, r.json.outbox, r.json.rejected.map((x) => x.why)], [0, 0, [GONE_WHY, GONE_WHY, GONE_WHY]]);
  w.fetchImpl = async (u) => {
    const id = String(u).split("/").pop();
    const body = { status: { id, author: id === T2 ? { id: "555", screen_name: "user_t" } : OWNER_ACCT, views: 1, replies: 1 }, replies: [] };
    if (id === T2) body.replies = [{ id: MINE, author: OWNER_ACCT, replying_to: { status: T2 } }];
    return new Response(JSON.stringify(body));
  };
  assert.equal((await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c })).status, 200);
  assert.equal((await raw.prepare("SELECT reply_url FROM outbox WHERE id = 'r-b-1'").first()).reply_url, null, "刷新补不上 B 的回复链接");
  assert.equal((await w.call("/api/admin/delete", { method: "POST", body: { kind: "outbox", id: "r-a-1" }, cookie: c })).status, 200);
  assert.deepEqual([(await raw.prepare("SELECT COUNT(*) AS n FROM outbox").first()).n, (await raw.prepare("SELECT COUNT(*) AS n FROM inbox").first()).n], [0, 0]);
  assert.ok(!(await dumpDb(w)).includes(T2));
});

test("按要求删到期只留哈希的旧卡片:按编号一页页翻(只读编号和链接那几样),一次翻不完回 more、卡片先留着,再点接着翻,翻完全删", async () => {
  const w = world();
  await w.login();
  await w.ingest({ outbox: [OUT({ id: "r-a-1", target: TG2 })] });
  w.clock += 31 * 864e5;
  assert.equal((await w.exp({})).status, 200);
  const c = await relogin(w);
  w.clock += 1000;
  await w.ingest({
    outbox: [...[1, 2, 3].map((i) => OUT({ id: "r-t-" + i, target: TG2 })), ...[1, 2, 3, 4, 5, 6].map((i) => OUT({ id: "r-x-" + i }))],
    inbox: [{ id: "3000000000000000941", url: U2, text: "x" }, { id: "3000000000000000942", replyToId: T2, text: "y" }, { id: "3000000000000000943", text: "z" }],
  });
  const keep = { ...SCAN }, raw = w.db, seen = [];
  Object.assign(SCAN, { page: 2, pages: 2 });
  w.db = { prepare: (sql) => { seen.push(sql); return raw.prepare(sql); }, batch: (ss) => raw.batch(ss) };
  try {
    const del = () => w.call("/api/admin/delete", { method: "POST", body: { kind: "outbox", id: "r-a-1" }, cookie: c });
    let r = await del(), tries = 1;
    assert.deepEqual([r.status, r.json.error], [409, "more"]);
    assert.ok(await raw.prepare("SELECT 1 AS x FROM outbox WHERE id = 'r-a-1'").first(), "没翻完,这张卡片先留着");
    while (r.status === 409 && tries < 10) { r = await del(); tries++; }
    assert.equal(r.status, 200, JSON.stringify(r.json));
  } finally {
    Object.assign(SCAN, keep);
    w.db = raw;
  }
  assert.deepEqual((await raw.prepare("SELECT id FROM outbox ORDER BY id").all()).results.map((x) => x.id), ["r-x-1", "r-x-2", "r-x-3", "r-x-4", "r-x-5", "r-x-6"]);
  assert.deepEqual((await raw.prepare("SELECT id FROM inbox").all()).results.map((x) => x.id), ["3000000000000000943"]);
  assert.equal(await raw.prepare("SELECT v FROM kv WHERE k LIKE 'del_scan:%'").first(), null, "翻完了,记的进度也删了");
  const scans = seen.filter((s) => /FROM (inbox|outbox) WHERE (purged = 0 AND )?id > \?/.test(s));
  assert.ok(scans.length >= 4 && scans.every((s) => /LIMIT \?$/.test(s) && !/SELECT id, mine\b/.test(s)), "按页翻、只读编号和链接");
});

test("这一版以前收进来的卡片协议里带着地址:刷新时评论的来源写卡片编号;到期留下的需求摘要,来源里的地址、@账号换成「…」;库里已经有的需求摘要由定时任务过一遍", async () => {
  const w = world();
  const c = await w.login();
  const HEX40 = "0x" + "ab".repeat(20), MINE = "2116000000000000004";
  // 旧版本留下的需求摘要(以前的来源只换 @账号,更早的一个都没换)
  for (const [id, source] of [["n-old-1", "我们的回复 · " + HEX40], ["n-old-2", "我们的回复 · @someone"], ["n-old-3", "X 长文"]]) await w.db.prepare("INSERT INTO needs (id, month, v) VALUES (?, '2026-11', ?)").bind(id, JSON.stringify({ source, type: "提问" })).run();
  await w.ingest({ docs: OUR_POST });
  assert.equal((await w.task({ do: "leads", leads: [] })).status, 200); // 定时任务(盯项目变动那一次)顺手过一遍
  const needOf = async (id) => JSON.parse((await w.db.prepare("SELECT v FROM needs WHERE id = ?").bind(id).first()).v).source;
  assert.deepEqual([await needOf("n-old-1"), await needOf("n-old-2"), await needOf("n-old-3")], ["我们的回复 · …", "我们的回复 · …", "X 长文"]);
  // 旧版本收进来的卡片:协议里直接带着地址,已发,核到了我们那条回复
  await w.db.prepare("INSERT INTO outbox (id, mine, status, decided_at, sent_target, reply_url, created_at, updated_at, purge_after) VALUES (?, ?, '已发', ?, ?, ?, 't', 't', ?)")
    .bind("r-old-hex", JSON.stringify({ target: { ...TARGET, protocol: HEX40 }, draft: "旧的。" }), new Date(w.clock).toISOString(), TARGET.id, "https://x.com/owner_acct/status/" + MINE, new Date(w.clock + 30 * 864e5).toISOString()).run();
  w.fetchImpl = async (u) => {
    const id = String(u).split("/").pop();
    if (id === MINE) return new Response(JSON.stringify({ status: { id, author: OWNER_ACCT, views: 1, replies: 1 }, replies: [{ id: "2116000000000000007", text: "桥上的钱没到", author: { id: "555", screen_name: "visitor" }, replying_to: { status: MINE } }] }));
    return new Response(JSON.stringify({ status: { id, author: OWNER_ACCT, views: 1, replies: 0 }, replies: [] }));
  };
  assert.equal((await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c })).json.newReplies, 1);
  assert.equal(JSON.parse((await w.db.prepare("SELECT mine FROM inbox WHERE id = '2116000000000000007'").first()).mine).source, "我们的回复 · r-old-hex");
  // 旧版本刷新时已经收进来的:来源里带着地址
  await w.db.prepare("INSERT INTO inbox (id, mine, text, created_at, updated_at, purge_after) VALUES (?, ?, 'x', 't', 't', ?)").bind("3000000000000000951", JSON.stringify({ source: "我们的回复 · " + HEX40, author: "visitor2" }), new Date(w.clock + 30 * 864e5).toISOString()).run();
  w.clock += 31 * 864e5;
  assert.equal((await w.exp({})).status, 200);
  const sources = (await w.db.prepare("SELECT v FROM needs WHERE id NOT LIKE 'n-old-%'").all()).results.map((x) => JSON.parse(x.v).source).sort();
  assert.deepEqual(sources, ["我们的回复 · r-old-hex", "我们的回复 · …"]);
  assert.ok(!/abababab|someone/.test(await dumpDb(w)), "库里没有地址和账号");
});

test("待发卡片编号不能全是数字(删卡片的标记会和同号的帖子撞在一起):整条不收,回执写明;r-xxx、p-xxx 照收", async () => {
  const w = world();
  const NUM_WHY = "id 不能全是数字(会和帖子编号混在一起),写成 r-xxx、p-xxx 这种";
  const r = await w.ingest({ outbox: [
    OUT({ id: "2116000000000000001" }),
    { id: "2117000000000000777", kind: "post", topic: "提醒", draft: "项目帖。", quote: "https://x.com/Scroll_ZKP/status/2117000000000000777" },
    OUT({ id: "r-123" }), { id: "p-2116", kind: "post", topic: "提醒", draft: "项目帖。" },
  ] });
  assert.equal(r.json.outbox, 2);
  assert.deepEqual(r.json.rejected.map((x) => [x.id, x.why]), [["2116000000000000001", NUM_WHY], ["2117000000000000777", NUM_WHY]]);
});

test("回执:已发的卡片补回复链接,读完状态以后它到期删了:写「30 天到期删过,不再改」(不是「管理员处理过」)", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ outbox: [OUT()] });
  assert.equal((await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-openeden-1", status: "已发" }, cookie: c })).status, 200);
  const real = w.db;
  w.db = { prepare(sql) {
    const st = real.prepare(sql);
    if (!/^SELECT id, mine, status, purged\b.* FROM outbox WHERE id IN/.test(sql)) return st;
    // 投递刚读完卡片的状态,到期清理就跑了
    return { bind: (...a) => ({ all: async () => { const r = await st.bind(...a).all(); await purge(real, new Date(w.clock + 31 * 864e5)); return r; } }) };
  }, batch: (s) => real.batch(s) };
  w.clock += 1000;
  const r = await w.ingest({ outbox: [OUT({ replyUrl: "https://x.com/owner_acct/status/2116000000000000004" })] });
  w.db = real;
  assert.deepEqual([r.json.outbox, r.json.rejected], [0, [{ kind: "outbox", id: "r-openeden-1", why: "30 天到期删过,不再改" }]]);
  assert.equal((await real.prepare("SELECT reply_url FROM outbox WHERE id = 'r-openeden-1'").first()).reply_url, null);
});

// ---------- 最后一轮(11-06):需求摘要分页过、来源标签的规则、同时点两次删除 ----------
test("以前的需求摘要过一遍:只在定时任务(盯项目变动那一次)里跑,按编号一页页翻、记下翻到哪,翻完才记 needs_v2;打开运营台、投递不碰;出错不连累线索", async () => {
  const w = world();
  const c = await w.login();
  const HEX40 = "0x" + "ab".repeat(20);
  for (let i = 0; i < 5; i++) await w.db.prepare("INSERT INTO needs (id, month, v) VALUES (?, '2026-11', ?)").bind("n-" + i, JSON.stringify({ source: i % 2 ? "我们的回复 · " + HEX40 : "X 长文", type: "提问" })).run();
  const sources = async () => (await w.db.prepare("SELECT v FROM needs ORDER BY id").all()).results.map((x) => JSON.parse(x.v).source);
  const kvOf = async (k) => (await w.db.prepare("SELECT v FROM kv WHERE k = ?").bind(k).first())?.v ?? null;
  await w.call("/api/admin/state", { cookie: c });
  await w.ingest({ docs: {} });
  assert.equal((await sources()).filter((s) => s.includes("abab")).length, 2, "打开运营台、投递都不碰");
  // 这一步出错:线索照收,needs_v2 不记
  const raw = w.db;
  w.db = { prepare: (sql) => { if (/FROM needs WHERE id > \?/.test(sql)) throw new Error("D1 出错了"); return raw.prepare(sql); }, batch: (ss) => raw.batch(ss) };
  w.clock += 1000;
  const t1 = await w.task({ do: "leads", leads: [LEAD()] });
  w.db = raw;
  assert.deepEqual([t1.status, t1.json.stored, await kvOf("needs_v2")], [200, 1, null]);
  // 一次只翻 1 页、每页 2 行:记下翻到哪,翻完才记 needs_v2
  const keep = { ...NEEDS_FIX };
  Object.assign(NEEDS_FIX, { page: 2, pages: 1 });
  try {
    for (let i = 0; i < 2; i++) { w.clock += 1000; assert.equal((await w.task({ do: "leads", leads: [] })).status, 200); }
    assert.deepEqual([await kvOf("needs_v2"), await kvOf("needs_v2_at")], [null, "n-3"]);
    w.clock += 1000;
    assert.equal((await w.task({ do: "leads", leads: [] })).status, 200);
    assert.deepEqual([await kvOf("needs_v2"), await kvOf("needs_v2_at")], ["1", null]);
  } finally {
    Object.assign(NEEDS_FIX, keep);
  }
  assert.deepEqual(await sources(), ["X 长文", "我们的回复 · …", "X 长文", "我们的回复 · …", "X 长文"]);
});

test("需求摘要的来源:只换掉认得出人、帖子、钱包的那几样(链接、网址、IP、@账号、0x 地址、25 个以上的英文字母数字、15 位以上的数字);长的中文标题、日期、短数字照留", () => {
  for (const s of ["项目帖 · 跨链桥到账延迟时如何确认资金状态并找到官方处理进度", "项目帖 · 20261106 每日观察", "我们的回复 · OpenEden", "X 长文", "Lido v2.0 · 2026-11-06", "我们的回复 · r-openeden-1"]) assert.equal(safeLabel(s), s, s);
  for (const [s, want] of [
    ["我们的回复 · 0x" + "ab".repeat(20), "我们的回复 · …"], ["我们的回复 · @someone", "我们的回复 · …"], ["我们的回复 · 7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV", "我们的回复 · …"],
    ["看 https://evil.example/a 的说明", "看 … 的说明"], ["去 app.uniswap.org 看", "去 … 看"], ["节点 1.2.3.4", "节点 …"], ["帖子 2116000000000000002", "帖子 …"],
  ]) assert.equal(safeLabel(s), want, s);
});

test("同时点了两次删除(只剩哈希、要翻好几页):慢的那次不把删完的任务写回旧进度,也不说「还没查完」", async () => {
  const w = world();
  await w.login();
  await w.ingest({ outbox: [OUT({ id: "r-a-1", target: TG2 })] });
  w.clock += 31 * 864e5;
  assert.equal((await w.exp({})).status, 200);
  const c = await relogin(w);
  w.clock += 1000;
  await w.ingest({ outbox: [...[1, 2, 3].map((i) => OUT({ id: "r-t-" + i, target: TG2 })), ...[1, 2, 3, 4].map((i) => OUT({ id: "r-x-" + i }))] });
  const keep = { ...SCAN }, raw = w.db;
  Object.assign(SCAN, { page: 2, pages: 1 });
  const del = () => w.call("/api/admin/delete", { method: "POST", body: { kind: "outbox", id: "r-a-1" }, cookie: c });
  let a;
  try {
    // 请求 A 翻完一页、记进度之前停住;这时请求 B 一路删完
    let paused = false;
    w.db = { prepare: (sql) => raw.prepare(sql), batch: async (ss) => {
      if (!paused && ss.some((x) => /INSERT INTO kv \(k, v\) SELECT/.test(x.sql || ""))) {
        paused = true;
        w.db = raw;
        let r;
        do { r = await del(); } while (r.status === 409);
        assert.equal(r.status, 200);
      }
      return raw.batch(ss);
    } };
    a = await del();
  } finally {
    Object.assign(SCAN, keep);
    w.db = raw;
  }
  assert.deepEqual([a.status, a.json.ok], [200, true], JSON.stringify(a.json));
  assert.equal(await raw.prepare("SELECT v FROM kv WHERE k LIKE 'del_scan:%'").first(), null, "没有留下旧进度");
  assert.deepEqual((await raw.prepare("SELECT id FROM outbox ORDER BY id").all()).results.map((x) => x.id), ["r-x-1", "r-x-2", "r-x-3", "r-x-4"]);
});
