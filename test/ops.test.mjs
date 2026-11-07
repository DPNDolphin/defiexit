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
import { capOf, gate, waitText, paceNote, dayHours, patrolLate } from "../admin/pace.js";
import { handle as hit } from "../functions/api/hit.js";

const HOST = "https://defiexit.com";
// 链接的规矩(11-06 第六轮)不收时说的话
const NEXT_WHY = "网址后面要先空一格再接文字", BRACKET_WHY = "网址里不能有 [ ] ( < > 这几个字符(markdown 写成 [文字](https://…) 照收)";
const SLASHES_WHY = "网址要写全 https://", ENTITY_WHY = "不能有 &#58; 这类 HTML 实体写法", MD_WHY = "markdown 的 ](…) 和 <…> 里面只能正好是一个 https:// 开头的网址(中间不能有空格,要有收尾的 ) 或 >)";
const BACKSLASH_WHY = "不能有反斜杠", REF_WHY = "不支持 [1]: 这种引用式链接,直接写 [文字](https://…)", ODD_SPACE_WHY = "有特殊空格(不换行空格、全角空格之类),换成普通空格";
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
  assert.deepEqual(Object.keys(again.json).sort(), ["docs", "inbox", "ok", "outbox", "outreach", "patrol", "problems", "receipt", "rejected", "sent", "setup"]);
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
  assert.deepEqual((await w.exp({})).json.hits, { checkup: { total: 0, since: null, byDay: {} }, view: { total: 0, since: null, byDay: {} }, visit: { total: 0, since: null, byDay: {} } });
  const ping = (at) => hit(new Request(HOST + "/api/hit", { method: "POST", headers: { Origin: HOST, "Content-Type": "application/json", "Content-Length": "15" }, body: '{"k":"checkup"}' }), { OPS: w.db }, new Date(at));
  // 现在是北京 11-03 18:00:最近 60 天从 09-05 算起;11-02 16:01(UTC)已经是北京 11-03
  for (const at of ["2026-09-01T02:00:00Z", "2026-11-02T15:59:00Z", "2026-11-02T16:01:00Z", "2026-11-03T09:00:00Z"]) assert.equal((await ping(at)).status, 204);
  w.clock += 1000;
  const r = await w.exp({ since: "2026-11-03T00:00:00Z" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.hits, { checkup: { total: 4, since: "2026-09-01", byDay: { "2026-11-02": 1, "2026-11-03": 2 } }, view: { total: 0, since: null, byDay: {} }, visit: { total: 0, since: null, byDay: {} } });
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
  assert.equal(checkText("ftp://files.example.org/a"), "网址要写全 https://"); // 11-06 第六轮:// 前面不是 http: / https: 的一律不收
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
  for (const s of ["官方页面是 blast.io 。不要点别的链接。", "去官方页面。blast.io 上看"]) assert.equal(checkText(s, undefined, IN), null, s);
  // 11-06 第六轮:网址后面紧跟着中文句号的不收(要先空一格)
  assert.equal(checkText("官方页面是 blast.io。不要点别的链接。", undefined, IN), "网址后面要先空一格再接文字");
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
  // 借道 @ 的那条(11-06 起链接里有 @、% 或反斜杠的一律不收)说的是 @,别的照旧说站外链接
  for (const x of r.rejected) assert.match(x.why, x.id === "3000000000000000515" ? /^草稿含带 @、% 或反斜杠的网址/ : /含站外链接/, x.id);
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
  assert.equal(waitText(g), "排队:今天上限 4 条(已打开 2 条,上面 2 条先发),明天放出");
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

// ---------- 宣传卡片(11-06):媒体投稿、给项目团队的邮件、安全清单的提交、技术社区的帖子 ----------
import { webUrl, mailAddr } from "../server/ops/ingest.js";

const REACH = (over = {}) => ({ id: "o-panews-1106", channel: "media", target: "PANews 投稿", lang: "zh", url: "https://www.panewslab.com/zh/contribute", title: "链关停了,钱怎么取", body: "很多人不知道,链关停以后钱还在链上。\n\n## 怎么查\n\n我们做了一个免费的退出截止日历:https://defiexit.com/deadlines/ 。", why: "PANews 接受投稿,页面底部有投稿入口", ...over });
const MAILTO = (over = {}) => ({ id: "o-sophon-1106", channel: "project", target: "Sophon 团队", lang: "en", to: "Team@Sophon.example", subject: "Your exit deadline on DeFiExit: corrections welcome", body: "Hi Sophon team,\n\nOur free exit-deadline calendar lists your shutdown date: https://defiexit.com/deadlines/ . If anything is off, just reply and we will fix it. Would you consider sharing it with your users?", why: "公告里写的联系邮箱", ...over });
const reachOf = async (w, id) => { const r = await w.db.prepare("SELECT * FROM outreach WHERE id = ?").bind(id).first(); return r && { ...r, mine: JSON.parse(r.mine) }; };
const reachWhy = (r) => Object.fromEntries(r.json.rejected.filter((x) => x.kind === "outreach").map((x) => [x.id, x.why]));

test("宣传卡片:表在第一次用到时自动建好", async () => {
  const db = new LocalD1();
  await ensure(db);
  await ensure(new Proxy(db, {})); // 换一个对象再跑一遍建表:已经有了不报错
  const cols = (await db.prepare("SELECT name FROM pragma_table_info('outreach') ORDER BY cid").all()).results.map((r) => r.name);
  assert.deepEqual(cols, ["id", "mine", "status", "decided_at", "result_note", "result_url", "result_at", "created_at", "updated_at"]);
});

test("宣传卡片的网址、邮箱:网址只收 https、普通的英文主机名(不收账号密码、端口、IP、xn--),存标准写法;邮箱只收一个普通地址,域名统一成小写", () => {
  for (const [s, want] of [
    ["https://news.ycombinator.com/submit", "https://news.ycombinator.com/submit"],
    ["  https://WWW.PanewsLab.com:443/zh/contribute  ", "https://www.panewslab.com/zh/contribute"],
    ["https://github.com/slowmist/Blockchain-dark-forest-selfguard-handbook/issues/new?title=Add DeFiExit", "https://github.com/slowmist/Blockchain-dark-forest-selfguard-handbook/issues/new?title=Add%20DeFiExit"],
  ]) assert.equal(webUrl(s), want, s);
  for (const s of ["http://a.org/", "https://u@a.org/", "https://u:p@a.org/", "https://a.org:8443/", "https://1.2.3.4/", "https://[::1]/", "https://xn--80ak6aa92e.com/", "https://localhost/",
    "ftp://a.org/", "javascript:alert(1)", "data:text/html,x", "www.a.org/x", "https://a.org/" + "x".repeat(500), "", "  ", null, 5, { toString: null }]) assert.equal(webUrl(s), null, typeof s === "string" ? s : typeof s);
  assert.equal(mailAddr("team@sophon.xyz"), "team@sophon.xyz");
  assert.equal(mailAddr(" First.Last+tag@Example.ORG "), "First.Last+tag@example.org");
  for (const s of ["a@b", "a@@b.org", "a@b@c.org", "a b@c.org", "<a@b.org>", "Name <a@b.org>", "a@b.org,c@d.org", "a@b.org?cc=c@d.org", "a%40b@c.org", "\"a\"@b.org",
    ".a@b.org", "a.@b.org", "a..b@c.org", "a@1.2.3.4", "a@xn--80ak6aa92e.com", "a@b.org\n?x", "@b.org", "", 5, null]) assert.equal(mailAddr(s), null, String(s));
});

test("宣传投递:合格的收下(投稿页的、写邮件的);网址、邮箱不合格的不收;标题、邮件标题、正文过敏感词和链接检查(只许本站和运营规则里的官方网址,长得像的绕不过去);编号不能全是数字;字段类型不对只拒那一条", async () => {
  const w = world();
  const c = await w.login();
  const URL_WHY = "url 不合格(要 https:// 开头的网址,不带账号密码、IP 地址、端口,最长 500 字)";
  const TO_WHY = "to 不合格(写一个普通的邮箱地址,比如 team@example.org;不带名字、尖括号、逗号、问号)";
  const OFF = "(宣传稿只许带 defiexit.com、运营规则 officialHosts 里列的官方网址,和我们自己的仓库 https://github.com/DPNDolphin/defiexit)";
  const HN = REACH({ id: "o-hn-1106", channel: "community", target: "Hacker News", lang: "en", url: "https://news.ycombinator.com/submit", title: "Show HN: DeFiExit – a free calendar of DeFi exit deadlines", body: "好".repeat(20000), why: undefined });
  const r = await w.ingest({ docs: { rules: { officialHosts: ["sophon.example"] } }, outreach: [
    REACH(), MAILTO(), HN,
    MAILTO({ id: "o-sophon-2", url: "https://sophon.example/blog/sunset", body: "Your announcement (https://sophon.example/blog/sunset) says withdrawals close on 2026-12-01." }),
    REACH({ id: "o-norm-1", url: "  https://WWW.PanewsLab.com:443/zh/contribute  ", lang: "zh-TW", subject: "  ", why: "" }),
    // 网址
    REACH({ id: "o-bad-1", url: "http://www.panewslab.com/zh/contribute" }), REACH({ id: "o-bad-2", url: "https://user:pw@www.panewslab.com/" }),
    REACH({ id: "o-bad-3", url: "javascript:alert(1)" }), REACH({ id: "o-bad-4", url: "https://1.2.3.4/submit" }), REACH({ id: "o-bad-5", url: "https://xn--pnews-9ra.com/" }),
    REACH({ id: "o-bad-6", url: "https://www.panewslab.com:8443/" }), REACH({ id: "o-bad-7", url: undefined }),
    // 邮箱
    MAILTO({ id: "o-bad-8", to: "Sophon <team@sophon.example>" }), MAILTO({ id: "o-bad-9", to: "team@sophon.example,boss@evil.example" }),
    MAILTO({ id: "o-bad-10", to: "team@sophon.example?cc=boss@evil.example" }), MAILTO({ id: "o-bad-11", to: "not-an-email" }),
    // 敏感词、链接
    REACH({ id: "o-bad-12", body: "加群领取空投" }), REACH({ id: "o-bad-13", title: "Claim your airdrop now" }), MAILTO({ id: "o-bad-14", subject: "DM me for details" }),
    REACH({ id: "o-bad-15", body: "源码在 https://github.com/someone-else/defiexit 。" }), REACH({ id: "o-bad-16", body: "去 evil。com 看" }), MAILTO({ id: "o-bad-17", subject: "See app.example.org" }),
    REACH({ id: "o-bad-26", body: "官方页面 https://sophon.example.evil.com/ 。" }),
    // 编号、渠道、语言、长度、类型
    REACH({ id: "2117000000000000901" }), REACH({ id: "o-bad-18", channel: "dm" }), REACH({ id: "o-bad-19", lang: "中文" }), REACH({ id: "o-bad-20", body: "x".repeat(20001) }),
    REACH({ id: "o-bad-21", target: { toString: null } }), REACH({ id: "o-bad-22", title: 7 }), REACH({ id: "o-bad-23", body: undefined }), REACH({ id: "o-bad-24", target: "  " }),
    REACH({ id: "o-bad-25", why: "x".repeat(501) }), MAILTO({ id: "o-bad-27", to: ["team@sophon.example"] }), REACH({ id: "o-bad-28", url: true }),
    null, 7, "o-x", [],
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.outreach, 5);
  const why = reachWhy(r);
  for (const n of [1, 2, 3, 4, 5, 6]) assert.equal(why["o-bad-" + n], URL_WHY, String(n));
  assert.equal(why["o-bad-7"], "缺 url(投稿页、仓库或发帖页的网址;只有写邮件的(带 to)可以不写)");
  for (const n of [8, 9, 10, 11]) assert.equal(why["o-bad-" + n], TO_WHY, String(n));
  assert.equal(why["o-bad-12"], "正文含不许用的词「加群」");
  assert.equal(why["o-bad-13"], "标题含不许用的词「claim your airdrop」");
  assert.equal(why["o-bad-14"], "邮件标题含不许用的词「dm me」");
  assert.equal(why["o-bad-15"], "正文含站外链接「github.com」" + OFF);
  assert.equal(why["o-bad-16"], "正文含站外链接「evil.com」" + OFF);
  assert.equal(why["o-bad-17"], "邮件标题含站外链接「app.example.org」" + OFF);
  assert.equal(why["o-bad-26"], "正文含站外链接「sophon.example.evil.com」" + OFF);
  assert.equal(why["2117000000000000901"], "id 不能全是数字(会和帖子编号混在一起),写成 o-panews-1106 这种");
  assert.equal(why["o-bad-18"], "channel 只能是 media、project、list、community");
  assert.equal(why["o-bad-19"], "lang 要写语言代码(zh、en、ja 这种)");
  assert.equal(why["o-bad-20"], "正文超过 20000 字");
  assert.equal(why["o-bad-21"], "target 格式不对(不能是对象或数组)");
  assert.equal(why["o-bad-22"], "title 要是文字");
  assert.equal(why["o-bad-23"], "缺 body(正文)");
  assert.equal(why["o-bad-24"], "缺 target(写给谁,比如「PANews 投稿」「Sophon 团队」)");
  assert.equal(why["o-bad-25"], "why 超过 500 字");
  assert.equal(why["o-bad-27"], "to 格式不对(不能是对象或数组)");
  assert.equal(why["o-bad-28"], "url 要是文字");
  assert.deepEqual(r.json.rejected.filter((x) => x.id === "?").map((x) => x.why), ["id 不合格", "id 不合格", "id 不合格", "id 不合格"]);
  assert.equal(r.json.rejected.length, 33);
  // 存下来的:我写的放 mine(网址存标准写法,邮箱的域名统一成小写,空着的不存),状态是待发
  const t = new Date(w.clock).toISOString();
  assert.deepEqual(await reachOf(w, "o-panews-1106"), { id: "o-panews-1106", mine: { channel: "media", target: "PANews 投稿", lang: "zh", url: REACH().url, title: REACH().title, body: REACH().body, why: REACH().why }, status: "待发", decided_at: null, result_note: null, result_url: null, result_at: null, created_at: t, updated_at: t });
  assert.equal((await reachOf(w, "o-sophon-1106")).mine.to, "Team@sophon.example");
  assert.deepEqual(Object.keys((await reachOf(w, "o-norm-1")).mine), ["channel", "target", "lang", "url", "title", "body"]);
  assert.equal((await reachOf(w, "o-norm-1")).mine.url, "https://www.panewslab.com/zh/contribute");
  assert.equal((await reachOf(w, "o-hn-1106")).mine.body.length, 20000);
  // 运营台读得到
  const st = (await w.call("/api/admin/state", { cookie: c })).json;
  assert.deepEqual(st.outreach.map((x) => x.id).sort(), ["o-hn-1106", "o-norm-1", "o-panews-1106", "o-sophon-1106", "o-sophon-2"]);
  assert.deepEqual(Object.keys(st.outreach[0]).sort(), ["created_at", "decided_at", "id", "mine", "result_at", "result_note", "result_url", "status"]);
  // 下一包不带运营规则:按库里的查(官方网址照样放行,子域名、后缀不算)
  w.clock += 1000;
  const r2 = await w.ingest({ outreach: [MAILTO({ id: "o-sophon-3", body: "See https://sophon.example/blog ." }), MAILTO({ id: "o-sophon-4", body: "See https://sophon.example.evil.com/ ." })] });
  assert.deepEqual([r2.json.outreach, r2.json.rejected.map((x) => x.id)], [1, ["o-sophon-4"]]);
  // 运营规则里去掉以后,写在正文里照样不收
  w.clock += 1000;
  const r3 = await w.ingest({ docs: { rules: { officialHosts: [] } }, outreach: [MAILTO({ id: "o-sophon-5", body: "See https://sophon.example/blog ." })] });
  assert.deepEqual([r3.json.outreach, reachWhy(r3)["o-sophon-5"]], [0, "正文含站外链接「sophon.example」" + OFF]);
});

test("宣传投递:一包最多 50 张;邮件标题、标题、正文加起来最多 10 万字,超了的从那一张起不收(回执里说一声,下一包再送)", async () => {
  const w = world();
  const r = await w.ingest({ outreach: Array.from({ length: 52 }, (_, i) => REACH({ id: "o-many-" + i })) });
  assert.equal(r.json.outreach, 50);
  assert.deepEqual(r.json.rejected, [{ kind: "outreach", id: "?", why: "一包最多 50 条:第 51 条起的 2 条没收,下一包再送" }]);
  // 五篇 2 万字的正好 10 万字;第六篇和它后面的(再短也一样)不收
  w.clock += 1000;
  const big = (n, over = {}) => REACH({ id: "o-big-" + n, title: undefined, body: "长".repeat(20000), ...over });
  const r2 = await w.ingest({ outreach: [1, 2, 3, 4, 5, 6].map((n) => big(n)).concat([big(7, { body: "短。" })]) });
  const PACK_WHY = "这一包的宣传稿加起来超过 100000 字:从这一张起没收,下一包再送";
  assert.deepEqual([r2.json.outreach, r2.json.rejected], [5, [{ kind: "outreach", id: "o-big-6", why: PACK_WHY }, { kind: "outreach", id: "o-big-7", why: PACK_WHY }]]);
  w.clock += 1000;
  assert.deepEqual((await w.ingest({ outreach: [big(6), big(7, { body: "短。" })] })).json.outreach, 2, "下一包照收");
});

test("宣传卡片:管理员没点过的,投递整份换新;点过「已发 / 跳过」的,投递改不了(回执写明);改回待发以后又能改;同一包里重复的只收第一条", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ outreach: [REACH(), MAILTO()] });
  const push = async (items) => { w.clock += 1000; return (await w.ingest({ outreach: items })).json; };
  const set = (id, body) => w.call("/api/admin/outreach", { method: "POST", body: { id, ...body }, cookie: c });
  // 没点过:整份换成这次送来的(这次没写的那几样也跟着去掉)
  let r = await push([REACH({ title: undefined, body: "改过的正文。" })]);
  assert.deepEqual([r.outreach, r.rejected], [1, []]);
  const row = await reachOf(w, "o-panews-1106");
  assert.deepEqual([row.mine.body, row.mine.title, row.created_at < row.updated_at], ["改过的正文。", undefined, true]);
  // 管理员点了「已发」「跳过」:投递改不了
  assert.equal((await set("o-panews-1106", { status: "已发" })).json.item.status, "已发");
  assert.equal((await set("o-sophon-1106", { status: "跳过" })).json.item.status, "跳过");
  r = await push([REACH({ body: "又想改一版。" }), MAILTO({ subject: "New subject" })]);
  assert.deepEqual([r.outreach, r.rejected.map((x) => [x.id, x.why])], [0, [["o-panews-1106", "管理员已经处理过,草稿不再改"], ["o-sophon-1106", "管理员已经处理过,草稿不再改"]]]);
  assert.equal((await reachOf(w, "o-panews-1106")).mine.body, "改过的正文。");
  assert.equal((await reachOf(w, "o-sophon-1106")).mine.subject, MAILTO().subject);
  // 改回待发以后又能改;同一包里同一张送了两遍,只收第一遍
  assert.equal((await set("o-panews-1106", { status: "待发" })).status, 200);
  r = await push([REACH({ body: "第三版。" }), REACH({ body: "第四版。" })]);
  assert.deepEqual([r.outreach, r.rejected], [1, [{ kind: "outreach", id: "o-panews-1106", why: "同一包里重复了,只收第一条" }]]);
  assert.equal((await reachOf(w, "o-panews-1106")).mine.body, "第三版。");
});

test("宣传卡片:投递读完状态、还没写的时候管理员点了「已发」:不改,回执照实说", async () => {
  const w = world();
  await w.ingest({ outreach: [REACH()] });
  const real = w.db;
  w.db = { prepare(sql) {
    const st = real.prepare(sql);
    if (!/^SELECT id, status FROM outreach WHERE id IN/.test(sql)) return st;
    return { bind: (...a) => ({ all: async () => { const r = await st.bind(...a).all(); await real.prepare("UPDATE outreach SET status = '已发' WHERE id = ?").bind("o-panews-1106").run(); return r; } }) };
  }, batch: (s) => real.batch(s) };
  w.clock += 1000;
  const r = await w.ingest({ outreach: [REACH({ body: "在途的新正文。" })] });
  w.db = real;
  assert.deepEqual([r.json.outreach, r.json.rejected], [0, [{ kind: "outreach", id: "o-panews-1106", why: "管理员刚处理过这条(点了「已发 / 跳过」),这次没改" }]]);
  assert.equal((await reachOf(w, "o-panews-1106")).mine.body, REACH().body);
});

