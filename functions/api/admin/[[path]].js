// 运营台接口(Cloudflare Pages Function,路径 /api/admin/*),只在 admin 主机上应答,别的主机一律 404。
// GET  state            看板数据、待发、收件(要登录;没设管理员就回 need: setup)
// POST setup / login / logout / logout-all
// POST outbox / inbox    管理员点的状态、决定、备注、改过的草稿
// POST watch / delete    帖子看不看评论;按要求删掉一条
// POST sync              经 fxtwitter 刷新读数和评论
// POST ingest            Claude 主窗口的签名投递(不靠登录,靠签名;见 server/ops/ingest.js)
// 改东西的请求(ingest 除外)必须同源、JSON、已登录;登录凭证是只给本主机的 __Host- cookie(SameSite=Strict)。

import { reply, gone, hostOk, sameOrigin, readJson, clientIp } from "../../../server/ops/http.js";
import { ensure, iso, getKv, getDocs, listOut, listIn, getOut, getIn, purge, goneStmt } from "../../../server/ops/db.js";
import { MIN_PASSWORD, hashPassword, checkPassword, newSession, hasSession, endSession, endAll, cookie, mustWait, failed, succeeded, same } from "../../../server/ops/auth.js";
import { ingest } from "../../../server/ops/ingest.js";
import { sync } from "../../../server/ops/sync.js";

const STATUS = ["待发", "已发", "跳过"];
const DECISIONS = ["采纳", "以后再说", "不采纳"];
const NAME = /^[\p{L}\p{N}_.-]{1,40}$/u;

async function state(db, admin, now) {
  await purge(db, now);
  const [docs, outbox, inbox, syncAt, syncNote, off, needs] = await Promise.all([
    getDocs(db), listOut(db), listIn(db), getKv(db, "sync_at_ms"), getKv(db, "sync_note"),
    db.prepare("SELECT id FROM watch WHERE on_ = 0").all(),
    db.prepare("SELECT month, v FROM needs ORDER BY month DESC LIMIT 100").all(),
  ]);
  const past = needs.results.map((r) => { try { return { month: r.month, ...JSON.parse(r.v) }; } catch { return null; } }).filter(Boolean);
  return reply({ ok: true, me: { name: admin.name }, docs, outbox, inbox, needs: past, watchOff: off.results.map((r) => r.id), synced: { at: syncAt ? iso(Number(syncAt)) : null, note: syncNote || "" } });
}

async function editOut(db, b, now) {
  const cur = await getOut(db, String(b.id || ""));
  if (!cur) return reply({ error: "none" }, 404);
  const sets = [], args = [];
  if ("status" in b) {
    if (!STATUS.includes(b.status)) return reply({ error: "bad" }, 400);
    sets.push("status = ?", "decided_at = ?");
    args.push(b.status, b.status === "待发" ? null : iso(now));
    if (b.status === "已发") {
      // 记下点「已发」那一刻的草稿和目标帖子:之后核对的就是这一条
      const tid = cur.mine && cur.mine.target && cur.mine.target.id;
      if (!tid) return reply({ error: "target" }, 400);
      sets.push("sent_text = ?", "sent_target = ?");
      args.push(cur.draft_admin != null ? cur.draft_admin : cur.mine.draft || "", tid);
    } else {
      sets.push("sent_text = NULL", "sent_target = NULL", "reply_url = NULL");
    }
  }
  if ("draft" in b) {
    if ((b.status || cur.status) !== "待发") return reply({ error: "locked" }, 409);
    if (b.draft === null) sets.push("draft_admin = NULL");
    else if (typeof b.draft === "string" && b.draft.length <= 2000) { sets.push("draft_admin = ?"); args.push(b.draft); }
    else return reply({ error: "bad" }, 400);
  }
  if ("note" in b) {
    if (typeof b.note !== "string" || b.note.length > 500) return reply({ error: "bad" }, 400);
    sets.push("note = ?");
    args.push(b.note);
  }
  if (!sets.length) return reply({ error: "bad" }, 400);
  await db.prepare(`UPDATE outbox SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).bind(...args, iso(now), cur.id).run();
  return reply({ ok: true, item: await getOut(db, cur.id) });
}

async function editIn(db, b, now) {
  const cur = await getIn(db, String(b.id || ""));
  if (!cur) return reply({ error: "none" }, 404);
  const sets = [], args = [];
  if ("decision" in b) {
    if (b.decision !== null && !DECISIONS.includes(b.decision)) return reply({ error: "bad" }, 400);
    sets.push("decision = ?", "decided_at = ?");
    args.push(b.decision, b.decision ? iso(now) : null);
  }
  if (b.replied === true) { sets.push("replied = 1", "replied_at = COALESCE(replied_at, ?)"); args.push(iso(now)); }
  if ("note" in b) {
    if (typeof b.note !== "string" || b.note.length > 500) return reply({ error: "bad" }, 400);
    sets.push("note = ?");
    args.push(b.note);
  }
  if (!sets.length) return reply({ error: "bad" }, 400);
  await db.prepare(`UPDATE inbox SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).bind(...args, iso(now), cur.id).run();
  return reply({ ok: true, item: await getIn(db, cur.id) });
}

