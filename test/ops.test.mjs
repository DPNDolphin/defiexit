// 运营台(functions/api/admin、functions/admin、server/ops):用本地 SQLite 当 D1、用假的 fxtwitter 测。不连 Cloudflare、不连 X。
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, randomUUID } from "node:crypto";
import { LocalD1 } from "../scripts/d1-local.mjs";
import { handle } from "../functions/api/admin/[[path]].js";
import { serve } from "../functions/admin/[[path]].js";
import { checkText, signedText, SKEW_MS } from "../server/ops/ingest.js";
import { waitFor, MIN_PASSWORD } from "../server/ops/auth.js";
import { hostOk } from "../server/ops/http.js";

const HOST = "https://defiexit.com";
const kp = () => generateKeyPairSync("ed25519");
const pubOf = (k) => k.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("base64url");
const PROD = kp(), PREV = kp();
const CODE = "setup-code-0123456789abcdef";
const PW = "correct-horse-battery-staple-42";
const baseEnv = (db, extra = {}) => ({ OPS: db, ADMIN_HOSTS: "defiexit.com", OPS_ENV: "production", INGEST_PUBKEYS: pubOf(PROD), SETUP_CODE: CODE, ...extra });

function world() {
  const w = { db: new LocalD1(), clock: Date.parse("2026-11-03T10:00:00Z"), fetchImpl: async () => new Response("{}", { status: 500 }) };
  w.now = () => new Date(w.clock);
  w.call = async (path, { method = "GET", body, cookie, origin = HOST, host = HOST, ip = "203.0.113.7", env = {}, type = "application/json" } = {}) => {
    const h = { "CF-Connecting-IP": ip };
    if (body !== undefined) h["Content-Type"] = type;
    if (origin) h.Origin = origin;
    if (cookie) h.Cookie = cookie;
    const r = await handle(new Request(host + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), baseEnv(w.db, env), w.fetchImpl, w.now());
    return { status: r.status, json: await r.json().catch(() => ({})), headers: r.headers };
  };
  w.ingest = async (payload, { key = PROD.privateKey, envName = "production", ts = w.clock, nonce = randomUUID().replace(/-/g, ""), path = "/api/admin/ingest" } = {}) => {
    const raw = JSON.stringify({ v: 1, ts, nonce, ...payload });
    const sig = sign(null, Buffer.from(signedText(envName, "POST", path, raw)), key).toString("base64url");
    const r = await handle(new Request(HOST + path, { method: "POST", headers: { "X-DX-Sig": sig, "Content-Type": "application/json" }, body: raw }), baseEnv(w.db), w.fetchImpl, w.now());
    return { status: r.status, json: await r.json(), raw, sig };
  };
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
  const r = await w.call("/api/admin/setup", { method: "POST", body: { code: CODE, name: "admin1", password: PW } });
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

test("登录凭证:退出、全部退出、闲置 7 天、满 30 天都失效", async () => {
  const w = world();
  const c = await w.login();
  w.clock += 6 * 864e5;
  assert.equal((await w.call("/api/admin/state", { cookie: c })).status, 200); // 6 天内打开过,闲置时间重算
  w.clock += 6 * 864e5;
  assert.equal((await w.call("/api/admin/state", { cookie: c })).status, 200);
  w.clock += 8 * 864e5;
  assert.equal((await w.call("/api/admin/state", { cookie: c })).json.need, "login"); // 闲置超过 7 天
  const c2 = (await w.call("/api/admin/login", { method: "POST", body: { name: "admin1", password: PW } })).headers.get("Set-Cookie").split(";")[0];
  await w.call("/api/admin/logout", { method: "POST", body: {}, cookie: c2 });
  assert.equal((await w.call("/api/admin/state", { cookie: c2 })).json.need, "login");
  const c3 = (await w.call("/api/admin/login", { method: "POST", body: { name: "admin1", password: PW } })).headers.get("Set-Cookie").split(";")[0];
  const c4 = (await w.call("/api/admin/login", { method: "POST", body: { name: "admin1", password: PW } })).headers.get("Set-Cookie").split(";")[0];
  await w.call("/api/admin/logout-all", { method: "POST", body: {}, cookie: c3 });
  assert.equal((await w.call("/api/admin/state", { cookie: c4 })).json.need, "login");
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
  const r = await handle(new Request(HOST + "/api/admin/ingest", { method: "POST", headers: { "X-DX-Sig": ok.sig }, body: ok.raw.replace("2026", "2027") }), baseEnv(w.db), w.fetchImpl, w.now());
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
  assert.deepEqual(s.json.errors, ["X 长文"]);
  assert.equal((await w.call("/api/admin/state", { cookie: c })).json.synced.note, "1 条没读到");
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
  await w.call("/api/admin/sync", { method: "POST", body: {}, cookie: c });
  const item = (await w.call("/api/admin/state", { cookie: c })).json.outbox[0];
  assert.equal(item.reply_url, "https://x.com/owner_acct/status/2116000000000000004");
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
import { sync } from "../server/ops/sync.js";
import { ensure, putDoc } from "../server/ops/db.js";

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
  const r = await handle(new Request(HOST + "/api/admin/ingest", { method: "POST", headers: { "X-DX-Sig": sig }, body: raw }), baseEnv(sneaky), w.fetchImpl, w.now());
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
  const r = await sync(counted, async () => new Response(JSON.stringify({ status: { id: "1234", author: { id: "1", screen_name: "owner" }, replies: 200 }, replies })), now);
  assert.equal(r.body.newReplies, 200);
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