test("宣传卡片的状态和回音:已发、跳过、改回待发;回音只给已发的记(一句话 + 可选的 https 链接,不收账号密码、IP、端口、别的协议);改成别的状态回音清掉;要登录", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ outreach: [REACH(), MAILTO()] });
  const id = "o-panews-1106";
  const set = (body, cookie = c) => w.call("/api/admin/outreach", { method: "POST", body: { id, ...body }, cookie });
  const err = async (body) => { const r = await set(body); return [r.status, r.json.error]; };
  assert.deepEqual(await err({ result_note: "编辑回了" }), [409, "notsent"]); // 没点「已发」不能记回音
  assert.equal((await set({ status: "已发" }, null)).json.need, "login");
  w.clock += 60000;
  const t1 = new Date(w.clock).toISOString();
  let it = (await set({ status: "已发" })).json.item;
  assert.deepEqual([it.status, it.decided_at, it.result_note], ["已发", t1, null]);
  assert.deepEqual(await err({ status: "已发", result_note: "x" }), [400, "bad"]); // 状态和回音不能同一次改
  assert.deepEqual(await err({ status: "发了" }), [400, "bad"]);
  assert.deepEqual(await err({}), [400, "bad"]);
  assert.equal((await set({ id: "o-none", status: "已发" })).status, 404);
  for (const u of ["http://www.panewslab.com/a", "https://u:p@www.panewslab.com/a", "https://1.2.3.4/a", "javascript:alert(1)", "https://www.panewslab.com:8443/a", "https://xn--pnews-9ra.com/a", "www.panewslab.com/a"]) {
    assert.deepEqual(await err({ result_note: "发出来了", result_url: u }), [400, "badurl"], u);
  }
  assert.deepEqual(await err({ result_note: "x".repeat(301) }), [400, "bad"]);
  assert.deepEqual(await err({ result_note: { toString: null } }), [400, "bad"]);
  assert.deepEqual(await err({ result_url: 5 }), [400, "bad"]);
  w.clock += 1000;
  const t2 = new Date(w.clock).toISOString();
  it = (await set({ result_note: "  编辑回邮件说下周三发 ", result_url: " https://WWW.PanewsLab.com/zh/articles/123?utm=x " })).json.item;
  assert.deepEqual([it.result_note, it.result_url, it.result_at], ["编辑回邮件说下周三发", "https://www.panewslab.com/zh/articles/123?utm=x", t2]);
  // 一次记一整份:只送了链接(空的),没送的那句话也清掉
  it = (await set({ result_url: "" })).json.item;
  assert.deepEqual([it.result_note, it.result_url, it.result_at], [null, null, null]);
  it = (await set({ result_note: "PR 合并了" })).json.item;
  assert.deepEqual([it.result_note, it.result_url, it.result_at], ["PR 合并了", null, t2]);
  // 再点一次「已发」:回音还在;两样都空着:清掉
  assert.equal((await set({ status: "已发" })).json.item.result_note, "PR 合并了");
  it = (await set({ result_note: "", result_url: "" })).json.item;
  assert.deepEqual([it.result_note, it.result_url, it.result_at], [null, null, null]);
  // 改成「跳过」、改回待发:回音清掉,改回待发的时间也清掉
  await set({ result_note: "有回音", result_url: "https://www.panewslab.com/a" });
  it = (await set({ status: "跳过" })).json.item;
  assert.deepEqual([it.status, it.result_note, it.result_url, it.result_at], ["跳过", null, null, null]);
  it = (await set({ status: "待发" })).json.item;
  assert.deepEqual([it.status, it.decided_at], ["待发", null]);
  // 我写的部分一个字都没动
  assert.deepEqual((await reachOf(w, id)).mine, { channel: "media", target: "PANews 投稿", lang: "zh", url: REACH().url, title: REACH().title, body: REACH().body, why: REACH().why });
});

test("导出带宣传卡片:编号、渠道、目标、状态、点的时间、回音(一句话、链接、记的时间);不带正文和收件邮箱;since 只给这之后改过的", async () => {
  const w = world();
  const c = await w.login();
  const t0 = w.clock;
  await w.ingest({ outreach: [REACH(), MAILTO()] });
  const set = (body) => w.call("/api/admin/outreach", { method: "POST", body, cookie: c });
  w.clock += 60000;
  const t1 = new Date(w.clock).toISOString();
  await set({ id: "o-panews-1106", status: "已发" });
  await set({ id: "o-panews-1106", result_note: "编辑回邮件说下周发", result_url: "https://www.panewslab.com/zh/articles/123" });
  w.clock += 1000;
  const r = await w.exp({});
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(r.json.outreach.find((x) => x.id === "o-panews-1106"), { id: "o-panews-1106", channel: "media", target: "PANews 投稿", status: "已发", decided_at: t1, result_note: "编辑回邮件说下周发", result_url: "https://www.panewslab.com/zh/articles/123", result_at: t1 });
  assert.deepEqual(r.json.outreach.find((x) => x.id === "o-sophon-1106"), { id: "o-sophon-1106", channel: "project", target: "Sophon 团队", status: "待发", decided_at: null, result_note: null, result_url: null, result_at: null });
  assert.ok(!/sophon\.example|很多人不知道|corrections welcome|页面底部/i.test(JSON.stringify(r.json)), "不带收件邮箱、正文、邮件标题和我的说明");
  const r2 = await w.exp({ since: new Date(t0 + 1).toISOString() });
  assert.deepEqual(r2.json.outreach.map((x) => x.id), ["o-panews-1106"]);
});

test("按要求删掉一张宣传卡片:那张卡片、写给它那个收件邮箱的(大小写不同也算),以后投递都不收(回执写明为什么);别的照收;库里没有它的邮箱", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ outreach: [REACH(), MAILTO()] });
  const del = (id) => w.call("/api/admin/delete", { method: "POST", body: { kind: "outreach", id }, cookie: c });
  assert.equal((await del("o-sophon-1106")).status, 200);
  assert.equal((await del("o-panews-1106")).status, 200);
  assert.equal((await del({ x: 1 })).status, 400);
  assert.equal((await del("x".repeat(65))).status, 400);
  assert.deepEqual([await reachOf(w, "o-sophon-1106"), await reachOf(w, "o-panews-1106")], [null, null]);
  assert.ok(!(await dumpDb(w)).toLowerCase().includes("team@sophon.example"), "库里没有这个邮箱");
  w.clock += 1000;
  const r = await w.ingest({ outreach: [
    MAILTO(), // 同一张:不收
    MAILTO({ id: "o-sophon-2", to: "team@SOPHON.example" }), // 换了编号、写给同一个邮箱:不收
    MAILTO({ id: "o-sophon-3", to: "press@sophon.example" }), // 别的邮箱:照收
    REACH(), // 删过的投稿卡片:不收
    REACH({ id: "o-panews-2" }), // 投稿卡片换个编号:照收(没有邮箱可挡)
  ] });
  assert.deepEqual(r.json.rejected.map((x) => [x.id, x.why]), [["o-sophon-1106", GONE_WHY], ["o-sophon-2", "这个收件邮箱按要求删过,不再收"], ["o-panews-1106", GONE_WHY]]);
  assert.equal(r.json.outreach, 2);
  // 没删过的卡片改成写给删过的邮箱:也不收,库里还是原来的
  w.clock += 1000;
  const r2 = await w.ingest({ outreach: [MAILTO({ id: "o-sophon-3", to: "Team@sophon.example" })] });
  assert.deepEqual(r2.json.rejected.map((x) => [x.id, x.why]), [["o-sophon-3", "这个收件邮箱按要求删过,不再收"]]);
  assert.equal((await reachOf(w, "o-sophon-3")).mine.to, "press@sophon.example");
  const st = (await w.call("/api/admin/state", { cookie: c })).json;
  assert.deepEqual(st.outreach.map((x) => x.id).sort(), ["o-panews-2", "o-sophon-3"]);
});

test("宣传卡片:投递已经在路上,管理员这时按要求删了它:写不回去(查 gone 和写在同一句),回执写明", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ outreach: [MAILTO()] });
  const real = w.db;
  w.db = { prepare(sql) {
    const st = real.prepare(sql);
    if (!/^SELECT id, status FROM outreach WHERE id IN/.test(sql)) return st;
    return { bind: (...a) => ({ all: async () => {
      const r = await st.bind(...a).all();
      assert.equal((await w.call("/api/admin/delete", { method: "POST", body: { kind: "outreach", id: "o-sophon-1106" }, cookie: c })).status, 200);
      return r;
    } }) };
  }, batch: (s) => real.batch(s) };
  w.clock += 1000;
  const r = await w.ingest({ outreach: [MAILTO({ body: "Updated body." })] });
  w.db = real;
  assert.deepEqual([r.json.outreach, r.json.rejected], [0, [{ kind: "outreach", id: "o-sophon-1106", why: GONE_WHY }]]);
  assert.equal(await reachOf(w, "o-sophon-1106"), null);
});

// ---------- 11-06 第二轮:链接末尾的标点不算链接、宣传稿另用一份敏感词、放行我们自己的仓库、收件邮箱 180 天删 ----------
import { reachWord } from "../server/ops/ingest.js";
import { REACH_TO_DAYS } from "../server/ops/db.js";

test("带协议的链接到哪儿为止(三种规矩都一样):包着它的 markdown、尖括号、括号和末尾的标点不算链接,[x](https://defiexit.com)、<https://defiexit.com>、(see https://defiexit.com/deadlines/). 都读成 defiexit.com;站外的照样拦;11-06 第六轮起,后面紧跟着别的字的不收", () => {
  const REPLY = [], POST = ["defiexit.com", "www.defiexit.com"], IN = [...POST, "blast.io"];
  const ours = ["[x](https://defiexit.com)", "<https://defiexit.com>", "(see https://defiexit.com/deadlines/).", "'https://defiexit.com'", "[https://defiexit.com]", "https://defiexit.com!", "_https://defiexit.com/_",
    "见 https://defiexit.com/deadlines/ 。", "（详见 https://defiexit.com/deadlines/ ）", "官网:https://defiexit.com ，", "<https://defiexit.com>."];
  for (const s of ours) {
    assert.equal(checkText(s, undefined, POST), null, s);
    assert.equal(checkText(s, undefined, IN), null, s);
    assert.match(checkText(s, undefined, REPLY), /^含链接或域名「defiexit\.com」/, s); // 对人的首回照旧一个都不带
  }
  // 第六轮起不收:后面紧跟着引号、反引号、中文标点的(要先空一格);** 是网址字符,算进主机名里
  for (const s of ["\"https://defiexit.com\"", "`https://defiexit.com`", "「https://defiexit.com」", "见 https://defiexit.com/deadlines/。", "（详见 https://defiexit.com/deadlines/）", "官网:https://defiexit.com，", "<https://defiexit.com>）"]) {
    for (const hosts of [POST, IN]) assert.equal(checkText(s, undefined, hosts), NEXT_WHY, s);
  }
  for (const hosts of [POST, IN]) assert.equal(checkText("**https://defiexit.com**", undefined, hosts), "含站外链接「defiexit.com**」");
  // 站外的,包着也一样拦,报的是真正的主机名
  for (const s of ["[x](https://evil.com)", "<https://evil.com>", "(see https://evil.com/x).", "「https://evil.com」"]) {
    for (const hosts of [POST, IN]) assert.equal(checkText(s, undefined, hosts), "含站外链接「evil.com」", s);
    assert.match(checkText(s, undefined, REPLY), /^含链接或域名「evil\.com」/, s);
  }
  // 括号、尖括号后面紧跟着字的:第六轮起直接不收(以前当普通文字接着查);括号里又套着链接的也不收
  for (const s of ["[x](https://defiexit.com)evil.com", "https://defiexit.com/x)evil.com", "<https://defiexit.com>evil.com"]) {
    for (const hosts of [POST, IN]) assert.equal(checkText(s, undefined, hosts), NEXT_WHY, s);
  }
  for (const hosts of [POST, IN]) assert.equal(checkText("https://defiexit.com/x(https://evil.com)", undefined, hosts), BRACKET_WHY);
  // 带反斜杠、@ 的(11-06 起一律不收,见「链接的规矩」;第七轮起反斜杠哪儿都不许有,尖括号里只能正好是一个网址)
  for (const s of ["https://defiexit.com\\evil.com", "https://defiexit.com\\@evil.com"]) for (const hosts of [POST, IN]) assert.equal(checkText(s, undefined, hosts), BACKSLASH_WHY, s);
  for (const hosts of [POST, IN]) {
    assert.equal(checkText("<https://blast.io@evil.com/>", undefined, hosts), MD_WHY);
    assert.equal(checkText("看 https://blast.io@evil.com/", undefined, hosts), "含带 @、% 或反斜杠的网址(网址里不能有这几个字符)");
  }
  // 紧挨着别的字的可疑网址、长得像的写法、http、子域名、IP,照旧
  assert.match(checkText("[x](https://defiexit.com) 官网blast.io", undefined, IN), /^含可疑网址「blast\.io」/);
  assert.match(checkText("(官网blast.io)", undefined, IN), /^含可疑网址「blast\.io」/);
  for (const [s, want] of [["(http://defiexit.com/)", "defiexit.com"], ["(https://defiexit.com.evil.com/)", "defiexit.com.evil.com"], ["[x](https://1.2.3.4/)", "1.2.3.4"], ["看 https：／／evil．com", "evil.com"]]) {
    for (const hosts of [POST, IN]) assert.equal(checkText(s, undefined, hosts), "含站外链接「" + want + "」", s);
  }
  // markdown 的 ]( 后面没紧接着 https:// 的(http://、全角的冒号和斜杠也算没有),第六轮起不收
  for (const s of ["[x](http://defiexit.com/)", "[x](https：／／evil．com)"]) for (const hosts of [POST, IN]) assert.equal(checkText(s, undefined, hosts), MD_WHY, s);
  assert.equal(checkText("(https://blast.io/withdraw).", undefined, IN), null);
  assert.equal(checkText("(https://blast.io/withdraw).", undefined, POST), "含站外链接「blast.io」");
});

test("链接末尾的标点不算链接:投递和管理员改草稿也一样(项目帖、收件续答收,对人的首回照旧不收);11-06 第六轮起,收尾的括号后面紧跟着中文标点的不收", async () => {
  const w = world();
  const c = await w.login();
  const r = await w.ingest({
    docs: { rules: { officialHosts: ["blast.io"] } },
    outbox: [{ id: "p-md-1", kind: "post", topic: "提醒", draft: "步骤见(https://defiexit.com/r/woofi/)." }, OUT({ id: "r-md-1", draft: "步骤见(https://defiexit.com/r/woofi/)." }),
      { id: "p-md-2", kind: "post", topic: "提醒", draft: "步骤见(https://defiexit.com/r/woofi/)。" }],
    inbox: [{ id: "3000000000000000613", text: "怎么取?", author: "user_m", draft: "官方页面 <https://blast.io/withdraw>, 步骤 [在这](https://defiexit.com/r/woofi/)." },
      { id: "3000000000000000614", text: "怎么取?", author: "user_m2", draft: "官方页面 <https://blast.io/withdraw>,步骤在这。" }],
  });
  assert.deepEqual([r.json.outbox, r.json.inbox, r.json.rejected.map((x) => [x.id, x.why])], [1, 1, [["r-md-1", "草稿含链接或域名「defiexit.com」(对人的首回一个都不带,连 defiexit.com 也不带)"], ["p-md-2", "草稿" + NEXT_WHY], ["3000000000000000614", "草稿" + NEXT_WHY]]]);
  const edit = (draft) => w.call("/api/admin/outbox", { method: "POST", body: { id: "p-md-1", draft }, cookie: c });
  assert.equal((await edit("步骤 [在这](https://defiexit.com).")).status, 200);
  assert.equal((await edit("步骤 [在这](https://defiexit.com) 。")).status, 200);
  assert.equal((await edit("步骤 [在这](https://defiexit.com)。")).json.why, NEXT_WHY);
  assert.equal((await edit("步骤 [在这](https://defiexit.com)evil.com")).json.why, NEXT_WHY);
  assert.equal((await edit("步骤 [在这](https://defiexit.com) evil.com")).json.why, "含站外链接「evil.com」");
});

test("宣传稿另用一份敏感词:安全说明照常能写(私钥、助记词、授权、seed phrase、private key、approval、recovery phrase、Disclaimer);只拦招揽和骗局的说法(中文按字面,英文按整词);X 上的回复、项目帖、收件续答照旧用原来那份", async () => {
  const w = world();
  const safe = "我们从不要你的私钥、助记词和密码,也不会让你授权给陌生合约;用完记得撤销授权。\n\nWe never ask for your seed phrase, private key or recovery phrase. Revoke approvals you no longer need.\n\nDisclaimer: this is not financial advice. How to recover funds from a sunset L2, and how to claim what is yours.";
  for (const [s, want] of [["请私信我", "私信我"], ["有问题私聊我", "私聊我"], ["加我微信", "加我微信"], ["欢迎加群", "加群"], ["进群领福利", "进群"], ["加入群聊", "入群"], ["请联系客服", "联系客服"], ["返佣 20%", "返佣"], ["领取空投", "领取空投"], ["转账给我", "转账给我"],
    ["Just DM me", "dm me"], ["DM  ME", "dm me"], ["pm me", "pm me"], ["Message me on X", "message me"], ["Join our Telegram", "join our telegram"], ["WhatsApp me", "whatsapp me"], ["get a rebate", "rebate"], ["Rebates!", "rebates"],
    ["airdrop claim page", "airdrop claim"], ["Claim your airdrop", "claim your airdrop"], ["ｄｍ ｍｅ", "dm me"]]) assert.equal(reachWord(s), want, s);
  for (const s of [safe, "ADMIN messages", "context menu", "reclaim", "the airdrop claimed by scammers", "我们不会私信你,也不用进任何群", "客服都是假的", "Telegram 上的骗子", "空投骗局"]) assert.equal(reachWord(s), null, s);
  const r = await w.ingest({ outreach: [REACH({ id: "o-safe-1", body: safe, title: "We never ask for your private key" }), REACH({ id: "o-scam-1", body: "有问题私信我" }), MAILTO({ id: "o-scam-2", subject: "Join our Telegram" })] });
  assert.deepEqual([r.json.outreach, reachWhy(r)], [1, { "o-scam-1": "正文含不许用的词「私信我」", "o-scam-2": "邮件标题含不许用的词「join our telegram」" }]);
  assert.equal((await reachOf(w, "o-safe-1")).mine.body, safe);
  // 原来那份照旧:对人的回复、项目帖、收件续答里,私钥、seed phrase、claim(连 Disclaimer 也算)都不许
  assert.equal(checkText(safe), "含不许用的词「授权」");
  w.clock += 1000;
  const r2 = await w.ingest({ outbox: [OUT({ id: "r-key-1", draft: "我们不碰你的私钥。" }), { id: "p-key-1", kind: "post", topic: "提醒", draft: "Never share your seed phrase." }], inbox: [{ id: "3000000000000000611", text: "x", author: "user_s", draft: "Disclaimer: not advice." }] });
  assert.deepEqual(r2.json.rejected.map((x) => [x.id, x.why]), [["r-key-1", "草稿含不许用的词「私钥」"], ["p-key-1", "草稿含不许用的词「seed phrase」"], ["3000000000000000611", "草稿含不许用的词「claim」"]]);
});

test("宣传稿放行我们自己的仓库:https://github.com/DPNDolphin/defiexit 和它下面的页面(不分大小写);别的 GitHub 链接照样不收(不带 https:// 的仓库路径第七轮起照收);项目帖、收件续答、管理员改的草稿不放行", async () => {
  const w = world();
  const c = await w.login();
  const ok = ["https://github.com/DPNDolphin/defiexit", "https://github.com/DPNDolphin/defiexit/", "https://github.com/DPNDolphin/defiexit/blob/main/README.md", "https://github.com/dpndolphin/DeFiExit/issues?q=is:open",
    "[源码](https://github.com/DPNDolphin/defiexit)", "<https://github.com/DPNDolphin/defiexit#readme>", "https://github.com:443/DPNDolphin/defiexit", "github.com/DPNDolphin/defiexit"];
  // 带 @、%(编码过的查询也算)的一律不收,报的是这个
  const special = ["https://user@github.com/DPNDolphin/defiexit", "https://github.com/dpndolphin/DeFiExit/issues?q=is%3Aopen"];
  const bad = ["https://github.com/DPNDolphin/defiexit-evil", "https://github.com/DPNDolphin", "https://github.com/DPNDolphin/other", "https://github.com/evil/defiexit", "https://github.com/DPNDolphin/defiexit/../../evil/repo",
    "https://github.com:8443/DPNDolphin/defiexit", "http://github.com/DPNDolphin/defiexit", "https://gist.github.com/DPNDolphin/defiexit", "https://github.com.evil.com/DPNDolphin/defiexit",
    "https://evil.com/github.com/DPNDolphin/defiexit", "https://github.com/DPNDolphin/defiexit.git"];
  const r = await w.ingest({ outreach: [...ok.map((s, i) => REACH({ id: "o-repo-ok-" + i, body: "源码:" + s + " 。" })), ...bad.map((s, i) => REACH({ id: "o-repo-bad-" + i, body: "源码:" + s + " 。" })),
    ...special.map((s, i) => REACH({ id: "o-repo-sp-" + i, body: "源码:" + s + " 。" }))] });
  assert.equal(r.json.outreach, ok.length, JSON.stringify(r.json.rejected));
  const why = reachWhy(r);
  special.forEach((s, i) => assert.equal(why["o-repo-sp-" + i], "正文含带 @、% 或反斜杠的网址(网址里不能有这几个字符)", s));
  bad.forEach((s, i) => (s.includes(":8443") ? assert.equal(why["o-repo-bad-" + i], "正文含带端口的链接「github.com:8443」", s)
    : assert.match(why["o-repo-bad-" + i], /^正文含站外链接「[^」]+」\(宣传稿只许带 defiexit\.com、运营规则 officialHosts 里列的官方网址,和我们自己的仓库 https:\/\/github\.com\/DPNDolphin\/defiexit\)$/, s)));
  assert.equal(why["o-repo-bad-0"].startsWith("正文含站外链接「github.com」"), true);
  // 只给宣传稿:项目帖、收件续答(运营规则里也不加 github.com)、管理员改的项目帖草稿,照旧不收
  w.clock += 1000;
  const REPO = "源码:https://github.com/DPNDolphin/defiexit 。";
  const r2 = await w.ingest({ docs: { rules: { officialHosts: ["blast.io"] } }, outbox: [{ id: "p-repo-1", kind: "post", topic: "开源", draft: "开源项目。" }, { id: "p-repo-2", kind: "post", topic: "开源", draft: REPO }], inbox: [{ id: "3000000000000000612", text: "x", author: "user_r", draft: REPO }] });
  assert.deepEqual(r2.json.rejected.map((x) => [x.id, x.why]), [["p-repo-2", "草稿含站外链接「github.com」"], ["3000000000000000612", "草稿含站外链接「github.com」"]]);
  assert.equal((await w.call("/api/admin/outbox", { method: "POST", body: { id: "p-repo-1", draft: REPO }, cookie: c })).json.why, "含站外链接「github.com」");
});