export async function handle(request, env, fetchImpl = fetch, now = new Date()) {
  if (!hostOk(request, env)) return gone();
  const db = env.OPS;
  if (!db) return reply({ need: "db" }, 503);
  await ensure(db);
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/admin\/?/, "");
  const admin = await db.prepare("SELECT name FROM admin WHERE id = 1").first();

  if (request.method === "GET") {
    if (path !== "state") return gone();
    if (!admin) return reply({ need: "setup" }, 401);
    if (!(await hasSession(db, request, now))) return reply({ need: "login" }, 401);
    return state(db, admin, now);
  }
  if (request.method !== "POST") return reply({ error: "method" }, 405, { Allow: "GET, POST" });

  if (path === "ingest") {
    const raw = await request.text();
    const r = await ingest(db, { raw, sig: request.headers.get("X-DX-Sig") || "", envName: String(env.OPS_ENV || ""), method: "POST", path: url.pathname, pubkeys: env.INGEST_PUBKEYS }, now);
    if (r.status === 200) await purge(db, now);
    return reply(r.body, r.status);
  }

  if (!sameOrigin(request)) return reply({ error: "origin" }, 403);
  if (!/^application\/json\b/i.test(request.headers.get("Content-Type") || "")) return reply({ error: "type" }, 415);
  const { value: b, error } = await readJson(request);
  if (error) return reply({ error }, 400);
  const ip = clientIp(request);

  if (path === "setup") {
    if (admin) return reply({ error: "exists" }, 409);
    const code = String(env.SETUP_CODE || "");
    if (code.length < 16) return reply({ error: "nocode" }, 503);
    const wait = await mustWait(db, ip, now);
    if (wait) return reply({ error: "wait", seconds: wait }, 429);
    if (!same(String(b.code || ""), code)) { await failed(db, ip, now); return reply({ error: "code" }, 403); }
    const name = String(b.name || "").trim();
    if (!NAME.test(name)) return reply({ error: "name" }, 400);
    if (String(b.password || "").length < MIN_PASSWORD) return reply({ error: "weak" }, 400);
    const h = await hashPassword(String(b.password));
    try {
      // id 固定为 1:两个人同时设,只有先到的那个写得进去
      await db.prepare("INSERT INTO admin (id, name, salt, hash, iter, created_at) VALUES (1, ?, ?, ?, ?, ?)").bind(name, h.salt, h.hash, h.iter, iso(now)).run();
    } catch {
      return reply({ error: "exists" }, 409);
    }
    await succeeded(db, ip);
    return reply({ ok: true }, 200, { "Set-Cookie": await newSession(db, now) });
  }
  if (path === "login") {
    if (!admin) return reply({ need: "setup" }, 401);
    const wait = await mustWait(db, ip, now);
    if (wait) return reply({ error: "wait", seconds: wait }, 429);
    const row = await db.prepare("SELECT name, salt, hash, iter FROM admin WHERE id = 1").first();
    const okPw = await checkPassword(String(b.password || ""), row);
    if (!(same(String(b.name || "").trim(), row.name) && okPw)) { await failed(db, ip, now); return reply({ error: "wrong" }, 401); }
    await succeeded(db, ip);
    return reply({ ok: true }, 200, { "Set-Cookie": await newSession(db, now) });
  }
  if (path === "logout") return reply({ ok: true }, 200, { "Set-Cookie": await endSession(db, request) });

  if (!admin || !(await hasSession(db, request, now))) return reply({ need: "login" }, 401);

  if (path === "logout-all") { await endAll(db); return reply({ ok: true }, 200, { "Set-Cookie": cookie("", 0) }); }
  if (path === "outbox") return editOut(db, b, now);
  if (path === "inbox") return editIn(db, b, now);
  if (path === "watch") {
    if (!/^\d{1,25}$/.test(String(b.id || "")) || typeof b.on !== "boolean") return reply({ error: "bad" }, 400);
    await db.prepare("INSERT INTO watch (id, on_) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET on_ = excluded.on_").bind(String(b.id), b.on ? 1 : 0).run();
    return reply({ ok: true });
  }
  if (path === "delete") {
    const table = { inbox: "inbox", outbox: "outbox" }[b.kind];
    if (!table || typeof b.id !== "string" || b.id.length > 64) return reply({ error: "bad" }, 400);
    await db.batch([db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(b.id), await goneStmt(db, b.id, now)]);
    return reply({ ok: true });
  }
  if (path === "sync") {
    const r = await sync(db, fetchImpl, now);
    await purge(db, now);
    return reply(r.body, r.status);
  }
  return gone();
}

export const onRequest = ({ request, env }) => handle(request, env);