test("宣传卡片的收件邮箱:点过「已发 / 跳过」满 180 天删掉(只删邮箱,记一个 toGone),没点的不删;改回待发、重新送来又能带上邮箱,重新点了从那时起算", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ outreach: [MAILTO(), MAILTO({ id: "o-skip-1", to: "press@sophon.example" }), MAILTO({ id: "o-wait-1", to: "hello@sophon.example" }), REACH()] });
  const set = (cookie, id, status) => w.call("/api/admin/outreach", { method: "POST", body: { id, status }, cookie });
  for (const [id, st] of [["o-sophon-1106", "已发"], ["o-skip-1", "跳过"], ["o-panews-1106", "已发"]]) assert.equal((await set(c, id, st)).status, 200);
  const toOf = async (id) => (await reachOf(w, id)).mine.to;
  // 差一小时满 180 天:都还在
  w.clock += REACH_TO_DAYS * 864e5 - 3600e3;
  const c2 = await relogin(w);
  await w.call("/api/admin/state", { cookie: c2 });
  assert.deepEqual([await toOf("o-sophon-1106"), await toOf("o-skip-1"), await toOf("o-wait-1")], ["Team@sophon.example", "press@sophon.example", "hello@sophon.example"]);
  // 满 180 天:点过的(已发、跳过)删掉,别的照留;没点过的不删;没有邮箱的不动
  w.clock += 2 * 3600e3;
  const st = (await w.call("/api/admin/state", { cookie: c2 })).json;
  const a = await reachOf(w, "o-sophon-1106");
  assert.deepEqual([a.mine.to, a.mine.toGone, a.mine.subject, a.mine.body, a.status, a.updated_at], [undefined, true, MAILTO().subject, MAILTO().body, "已发", new Date(w.clock).toISOString()]);
  assert.deepEqual([await toOf("o-skip-1"), (await reachOf(w, "o-skip-1")).mine.toGone, await toOf("o-wait-1"), (await reachOf(w, "o-panews-1106")).mine.toGone], [undefined, true, "hello@sophon.example", undefined]);
  assert.equal(st.outreach.find((x) => x.id === "o-sophon-1106").mine.toGone, true, "运营台读得到,页面上写明是到期删的");
  assert.ok(!/team@sophon\.example|press@sophon\.example/i.test(await dumpDb(w)), "库里没有这两个邮箱了");
  // 改回待发,我重新送一张带邮箱的:又有了;再点「已发」从那时起算
  assert.equal((await set(c2, "o-sophon-1106", "待发")).status, 200);
  w.clock += 1000;
  assert.equal((await w.ingest({ outreach: [MAILTO()] })).json.outreach, 1);
  assert.equal((await set(c2, "o-sophon-1106", "已发")).status, 200);
  w.clock += 1000;
  await w.call("/api/admin/state", { cookie: c2 });
  assert.deepEqual([await toOf("o-sophon-1106"), (await reachOf(w, "o-sophon-1106")).mine.toGone], ["Team@sophon.example", undefined]);
});

import { titleWord } from "../server/ops/ingest.js";

test("宣传稿的标题、邮件标题照诊所第 8 条另外避开找回、领取、recover、claim(中文按字面;英文看词头:recovered、recovery、claiming 都算,Disclaimer、reclaim 不算);正文照常能写", async () => {
  const w = world();
  for (const [s, want] of [["如何找回被困资产", "找回"], ["领取指南", "领取"], ["How to recover funds", "recover"], ["Recovered: 52 USDT", "recover"], ["Recovery after a chain shutdown", "recover"],
    ["Claim your USDT", "claim"], ["Claimed!", "claim"], ["CLAIMING guide", "claim"], ["领取空投", "领取空投"], ["Just DM me", "dm me"]]) assert.equal(titleWord(s), want, s);
  for (const s of ["Disclaimer and FAQ", "How to reclaim nothing", "到期金库可自助调用官方合约提取", "Exit deadlines for sunset L2s", "We never ask for your private key"]) assert.equal(titleWord(s), null, s);
  const WHY = "(标题、邮件标题避开找回、领取、recover、claim,正文可以写)";
  const r = await w.ingest({ outreach: [
    REACH({ id: "o-t-1", title: "如何找回被困资产" }), REACH({ id: "o-t-2", title: "How we recovered 52 USDT" }), MAILTO({ id: "o-t-3", subject: "Claiming guide for Sophon users" }),
    REACH({ id: "o-t-4", title: "Claim your airdrop" }),
    REACH({ id: "o-t-ok", title: "Disclaimer: exit deadlines", body: "How to recover funds and claim what is yours. 找回、领取都写在正文里。" }),
  ] });
  assert.deepEqual([r.json.outreach, reachWhy(r)], [1, { "o-t-1": "标题含不许用的词「找回」" + WHY, "o-t-2": "标题含不许用的词「recover」" + WHY, "o-t-3": "邮件标题含不许用的词「claim」" + WHY, "o-t-4": "标题含不许用的词「claim your airdrop」" }]);
  assert.equal((await reachOf(w, "o-t-ok")).mine.body, "How to recover funds and claim what is yours. 找回、领取都写在正文里。");
});

// ---------- 11-06 第三轮(审查后):链接整串按浏览器的读法看、看不见的字符、坏掉的字符、邮箱到期删了以后按要求删、点过的卡片分页 ----------
import { REACH_LIST } from "../server/ops/db.js";
// 看不见的字、坏掉的字都用编号拼出来(源文件里不放这种字)
const ch = (n) => String.fromCharCode(n);
const ZW = ch(0x200b), WJ = ch(0x2060), BOM = ch(0xfeff), ZWJ = ch(0x200d), SHY = ch(0xad), VS16 = ch(0xfe0f), FILL = ch(0x3164), RLO = ch(0x202e), LRI = ch(0x2066), HI = ch(0xd800), LO = ch(0xdc00);
const SPECIAL_WHY = "含带 @、% 或反斜杠的网址(网址里不能有这几个字符)";
const BIDI_WHY = "含会把字倒过来、挪位置显示的方向控制字符(U+202A–202E、U+2066–2069),删掉再送", BROKEN_WHY = "含坏掉的字符(不成对的 UTF-16 代理项),重新复制一遍再送";
const REACH_OFF_WHY = "(宣传稿只许带 defiexit.com、运营规则 officialHosts 里列的官方网址,和我们自己的仓库 https://github.com/DPNDolphin/defiexit)";

test("链接里有 @、% 或反斜杠的一律不收(对人的回复、项目帖、收件续答、宣传稿都一样):https://defiexit.com(a)@evil%2ecom/ 和 %2e、%40、反斜杠、套着括号、带账号名的变体;带端口的不收(:443 照收)", async () => {
  const REPLY = [], POST = ["defiexit.com", "www.defiexit.com"], IN = [...POST, "blast.io"];
  const BS = "\\";
  for (const s of ["https://defiexit.com(a)@evil%2ecom/", "https://defiexit.com(a)@evil.com/", "[x](https://defiexit.com(a)@evil%2ecom/)", "((https://defiexit.com(a)@evil%2ecom/))", "<https://defiexit.com(a)@evil%2ecom/>",
    "https://evil%2ecom/", "https://blast.io@evil%2ecom/", "https://defiexit.com%2f@evil.com", "https://defiexit.com" + BS + "@evil%2ecom", "https://defiexit.com" + BS + "@evil.com/x", "https://defiexit.com" + BS + "x@evil.com/",
    "https://user@defiexit.com/", "https://user:pw@defiexit.com/deadlines/", "https://defiexit.com(a)@defiexit.com/", "[x](https://u@defiexit.com)", "https://defiexit.com%40evil.com/", "https://defiexit%2ecom/",
    // 主机名后面(路径、查询、片段里)的 @ 也不收:我们发的链接用不着
    "https://defiexit.com/@someone", "https://defiexit.com/?from=@x", "https://defiexit.com/#@x", "(https://defiexit.com/deadlines/)@x"]) {
    // 第七轮起:反斜杠哪儿都不许有;markdown、尖括号里只能正好是一个网址(说法换了,照样不收)
    const want = s.includes(BS) ? BACKSLASH_WHY : /^(\[x\]\(|<)/.test(s) ? MD_WHY : SPECIAL_WHY;
    for (const hosts of [POST, IN]) assert.equal(checkText(s, undefined, hosts), want, s);
    assert.notEqual(checkText(s, undefined, REPLY), null, s);
  }
  assert.equal(checkText("https://defiexit.com:8443/deadlines/", undefined, POST), "含带端口的链接「defiexit.com:8443」");
  assert.equal(checkText("https://defiexit.com:443/deadlines/", undefined, POST), null);
  // 投递也一样:项目帖、收件续答、宣传稿都不收
  const w = world();
  const BAD = "官方说明 https://defiexit.com(a)@evil%2ecom/ 。";
  const r = await w.ingest({ docs: { rules: { officialHosts: ["blast.io"] } }, outbox: [{ id: "p-at-1", kind: "post", topic: "提醒", draft: BAD }], inbox: [{ id: "3000000000000000621", text: "x", author: "user_at", draft: BAD }], outreach: [REACH({ id: "o-at-1", body: BAD })] });
  assert.deepEqual([r.json.outbox, r.json.inbox, r.json.outreach], [0, 0, 0]);
  assert.deepEqual(r.json.rejected.map((x) => [x.kind, x.why]), [["outbox", "草稿" + SPECIAL_WHY], ["inbox", "草稿" + SPECIAL_WHY], ["outreach", "正文" + SPECIAL_WHY]]);
});

test("看不见的字符藏不住词和网址(四种规矩都一样):零宽空格、词连接符、BOM、软连字符、变体选择符去掉再查,韩文填充符当空格;会把字倒过来显示的方向控制字符不收;表情里的连接符照常能用;全是看不见的字算空的;原文照存", async () => {
  const REPLY = [], POST = ["defiexit.com", "www.defiexit.com"];
  for (const [s, want] of [["私" + ZW + "信我", "私信我"], ["d" + ZW + "m me", "dm me"], ["私" + WJ + "信我", "私信我"], ["私" + BOM + "信我", "私信我"], ["re" + SHY + "bate", "rebate"], ["私" + VS16 + "信我", "私信我"], ["dm" + FILL + "me", "dm me"]]) {
    assert.equal(reachWord(s), want, JSON.stringify(s));
  }
  assert.equal(titleWord("reco" + ZW + "ver funds"), "recover");
  const w = world();
  const r = await w.ingest({ outreach: [REACH({ id: "o-zw-1", body: "有问题私" + ZW + "信我" }), REACH({ id: "o-zw-2", body: "Just d" + ZW + "m me" }), MAILTO({ id: "o-zw-3", subject: "reco" + ZW + "ver funds" }),
    REACH({ id: "o-zw-4", target: "PANews" + RLO + "投稿" }), REACH({ id: "o-zw-5", body: "去 evil.c" + ZW + "om 看" }), REACH({ id: "o-zw-ok", body: "表情 👨" + ZWJ + "👩" + ZWJ + "👧 照常能用。" })] });
  assert.deepEqual(reachWhy(r), { "o-zw-1": "正文含不许用的词「私信我」", "o-zw-2": "正文含不许用的词「dm me」", "o-zw-3": "邮件标题含不许用的词「recover」(标题、邮件标题避开找回、领取、recover、claim,正文可以写)",
    "o-zw-4": "target " + BIDI_WHY, "o-zw-5": "正文含站外链接「evil.com」" + REACH_OFF_WHY });
  assert.equal((await reachOf(w, "o-zw-ok")).mine.body, "表情 👨" + ZWJ + "👩" + ZWJ + "👧 照常能用。", "原文照存");
  // 对人的回复、项目帖、收件续答:原来那份敏感词和网址检查照样藏不住
  assert.match(checkText("去 evil.c" + ZW + "om 看", undefined, REPLY), /^含链接或域名「evil\.com」/);
  assert.equal(checkText("去 evil.c" + ZW + "om 看", undefined, POST), "含站外链接「evil.com」");
  assert.equal(checkText("去 https://evil.c" + ZW + "om/ 看", undefined, POST), "含站外链接「evil.com」");
  assert.equal(checkText("可以私" + ZW + "信", undefined, REPLY), "含不许用的词「私信」");
  assert.equal(checkText("seed" + SHY + " phrase", undefined, REPLY), "含不许用的词「seed phrase」");
  for (const s of ["abc" + RLO + "moc.live", "到期" + LRI + "金库"]) for (const hosts of [REPLY, POST]) assert.equal(checkText(s, undefined, hosts), BIDI_WHY, JSON.stringify(s));
  assert.equal(checkText("👨" + ZWJ + "👩" + ZWJ + "👧 到期金库可以自己取出。", undefined, REPLY), null, "表情里的连接符照常能用");
  assert.equal(checkText(ZW + WJ + ZW, undefined, POST), "是空的");
  w.clock += 1000;
  const r2 = await w.ingest({ outbox: [OUT({ id: "r-zw-1", draft: "可以私" + ZW + "信我" }), { id: "p-zw-1", kind: "post", topic: "提醒", draft: "去 evil.c" + ZW + "om 看" }] });
  assert.deepEqual(r2.json.rejected.map((x) => [x.id, x.why]), [["r-zw-1", "草稿含不许用的词「私信」"], ["p-zw-1", "草稿含站外链接「evil.com」"]]);
});

test("坏掉的字符(不成对的 UTF-16 代理项)不收:宣传卡片每个字段都查,对人的回复、项目帖、收件续答的草稿也查;成对的(表情)照收", async () => {
  const w = world();
  const r = await w.ingest({
    outreach: [MAILTO({ id: "o-sur-1", body: "hello" + HI }), REACH({ id: "o-sur-2", target: "PANews" + LO }), REACH({ id: "o-sur-3", why: "说明" + HI }), REACH({ id: "o-sur-4", title: LO + "标题" }), REACH({ id: "o-sur-ok", body: "表情 😀 照收。" })],
    outbox: [OUT({ id: "r-sur-1", draft: "到期金库" + HI })],
    inbox: [{ id: "3000000000000000622", text: "x", author: "user_sur", draft: "好的" + LO }],
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.outreach, r.json.outbox, r.json.inbox], [1, 0, 0]);
  assert.deepEqual(reachWhy(r), { "o-sur-1": "body " + BROKEN_WHY, "o-sur-2": "target " + BROKEN_WHY, "o-sur-3": "why " + BROKEN_WHY, "o-sur-4": "title " + BROKEN_WHY });
  assert.deepEqual(r.json.rejected.filter((x) => x.kind !== "outreach").map((x) => [x.id, x.why]), [["r-sur-1", "草稿" + BROKEN_WHY], ["3000000000000000622", "草稿" + BROKEN_WHY]]);
});

test("收件邮箱 180 天到期删了以后再按要求删这张卡片:用到期时留下的哈希,写给这个邮箱的照样不收;库里没有邮箱的明文", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ outreach: [MAILTO()] });
  assert.equal((await w.call("/api/admin/outreach", { method: "POST", body: { id: "o-sophon-1106", status: "已发" }, cookie: c })).status, 200);
  w.clock += (REACH_TO_DAYS + 1) * 864e5;
  const c2 = await relogin(w);
  await w.call("/api/admin/state", { cookie: c2 });
  const m = (await reachOf(w, "o-sophon-1106")).mine;
  assert.deepEqual([m.to, m.toGone, m.toKey], [undefined, true, await goneKey("to:team@sophon.example")]);
  assert.ok(!/team@sophon\.example/i.test(await dumpDb(w)), "库里没有邮箱的明文");
  assert.equal((await w.call("/api/admin/delete", { method: "POST", body: { kind: "outreach", id: "o-sophon-1106" }, cookie: c2 })).status, 200);
  w.clock += 1000;
  const r = await w.ingest({ outreach: [MAILTO({ id: "o-sophon-9", to: "TEAM@sophon.example" }), MAILTO({ id: "o-sophon-10", to: "press@sophon.example" })] });
  assert.deepEqual([r.json.outreach, r.json.rejected.map((x) => [x.id, x.why])], [1, [["o-sophon-9", "这个收件邮箱按要求删过,不再收"]]]);
});

test("点过的宣传卡片分页:运营台给全部没点的(再早送来的也在)和最近点过的一页,点过的一共几张从库里数;更早的按点的时间往前一页页翻(时间一样的按编号),不漏不重;要登录", async () => {
  const keep = { ...REACH_LIST };
  REACH_LIST.page = 3;
  try {
    const w = world();
    const c = await w.login();
    await w.ingest({ outreach: [REACH({ id: "o-old-pending" })] });
    w.clock += 1000;
    await w.ingest({ outreach: [1, 2, 3, 4, 5].map((n) => REACH({ id: "o-sent-" + n })) });
    // o-sent-2、o-sent-3 同一刻点的(正好跨在第一页和第二页之间)
    for (const n of [1, 2, 3, 4, 5]) {
      if (n !== 3) w.clock += 1000;
      assert.equal((await w.call("/api/admin/outreach", { method: "POST", body: { id: "o-sent-" + n, status: "已发" }, cookie: c })).status, 200);
    }
    const st = (await w.call("/api/admin/state", { cookie: c })).json;
    assert.deepEqual(st.outreach.map((x) => x.id), ["o-old-pending", "o-sent-5", "o-sent-4", "o-sent-3"]);
    assert.deepEqual(st.outreachMore, { handled: 2, after: { at: st.outreach[3].decided_at, id: "o-sent-3" } });
    const page = (at, id, cookie = c) => w.call("/api/admin/outreach-done?at=" + encodeURIComponent(at) + "&id=" + encodeURIComponent(id), { cookie });
    let p = await page(st.outreachMore.after.at, "o-sent-3");
    assert.deepEqual([p.status, p.json.items.map((x) => x.id), p.json.more], [200, ["o-sent-2", "o-sent-1"], 0]);
    assert.equal(p.json.items[0].decided_at, st.outreachMore.after.at, "和第一页最后一张同一刻点的,接着给,没漏");
    p = await page(p.json.after.at, p.json.after.id);
    assert.deepEqual([p.json.items, p.json.more, p.json.after], [[], 0, null]);
    assert.equal((await page("", "")).status, 400);
    assert.equal((await page(st.outreachMore.after.at, "o-sent-3", null)).json.need, "login");
  } finally {
    Object.assign(REACH_LIST, keep);
  }
});

// ---------- 11-06 第四轮(复审后):链接后面紧跟着的话不算主机名、仓库链接按浏览器真正去的路径查;第六轮起紧跟着的不收 ----------
test("链接后面紧跟着的话(项目帖、收件续答、宣传稿、管理员改的草稿都一样):第六轮起要先空一格,官网： https://defiexit.com （100%免费） 照收,官网：https://defiexit.com（100%免费） 不收;https://defiexit.com(a)@evil%2ecom/ 照样不收", async () => {
  const POST = ["defiexit.com", "www.defiexit.com"], IN = [...POST, "blast.io"];
  const spaced = ["官网： https://defiexit.com （100%免费）", "https://defiexit.com （@DeFiExit）", "https://defiexit.com （免费）", "https://defiexit.com ）后面",
    "https://defiexit.com 】后面", "https://defiexit.com 」后面", "https://defiexit.com 。后面", "https://defiexit.com ，后面", "(see https://defiexit.com).", "[x](https://defiexit.com/en/)\n下一段"];
  for (const s of spaced) for (const hosts of [POST, IN]) assert.equal(checkText(s, undefined, hosts), null, s);
  // 紧跟着的(全角标点、汉字、左括号):不收
  const glued = ["官网：https://defiexit.com（100%免费）", "https://defiexit.com（@DeFiExit）", "https://defiexit.com（免费）", "https://defiexit.com）后面",
    "https://defiexit.com】后面", "https://defiexit.com」后面", "https://defiexit.com。后面", "https://defiexit.com，后面", "https://defiexit.com后面"];
  for (const s of glued) for (const hosts of [POST, IN]) assert.equal(checkText(s, undefined, hosts), NEXT_WHY, s);
  for (const hosts of [POST, IN]) assert.equal(checkText("https://defiexit.com(免费)", undefined, hosts), BRACKET_WHY);
  // 空开以后,跟着的话里真有站外网址的,照样拦
  for (const s of ["https://defiexit.com （@evil.com）", "https://defiexit.com ，见 evil.com"]) for (const hosts of [POST, IN]) assert.equal(checkText(s, undefined, hosts), "含站外链接「evil.com」", s);
  for (const s of ["https://defiexit.com,@evil.com", "https://defiexit.com(a)@evil%2ecom/"]) for (const hosts of [POST, IN]) assert.equal(checkText(s, undefined, hosts), SPECIAL_WHY, s);
  for (const hosts of [POST, IN]) assert.equal(checkText("[x](https://defiexit.com(a)@evil%2ecom)", undefined, hosts), MD_WHY);
  const w = world();
  const c = await w.login();
  const BAD = "官方说明 https://defiexit.com(a)@evil%2ecom/ 。";
  const r = await w.ingest({
    docs: { rules: { officialHosts: ["blast.io"] } },
    outbox: [...spaced.map((s, i) => ({ id: "p-prose-" + i, kind: "post", topic: "提醒", draft: s })), { id: "p-prose-bad", kind: "post", topic: "提醒", draft: BAD }, { id: "p-prose-glued", kind: "post", topic: "提醒", draft: glued[0] }],
    inbox: [...spaced.map((s, i) => ({ id: "30000000000000007" + String(i).padStart(2, "0"), text: "x", author: "user_p" + i, draft: s })), { id: "3000000000000000799", text: "x", author: "user_pb", draft: BAD }, { id: "3000000000000000798", text: "x", author: "user_pg", draft: glued[0] }],
    outreach: [REACH({ id: "o-prose-1", body: spaced.join("\n") }), REACH({ id: "o-prose-bad", body: BAD }), REACH({ id: "o-prose-glued", body: glued[0] })],
  });
  assert.deepEqual([r.json.outbox, r.json.inbox, r.json.outreach], [spaced.length, spaced.length, 1], JSON.stringify(r.json.rejected));
  assert.deepEqual(r.json.rejected.map((x) => [x.id, x.why]), [["p-prose-bad", "草稿" + SPECIAL_WHY], ["p-prose-glued", "草稿" + NEXT_WHY], ["3000000000000000799", "草稿" + SPECIAL_WHY], ["3000000000000000798", "草稿" + NEXT_WHY],
    ["o-prose-bad", "正文" + SPECIAL_WHY], ["o-prose-glued", "正文" + NEXT_WHY]]);
  const edit = (draft) => w.call("/api/admin/outbox", { method: "POST", body: { id: "p-prose-0", draft }, cookie: c });
  assert.equal((await edit("官网： https://defiexit.com （100%免费）")).status, 200);
  assert.equal((await edit("https://defiexit.com （@DeFiExit）")).status, 200);
  assert.deepEqual([(await edit("官网：https://defiexit.com（100%免费）")).json.why, (await edit("https://defiexit.com（@DeFiExit）")).json.why], [NEXT_WHY, NEXT_WHY]);
  assert.equal((await edit(BAD)).json.why, SPECIAL_WHY);
});

test("宣传稿放行我们自己的仓库,按浏览器真正去的路径查:[source](https://github.com/DPNDolphin/defiexit(a)/../../attacker/repo) 去的是 /attacker/repo,不收;编码过的 ../ 也不收;仓库链接后面空一格再接话照收", async () => {
  const w = world();
  const bad = ["[source](https://github.com/DPNDolphin/defiexit(a)/../../attacker/repo)", "https://github.com/DPNDolphin/defiexit(a)/../../attacker/repo", "https://github.com/DPNDolphin/defiexit%2f..%2f..%2fattacker",
    "https://github.com/DPNDolphin/defiexit/%2e%2e/%2e%2e/attacker/repo", "https://github.com/DPNDolphin/defiexit(/../../attacker)"];
  const ok = ["https://github.com/DPNDolphin/defiexit （源码）", "https://github.com/DPNDolphin/defiexit ，源码在这", "https://github.com/DPNDolphin/defiexit 。源码在这", "[源码](https://github.com/DPNDolphin/defiexit/blob/main/README.md)"];
  const glued = ["https://github.com/DPNDolphin/defiexit（源码）", "https://github.com/DPNDolphin/defiexit，源码在这", "https://github.com/DPNDolphin/defiexit。源码在这"];
  const r = await w.ingest({ outreach: [...bad.map((s, i) => REACH({ id: "o-ghp-bad-" + i, body: "源码 " + s })), ...ok.map((s, i) => REACH({ id: "o-ghp-ok-" + i, body: "源码 " + s })), ...glued.map((s, i) => REACH({ id: "o-ghp-glued-" + i, body: "源码 " + s }))] });
  assert.equal(r.json.outreach, ok.length, JSON.stringify(r.json.rejected));
  const why = reachWhy(r);
  bad.forEach((s, i) => assert.equal(why["o-ghp-bad-" + i], /%/.test(s) ? "正文" + SPECIAL_WHY : s.startsWith("[") ? "正文" + MD_WHY : "正文" + BRACKET_WHY, s));
  glued.forEach((s, i) => assert.equal(why["o-ghp-glued-" + i], "正文" + NEXT_WHY, s));
});

// ---------- 11-06 第五轮:链接的规矩改成严格、简单的(见 ingest.js 的「链接的规矩」);第六轮更严 ----------
test("链接的规矩(第五、六轮):我们平常写的链接照收,后面要空一格(或者收尾的英文标点、结尾);带 @、%、反斜杠的、IDN 和 IPv6 借道的、主机名不在名单上的不收;对人的回复、项目帖、收件续答、宣传稿都一样", async () => {
  const REPLY = [], POST = ["defiexit.com", "www.defiexit.com"], IN = [...POST, "blast.io"];
  const ours = ["https://defiexit.com", "https://www.defiexit.com/en/deadlines/#summerfi-winddown", "https://defiexit.com/deadlines/?nc=1", "https://defiexit.com:443/deadlines/"];
  const tails = [" 。", " ，下一句", " （100%免费）", " （@DeFiExit）", "", ".", "!", ").", "\n下一段", "\t下一句"];
  const glued = ["，下一句", "。下一句", "）", "】下一句", "」下一句", "（100%免费）", "（@DeFiExit）", ".下一句", ")下一句", "\"", "ｍｕｎｉｔｙ"];
  for (const link of ours) {
    for (const tail of tails) {
      const s = "官网：" + link + tail;
      for (const hosts of [POST, IN]) assert.equal(checkText(s, undefined, hosts), null, s);
      assert.match(checkText(s, undefined, REPLY), /^含链接或域名「(www\.)?defiexit\.com」/, s); // 对人的首回照旧一个链接都不带
    }
    for (const tail of glued) for (const hosts of [POST, IN]) assert.equal(checkText("官网：" + link + tail, undefined, hosts), NEXT_WHY, link + tail);
  }
  assert.equal(checkText("官方页面 https://blast.io/withdraw 。", undefined, IN), null, "运营规则里的官方网址");
  // 第五轮 Codex 的:IDN 编码、IPv6 借道 @ 的,前两轮的 (a)@evil%2ecom
  const special = ["https://defiexit.com;@xn--bcher-kva%2ecom/", "https://defiexit.com(a)@xn--bcher-kva%2ecom/", "https://defiexit.com;@[2001:db8::1]/", "https://defiexit.com;@evil.com", "https://defiexit.com(a)@evil%2ecom/"];
  for (const s of special) for (const hosts of [REPLY, POST, IN]) assert.equal(checkText(s, undefined, hosts), SPECIAL_WHY, s);
  for (const [s, host] of [["https://evil.com,defiexit.com", "evil.com,defiexit.com"], ["https://xn--bcher-kva.com/", "xn--bcher-kva.com"], ["https://1.2.3.4/x", "1.2.3.4"], ["见 evil.com", "evil.com"]]) {
    for (const hosts of [POST, IN]) assert.equal(checkText(s, undefined, hosts), "含站外链接「" + host + "」", s);
  }
  for (const hosts of [POST, IN]) assert.equal(checkText("https://[2001:db8::1]/", undefined, hosts), BRACKET_WHY); // 第六轮起网址里不许有 [ ]
  // 投递:项目帖、收件续答、宣传稿(以前第一条收进库里了)
  const w = world();
  const r = await w.ingest({
    docs: { rules: { officialHosts: ["blast.io"] } },
    outbox: [...special.map((s, i) => ({ id: "p-r5-" + i, kind: "post", topic: "提醒", draft: "看 " + s })), { id: "p-r5-ok", kind: "post", topic: "提醒", draft: "官网： https://defiexit.com （100%免费）" }],
    inbox: [{ id: "3000000000000000831", text: "x", author: "user_r5", draft: "看 " + special[0] }],
    outreach: [REACH({ id: "o-r5-1", body: "看 " + special[0] }), REACH({ id: "o-r5-2", body: "看 https://evil.com,defiexit.com" }), REACH({ id: "o-r5-ok", body: "官网： https://defiexit.com （100%免费）\n\nhttps://blast.io/withdraw" })],
  });
  assert.deepEqual([r.json.outbox, r.json.inbox, r.json.outreach], [1, 0, 1], JSON.stringify(r.json.rejected));
  assert.deepEqual(r.json.rejected.map((x) => [x.id, x.why]), [...special.map((s, i) => ["p-r5-" + i, "草稿" + SPECIAL_WHY]), ["3000000000000000831", "草稿" + SPECIAL_WHY],
    ["o-r5-1", "正文" + SPECIAL_WHY], ["o-r5-2", "正文含站外链接「evil.com,defiexit.com」" + REACH_OFF_WHY]]);
});

test("链接的规矩(第五轮):GitHub 只放行我们的仓库,解析出来的路径是 /DPNDolphin/defiexit 或者它下面的;原样的路径里有 . 或 .. 这一段的不收,compare/main...x 照收", async () => {
  const w = world();
  const ok = ["https://github.com/DPNDolphin/defiexit/blob/main/README.md", "https://github.com/DPNDolphin/defiexit#readme", "https://github.com/DPNDolphin/defiexit/issues/1",
    "https://github.com/DPNDolphin/defiexit/compare/main...release-1106", "https://github.com/DPNDolphin/defiexit/compare/main...x", "https://github.com/dpndolphin/DeFiExit", "[源码](https://github.com/DPNDolphin/defiexit)"];
  const bad = ["https://github.com/DPNDolphin/defiexit/./x", "https://github.com/DPNDolphin/defiexit/..", "https://github.com/DPNDolphin/defiexit/../defiexit", "https://github.com/DPNDolphin/defiexit/x/../..",
    "https://github.com/DPNDolphin/defiexitx", "https://github.com/DPNDolphin/defiexit.git"];
  const r = await w.ingest({ outreach: [...ok.map((s, i) => REACH({ id: "o-g5-ok-" + i, body: "源码 " + s + " 。" })), ...bad.map((s, i) => REACH({ id: "o-g5-bad-" + i, body: "源码 " + s + " 。" })),
    REACH({ id: "o-g5-paren", body: "源码 [source](https://github.com/DPNDolphin/defiexit(a)/../../attacker/repo) 。" })] });
  assert.equal(r.json.outreach, ok.length, JSON.stringify(r.json.rejected));
  const why = reachWhy(r);
  bad.forEach((s, i) => assert.equal(why["o-g5-bad-" + i], "正文含站外链接「github.com」" + REACH_OFF_WHY, s));
  assert.equal(why["o-g5-paren"], "正文" + MD_WHY); // 第六轮起网址里有 ( 就不收;第七轮起 markdown 里只能正好是一个网址
});

// ---------- 11-06 第六轮:链接后面先空一格;网址里不许有 [ ] ( < >;markdown 的 ]( 和 < 后面要紧接着 https://;// 要写全 https://;不许有 HTML 实体 ----------
import { cleanReach } from "../server/ops/ingest.js";

test("链接的规矩(第六轮):Codex 第四轮的几条都不收;后面紧跟着字的、网址里有括号的、markdown 和尖括号里不是 https:// 的、省掉协议的、HTML 实体,都不收;写对了的照收", async () => {
  const REPLY = [], POST = ["defiexit.com", "www.defiexit.com"], IN = [...POST, "blast.io"], B = ch(92);
  const codex = [
    ["[x](https://defiexit.com（@%65%76%69%6c%2e%63%6f%6d/)", MD_WHY], // 第七轮起 markdown 里只能正好是一个网址(第六轮是 NEXT_WHY) // 浏览器认的主机名到 / 才结束,去的是 evil.com
    ["https://defiexit.comｍｕｎｉｔｙ", NEXT_WHY], // 全角字母照样算主机名,去的是 defiexit.community
    ["https://defiexit.com/[x](//evil.com)", SLASHES_WHY], // markdown 把 x 画成去 evil.com 的链接
    ["[x](https&#58;//evil&#46;com)", ENTITY_WHY], // markdown 把 &#58; 换回冒号,去的是 evil.com
    ["[x](//0x08080808)", SLASHES_WHY], // 去的是 8.8.8.8
  ];
  for (const [s, want] of codex) {
    for (const hosts of [POST, IN]) assert.equal(checkText(s, undefined, hosts), want, s);
    assert.notEqual(checkText(s, undefined, REPLY), null, s);
  }
  // K:后面紧跟着的(看不见的字符隔着的全角字母、汉字、链接里又套着链接、< > 外面紧跟着的)
  const next = ["https://defiexit.com" + ZW + "ｍｕｎｉｔｙ", "https://defiexit.comＭＵＮＩＴＹ", "https://defiexit.com/en/中文", "https://defiexit.com/?u=https://evil.com", "https://defiexit.com/https://defiexit.com/",
    "站 defiexit.com，只请", "defiexit.com（免费）", "<https://defiexit.com>）", "<https://defiexit.com>x", "https://defiexit.com/x]y"];
  for (const s of next) for (const hosts of [POST, IN]) assert.equal(checkText(s, undefined, hosts), NEXT_WHY, s);
  for (const hosts of [POST, IN]) assert.equal(checkText("https://defiexit.com's docs", undefined, hosts), "含站外链接「defiexit.com's」"); // ' 是网址字符,算进主机名里
  // L:网址里不许有 [ ] ( < >
  for (const s of ["https://defiexit.com/[x]", "https://defiexit.com/a(b)", "https://defiexit.com(", "https://defiexit.com[", "https://defiexit.com/a)(b", "https://defiexit.com<x", "https://defiexit.com>x", "defiexit.com/a(b)"]) {
    for (const hosts of [POST, IN]) assert.equal(checkText(s, undefined, hosts), BRACKET_WHY, s);
  }
  // M:markdown 的 ]( 后面、< 后面紧跟着协议或 // 的,都要紧接着 https://
  for (const s of ["[x](javascript:alert(1))", "[x]( https://defiexit.com)", "[x](<https://defiexit.com>)", "[x](http://defiexit.com)", "[x](mailto:a@defiexit.com)", "[x](defiexit.com)", "[x](/en/)",
    "<javascript:alert(1)>", "<mailto:a@defiexit.com>", "<http://defiexit.com>"]) {
    for (const hosts of [REPLY, POST, IN]) assert.equal(checkText(s, undefined, hosts), MD_WHY, s);
  }
  // N:// 前面要紧挨着 http: 或 https:,http: / https: 后面要是 //(全角的统一写法以后照样查)
  for (const s of ["//evil.com", "看 //defiexit.com", "<//evil.com>", "https:///evil.com", "https:0x08080808", "http:evil.com", "ftp://x.org", "ｈｔｔｐｓ：／／／evil.com", "[x](／／evil.com)", "https://defiexit.com/a//b", "转发//@某人"]) {
    for (const hosts of [REPLY, POST, IN]) assert.equal(checkText(s, undefined, hosts), SLASHES_WHY, s);
  }
  for (const hosts of [REPLY, POST, IN]) assert.equal(checkText("https:/" + B + "evil.com", undefined, hosts), BACKSLASH_WHY); // 第七轮起反斜杠哪儿都不许有
  // O:HTML 实体(数字的不带分号浏览器也认;全角的统一写法以后照样查)
  for (const s of ["&#58;", "&#x3a;", "&#X3A;", "&colon;", "&amp;", "&frac12;", "&#58", "https&#58;//evil.com", "＆＃５８；"]) {
    for (const hosts of [REPLY, POST, IN]) assert.equal(checkText("看 " + s, undefined, hosts), ENTITY_WHY, s);
  }
  // HTML 标签:浏览器解析网址时去掉中间的 Tab、换行,href 里的链接后面空了一行也挡不住(另加的一条)
  const NL = ch(10), TAB = ch(9);
  for (const s of ["<a href=\"https://defiexit.com" + NL + "munity\">x</a>", "<img src=\"https://defiexit.com" + TAB + "munity/x.png\">", "<a href=https://defiexit.com>x</a>", "第一行<br>第二行", "<br/>", "</a>", "<details>"]) {
    for (const hosts of [REPLY, POST, IN]) assert.equal(checkText(s, undefined, hosts), "不能有 HTML 标签(<a>、<img> 这种)", s);
  }
  // 写对了的照收
  const ok = ["5 <10 个", "x<=y", "<3", "官网： https://defiexit.com （100%免费）", "(see https://defiexit.com).", "[x](https://defiexit.com/en/)\n下一段", "<https://defiexit.com>", "<https://defiexit.com>.", "[x](HTTPS://defiexit.com)", "HTTPS://defiexit.com/en/",
    "站 defiexit.com ，只请", "R&D 团队和 Q&A", "AT&T", "1/2 和 a/b", "'https://defiexit.com'", "(https://blast.io/withdraw)"];
  for (const s of ok) assert.equal(checkText(s, undefined, IN), null, s);
  // 投递:项目帖、收件续答、宣传稿(正文、邮件标题)都不收;管理员改草稿也不收
  const w = world();
  const c = await w.login();
  const r = await w.ingest({
    docs: { rules: { officialHosts: ["blast.io"] } },
    outbox: [...codex.map(([s], i) => ({ id: "p-r6-" + i, kind: "post", topic: "提醒", draft: "看 " + s })), { id: "p-r6-ok", kind: "post", topic: "提醒", draft: "官网： https://defiexit.com （100%免费）" }],
    inbox: codex.map(([s], i) => ({ id: "300000000000000090" + i, text: "x", author: "user_r6" + i, draft: "看 " + s })),
    outreach: [...codex.map(([s], i) => REACH({ id: "o-r6-" + i, body: "看 " + s })), MAILTO({ id: "o-r6-subj", subject: "See https://defiexit.com（docs）" }),
      REACH({ id: "o-r6-ok", body: "官网： https://defiexit.com （100%免费）\n\n[source](https://github.com/DPNDolphin/defiexit)\n\n<https://blast.io/withdraw>" })],
  });
  assert.deepEqual([r.json.outbox, r.json.inbox, r.json.outreach], [1, 0, 1], JSON.stringify(r.json.rejected));
  assert.deepEqual(r.json.rejected.map((x) => [x.id, x.why]), [...codex.map(([, want], i) => ["p-r6-" + i, "草稿" + want]), ...codex.map(([, want], i) => ["300000000000000090" + i, "草稿" + want]),
    ...codex.map(([, want], i) => ["o-r6-" + i, "正文" + want]), ["o-r6-subj", "邮件标题" + NEXT_WHY]]);
  for (const [s, want] of codex) {
    const e = await w.call("/api/admin/outbox", { method: "POST", body: { id: "p-r6-ok", draft: "看 " + s }, cookie: c });
    assert.deepEqual([e.status, e.json.why], [400, want], s);
  }
});

test("现在的种子稿里的每一个链接(11-06 取的样子:前三个字、链接、后两个字)照收;只有置顶帖那一处「defiexit.com，」不收,要先空一格", () => {
  const POST = ["defiexit.com", "www.defiexit.com"];
  const reach = ["s](https://defiexit.com/en/)\n\n", "e: https://github.com/DPNDolphin/defiexit\n\n", "s:\nhttps://defiexit.com/en/deadlines/\n\n", "): https://github.com/DPNDolphin/defiexit\n\n",
    "it\nhttps://defiexit.com/ ·", " · https://github.com/DPNDolphin/defiexit", "p: https://defiexit.com/en/deadlines/#stargate-stg-zro\n-", "s: https://defiexit.com/en/deadlines/#stargate-v1-pools\n\n",
    "e:\nhttps://defiexit.com/en/deadlines/#standx-winddown\n\n", "e:\nhttps://defiexit.com/en/deadlines/#universal-uassets-winddown\n\n"];
  for (const s of reach) assert.equal(cleanReach(REACH({ body: "看 " + s }), POST).error, undefined, s);
  const posts = ["步骤：defiexit.com", "友。 https://defiexit.com/deadlines/", "一图:defiexit.com/r/okx-boost/", "e: defiexit.com. I", "打钱。defiexit.com\n\n", "e. https://defiexit.com/en/deadlines/#summerfi-winddown"];
  for (const s of posts) assert.equal(checkText(s, undefined, POST), null, s);
  assert.equal(checkText("以在 defiexit.com 输", undefined, [...POST, "blast.io"]), null); // 收件续答
  assert.equal(checkText("网站 defiexit.com，只", undefined, POST), NEXT_WHY); // 置顶帖 p-pin-1106:要写成「defiexit.com ，」
});

// ---------- 11-06 第七轮:不去细抠 markdown,用得着的写法以外一律不收 ----------
test("链接的规矩(第七轮):Codex 第五轮的几条都不收;反斜杠、引用式链接、特殊空格、markdown 和尖括号里不是正好一个网址的,都不收;不带 https:// 的仓库路径照收", async () => {
  const REPLY = [], POST = ["defiexit.com", "www.defiexit.com"], IN = [...POST, "blast.io"], B = ch(92), NB = ch(0xa0), NL = ch(10), TAB = ch(9);
  const escaped = "[1]: https" + B + ":" + B + "/" + B + "/evil" + B + ".com";
  const codex = [
    ["[x](https://defiexit.com" + NB + "@0x08080808)", ODD_SPACE_WHY], // markdown 把不换行空格算进链接里,去的是 8.8.8.8
    ["<https://defiexit.com @0x08080808>", MD_WHY],
    ["[x][1]" + NL + NL + escaped, BACKSLASH_WHY], // 引用式链接加反斜杠转义,显示出来去的是 evil.com
    ["![x][1]" + NL + NL + escaped, BACKSLASH_WHY],
  ];
  for (const [s, want] of codex) for (const hosts of [REPLY, POST, IN]) assert.equal(checkText(s, undefined, hosts), want, s);
  // R:反斜杠哪儿都不许有(全角的统一写法以后也算)
  for (const s of ["a" + B + "b", "C:" + B + "Users", B + "*强调" + B + "*", "看 ＼ 这个", "看 ﹨ 这个"]) for (const hosts of [REPLY, POST, IN]) assert.equal(checkText(s, undefined, hosts), BACKSLASH_WHY, s);
  // S:引用式链接(定义放在引用块、列表里的也算;本站的也不收),和 [文字][1]、[文字][]、![图][1] 这种用法
  for (const s of ["[1]: https://evil.com", "[1]: https://defiexit.com", "   [1]: https://defiexit.com", "> [1]: https://defiexit.com", "- [1]: https://defiexit.com", "看 [官网][1]", "看 [官网][]", "![图][1]",
    "[x][1]" + NL + NL + "[1]: https://defiexit.com"]) {
    for (const hosts of [REPLY, POST, IN]) assert.equal(checkText(s, undefined, hosts), REF_WHY, s);
  }
  // T:特殊空格(放在头尾的也算);Tab 在链接外面照收,在 ](…)、<…> 里面不收
  for (const n of [0xa0, 0x1680, 0x2000, 0x2005, 0x200a, 0x202f, 0x205f, 0x3000, 0xfeff, 0x2028, 0x2029, 0x85]) {
    for (const s of ["官网" + ch(n) + "https://defiexit.com", ch(n) + "官网", "官网" + ch(n), "https://defiexit.com" + ch(n) + "munity"]) {
      for (const hosts of [REPLY, POST, IN]) assert.equal(checkText(s, undefined, hosts), ODD_SPACE_WHY, n.toString(16) + " " + JSON.stringify(s));
    }
  }
  assert.equal(checkText("第一列" + TAB + "https://defiexit.com" + TAB + "第二列", undefined, POST), null);
  // U:](…)、<…> 里面只能正好是一个 https:// 网址:没有收尾的、里面有空白(空格、Tab、换行)的、末尾带标点的都不收
  for (const s of ["[x](https://defiexit.com", "[x](https://defiexit.com )", "[x](https://defiexit.com" + TAB + ")", "[x](" + TAB + "https://defiexit.com)", "[x](https://defiexit.com" + NL + ")",
    "[x](https://defiexit.com.)", "[x](https://defiexit.com \"标题\")", "<https://defiexit.com", "<https://defiexit.com >", "<https://defiexit.com" + NL + ">", "<https://defiexit.com/x" + TAB + "y>"]) {
    for (const hosts of [REPLY, POST, IN]) assert.equal(checkText(s, undefined, hosts), MD_WHY, JSON.stringify(s));
  }
  // 正好是一个网址的照常往下查:本站照收,站外的照样拦
  for (const s of ["[x](https://defiexit.com/en/)", "<https://defiexit.com/en/#a>", "![logo](https://defiexit.com/logo.png)", "(see [x](https://defiexit.com/en/)).", "[注]：说明", "[1] 见下"]) {
    assert.equal(checkText(s, undefined, POST), null, s);
  }
  assert.equal(checkText("[x](https://evil.com)", undefined, POST), "含站外链接「evil.com」");
  // V:不带 https:// 的仓库路径照 https:// 的规矩查(只给宣传稿);别的 github.com 路径照样不收
  const w = world();
  const c = await w.login();
  const repoOk = ["github.com/DPNDolphin/defiexit/blob/main/README.md", "github.com/DPNDolphin/defiexit", "github.com/dpndolphin/DeFiExit#readme", "github.com/DPNDolphin/defiexit/compare/main...x"];
  const repoBad = ["github.com/evil/defiexit", "github.com/DPNDolphin/defiexitx", "github.com/DPNDolphin/defiexit/../x", "github.com/DPNDolphin/defiexit/./x", "github.com/DPNDolphin", "www.github.com/DPNDolphin/defiexit"];
  const r = await w.ingest({
    docs: { rules: { officialHosts: ["blast.io"] } },
    outbox: [...codex.map(([s], i) => ({ id: "p-r7-" + i, kind: "post", topic: "提醒", draft: "看 " + s })), { id: "p-r7-ok", kind: "post", topic: "提醒", draft: "官网 https://defiexit.com" },
      { id: "p-r7-repo", kind: "post", topic: "提醒", draft: "源码 " + repoOk[0] }],
    inbox: codex.map(([s], i) => ({ id: "300000000000000095" + i, text: "x", author: "user_r7" + i, draft: "看 " + s })),
    outreach: [...codex.map(([s], i) => REACH({ id: "o-r7-" + i, body: "看 " + s })), ...repoOk.map((s, i) => REACH({ id: "o-r7-ok-" + i, body: "源码 " + s })),
      ...repoBad.map((s, i) => REACH({ id: "o-r7-bad-" + i, body: "源码 " + s })),
      REACH({ id: "o-r7-target", target: "PANews" + ch(0x3000) + "投稿" }), REACH({ id: "o-r7-why", why: "见 C:" + B + "x" }), REACH({ id: "o-r7-why2", why: "见 C:＼x" }), MAILTO({ id: "o-r7-subj", subject: "Hi" + NB + "team" })],
  });
  assert.deepEqual([r.json.outbox, r.json.inbox, r.json.outreach], [1, 0, repoOk.length], JSON.stringify(r.json.rejected));
  const why = Object.fromEntries(r.json.rejected.map((x) => [x.id, x.why]));
  codex.forEach(([, want], i) => assert.deepEqual([why["p-r7-" + i], why["300000000000000095" + i], why["o-r7-" + i]], ["草稿" + want, "草稿" + want, "正文" + want]));
  assert.equal(why["p-r7-repo"], "草稿含站外链接「github.com」"); // 项目帖不放行仓库
  repoBad.forEach((s, i) => assert.match(why["o-r7-bad-" + i], /^正文含站外链接「(www\.)?github\.com」/, s));
  assert.deepEqual([why["o-r7-target"], why["o-r7-why"], why["o-r7-why2"], why["o-r7-subj"]], ["target " + ODD_SPACE_WHY, "why " + BACKSLASH_WHY, "why " + BACKSLASH_WHY, "邮件标题" + ODD_SPACE_WHY]);
  // 管理员改草稿也一样
  for (const [s, want] of [...codex, ["看 [官网][1]", REF_WHY], ["[x](https://defiexit.com )", MD_WHY], ["a" + B + "b", BACKSLASH_WHY]]) {
    const e = await w.call("/api/admin/outbox", { method: "POST", body: { id: "p-r7-ok", draft: s }, cookie: c });
    assert.deepEqual([e.status, e.json.why], [400, want], JSON.stringify(s));
  }
});

test("第七轮的规矩不拦现在的种子稿(特殊空格、反斜杠、引用式链接都没有);前几轮 Codex 的输入照样不收", () => {
  const POST = ["defiexit.com", "www.defiexit.com"], IN = [...POST, "blast.io"], B = ch(92);
  // 种子稿里链接前后的样子(11-06 取的),第七轮照收
  for (const s of ["s](https://defiexit.com/en/)\n\n", "e: https://github.com/DPNDolphin/defiexit\n\n", "友。 https://defiexit.com/deadlines/", "一图:defiexit.com/r/okx-boost/", "e: defiexit.com. I", "以在 defiexit.com 输"]) {
    assert.equal(cleanReach(REACH({ body: "看 " + s }), POST).error, undefined, s);
  }
  // 前几轮的:都还不收(说法可能换了)
  const old = ["https://defiexit.com(a)@evil%2ecom/", "[x](https://defiexit.com(a)@evil%2ecom)", "https://defiexit.com;@xn--bcher-kva%2ecom/", "https://defiexit.com;@[2001:db8::1]/", "https://evil.com,defiexit.com",
    "https://defiexit.com" + B + "@evil.com", "[source](https://github.com/DPNDolphin/defiexit(a)/../../attacker/repo)", "官网：https://defiexit.com（100%免费）", "https://defiexit.comｍｕｎｉｔｙ",
    "[x](https://defiexit.com（@%65%76%69%6c%2e%63%6f%6d/)", "https://defiexit.com/[x](//evil.com)", "[x](https&#58;//evil&#46;com)", "[x](//0x08080808)", "<a href=\"https://defiexit.com" + ch(10) + "munity\">x</a>",
    "e" + ch(0x200b) + "vil.com", "https://xn--bcher-kva.com/", "ｅｖｉｌ．ｃｏｍ", "在defiexit.com上查"];
  for (const s of old) for (const hosts of [POST, IN]) assert.notEqual(checkText(s, undefined, hosts), null, s);
});

// ---------- 11-06 第八轮(Codex 第六轮):宣传「发过的」这一页和一共几张是同一个时刻读的 ----------
test("宣传「发过的」:还没点的、点过的这一页、一共几张在一个 batch 里读(同一个时刻);读到一半正好有一张点了「已发」,也不会把最早那张挤掉还说没有了;往前翻一页也是一个 batch", async () => {
  const keep = { ...REACH_LIST };
  REACH_LIST.page = 3;
  try {
    const w = world();
    const c = await w.login();
    await w.ingest({ outreach: [1, 2, 3, 4].map((n) => REACH({ id: "o-snap-" + n })) });
    for (const n of [1, 2, 3]) {
      w.clock += 1000;
      assert.equal((await w.call("/api/admin/outreach", { method: "POST", body: { id: "o-snap-" + n, status: "已发" }, cookie: c })).status, 200);
    }
    // 读宣传卡片的时候,读完头一句(分开读的话就是两句中间)o-snap-4 正好被点了「已发」
    const raw = w.db, listing = (sql) => /FROM outreach WHERE (?:status (?:=|!=) '待发'|status != '待发' AND \(COALESCE)/.test(sql) && !/json_extract/.test(sql);
    let landed = false, loose = 0;
    const land = () => { if (landed) return; landed = true; raw.prepare("UPDATE outreach SET status = '已发', decided_at = ? WHERE id = 'o-snap-4'").bind(new Date(w.clock + 500).toISOString()).runSync(); };
    const wrap = (st, sql) => ({ inner: st, sql, bind: (...a) => wrap(st.bind(...a), sql),
      first: (...a) => { const p = st.first(...a); if (listing(sql)) { loose++; land(); } return p; },
      all: () => { const p = st.all(); if (listing(sql)) { loose++; land(); } return p; }, run: () => st.run() });
    w.db = { prepare: (sql) => wrap(raw.prepare(sql), sql), batch: async (ss) => { const out = await raw.batch(ss.map((x) => x.inner)); if (ss.some((x) => listing(x.sql))) land(); return out; } };
    const st = (await w.call("/api/admin/state", { cookie: c })).json;
    assert.deepEqual([landed, loose], [true, 0], "宣传卡片只在 batch 里读");
    // 同一个时刻:o-snap-4 要么还没点(在还没点的里,点过的一共 3 张),要么点过了(在这一页最上面,一共 4 张);不会两边都有,张数也对得上
    const pend = st.outreach.filter((x) => x.status === "待发").map((x) => x.id), done = st.outreach.filter((x) => x.status !== "待发").map((x) => x.id);
    const before = pend.includes("o-snap-4");
    assert.deepEqual([done.includes("o-snap-4"), done.length + st.outreachMore.handled], [!before, before ? 3 : 4], JSON.stringify(st.outreachMore));
    assert.deepEqual([pend, done, st.outreachMore.handled], [["o-snap-4"], ["o-snap-3", "o-snap-2", "o-snap-1"], 0]); // 读的是点以前那一刻
    // 再读一次:点过的 4 张,这一页 3 张,还有 1 张(最早那张)翻得到
    const st2 = (await w.call("/api/admin/state", { cookie: c })).json;
    assert.deepEqual([st2.outreach.map((x) => x.id), st2.outreachMore.handled], [["o-snap-4", "o-snap-3", "o-snap-2"], 1]);
    // 往前翻一页:这一页和还剩几张也是一个 batch
    w.db = { prepare: (sql) => wrap(raw.prepare(sql), sql), batch: (ss) => raw.batch(ss.map((x) => x.inner)) };
    const p = await w.call("/api/admin/outreach-done?at=" + encodeURIComponent(st2.outreachMore.after.at) + "&id=" + st2.outreachMore.after.id, { cookie: c });
    w.db = raw;
    assert.deepEqual([p.json.items.map((x) => x.id), p.json.more, loose], [["o-snap-1"], 0, 0]);
  } finally {
    Object.assign(REACH_LIST, keep);
  }
});

// ---------- 「已发」拆成已打开 / 待核实 / 核实已发(11-06,决策记录 11-05「运营台要修的」①),跟进轮询先读新的(②) ----------
import { sentState, SENT, SENT_LABEL } from "../admin/pace.js";
import { pick, postedMs, tierOf, TIERS, COLD_MIN, FLOOR } from "../server/ops/sync.js";
import { SENT_CUT_KEY, targetKey, SENT_QUEUE, backfillSentPosts } from "../server/ops/db.js";
import { BUDGET } from "../server/ops/sync.js";

// X 的帖子编号里带着发帖时间:按毫秒造一个(n 区分同一毫秒的几条)
const snow = (ms, n = 0) => String(((BigInt(Math.round(ms)) - 1288834974657n) << 22n) + BigInt(n));
const login2 = async (w) => (await w.call("/api/admin/login", { method: "POST", body: { name: "admin1", password: PW } })).headers.get("Set-Cookie").split(";")[0];
const OURS_URL = (id) => "https://x.com/DeFiExit/status/" + id;
// 一条核实结果:目标帖子的摘要照服务器的算法算(导出核实队列里的 target_key);帖子编号按发帖时间造(不早于点开)
const sentItem = async (id, opened, postMs, { tid = TARGET.id, n = 0, url } = {}) => ({ id, opened, target: tid == null ? null : await targetKey(tid), url: url || OURS_URL(snow(postMs, n)) });

test("三种怎么算(sentState):没点开的是 null;点开不到 6 小时是已打开,满 6 小时还没核到是待核实;核到(点开的时间对得上)是核实已发;这一版以前点开、还没核的是旧的没核", () => {
  const T = Date.parse("2026-11-08T10:00:00Z");
  const at = (ms) => new Date(ms).toISOString();
  const rule = { graceMs: SENT.graceMs, cutover: at(T - 864e5) };
  const row = (opened, sent) => ({ status: "已发", decided_at: at(opened), mine: { target: { id: "1" }, sent } });
  assert.equal(sentState({ status: "待发", decided_at: null, mine: {} }, rule, T), null);
  assert.equal(sentState({ status: "跳过", decided_at: at(T), mine: {} }, rule, T), null);
  assert.equal(sentState(row(T - 1000), rule, T), "opened");
  assert.equal(sentState(row(T - SENT.graceMs + 1), rule, T), "opened");
  assert.equal(sentState(row(T - SENT.graceMs), rule, T), "pending", "满 6 小时就算待核实");
  assert.equal(sentState(row(T - 3 * 864e5 + 1, undefined), { ...rule, cutover: at(T - 3 * 864e5) }, T), "pending");
  // 核到了:点开的时间要和 decided_at 一模一样(改回待发以后再点开的,上一次核到的不算)
  assert.equal(sentState(row(T - 7 * 3600e3, { opened: at(T - 7 * 3600e3), at: at(T), url: OURS_URL("9") }), rule, T), "verified");
  assert.equal(sentState(row(T - 1000, { opened: at(T - 9 * 3600e3), at: at(T - 8 * 3600e3) }), rule, T), "opened", "核到的是上一次点开的");
  assert.equal(sentState(row(T - 1000, { opened: at(T - 1000) }), rule, T), "opened", "没有核到的时间不算");
  assert.equal(sentState(row(T - 1000, "坏的"), rule, T), "opened");
  // 到期删过链接的也算核实已发(留着 opened、at 数)
  assert.equal(sentState(row(T - 40 * 864e5, { opened: at(T - 40 * 864e5), at: at(T - 40 * 864e5) }), rule, T), "verified");
  // 旧记录:早于 cutover 点开的,没核到是 legacy(不算待核实),核到了照样是核实已发;没有 cutover(旧服务器)就不分旧的
  assert.equal(sentState(row(T - 2 * 864e5), rule, T), "legacy");
  assert.equal(sentState(row(T - 2 * 864e5, { opened: at(T - 2 * 864e5), at: at(T) }), rule, T), "verified");
  assert.equal(sentState(row(T - 2 * 864e5), { graceMs: SENT.graceMs, cutover: null }, T), "pending");
  assert.equal(sentState(row(T - 2 * 864e5), null, T), "pending");
  // 时限照服务器给的
  assert.equal(sentState(row(T - 3600e3), { graceMs: 1800e3, cutover: null }, T), "pending");
  assert.deepEqual(SENT_LABEL, { opened: "已打开", pending: "待核实", verified: "核实已发", legacy: "已发(旧,没核)" });
});

test("点「在 X 打开」只记「已打开」;6 小时还没核到变「待核实」;主窗口核到了经签名投递记「核实已发」(链接以核到的为准);改回待发再点开要重核", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ outbox: [OUT()] });
  await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-openeden-1", status: "已发" }, cookie: c });
  const view = async () => { const st = (await w.call("/api/admin/state", { cookie: c })).json; const d = st.outbox.find((x) => x.id === "r-openeden-1"); return { st, d, s: sentState(d, st.sentRule, w.clock) }; };
  let v = await view();
  assert.equal(v.s, "opened");
  assert.deepEqual(v.st.sentRule, { graceMs: SENT.graceMs, cutover: new Date(Date.parse("2026-11-03T10:00:00Z")).toISOString() });
  const opened = v.d.decided_at, T0 = Date.parse(opened);
  w.clock += SENT.graceMs;
  v = await view();
  assert.equal(v.s, "pending");
  let e = (await w.exp({})).json;
  let row = e.outbox.find((x) => x.id === "r-openeden-1");
  assert.deepEqual([row.check, row.sent_text, row.verified_url, row.verified_at, row.purged], ["pending", OUT().draft, null, null, false]);
  // 核实队列:还没核实的,带目标帖子的摘要(不带编号)、回帖还是项目帖
  assert.deepEqual(e.sentQueue, { items: [{ id: "r-openeden-1", decided_at: opened, created_at: new Date(Date.parse("2026-11-03T10:00:00Z")).toISOString(), batch_start: opened, reply_url: null, sent_text: OUT().draft, target_key: await targetKey(TARGET.id), kind: "reply", check: "pending" }], next: null });
  assert.ok(!JSON.stringify(e.sentQueue).includes(TARGET.id), "核实队列不带目标帖子编号");
  // 核到了:点开的时间、目标帖子的摘要照导出的原样送回来
  const item = await sentItem("r-openeden-1", opened, T0 + 30e3);
  w.clock += 1000;
  const r = await w.ingest({ sent: [{ ...item, postedAt: new Date(T0 + 30e3).toISOString() }] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.sent, r.json.rejected], [1, []]);
  v = await view();
  assert.equal(v.s, "verified");
  assert.deepEqual([v.d.reply_url, v.d.mine.sent.url, v.d.mine.sent.post, v.d.mine.sent.opened, v.d.mine.sent.at], [item.url, item.url, item.url.split("/").pop(), opened, new Date(w.clock).toISOString()]);
  assert.equal(v.d.mine.draft, OUT().draft, "mine 别的部分不动");
  e = (await w.exp({})).json;
  row = e.outbox.find((x) => x.id === "r-openeden-1");
  assert.deepEqual([row.check, row.verified_url, row.verified_at], ["verified", item.url, new Date(w.clock).toISOString()]);
  assert.deepEqual(e.sentQueue.items, [], "核实了的不在队列里");
  // 改回待发再点开:上一次核到的不算了,要重新核;拿上一次点开的时间送来的不收(回执写明)
  await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-openeden-1", status: "待发" }, cookie: c });
  w.clock += 60e3;
  await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-openeden-1", status: "已发" }, cookie: c });
  v = await view();
  assert.equal(v.s, "opened");
  w.clock += 1000;
  const again = await w.ingest({ sent: [item] });
  assert.deepEqual([again.json.sent, again.json.rejected], [0, [{ kind: "sent", id: "r-openeden-1", why: "点开的时间对不上(管理员后来又点了一次),按导出里新的时间重核" }]]);
  // 新的这次点开是新的一批:上次核到的那条是上一批发的(也归上一次点开),不能再拿来充这一次
  w.clock += 1000;
  const stale = await w.ingest({ sent: [{ ...item, opened: v.d.decided_at }] });
  assert.deepEqual([stale.json.sent, stale.json.rejected.map((x) => x.why)], [0, ["那条帖子发在这一批发送开始以前(这一轮第一次复制或点开;没有批次的旧记录看卡片送进运营台的时间),或者从编号读不出发帖时间,不算"]]);
  w.clock += 1000;
  assert.equal((await w.ingest({ sent: [await sentItem("r-openeden-1", v.d.decided_at, Date.parse(v.d.decided_at) + 5e3, { n: 1 })] })).json.sent, 1);
  assert.equal((await view()).s, "verified");
});

test("核实结果:只记「已发」、没到期删过、点开时间对得上、目标帖子对得上、帖子不早于卡片送进来的;链接只认 x.com 的;不合格的只拒那一条(回执写明为什么);按要求删过的帖子也不收;不碰别的", async () => {
  const w = world();
  const c = await w.login();
  const tgt = (n) => ({ ...TARGET, id: "21160000000000009" + n, url: "https://x.com/someone/status/21160000000000009" + n });
  const POST = { id: "p-x-1107", kind: "post", topic: "提醒", why: "测试", draft: "测试项目帖。" };
  await w.ingest({ outbox: ["a", "b", "c", "d", "e", "f", "g"].map((k, i) => OUT({ id: "r-" + k, target: tgt(11 + i) })).concat([POST]) });
  for (const id of ["r-a", "r-c", "r-d", "r-e", "r-f", "r-g", POST.id]) await w.call("/api/admin/outbox", { method: "POST", body: { id, status: "已发" }, cookie: c });
  await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-e", status: "跳过" }, cookie: c });
  const st = (await w.call("/api/admin/state", { cookie: c })).json;
  const op = (id) => st.outbox.find((x) => x.id === id).decided_at, T0 = Date.parse(op("r-a"));
  await w.db.prepare("UPDATE outbox SET purged = 1 WHERE id = 'r-d'").run();
  const GONE_POST = snow(T0 + 60e3, 9);
  await w.call("/api/admin/delete", { method: "POST", body: { kind: "inbox", id: GONE_POST }, cookie: c }); // 按要求删过的帖子(这里是核到的那条)
  const it = (id, n, over = {}) => sentItem(id, op(id) || op("r-a"), T0 + 60e3, { tid: tgt(11 + "abcdefg".indexOf(id.slice(2))).id, n, ...over });
  w.clock += 1000;
  const r = await w.ingest({ sent: [
    await it("r-a", 1),
    await it("r-a", 2),
    { ...(await it("r-b", 3)), opened: op("r-a") },
    { ...(await it("r-c", 4)), url: "https://twitter.com/DeFiExit/status/" + snow(T0 + 60e3, 4) },
    { ...(await it("r-c", 4)), url: "https://www.x.com/DeFiExit/status/" + snow(T0 + 60e3, 4) },
    { ...(await it("r-c", 4)), url: OURS_URL(snow(T0 + 60e3, 4)) + "?s=20" },
    { ...(await it("r-c", 4)), opened: { toString: null } },
    { ...(await it("r-c", 4)), target: undefined },
    await it("r-c", 4, { tid: "2116000000000000999" }), // 本地卡片的目标和运营台记下的不是同一条
    await it("r-d", 5),
    { ...(await it("r-e", 6)), opened: op("r-a") },
    { id: "r-zz", opened: op("r-a"), target: null, url: OURS_URL(snow(T0 + 60e3, 7)) },
    await it("r-f", 8, { url: OURS_URL(GONE_POST) }),
    { ...(await it("r-c", 4)), opened: "不是时间" },
    await sentItem("r-g", op("r-g"), T0 - 20 * 60e3, { tid: tgt(17).id }), // 卡片送进来以前 20 分钟发的:不算
    await sentItem("r-g", op("r-g"), T0 + 3600e3, { tid: tgt(17).id, n: 9 }), // 比现在还晚:编号读不出发帖时间
    await sentItem(POST.id, op(POST.id), T0 + 60e3, { tid: tgt(11).id, n: 10 }), // 项目帖没有目标帖子,target 要写 null
  ] });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.sent, 1);
  assert.deepEqual(r.json.rejected.map((x) => x.kind + " " + x.id + ":" + x.why).sort(), [
    "sent r-a:同一包里重复了,只收第一条",
    "sent r-b:这条现在不是「已发」(改回待发或跳过了),不记核实",
    "sent r-c:url 不合格(只认 https://x.com/账号/status/编号)",
    "sent r-c:url 不合格(只认 https://x.com/账号/status/编号)",
    "sent r-c:url 不合格(只认 https://x.com/账号/status/编号)",
    "sent r-c:opened 格式不对(不能是对象或数组)",
    "sent r-c:target 要是导出核实队列里的 target_key(项目帖写 null)",
    "sent r-c:目标帖子对不上(本地卡片的目标和运营台点「已发」时记下的不是同一条),不记",
    "sent r-d:30 天到期删过,不再改",
    "sent r-e:这条现在不是「已发」(改回待发或跳过了),不记核实",
    "sent r-zz:没有这张卡片(按要求删过,或编号不对)",
    "sent r-f:管理员按要求删过,不再收",
    "sent r-c:opened 要是那次点开的时间(导出里的 decided_at,原样照抄)",
    "sent r-g:那条帖子发在这一批发送开始以前(这一轮第一次复制或点开;没有批次的旧记录看卡片送进运营台的时间),或者从编号读不出发帖时间,不算",
    "sent r-g:同一包里重复了,只收第一条",
    "sent p-x-1107:目标帖子对不上(本地卡片的目标和运营台点「已发」时记下的不是同一条),不记",
  ].sort());
  const after = (await w.call("/api/admin/state", { cookie: c })).json;
  const by = (id) => after.outbox.find((x) => x.id === id);
  assert.equal(sentState(by("r-a"), after.sentRule, w.clock), "verified");
  assert.equal(by("r-a").reply_url, OURS_URL(snow(T0 + 60e3, 1)));
  assert.equal(sentState(by("r-c"), after.sentRule, w.clock), "opened");
  assert.equal(by("r-c").reply_url, null);
  assert.deepEqual([by("r-b").status, by("r-e").status, by("r-d").mine.sent, by("r-f").mine.sent], ["待发", "跳过", undefined, undefined]);
  // 发帖时间按卡片送进来的时间算,留 15 分钟钟差:送进来以前 10 分钟的照收;项目帖 target 写 null 照收
  w.clock += 1000;
  const ok = await w.ingest({ sent: [await sentItem("r-g", op("r-g"), T0 - 10 * 60e3, { tid: tgt(17).id, n: 11 }), await sentItem(POST.id, op(POST.id), T0 + 60e3, { tid: null, n: 12 })] });
  assert.deepEqual([ok.json.sent, ok.json.rejected], [2, []]);
  // 一包最多 50 条
  w.clock += 1000;
  const many = await w.ingest({ sent: Array.from({ length: 51 }, () => ({ id: "r-a", opened: op("r-a"), target: null, url: OURS_URL("1") })) });
  assert.ok(many.json.rejected.some((x) => x.kind === "sent" && /一包最多 50 条/.test(x.why)));
});

test("同一条帖子只核给一张卡片:别的卡片已经核实成这条的不收(同一包里两张争同一条,只收第一张);同一次点开已经核实了的,同一条再送一遍照收不改,别的一条不收", async () => {
  const w = world();
  const c = await w.login();
  const tgt = (n) => ({ ...TARGET, id: "21160000000000006" + n, url: "https://x.com/someone/status/21160000000000006" + n });
  await w.ingest({ outbox: [OUT({ id: "r-a", target: tgt(11) }), OUT({ id: "r-b", target: tgt(12) }), OUT({ id: "r-c", target: tgt(13) })] });
  for (const id of ["r-a", "r-b", "r-c"]) await w.call("/api/admin/outbox", { method: "POST", body: { id, status: "已发" }, cookie: c });
  const st = (await w.call("/api/admin/state", { cookie: c })).json;
  const op = (id) => st.outbox.find((x) => x.id === id).decided_at, T0 = Date.parse(op("r-a"));
  const P = snow(T0 + 30e3, 1);
  w.clock += 1000;
  const r = await w.ingest({ sent: [await sentItem("r-a", op("r-a"), 0, { tid: tgt(11).id, url: OURS_URL(P) }), await sentItem("r-b", op("r-b"), 0, { tid: tgt(12).id, url: OURS_URL(P) })] });
  assert.deepEqual([r.json.sent, r.json.rejected], [1, [{ kind: "sent", id: "r-b", why: "这条帖子已经核给别的卡片了,一条帖子只核给一张卡片", taken: [P] }]]);
  w.clock += 1000;
  const r2 = await w.ingest({ sent: [await sentItem("r-c", op("r-c"), 0, { tid: tgt(13).id, url: "https://x.com/Ilikecoin2023/status/" + P })] });
  assert.deepEqual(r2.json.rejected, [{ kind: "sent", id: "r-c", why: "这条帖子已经核给别的卡片了,一条帖子只核给一张卡片", taken: [P] }], "换了用户名的链接、编号一样也算同一条");
  // 同一次点开再送一遍同一条:照收(重投安全),什么都不改;送别的一条:不收
  const before = (await w.db.prepare("SELECT mine, reply_url FROM outbox WHERE id = 'r-a'").first());
  w.clock += 1000;
  const same = await w.ingest({ sent: [await sentItem("r-a", op("r-a"), 0, { tid: tgt(11).id, url: "https://x.com/Ilikecoin2023/status/" + P })] });
  assert.deepEqual([same.json.sent, same.json.rejected], [1, []]);
  assert.deepEqual(await w.db.prepare("SELECT mine, reply_url FROM outbox WHERE id = 'r-a'").first(), before);
  w.clock += 1000;
  const other = await w.ingest({ sent: [await sentItem("r-a", op("r-a"), T0 + 60e3, { tid: tgt(11).id, n: 2 })] });
  assert.deepEqual(other.json.rejected, [{ kind: "sent", id: "r-a", why: "这一次点开已经核实过另一条了,不换" }]);
  // 读和写之间别的包先把它核实成了另一条:这一包写不进去(语句里核对),回执写明
  const raw = w.db;
  let landed = false;
  const Q = snow(T0 + 90e3, 3), R = snow(T0 + 95e3, 4);
  const land = () => { if (landed) return; landed = true; raw.prepare("UPDATE outbox SET reply_url = ?, mine = json_set(mine, '$.sent', json(?)) WHERE id = 'r-b'").bind(OURS_URL(Q), JSON.stringify({ opened: op("r-b"), at: new Date(w.clock).toISOString(), url: OURS_URL(Q), post: Q })).runSync(); };
  const wrap = (st2, sql) => ({ inner: st2, bind: (...a) => wrap(st2.bind(...a), sql), first: (...a) => st2.first(...a), run: () => st2.run(),
    all: async () => { const out = await st2.all(); if (/SELECT id, mine, status, purged, decided_at, created_at, sent_target/.test(sql)) land(); return out; } });
  w.db = { prepare: (sql) => wrap(raw.prepare(sql), sql), batch: (ss) => raw.batch(ss.map((x) => x.inner)) };
  w.clock += 1000;
  const race = await w.ingest({ sent: [await sentItem("r-b", op("r-b"), 0, { tid: tgt(12).id, url: OURS_URL(R) })] });
  w.db = raw;
  assert.deepEqual([landed, race.json.sent, race.json.rejected], [true, 0, [{ kind: "sent", id: "r-b", why: "这一次点开已经核实过另一条了,不换" }]]);
  const b = await raw.prepare("SELECT reply_url, json_extract(mine, '$.sent.url') AS u FROM outbox WHERE id = 'r-b'").first();
  assert.deepEqual([b.reply_url, b.u], [OURS_URL(Q), OURS_URL(Q)]);
});

test("一条帖子永远只归第一次核到的那一次点开:改回待发也不放出来,别的卡片、这张卡片以后再点开都不能拿它充数;这一次新发的照收", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ outbox: [OUT({ id: "r-a" }), OUT({ id: "r-b", draft: "到期金库可以在官方合约上自己取出,不用等官网。我们不会主动找你。" })] });
  await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-a", status: "已发" }, cookie: c });
  const op = async (id) => (await w.db.prepare("SELECT decided_at FROM outbox WHERE id = ?").bind(id).first("decided_at"));
  const o1 = await op("r-a"), T0 = Date.parse(o1), P = snow(T0 + 30e3, 1);
  w.clock += 60e3;
  assert.equal((await w.ingest({ sent: [await sentItem("r-a", o1, 0, { url: OURS_URL(P) })] })).json.sent, 1);
  // 改回待发:P 照样归 r-a 的第一次点开。r-b(同一条目标帖)拿 P 不收
  await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-a", status: "待发" }, cookie: c });
  await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-b", status: "已发" }, cookie: c });
  w.clock += 60e3;
  const b = await w.ingest({ sent: [await sentItem("r-b", await op("r-b"), 0, { url: OURS_URL(P) })] });
  assert.deepEqual(b.json.rejected, [{ kind: "sent", id: "r-b", why: "这条帖子已经核给别的卡片了,一条帖子只核给一张卡片", taken: [P] }]);
  // r-a 一分钟后再点开(没再发):拿 P 不收,还是已打开
  w.clock += 60e3;
  await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-a", status: "已发" }, cookie: c });
  const o2 = await op("r-a");
  w.clock += 1000;
  const a2 = await w.ingest({ sent: [await sentItem("r-a", o2, 0, { url: OURS_URL(P) })] });
  assert.deepEqual(a2.json.rejected, [{ kind: "sent", id: "r-a", why: "这条帖子已经核给这张卡片以前那一次点开了(改回待发再点开的,要这一次发的才算)", taken: [P] }]);
  const st = (await w.call("/api/admin/state", { cookie: c })).json;
  assert.equal(sentState(st.outbox.find((x) => x.id === "r-a"), st.sentRule, w.clock), "opened");
  // 这一次真发了 Q:照收
  const Q = snow(Date.parse(o2) + 20e3, 2);
  w.clock += 1000;
  assert.equal((await w.ingest({ sent: [await sentItem("r-a", o2, 0, { url: OURS_URL(Q) })] })).json.sent, 1);
  // 到期删过以后也不放出来(sent_posts 只存哈希,不删)
  const keys = (await w.db.prepare("SELECT post, card, opened FROM sent_posts ORDER BY at").all()).results;
  assert.deepEqual(keys.map((k) => [k.card, k.opened]), [["r-a", o1], ["r-a", o2]]);
  assert.ok(keys.every((k) => /^[0-9a-f]{64}$/.test(k.post)) && !JSON.stringify(keys).includes(P), "只存帖子编号的哈希");
});

test("发送批次:这一轮第一次点「复制」或点开算起点;先复制发出去、过几个小时才点「已发」的照收;没复制、点开以前就有的不收;改回待发再点开是新的一批,上一批发的(没核实过也一样)不算", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ outbox: [OUT({ id: "r-a" }), OUT({ id: "r-b" }), OUT({ id: "r-c" })] });
  const T0 = w.clock;
  const op = async (id) => (await w.db.prepare("SELECT decided_at FROM outbox WHERE id = ?").bind(id).first("decided_at"));
  // r-a:50 分钟后点「复制」(页面顺手告诉服务器),一小时后发,三小时后才点「已发」
  w.clock = T0 + 50 * 60e3;
  assert.equal((await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-a", copied: true }, cookie: c })).status, 200);
  assert.equal((await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-a", copied: "x" }, cookie: c })).status, 400);
  w.clock = T0 + 3 * 3600e3;
  for (const id of ["r-a", "r-b"]) await w.call("/api/admin/outbox", { method: "POST", body: { id, status: "已发" }, cookie: c });
  w.clock += 1000;
  const r = await w.ingest({ sent: [await sentItem("r-a", await op("r-a"), T0 + 3600e3, { n: 1 }), await sentItem("r-b", await op("r-b"), T0 + 3600e3, { n: 2 })] });
  assert.deepEqual([r.json.sent, r.json.rejected], [1, [{ kind: "sent", id: "r-b", why: "那条帖子发在这一批发送开始以前(这一轮第一次复制或点开;没有批次的旧记录看卡片送进运营台的时间),或者从编号读不出发帖时间,不算" }]], "r-b 没复制,点开以前两小时就有的帖子不算");
  // r-c:10:00 点开、发了 P(还没核实);12:00 改回待发再点开(没重发):P 是上一批发的,不算
  w.clock = T0;
  await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-c", status: "已发" }, cookie: c });
  w.clock = T0 + 2 * 3600e3;
  await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-c", status: "待发" }, cookie: c });
  await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-c", status: "已发" }, cookie: c });
  w.clock = T0 + 4 * 3600e3;
  const r2 = await w.ingest({ sent: [await sentItem("r-c", await op("r-c"), T0 + 60e3, { n: 3 })] });
  assert.deepEqual(r2.json.rejected.map((x) => x.why), ["那条帖子发在这一批发送开始以前(这一轮第一次复制或点开;没有批次的旧记录看卡片送进运营台的时间),或者从编号读不出发帖时间,不算"]);
  // 这一批开始以后发的照收
  w.clock += 1000;
  assert.equal((await w.ingest({ sent: [await sentItem("r-c", await op("r-c"), T0 + 2 * 3600e3 + 60e3, { n: 4 })] })).json.sent, 1);
});

test("记归属和写卡片同一个条件:读完卡片、写之前管理员改回待发了,卡片写不上,帖子也不留归属(别的卡片之后照样能用)", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ outbox: [OUT({ id: "r-a" }), OUT({ id: "r-b" })] });
  for (const id of ["r-a", "r-b"]) await w.call("/api/admin/outbox", { method: "POST", body: { id, status: "已发" }, cookie: c });
  const op = async (id) => (await w.db.prepare("SELECT decided_at FROM outbox WHERE id = ?").bind(id).first("decided_at"));
  const oa = await op("r-a"), P = snow(Date.parse(oa) + 30e3, 1);
  const raw = w.db;
  let landed = false;
  const land = () => { if (landed) return; landed = true; raw.prepare("UPDATE outbox SET status = '待发', decided_at = NULL, sent_text = NULL, sent_target = NULL WHERE id = 'r-a'").runSync(); };
  const wrap = (st2, sql) => ({ inner: st2, bind: (...a) => wrap(st2.bind(...a), sql), first: (...a) => st2.first(...a), run: () => st2.run(),
    all: async () => { const out = await st2.all(); if (/SELECT id, mine, status, purged, decided_at, created_at, sent_target/.test(sql)) land(); return out; } });
  w.db = { prepare: (sql) => wrap(raw.prepare(sql), sql), batch: (ss) => raw.batch(ss.map((x) => x.inner)) };
  w.clock += 1000;
  const r = await w.ingest({ sent: [await sentItem("r-a", oa, 0, { url: OURS_URL(P) })] });
  w.db = raw;
  assert.deepEqual([landed, r.json.sent], [true, 0]);
  assert.equal((await raw.prepare("SELECT COUNT(*) AS n FROM sent_posts").first("n")), 0, "没写上就不留归属");
  w.clock += 1000;
  assert.equal((await w.ingest({ sent: [await sentItem("r-b", await op("r-b"), 0, { url: OURS_URL(P) })] })).json.sent, 1);
});

test("升级:以前核实过的(mine.sent 带着帖子编号)补记进 sent_posts,翻完记版本、只翻一次;补记以前别的卡片也拿不走它", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ outbox: [OUT({ id: "r-a" }), OUT({ id: "r-b" })] });
  for (const id of ["r-a", "r-b"]) await w.call("/api/admin/outbox", { method: "POST", body: { id, status: "已发" }, cookie: c });
  const op = async (id) => (await w.db.prepare("SELECT decided_at FROM outbox WHERE id = ?").bind(id).first("decided_at"));
  const oa = await op("r-a"), P = snow(Date.parse(oa) + 30e3, 1);
  // 旧版本核实的:只有 mine.sent,sent_posts 里没有
  await w.db.prepare("UPDATE outbox SET reply_url = ?, mine = json_set(mine, '$.sent', json(?)) WHERE id = 'r-a'").bind(OURS_URL(P), JSON.stringify({ opened: oa, at: oa, url: OURS_URL(P), post: P })).run();
  assert.equal(await w.db.prepare("SELECT COUNT(*) AS n FROM sent_posts").first("n"), 0);
  w.clock += 1000;
  const r = await w.ingest({ sent: [await sentItem("r-b", await op("r-b"), 0, { url: OURS_URL(P) })] });
  assert.deepEqual(r.json.rejected, [{ kind: "sent", id: "r-b", why: "这条帖子已经核给别的卡片了,一条帖子只核给一张卡片", taken: [P] }]);
  assert.deepEqual([await w.db.prepare("SELECT card FROM sent_posts").first("card"), await w.db.prepare("SELECT v FROM kv WHERE k = 'sent_posts_v1'").first("v")], ["r-a", "1"]);
  // 补记以前(版本标记还没有、sent_posts 是空的):写卡片的语句照旧查别的卡片的 mine.sent,也挡得住
  await w.db.prepare("DELETE FROM sent_posts").run();
  const keep = await backfillSentPosts(w.db);
  assert.equal(keep, true, "翻完了就不再翻");
  assert.equal(await w.db.prepare("SELECT COUNT(*) AS n FROM sent_posts").first("n"), 0);
  w.clock += 1000;
  const r2 = await w.ingest({ sent: [await sentItem("r-b", await op("r-b"), 0, { url: OURS_URL(P) })] });
  assert.equal(r2.json.sent, 0);
  assert.equal(await w.db.prepare("SELECT reply_url FROM outbox WHERE id = 'r-b'").first("reply_url"), null);
});

test("送来几条对得上的:挑第一条能用的(前面那条已经归了别的卡片,就用后面那条);都不能用的不收,回执写第一条的原因", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ outbox: [OUT({ id: "r-a" }), OUT({ id: "r-b" }), OUT({ id: "r-c" })] });
  for (const id of ["r-a", "r-b", "r-c"]) await w.call("/api/admin/outbox", { method: "POST", body: { id, status: "已发" }, cookie: c });
  const op = async (id) => (await w.db.prepare("SELECT decided_at FROM outbox WHERE id = ?").bind(id).first("decided_at"));
  const T0 = Date.parse(await op("r-a")), P = snow(T0 + 10e3, 1), Q = snow(T0 + 20e3, 2);
  w.clock += 1000;
  assert.equal((await w.ingest({ sent: [await sentItem("r-a", await op("r-a"), 0, { url: OURS_URL(P) })] })).json.sent, 1);
  w.clock += 1000;
  const r = await w.ingest({ sent: [{ ...(await sentItem("r-b", await op("r-b"), 0)), url: undefined, urls: [OURS_URL(P), OURS_URL(Q)] }, { ...(await sentItem("r-c", await op("r-c"), 0)), url: undefined, urls: [OURS_URL(P), OURS_URL(Q)] }] });
  assert.deepEqual([r.json.sent, r.json.rejected], [1, [{ kind: "sent", id: "r-c", why: "这条帖子已经核给别的卡片了,一条帖子只核给一张卡片", taken: [P, Q] }]], "都归了别人:回执写明是哪几条,核实器下次不再送");
  assert.equal((await w.db.prepare("SELECT reply_url FROM outbox WHERE id = 'r-b'").first("reply_url")), OURS_URL(Q));
  w.clock += 1000;
  const bad = await w.ingest({ sent: [{ id: "r-c", opened: await op("r-c"), target: await targetKey(TARGET.id), urls: [] }, { id: "r-c", opened: await op("r-c"), target: null, urls: Array.from({ length: 6 }, (_, i) => OURS_URL(snow(T0, i))) }] });
  assert.deepEqual(bad.json.rejected.map((x) => x.why), ["urls 要是 1–5 条链接", "urls 要是 1–5 条链接"]);
});

test("到期清理和核实同时来:清理读到的是还没核实的样子,写之前核实先写进去了,核实结果照样留着(不被旧的样子盖掉)", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ outbox: [OUT()] });
  await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-openeden-1", status: "已发" }, cookie: c });
  const opened = (await w.db.prepare("SELECT decided_at FROM outbox WHERE id = 'r-openeden-1'").first("decided_at"));
  w.clock += 31 * 864e5;
  const raw = w.db;
  let landed = false;
  const at = new Date(w.clock).toISOString();
  const land = () => { if (landed) return; landed = true; raw.prepare("UPDATE outbox SET mine = json_set(mine, '$.sent', json(?)) WHERE id = 'r-openeden-1'").bind(JSON.stringify({ opened, at, url: OURS_URL("1"), post: "1" })).runSync(); };
  const wrap = (st2, sql) => ({ inner: st2, bind: (...a) => wrap(st2.bind(...a), sql), first: (...a) => st2.first(...a), run: () => st2.run(),
    all: async () => { const out = await st2.all(); if (/SELECT id, mine, draft_admin, sent_text, status, decided_at FROM outbox WHERE purged = 0/.test(sql)) land(); return out; } });
  w.db = { prepare: (sql) => wrap(raw.prepare(sql), sql), batch: (ss) => raw.batch(ss.map((x) => x.inner)) };
  const e = (await w.exp({})).json;
  w.db = raw;
  assert.equal(landed, true);
  const m = JSON.parse(await raw.prepare("SELECT mine FROM outbox WHERE id = 'r-openeden-1'").first("mine"));
  assert.deepEqual([m.sent, e.sent.total.replies.verified], [{ opened, at }, 1]);
});

test("核实队列可以翻页:还没核实的「已发」按点开的时间往前一页页给(核实了的、到期删过的不给),翻完 next 是 null;导出的 outbox 只给最近 500 条也不漏核", async () => {
  const w = world();
  const c = await w.login();
  const keep = { ...SENT_QUEUE };
  try {
    SENT_QUEUE.page = 2;
    const tgt = (n) => ({ ...TARGET, id: "21160000000000005" + n, url: "https://x.com/someone/status/21160000000000005" + n });
    const ids = ["r-1", "r-2", "r-3", "r-4", "r-5", "r-6"];
    await w.ingest({ outbox: ids.map((id, i) => OUT({ id, target: tgt(11 + i) })) });
    for (const id of ids) { w.clock += 1000; await w.call("/api/admin/outbox", { method: "POST", body: { id, status: "已发" }, cookie: c }); }
    const op = async (id) => (await w.db.prepare("SELECT decided_at FROM outbox WHERE id = ?").bind(id).first("decided_at"));
    w.clock += 1000;
    await w.ingest({ sent: [await sentItem("r-6", await op("r-6"), Date.parse(await op("r-6")) + 1000, { tid: tgt(16).id })] });
    await w.db.prepare("UPDATE outbox SET purged = 1 WHERE id = 'r-1'").run();
    const pages = [];
    let after;
    for (let k = 0; k < 5; k++) {
      const e = (await w.exp(after ? { queueAfter: after } : {})).json;
      pages.push(e.sentQueue.items.map((x) => x.id));
      after = e.sentQueue.next;
      if (!after) break;
    }
    assert.deepEqual(pages, [["r-5", "r-4"], ["r-3", "r-2"], []]);
    assert.equal((await w.exp({})).json.sentQueue.items[0].target_key, await targetKey(tgt(15).id));
  } finally {
    Object.assign(SENT_QUEUE, keep);
  }
});

test("旧记录兼容:这一版以前点开的「已发」照常显示、不报错,是「已发(旧,没核)」(不算待核实);照样占当天的名额;补核了转「核实已发」(没有发送批次:帖子不早于卡片送进来就行);30 天到期以后核实结果(不带链接)留着照样数", async () => {
  const w = world();
  // 旧版本的库:表是旧版本建的(没有 sent_v2_at),里面有点过「已发」、服务器找到了链接的卡片,和找不到链接的
  await ensure(w.db);
  const old = Date.parse("2026-11-03T02:00:00Z");
  const put = (id, tid, reply) => w.db.prepare("INSERT INTO outbox (id, mine, status, decided_at, sent_text, sent_target, reply_url, created_at, updated_at, purge_after) VALUES (?, ?, '已发', ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, JSON.stringify(OUT({ id, target: { ...TARGET, id: tid, url: "https://x.com/someone/status/" + tid } })), new Date(old).toISOString(), "旧的草稿", tid, reply, new Date(old - 864e5).toISOString(), new Date(old).toISOString(), new Date(old + 30 * 864e5).toISOString()).run();
  const P1 = snow(old - 2 * 3600e3, 1); // 旧版本里点开两小时以前就发了(后来又点了一次「已发」,点开的时间往后挪了)
  await put("r-old-1", "2116000000000000501", "https://x.com/Ilikecoin2023/status/" + P1);
  await put("r-old-2", "2116000000000000502", null);
  await put("r-old-3", "2116000000000000503", null);
  // 这一版第一次跑:记下 sent_v2_at;以后别的实例再跑(ensure 再来一遍)也不改它
  const c = await w.login();
  const cut = (await w.db.prepare("SELECT v FROM kv WHERE k = ?").bind(SENT_CUT_KEY).first("v"));
  assert.equal(cut, new Date(w.clock).toISOString());
  w.clock += 3600e3;
  const db2 = { prepare: (s) => w.db.prepare(s), batch: (s) => w.db.batch(s) }; // 换一个实例:ensure 重新跑一遍
  const env2 = { ...{ OPS: db2 }, ADMIN_HOSTS: "defiexit.com", OPS_ENV: "production", INGEST_PUBKEYS: "", TASK_PUBKEYS: "", SETUP_CODE: CODE };
  await handle(new Request(HOST + "/api/admin/state", { headers: { Cookie: c } }), env2, w.edge, w.now());
  assert.equal(await w.db.prepare("SELECT v FROM kv WHERE k = ?").bind(SENT_CUT_KEY).first("v"), cut);
  const st = (await w.call("/api/admin/state", { cookie: c })).json;
  assert.equal(st.outbox.length, 3);
  for (const d of st.outbox) assert.equal(sentState(d, st.sentRule, w.clock), "legacy");
  // 照样占名额(按点开算):那天(北京时间 11-03)还能放几条
  assert.equal(gate(st.outbox, [], 15, old + 3600e3).used, 3);
  let e = (await w.exp({})).json;
  assert.deepEqual(e.outbox.map((x) => [x.id, x.check]).sort(), [["r-old-1", "legacy"], ["r-old-2", "legacy"], ["r-old-3", "legacy"]]);
  assert.deepEqual(e.sent.total.replies, { opened: 0, pending: 0, verified: 0, legacy: 3 });
  assert.deepEqual(e.sentQueue.items.map((x) => [x.id, x.check, x.target_key]).sort(), [["r-old-1", "legacy", await targetKey("2116000000000000501")], ["r-old-2", "legacy", await targetKey("2116000000000000502")], ["r-old-3", "legacy", await targetKey("2116000000000000503")]]);
  // 补核:r-old-1 是点开前 2 小时发的(卡片一天前就送进来了),照收;比卡片送进来还早的不收
  w.clock += 1000;
  const ok = await w.ingest({ sent: [await sentItem("r-old-1", new Date(old).toISOString(), 0, { tid: "2116000000000000501", url: "https://x.com/DeFiExit/status/" + P1 }),
    await sentItem("r-old-2", new Date(old).toISOString(), old - 25 * 3600e3, { tid: "2116000000000000502" })] });
  assert.deepEqual([ok.json.sent, ok.json.rejected], [1, [{ kind: "sent", id: "r-old-2", why: "那条帖子发在这一批发送开始以前(这一轮第一次复制或点开;没有批次的旧记录看卡片送进运营台的时间),或者从编号读不出发帖时间,不算" }]]);
  e = (await w.exp({})).json;
  assert.deepEqual(e.sent.total.replies, { opened: 0, pending: 0, verified: 1, legacy: 2 });
  assert.deepEqual(e.sent.byDay["2026-11-03"].replies, { opened: 0, pending: 0, verified: 1, legacy: 2 });
  // 30 天到期:链接、帖子编号删掉,核实结果留着(只有点开、核到的时间),照样数;到期删过的不再导出点开时记下的那段话
  w.clock += 31 * 864e5;
  e = (await w.exp({})).json;
  const r1 = e.outbox.find((x) => x.id === "r-old-1");
  assert.deepEqual([r1.purged, r1.check, r1.verified_url, r1.reply_url, r1.sent_text], [true, "verified", null, null, null]);
  assert.deepEqual(e.sent.total.replies, { opened: 0, pending: 0, verified: 1, legacy: 2 });
  assert.deepEqual(e.sentQueue.items, [], "到期删过的不在核实队列里");
  const raw = await w.db.prepare("SELECT mine FROM outbox WHERE id = 'r-old-1'").first("mine");
  assert.deepEqual(JSON.parse(raw).sent, { opened: new Date(old).toISOString(), at: new Date(Date.parse("2026-11-03T11:00:01Z")).toISOString() });
  assert.ok(!raw.includes(P1), "到期以后链接、帖子编号不留");
  // 到期删过的不再收核实结果
  w.clock += 1000;
  assert.equal((await w.ingest({ sent: [await sentItem("r-old-3", new Date(old).toISOString(), old + 1000, { tid: "2116000000000000503" })] })).json.rejected[0].why, "30 天到期删过,不再改");
});

test("到期清理:我们的草稿、改过的草稿、点开时记下的那段话、需求摘要里认得出人、帖子、钱包的都换掉(@账号、别人的链接、0x 地址、长串地址、帖子编号、xxx.eth、IP);本站链接留着;导出不再带到期的那段话", async () => {
  const w = world();
  const c = await w.login();
  const ADDR = "0x1234567890abcdef1234567890abcdef12345678", SOL = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
  const draft = "@someone 你那个 " + ADDR + " 还在,vitalik.eth 也一样;看 https://x.com/someone/status/2116000000000000001 和 https://defiexit.com/zh/ 。";
  await w.ingest({ outbox: [OUT({ draft: "到期金库可以在官方合约上自己取出。我们不会主动找你,也不会要你的钱包信息。" })] });
  await w.db.prepare("UPDATE outbox SET draft_admin = ? WHERE id = 'r-openeden-1'").bind(draft + " " + SOL + " 1.2.3.4").run();
  await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-openeden-1", status: "已发" }, cookie: c });
  await w.db.prepare("UPDATE outbox SET mine = json_set(mine, '$.draft', ?) WHERE id = 'r-openeden-1'").bind(draft).run();
  w.clock += 31 * 864e5;
  const e = (await w.exp({})).json;
  assert.equal(e.outbox[0].sent_text, null);
  const row = await w.db.prepare("SELECT mine, draft_admin, sent_text FROM outbox WHERE id = 'r-openeden-1'").first();
  const all = row.mine + row.draft_admin + row.sent_text;
  for (const bad of [ADDR, SOL, "vitalik.eth", "someone", "2116000000000000001", "1.2.3.4"]) assert.ok(!all.includes(bad), "还留着 " + bad + ":" + all);
  assert.ok(row.sent_text.includes("https://defiexit.com/zh/") && row.sent_text.includes("@某人"), row.sent_text);
});

test("每天上限和「歇一会儿」按点开算:点开了、还没核到(甚至待核实)的照样占名额、照样算进节奏;读钟用的数(导出 sent)只数核实已发,另外单列已打开、待核实", async () => {
  const w = world();
  const c = await w.login();
  const tgt = (n) => ({ ...TARGET, id: "21160000000000008" + n, url: "https://x.com/someone/status/21160000000000008" + n });
  const POST = { id: "p-x-1106", kind: "post", topic: "提醒", why: "测试", draft: "测试项目帖。" };
  await w.ingest({ docs: { rules: { dailyReplyCap: 3 } }, outbox: [OUT({ id: "r-1", target: tgt(11) }), OUT({ id: "r-2", target: tgt(12) }), OUT({ id: "r-3", target: tgt(13) }), OUT({ id: "r-4", target: tgt(14) }), POST] });
  for (const id of ["r-1", "r-2", POST.id]) await w.call("/api/admin/outbox", { method: "POST", body: { id, status: "已发" }, cookie: c });
  // r-1 是 7 小时前点开的(北京时间同一天 11:00;这一版那时已经上线了),到现在还没核到:待核实
  const CUT = new Date(w.clock - 2 * 864e5).toISOString();
  await w.db.prepare("UPDATE kv SET v = ? WHERE k = ?").bind(CUT, SENT_CUT_KEY).run();
  await w.db.prepare("UPDATE outbox SET decided_at = ? WHERE id = 'r-1'").bind(new Date(w.clock - 7 * 3600e3).toISOString()).run();
  let st = (await w.call("/api/admin/state", { cookie: c })).json;
  const by = (id) => st.outbox.find((x) => x.id === id);
  assert.deepEqual([sentState(by("r-1"), st.sentRule, w.clock), sentState(by("r-2"), st.sentRule, w.clock)], ["pending", "opened"]);
  const pend = st.outbox.filter((x) => x.status === "待发").sort((a, b) => a.created_at.localeCompare(b.created_at));
  const g = gate(st.outbox, pend, capOf(st.docs.rules), w.clock);
  assert.deepEqual([g.cap, g.used, [...g.queued]], [3, 2, ["r-4"]], "待核实的、已打开的都占名额");
  // 节奏也按点开算:刚才 30 分钟里点开了 5 条(含没核到的),再点一条就提醒
  const times = [...st.outbox.filter((x) => x.status === "已发").map((x) => x.decided_at), ...[1, 2, 3].map((i) => new Date(w.clock - i * 60e3).toISOString())];
  assert.equal(paceNote(times), null);
  assert.equal(paceNote([...times, new Date(w.clock + 60e3).toISOString()]), "30 分钟里已经发了 6 条,歇一会儿");
  // 核到 r-2 和项目帖;r-1 一直没核到
  w.clock += 1000;
  await w.ingest({ sent: [await sentItem("r-2", by("r-2").decided_at, Date.parse(by("r-2").decided_at) + 1000, { tid: tgt(12).id }), await sentItem(POST.id, by(POST.id).decided_at, Date.parse(by(POST.id).decided_at) + 1000, { tid: null, n: 1 })] });
  const e = (await w.exp({})).json;
  assert.deepEqual(e.sentRule, { graceMs: SENT.graceMs, cutover: CUT });
  assert.deepEqual(e.sent.total, { replies: { opened: 0, pending: 1, verified: 1, legacy: 0 }, posts: { opened: 0, pending: 0, verified: 1, legacy: 0 } });
  assert.deepEqual(e.sent.byDay, { "2026-11-03": { replies: { opened: 0, pending: 1, verified: 1, legacy: 0 }, posts: { opened: 0, pending: 0, verified: 1, legacy: 0 } } });
  assert.deepEqual(e.outbox.filter((x) => x.status !== "待发").map((x) => [x.id, x.check]).sort(), [["p-x-1106", "verified"], ["r-1", "pending"], ["r-2", "verified"]]);
  assert.deepEqual(e.outbox.filter((x) => x.status === "待发").map((x) => x.check), [null, null]);
  // 核实了也不改点开的时间:名额照旧是 2
  st = (await w.call("/api/admin/state", { cookie: c })).json;
  assert.equal(gate(st.outbox, [], 3, w.clock).used, 2);
});

test("跟进轮询分档(pick):3 小时内的每轮都读;越旧隔得越久,到了该读的时候才读;每轮总数不超过上限;新的再多也给旧的留名额;顺序稳定", () => {
  const T = Date.parse("2026-11-08T10:00:00Z");
  assert.equal(postedMs(snow(T - 3600e3), T), T - 3600e3);
  assert.ok(Number.isNaN(postedMs(snow(T + 3600e3), T)), "比现在晚的不像真的");
  assert.ok(Number.isNaN(postedMs("123", T)) && Number.isNaN(postedMs("x", T)));
  assert.deepEqual(TIERS.map((x) => [x.upto / 3600e3, x.every / 3600e3]), [[3, 0], [12, 1], [48, 3], [Infinity, 8]]);
  assert.equal(tierOf(0).every, 0);
  assert.equal(tierOf(3 * 3600e3).every, 3600e3);
  const mine = (id, at) => ({ kind: "mine", id, at: new Date(at).toISOString() });
  const hot = mine(snow(T - 3600e3), T - 3600e3), warm = mine(snow(T - 5 * 3600e3), T - 5 * 3600e3), cold = mine(snow(T - 30 * 3600e3), T - 30 * 3600e3);
  const old = mine(snow(T - 3 * 864e5), T - 3 * 864e5), watch = { kind: "watch", id: snow(T - 10 * 864e5) };
  const list = [old, cold, warm, hot, watch];
  const reads = {};
  // 第一轮都没读过:新的先,旧的里被监控的在前,再按编号
  assert.deepEqual(pick(list, 20, reads, T).map((e) => e.id), [hot.id, watch.id, old.id, cold.id, warm.id]);
  for (const e of list) reads[e.id] = new Date(T).toISOString();
  reads[old.id] = new Date(T - 60e3).toISOString(); // old 早读了一分钟:补数的时候它先
  // 到了该读的(排在前面),不够 FLOOR 条的拿上次读得最早的补上(排在后面)
  const at = (h) => { const got = pick(list, 20, reads, T + h * 3600e3).map((e) => e.id); return [got.slice(0, got.length - Math.max(0, FLOOR - due(h))).sort(), got.length]; };
  const due = (h) => ({ [1 / 3]: 1, 1: 2, 3: 3, 8: 5 })[h];
  assert.equal(FLOOR, 4);
  assert.deepEqual(at(1 / 3), [[hot.id], 4], "20 分钟后只有 3 小时内的到了,另补 3 条");
  assert.deepEqual(pick(list, 20, reads, T + 20 * 60e3).map((e) => e.id), [hot.id, old.id, watch.id, cold.id], "补的是上次读得最早的,一样早的被监控的在前、再按编号");
  assert.deepEqual(at(1), [[hot.id, warm.id].sort(), 4], "1 小时后:3–12 小时的也到了");
  assert.deepEqual(at(3), [[hot.id, warm.id, cold.id].sort(), 4], "3 小时后:12–48 小时的也到了(hot 那条这时 4 小时了,按 3–12 小时的档也到了)");
  assert.deepEqual(at(8), [[hot.id, warm.id, cold.id, old.id, watch.id].sort(), 5]);
  // 帖子编号读不出发帖时间:我们的回复按点开的时间算,被监控的当新帖
  assert.deepEqual(pick([{ kind: "mine", id: "3000000000000000001", at: new Date(T - 3 * 864e5).toISOString() }, { kind: "watch", id: "3000000000000000002" }], 1, { "3000000000000000001": new Date(T - 3600e3).toISOString(), "3000000000000000002": new Date(T - 60e3).toISOString() }, T).map((e) => e.id), ["3000000000000000002"]);
  // 上限:3 小时内的 25 条 + 到了该读的旧的 6 条,一轮 20 条:新的 16 条、旧的留 COLD_MIN = 4 条;旧的等得最久的先
  const hots = Array.from({ length: 25 }, (_, i) => mine(snow(T - 600e3, i), T - 600e3));
  const olds = Array.from({ length: 6 }, (_, i) => mine(snow(T - 3 * 864e5, i), T - 3 * 864e5));
  const r2 = {};
  olds.forEach((e, i) => { r2[e.id] = new Date(T - (9 + i) * 3600e3).toISOString(); }); // 等了 9–14 小时(每 8 小时一次)
  const got = pick([...olds, ...hots], 20, r2, T);
  assert.equal(got.length, 20);
  assert.equal(COLD_MIN, 4);
  // 留给旧的 4 个和新的交错排在最前面(新、旧、新、旧……):上游慢、读到一半时间到了,旧的也读得到;旧的里等得最久的先
  assert.deepEqual([1, 3, 5, 7].map((i) => got[i].id), olds.slice(2).reverse().map((e) => e.id), "等得最久的先,交错排在前面");
  assert.deepEqual([0, 2, 4, 6, ...Array.from({ length: 12 }, (_, i) => 8 + i)].map((i) => got[i].e === undefined && hots.includes(got[i])), Array(16).fill(true), "其余都是新的");
  assert.equal(pick(hots, 20, {}, T).length, 20, "没有到了该读的旧帖:新的用满");
  assert.equal(pick([...hots.slice(0, 10), ...olds], 20, r2, T).length, 16, "新的没用完的名额给旧的");
  assert.deepEqual(pick(list, 3, {}, T).map((e) => e.id), [hot.id, watch.id, old.id], "这一轮剩得不多:新的先");
  assert.equal(pick([hot], 20, { [hot.id]: new Date(T).toISOString() }, T).length, 1, "一共就这么多,补不出来");
  assert.equal(pick(list, 0, {}, T).length, 0);
  // 同样的输入,同样的顺序(和传进来的顺序无关)
  assert.deepEqual(pick([...olds, ...hots].reverse(), 20, r2, T).map((e) => e.id), got.map((e) => e.id));
});

// 跟进轮询的模拟:过去 7 天每天 perDay 条(均匀),往后 3 天每天 10、14、18 点各坐下一次(每次 perDay / 3 条,隔 3 分钟),
// 第二天 12 点另有一次猛的(burst 条,每分钟一条),另有 6 条被监控的旧帖子。每 20 分钟一轮,每轮 16 条(MAX_FETCH 扣掉找链接最多用的 4 条)。
// 回各档(按读的那一刻帖子多旧)两次读之间最长隔几小时;第一天是起步(以前没读过的一下子都到了),不算
function simulate(perDay, burst) {
  const T0 = Date.parse("2026-11-08T00:00:00Z"), ROUND = 20 * 60e3, ROUNDS = 3 * 72, END = T0 + ROUNDS * ROUND;
  const posts = [];
  for (let d = 7; d >= 0; d--) for (let i = 0; i < perDay; i++) { const c = T0 - d * 864e5 + (i * 864e5) / perDay; if (c < T0) posts.push({ kind: "mine", id: snow(c, 1), c }); }
  for (let d = 0; d < 3; d++) for (const h of [10, 14, 18]) for (let i = 0; i < Math.round(perDay / 3); i++) { const c = T0 + d * 864e5 + h * 3600e3 + i * 180e3; posts.push({ kind: "mine", id: snow(c, 2), c }); }
  for (let i = 0; i < burst; i++) { const c = T0 + 864e5 + 12 * 3600e3 + i * 60e3; posts.push({ kind: "mine", id: snow(c, 3), c }); }
  const watch = Array.from({ length: 6 }, (_, i) => ({ kind: "watch", id: snow(T0 - (10 + i * 4) * 864e5, 4), c: T0 - (10 + i * 4) * 864e5 }));
  const reads = {}, hist = new Map();
  for (let k = 0; k < ROUNDS; k++) {
    const now = T0 + k * ROUND;
    const list = [...posts.filter((p) => p.c <= now && now - p.c < 7 * 864e5), ...watch].map((p) => ({ kind: p.kind, id: p.id, at: new Date(p.c).toISOString() }));
    const got = pick(list, MAX_FETCH - 4, reads, now);
    assert.ok(got.length <= MAX_FETCH - 4);
    for (const e of got) { reads[e.id] = new Date(now).toISOString(); if (!hist.has(e.id)) hist.set(e.id, []); hist.get(e.id).push(now); }
  }
  const worst = {};
  for (const p of [...posts, ...watch]) {
    let prev = Math.max(p.c, T0);
    for (const t of [...(hist.get(p.id) || []), END]) {
      if (t - p.c >= 7 * 864e5 && p.kind === "mine") break;
      const tier = tierOf(t - p.c).every / 3600e3;
      if (prev >= T0 + 864e5) worst[tier] = Math.max(worst[tier] || 0, (t - prev) / 3600e3);
      prev = t;
    }
  }
  return worst;
}
test("跟进轮询不饿死:每天 20 条时,3 小时内的每轮都读到,别的按档读(每小时、每 3 小时、每 8 小时,最多多等一轮);一次猛地来 30 条(超过一轮的名额),新的也至少 4 轮读一次,旧的照样读到", () => {
  const calm = simulate(20, 0);
  assert.ok(calm[0] <= 1 / 3 + 1e-9, "3 小时内的每轮都读:" + JSON.stringify(calm));
  assert.ok(calm[1] <= 1 + 1 / 3 + 1e-9 && calm[3] <= 4 && calm[8] <= 9.5, JSON.stringify(calm));
  const busy = simulate(20, 30);
  assert.ok(busy[0] <= 4 / 3 + 1e-9, "新的最多隔 4 轮:" + JSON.stringify(busy));
  assert.ok(busy[1] <= 2.5 && busy[3] <= 6 && busy[8] <= 14, "旧的照样读到:" + JSON.stringify(busy));
});

test("刷新:我们的回复按发出多久分档读(3 小时内每轮读,旧的到了时候才读,不够 4 条拿上次读得最早的补上);点开超过 6 小时、还没链接的不再去目标帖子底下找(交给主窗口核)", async () => {
  const w = world();
  const c = await w.login();
  const T = w.clock;
  const OWNER = { id: "1000000000000000001", screen_name: "owner_acct" };
  const WATCH = snow(T - 10 * 864e5), NEW = snow(T - 3600e3), OLD = [1, 2, 3, 4, 5].map((i) => snow(T - 3 * 864e5, i));
  const tgt = (n) => ({ ...TARGET, id: "21160000000000007" + n, url: "https://x.com/someone/status/21160000000000007" + n });
  const olds = OLD.map((_, i) => OUT({ id: "r-old-" + (i + 1), target: tgt(20 + i) }));
  await w.ingest({ docs: { x_posts: { posts: [{ name: "X 长文", id: WATCH, points: [] }] } }, outbox: [OUT({ id: "r-new", target: tgt(11) }), ...olds, OUT({ id: "r-lost", target: tgt(13) }), OUT({ id: "r-fresh", target: tgt(14) })] });
  for (const id of ["r-new", ...olds.map((x) => x.id), "r-lost", "r-fresh"]) await w.call("/api/admin/outbox", { method: "POST", body: { id, status: "已发" }, cookie: c });
  w.clock += 1000;
  await w.ingest({ outbox: [{ ...OUT({ id: "r-new", target: tgt(11) }), replyUrl: "https://x.com/owner_acct/status/" + NEW }, ...olds.map((x, i) => ({ ...x, replyUrl: "https://x.com/owner_acct/status/" + OLD[i] }))] });
  await w.db.prepare("UPDATE outbox SET decided_at = ? WHERE id LIKE 'r-old-%' OR id = 'r-lost'").bind(new Date(T - 3 * 864e5).toISOString()).run();
  let asked = [];
  w.fetchImpl = async (u) => { const id = String(u).split("/").pop(); asked.push(id); return new Response(JSON.stringify({ status: { id, author: OWNER, views: 1, replies: 0 }, replies: [] })); };
  const round = async (min) => { w.clock += min * 60e3; asked = []; const r = await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c }); assert.equal(r.status, 200, JSON.stringify(r.json)); return asked.sort(); };
  assert.deepEqual(await round(0), [WATCH, tgt(14).id, NEW, ...OLD].sort(), "第一轮都读;r-lost 点开 3 天了不再找链接,r-fresh 刚点开的去找");
  // 20 分钟后:到了该读的只有 3 小时内的 NEW(和还在找链接的 r-fresh),不够 4 条:拿上次读得最早的补上(一样早的被监控的在前、再按编号)
  assert.deepEqual(await round(20), [tgt(14).id, NEW, WATCH, OLD[0], OLD[1]].sort());
  assert.deepEqual(await round(20), [tgt(14).id, NEW, OLD[2], OLD[3], OLD[4]].sort(), "补的轮着来");
  // 再过 7 小时 50 分:旧的里离上次读满 8 小时的到了(WATCH、OLD 1–2),OLD 3–5 还差 10 分钟;NEW 已经 9 个多小时(每小时一次)也到了;
  // r-fresh 点开超过 6 小时,不再去找链接
  assert.deepEqual(await round(7 * 60 + 50), [NEW, WATCH, OLD[0], OLD[1]].sort());
});

test("核实发出了的:链接以核到的为准,补链接(投递的 replyUrl、管理员贴的)不再换它(读和写之间刚核实的,语句里也挡住,不会写出两个链接);没核实的照旧能补", async () => {
  const w = world();
  const c = await w.login();
  await w.ingest({ outbox: [OUT(), OUT({ id: "r-two", target: { ...TARGET, id: "2116000000000000777", url: "https://x.com/someone/status/2116000000000000777" } })] });
  for (const id of ["r-openeden-1", "r-two"]) await w.call("/api/admin/outbox", { method: "POST", body: { id, status: "已发" }, cookie: c });
  const st = (await w.call("/api/admin/state", { cookie: c })).json;
  const opened = st.outbox.find((x) => x.id === "r-openeden-1").decided_at, T0 = Date.parse(opened);
  w.clock += 1000;
  // 没核实的:照旧能补链接
  assert.equal((await w.ingest({ outbox: [{ ...OUT(), replyUrl: "https://x.com/DeFiExit/status/2118000000000000301" }] })).json.outbox, 1);
  w.clock += 1000;
  const item = await sentItem("r-openeden-1", opened, T0 + 1000);
  assert.equal((await w.ingest({ sent: [item] })).json.sent, 1);
  w.clock += 1000;
  const r = await w.ingest({ outbox: [{ ...OUT(), replyUrl: "https://x.com/DeFiExit/status/2118000000000000303" }] });
  assert.deepEqual([r.json.outbox, r.json.rejected], [0, [{ kind: "outbox", id: "r-openeden-1", why: "已经核实发出了,链接以核到的为准,不再换" }]]);
  const p = await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-openeden-1", reply_url: "https://x.com/DeFiExit/status/2118000000000000304" }, cookie: c });
  assert.deepEqual([p.status, p.json.error], [409, "verified"]);
  const d = (await w.call("/api/admin/state", { cookie: c })).json.outbox.find((x) => x.id === "r-openeden-1");
  assert.deepEqual([d.reply_url, d.mine.sent.url, sentState(d, st.sentRule, w.clock)], [item.url, item.url, "verified"]);
  // 管理员贴链接:读到的时候还没核实,写之前主窗口核实了(另一个请求先写进去):这次贴的不写(回 changed),reply_url 和核到的链接一致
  const raw = w.db, opened2 = st.outbox.find((x) => x.id === "r-two").decided_at, V = OURS_URL(snow(Date.parse(opened2) + 2000, 5));
  let landed = false;
  const land = () => { if (landed) return; landed = true; raw.prepare("UPDATE outbox SET reply_url = ?, mine = json_set(mine, '$.sent', json(?)) WHERE id = 'r-two'").bind(V, JSON.stringify({ opened: opened2, at: new Date(w.clock).toISOString(), url: V, post: V.split("/").pop() })).runSync(); };
  const wrap = (st2, sql) => ({ inner: st2, bind: (...a) => wrap(st2.bind(...a), sql), all: () => st2.all(), run: () => st2.run(),
    first: async (...a) => { const out = await st2.first(...a); if (sql === "SELECT * FROM outbox WHERE id = ?") land(); return out; } });
  w.db = { prepare: (sql) => wrap(raw.prepare(sql), sql), batch: (ss) => raw.batch(ss.map((x) => x.inner)) };
  const paste = await w.call("/api/admin/outbox", { method: "POST", body: { id: "r-two", reply_url: "https://x.com/DeFiExit/status/2118000000000000305" }, cookie: c });
  w.db = raw;
  assert.deepEqual([landed, paste.status, paste.json.error], [true, 409, "changed"]);
  const t2 = await raw.prepare("SELECT reply_url, json_extract(mine, '$.sent.url') AS u FROM outbox WHERE id = 'r-two'").first();
  assert.deepEqual([t2.reply_url, t2.u], [V, V]);
});

test("刷新:上游慢、读到一半 45 秒就到了,留给旧帖子的名额也读得到(和新的交错着读);持续有新帖,旧的也一轮轮轮得到", async () => {
  const w = world();
  const c = await w.login();
  const T = w.clock;
  const OWNER = { id: "1000000000000000001", screen_name: "owner_acct" };
  const tgt = (n) => ({ ...TARGET, id: "21160000000000004" + String(n).padStart(2, "0"), url: "https://x.com/someone/status/21160000000000004" + String(n).padStart(2, "0") });
  const NEW = Array.from({ length: 10 }, (_, i) => snow(T - 3600e3, i)), OLD = Array.from({ length: 6 }, (_, i) => snow(T - 3 * 864e5, i));
  const cards = [...NEW.map((p, i) => ({ c: OUT({ id: "r-n" + i, target: tgt(i) }), p })), ...OLD.map((p, i) => ({ c: OUT({ id: "r-o" + i, target: tgt(20 + i) }), p }))];
  await w.ingest({ outbox: cards.map((x) => x.c) });
  for (const x of cards) await w.call("/api/admin/outbox", { method: "POST", body: { id: x.c.id, status: "已发" }, cookie: c });
  w.clock += 1000;
  await w.ingest({ outbox: cards.map((x) => ({ ...x.c, replyUrl: "https://x.com/owner_acct/status/" + x.p })) });
  await w.db.prepare("UPDATE outbox SET decided_at = ? WHERE id LIKE 'r-o%'").bind(new Date(T - 3 * 864e5).toISOString()).run();
  // 认得我们的账号;旧的 9 小时前读过(每 8 小时一次,到了),新的没读过
  await w.db.prepare("INSERT INTO kv (k, v) VALUES ('our_ids', ?)").bind(JSON.stringify([OWNER.id])).run();
  await w.db.prepare("INSERT INTO kv (k, v) VALUES ('auto_reads', ?)").bind(JSON.stringify(Object.fromEntries(OLD.map((p) => [p, new Date(T - 9 * 3600e3).toISOString()])))).run();
  const keep = BUDGET.ms;
  try {
    BUDGET.ms = 200; // 每读一条 40 毫秒:一轮只来得及读 5、6 条
    let asked = [];
    w.fetchImpl = async (u) => { const id = String(u).split("/").pop(); asked.push(id); await new Promise((r) => setTimeout(r, 40)); return new Response(JSON.stringify({ status: { id, author: OWNER, views: 1, replies: 0 }, replies: [] })); };
    const r = await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.ok(asked.length >= 2 && asked.length < 16, "时间到了就停:读了 " + asked.length + " 条");
    const olds = asked.filter((id) => OLD.includes(id)).length, news = asked.filter((id) => NEW.includes(id)).length;
    assert.ok(olds >= 1 && news >= 1 && Math.abs(olds - news) <= 1, `新的、旧的交错着读:新 ${news} 旧 ${olds}`);
    // 接着几轮(每轮都只来得及读几条):6 条旧的都轮得到
    const seen = new Set(asked.filter((id) => OLD.includes(id)));
    for (let k = 0; k < 6 && seen.size < OLD.length; k++) {
      w.clock += 20 * 60e3;
      asked = [];
      await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c });
      for (const id of asked) if (OLD.includes(id)) seen.add(id);
    }
    assert.equal(seen.size, OLD.length, "旧的都轮到了");
  } finally {
    BUDGET.ms = keep;
  }
});


// 巡检(3070 的 tools/ops_patrol.py):每轮结束单独送一包顶层的 patrol(ops_push --only patrol),存进 kv;暂停开关管理员点,导出带给巡检
test("巡检状态:单独一包顶层的 patrol,形状不对不收(回执写明);收下的进「定时任务」(auto.patrol),不碰看板;晚到的旧包不盖新的;将来的时间存成收到的时间(不挡以后的报到);看板的投递盖不掉它", async () => {
  const w = world();
  const c = await w.login();
  const send = async (patrol) => { w.clock += 1000; return w.ingest({ patrol }); };
  w.clock += 1000;
  await w.ingest({ docs: { summary: { updatedAt: "2026-11-03T10:00:00Z", asks: [{ text: "主窗口写的", when: "今天" }] } } });
  for (const bad of [{ at: "2026-11-03T18:17:00+08:00", ok: "yes", note: "x" }, { at: "不是时间", ok: true, note: "x" }, { ok: true, note: "x" }, { at: "2026-11-03T18:17:00+08:00", ok: true, note: "长".repeat(201) }, { at: "2026-11-03T18:17:00+08:00", ok: true }, "没有新评论", null, []]) {
    const r = await send(bad);
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.patrol, r.json.rejected], [0, [{ kind: "patrol", id: "patrol", why: "格式不对" }]], JSON.stringify(bad));
  }
  assert.equal((await w.call("/api/admin/state", { cookie: c })).json.auto.patrol, null);
  const r = await send({ at: "2026-11-03T17:47:00+08:00", ok: true, note: "没有新评论" });
  assert.deepEqual([r.json.patrol, r.json.docs, r.json.rejected], [1, 0, []]);
  let st = (await w.call("/api/admin/state", { cookie: c })).json;
  assert.deepEqual(st.auto.patrol, { at: "2026-11-03T09:47:00.000Z", ok: true, note: "没有新评论" });
  assert.deepEqual(st.docs.summary, { updatedAt: "2026-11-03T10:00:00Z", asks: [{ text: "主窗口写的", when: "今天" }] }, "看板不动");
  await send({ at: "2026-11-03T17:17:00+08:00", ok: false, note: "旧的" }); // 晚到的旧包
  w.clock += 1000;
  await w.ingest({ docs: { summary: { updatedAt: "2026-11-03T10:00:30Z", asks: [] } } }); // 主窗口送看板
  st = (await w.call("/api/admin/state", { cookie: c })).json;
  assert.equal(st.auto.patrol.note, "没有新评论");
  // 3070 的钟快了 9 分钟:收下,时间记成收到的那一刻;半小时后真实的那一轮照样更新
  const got = new Date(w.clock + 1000).toISOString();
  await send({ at: "2026-11-03T18:09:00+08:00", ok: true, note: "钟快了" });
  assert.deepEqual((await w.call("/api/admin/state", { cookie: c })).json.auto.patrol, { at: got, ok: true, note: "钟快了" });
  w.clock += 30 * 60e3;
  await send({ at: new Date(w.clock + 1000).toISOString(), ok: false, note: "出错:读不了运营台" });
  w.clock += 1000;
  assert.deepEqual((await w.exp({})).json.auto.patrol, { at: new Date(w.clock - 1000).toISOString(), ok: false, note: "出错:读不了运营台" });
});

test("暂停巡检开关:管理员登录才能改(同源、JSON);只收 { paused: true|false };运营台和导出都带 patrol: { paused, at }", async () => {
  const w = world();
  assert.equal((await w.call("/api/admin/patrol", { method: "POST", body: { paused: true } })).status, 401, "没设管理员");
  const c = await w.login();
  assert.deepEqual((await w.exp({})).json.patrol, { paused: false, at: null }, "没点过:没暂停");
  assert.deepEqual((await w.call("/api/admin/state", { cookie: c })).json.patrol, { paused: false, at: null });
  assert.equal((await w.call("/api/admin/patrol", { method: "POST", body: { paused: true } })).json.need, "login");
  assert.equal((await w.call("/api/admin/patrol", { method: "POST", body: { paused: true }, cookie: c, origin: null })).json.error, "origin");
  assert.equal((await w.call("/api/admin/patrol", { method: "POST", body: { paused: true }, cookie: c, origin: "https://evil.example" })).json.error, "origin");
  assert.equal((await w.call("/api/admin/patrol", { method: "POST", body: { paused: true }, cookie: c, type: "text/plain" })).status, 415);
  for (const bad of [{}, { paused: "true" }, { paused: 1 }, { paused: true, at: "2026-11-03T10:00:00Z" }]) {
    assert.equal((await w.call("/api/admin/patrol", { method: "POST", body: bad, cookie: c })).status, 400, JSON.stringify(bad));
  }
  w.clock += 60e3;
  const r = await w.call("/api/admin/patrol", { method: "POST", body: { paused: true }, cookie: c });
  assert.deepEqual(r.json, { ok: true, patrol: { paused: true, at: "2026-11-03T10:01:00.000Z" } });
  assert.deepEqual((await w.call("/api/admin/state", { cookie: c })).json.patrol, { paused: true, at: "2026-11-03T10:01:00.000Z" });
  w.clock += 1000;
  assert.deepEqual((await w.exp({ since: new Date(w.clock).toISOString() })).json.patrol, { paused: true, at: "2026-11-03T10:01:00.000Z" }, "导出不看 since");
  assert.equal((await w.exp({}, { key: TASK.privateKey })).json.error, "sig", "定时任务的小钥匙读不了");
  w.clock += 60e3;
  await w.call("/api/admin/patrol", { method: "POST", body: { paused: false }, cookie: c });
  w.clock += 1000;
  assert.deepEqual((await w.exp({})).json.patrol, { paused: false, at: "2026-11-03T10:02:01.000Z" });
  // 投递改不了开关(顶层的 patrol 是巡检的报到,{ paused } 不合那个形状)
  w.clock += 1000;
  assert.deepEqual((await w.ingest({ patrol: { paused: true } })).json.rejected, [{ kind: "patrol", id: "patrol", why: "格式不对" }]);
  w.clock += 1000;
  assert.equal((await w.exp({})).json.patrol.paused, false);
});

test("巡检多久没报到:只数北京时间 8:00–24:00(夜里不跑不算),白天超过 2 小时才算没跑;暂停中不算;没报到过不算", () => {
  const bj = (s) => Date.parse(s + "+08:00");
  assert.equal(dayHours(bj("2026-11-07T10:00:00"), bj("2026-11-07T12:30:00")), 2.5);
  assert.equal(dayHours(bj("2026-11-07T23:47:00"), bj("2026-11-08T08:17:00")).toFixed(2), "0.50", "夜里不算:23:47 到 24:00、8:00 到 8:17");
  assert.equal(dayHours(bj("2026-11-07T02:00:00"), bj("2026-11-07T07:59:00")), 0);
  assert.equal(dayHours(bj("2026-11-06T12:00:00"), bj("2026-11-07T12:00:00")), 16);
  assert.equal(dayHours(bj("2026-10-01T12:00:00"), bj("2026-11-07T12:00:00")) > 2, true, "隔得很久的也算没跑");
  assert.equal(dayHours(bj("2026-11-07T12:00:00"), bj("2026-11-07T11:00:00")), 0);
  const at = (s) => ({ at: new Date(bj(s)).toISOString(), ok: true, note: "没有新评论" });
  assert.equal(patrolLate(at("2026-11-07T10:17:00"), null, bj("2026-11-07T12:16:00")), false);
  assert.equal(patrolLate(at("2026-11-07T10:17:00"), null, bj("2026-11-07T12:18:00")), true);
  assert.equal(patrolLate(at("2026-11-07T23:47:00"), null, bj("2026-11-08T09:40:00")), false, "早上 9:40:白天才过了 1 小时 53 分");
  assert.equal(patrolLate(at("2026-11-07T23:47:00"), null, bj("2026-11-08T09:50:00")), true);
  assert.equal(patrolLate(at("2026-11-07T10:17:00"), { paused: true, at: "2026-11-07T02:00:00Z" }, bj("2026-11-07T20:00:00")), false, "暂停中不提醒");
  assert.equal(patrolLate(at("2026-11-07T10:17:00"), { paused: false, at: "2026-11-07T02:00:00Z" }, bj("2026-11-07T20:00:00")), true);
  assert.equal(patrolLate(null, null, bj("2026-11-07T20:00:00")), false);
  assert.equal(patrolLate({ at: "坏的" }, null, bj("2026-11-07T20:00:00")), false);
});
