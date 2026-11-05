// 运营台接口(Cloudflare Pages Function,路径 /api/admin/*),只在 admin 主机上应答,别的主机一律 404。
// GET  state            看板数据、待发、收件、体检次数、问题记录的数(要登录;没设管理员就回 need: setup)
// POST setup / login / logout / logout-all
// POST outbox / inbox    管理员点的状态、决定、备注、改过的草稿
// POST watch / delete    帖子看不看评论;按要求删掉一条(同一条帖子在收件、待发、问题记录里的几行一起删,以后都不再收)
// POST sync              经 fxtwitter 刷新读数和评论
// POST ingest            Claude 主窗口的签名投递(不靠登录,靠签名;见 server/ops/ingest.js)
// POST task              定时任务的小钥匙:只能刷新、加线索(见 server/ops/task.js)
// POST export            Claude 主窗口用投递钥匙读管理员点过的决定、状态和线索(见 server/ops/task.js)
// 改东西的请求(ingest 除外)必须同源、JSON、已登录;登录凭证是只给本主机的 __Host- cookie(SameSite=Strict)。

import { reply, gone, hostOk, sameOrigin, readJson, clientIp } from "../../../server/ops/http.js";
import { ensure, iso, getKv, getDocs, listOut, listIn, getOut, getIn, outRow, existing, purge, goneKey, goneStmt, markStmt, NOT_GONE, goneArg, outKeys, inKeys, sameRefs, sameInRefs, rowsAbout, hitCounts, problemCounts, problemKey } from "../../../server/ops/db.js";
import { MIN_PASSWORD, hashPassword, checkPassword, newSession, hasSession, endSession, endAll, cookie, mustWait, failed, succeeded, same } from "../../../server/ops/auth.js";
import { ingest, checkText, outHosts } from "../../../server/ops/ingest.js";
import { sync } from "../../../server/ops/sync.js";
import { task, exportFor, listLeads, autoState } from "../../../server/ops/task.js";

const STATUS = ["待发", "已发", "跳过"];
const DECISIONS = ["采纳", "以后再说", "不采纳"];
const NAME = /^[\p{L}\p{N}_.-]{1,40}$/u;
const hex = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join("");

async function state(db, admin, now) {
  await purge(db, now);
  const [docs, outbox, inbox, syncAt, syncNote, off, needs, leads, auto, outStats, hits, p7, p30] = await Promise.all([
    getDocs(db), listOut(db), listIn(db), getKv(db, "sync_at_ms"), getKv(db, "sync_note"),
    db.prepare("SELECT id FROM watch WHERE on_ = 0").all(),
    db.prepare("SELECT month, v FROM needs ORDER BY month DESC LIMIT 100").all(),
    listLeads(db, 30), autoState(db), getKv(db, "out_stats"), hitCounts(db, now),
    // 「大家最常问」:最近 7 天、30 天的数,各带问得多的 10 个协议(只有数)
    problemCounts(db, now, 7, 10), problemCounts(db, now, 30, 10),
  ]);
  const past = needs.results.map((r) => { try { return { month: r.month, ...JSON.parse(r.v) }; } catch { return null; } }).filter(Boolean);
  let stats = {};
  try { stats = JSON.parse(outStats || "{}") || {}; } catch { stats = {}; }
  return reply({ ok: true, me: { name: admin.name }, docs, outbox, inbox, needs: past, leads, auto, outStats: stats, hits, problems: { d7: p7, d30: p30 }, watchOff: off.results.map((r) => r.id), synced: { at: syncAt ? iso(Number(syncAt)) : null, note: syncNote || "" } });
}

// 管理员贴的帖子链接:只收 x.com(或 twitter.com)上的帖子链接,统一成 https://x.com/<账号>/status/<编号>,去掉 ?s=20 这类尾巴
function xStatusUrl(s) {
  try {
    const u = new URL(String(s || "").trim());
    if (u.protocol !== "https:" || !["x.com", "www.x.com", "mobile.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"].includes(u.hostname)) return null;
    const m = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,25})\/?$/.exec(u.pathname);
    return m ? `https://x.com/${m[1]}/status/${m[2]}` : null;
  } catch {
    return null;
  }
}

async function editOut(db, b, now) {
  const row = await db.prepare("SELECT * FROM outbox WHERE id = ?").bind(String(b.id || "")).first();
  if (!row) return reply({ error: "none" }, 404);
  const cur = outRow(row);
  const sets = [], args = [];
  let replyUrl = row.reply_url, sentTarget = row.sent_target; // 改完以后这一行的回复链接、记下的目标帖子
  if ("reply_url" in b) {
    // 自己发的帖子运营台找不到链接,管理员贴一次;回复一般自己能找到,找不到也可以贴。只给「已发」的贴
    if ("status" in b) return reply({ error: "bad" }, 400);
    const u = xStatusUrl(b.reply_url);
    if (!u) return reply({ error: "badlink" }, 400);
    if (cur.purged) return reply({ error: "purged" }, 409);
    if (cur.status !== "已发") return reply({ error: "locked" }, 409);
    sets.push("reply_url = ?");
    args.push(u);
    replyUrl = u;
  }
  if ("status" in b) {
    if (!STATUS.includes(b.status)) return reply({ error: "bad" }, 400);
    sets.push("status = ?", "decided_at = ?");
    args.push(b.status, b.status === "待发" ? null : iso(now));
    if (b.status === "已发") {
      // 记下点「已发」那一刻的草稿和目标帖子:之后核对的就是这一条(自己发的帖子没有目标帖子)
      const post = !!cur.mine && cur.mine.kind === "post";
      const tid = cur.mine && cur.mine.target && cur.mine.target.id;
      if (!tid && !post) return reply({ error: "target" }, 400);
      sets.push("sent_text = ?", "sent_target = ?");
      args.push(cur.draft_admin != null ? cur.draft_admin : cur.mine.draft || "", post ? null : tid);
      sentTarget = post ? null : String(tid);
    } else {
      sets.push("sent_text = NULL", "sent_target = NULL", "reply_url = NULL");
      sentTarget = replyUrl = null;
    }
  }
  if ("draft" in b) {
    if ((b.status || cur.status) !== "待发") return reply({ error: "locked" }, 409);
    if (b.draft === null) sets.push("draft_admin = NULL");
    else if (typeof b.draft === "string" && b.draft.length <= 2000) {
      // 管理员改的草稿也过一遍,和投递的规矩一样:对人的首回不带链接,项目帖只许本站链接;不许敏感词(就算账号被人登进去,也塞不进站外链接)
      const bad = checkText(b.draft, undefined, outHosts(cur.mine));
      if (bad) return reply({ error: "draftbad", why: bad }, 400);
      sets.push("draft_admin = ?");
      args.push(b.draft);
    } else return reply({ error: "bad" }, 400);
  }
  if ("note" in b) {
    if (typeof b.note !== "string" || b.note.length > 500) return reply({ error: "bad" }, 400);
    sets.push("note = ?");
    args.push(b.note);
  }
  if (!sets.length) return reply({ error: "bad" }, 400);
  // 条件写在语句里:上面读到的这张卡片要是读和写之间到期删了(purged 变了),这次照着读到的写会把删掉的目标帖子编号、
  // 没换掉 @账号的草稿写回去,所以不写。改完以后这一行还带着的帖子(目标帖子、引用的原帖、回复链接、记下的目标)和卡片本身
  // 按要求删过的(gone 里有),也不写;没改的那几样核对还是读到的样子(读和写之间被别的改了也不写)
  const keys = await outKeys(cur.id, cur.mine, replyUrl, sentTarget);
  const [same, sameArgs] = sameRefs(cur.mine);
  const keepReply = !("reply_url" in b) && !("status" in b && b.status !== "已发"), keepSent = !("status" in b);
  const r = await db.prepare(`UPDATE outbox SET ${sets.join(", ")}, updated_at = ? WHERE id = ? AND purged = ? AND ${same}` + (keepReply ? " AND reply_url IS ?" : "") + (keepSent ? " AND sent_target IS ?" : "") + ` AND ${NOT_GONE}`)
    .bind(...args, iso(now), cur.id, cur.purged ? 1 : 0, ...sameArgs, ...(keepReply ? [row.reply_url ?? null] : []), ...(keepSent ? [row.sent_target ?? null] : []), goneArg(keys)).run();
  if (!(r.meta && r.meta.changes)) return missed(db, cur, keys, (id) => getOut(db, id));
  return reply({ ok: true, item: await getOut(db, cur.id) });
}

// 管理员改的这一条没改上:没了 → none;到期删过 → purged;带着的帖子按要求删过 → gone;都不是 → 读和写之间被别处改了(changed)
async function missed(db, cur, keys, read) {
  const again = await read(cur.id);
  if (!again) return reply({ error: "none" }, 404);
  if (!!again.purged !== !!cur.purged) return reply({ error: "purged" }, 409);
  return (await existing(db, "gone", keys)).size ? reply({ error: "gone" }, 409) : reply({ error: "changed" }, 409);
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
  // 这条评论和它带着的帖子(链接里的、要回的那条)按要求删过的不改;那两样核对还是读到的样子
  const keys = await inKeys(cur.id, cur.mine);
  const [same, sameArgs] = sameInRefs(cur.mine);
  const r = await db.prepare(`UPDATE inbox SET ${sets.join(", ")}, updated_at = ? WHERE id = ? AND ${same} AND ${NOT_GONE}`).bind(...args, iso(now), cur.id, ...sameArgs, goneArg(keys)).run();
  if (!(r.meta && r.meta.changes)) return missed(db, cur, keys, (id) => getIn(db, id));
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
  if (path === "task") {
    const raw = await request.text();
    const r = await task(db, { raw, sig: request.headers.get("X-DX-Sig") || "", envName: String(env.OPS_ENV || ""), method: "POST", path: url.pathname, pubkeys: env.TASK_PUBKEYS }, now, fetchImpl);
    if (r.status === 200) await purge(db, now);
    return reply(r.body, r.status);
  }
  if (path === "export") {
    const raw = await request.text();
    const r = await exportFor(db, { raw, sig: request.headers.get("X-DX-Sig") || "", envName: String(env.OPS_ENV || ""), method: "POST", path: url.pathname, pubkeys: env.INGEST_PUBKEYS }, now);
    return reply(r.body, r.status);
  }

  if (!sameOrigin(request)) return reply({ error: "origin" }, 403);
  if (!/^application\/json\b/i.test(request.headers.get("Content-Type") || "")) return reply({ error: "type" }, 415);
  const { value: b, error } = await readJson(request);
  if (error) return reply({ error }, 400);
  const ip = clientIp(request);

  if (path === "setup") {
    if (admin) return reply({ error: "exists" }, 409);
    // 两种设置码:维护者签名送进来的一次性链接(只存哈希,有效期内),或 Cloudflare 里的机密 SETUP_CODE
    const code = String(env.SETUP_CODE || "");
    const linkHash = await getKv(db, "setup_hash");
    const linkOk = !!linkHash && +now < Number((await getKv(db, "setup_exp")) || 0);
    if (code.length < 16 && !linkOk) return reply({ error: "nocode" }, 503);
    const wait = await mustWait(db, ip, now);
    if (wait) return reply({ error: "wait", seconds: wait }, 429);
    const given = String(b.code || "");
    const okCode = (code.length >= 16 && same(given, code)) || (linkOk && same(await hex(given), linkHash));
    if (!okCode) { await failed(db, ip, now); return reply({ error: "code" }, 403); }
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
    await db.prepare("DELETE FROM kv WHERE k IN ('setup_hash', 'setup_exp')").run();
    await succeeded(db, ip);
    return reply({ ok: true }, 200, { "Set-Cookie": await newSession(db, now, b.remember === true) });
  }
  if (path === "login") {
    if (!admin) return reply({ need: "setup" }, 401);
    const wait = await mustWait(db, ip, now);
    if (wait) return reply({ error: "wait", seconds: wait }, 429);
    const row = await db.prepare("SELECT name, salt, hash, iter FROM admin WHERE id = 1").first();
    const okPw = await checkPassword(String(b.password || ""), row);
    if (!(same(String(b.name || "").trim(), row.name) && okPw)) { await failed(db, ip, now); return reply({ error: "wrong" }, 401); }
    await succeeded(db, ip);
    return reply({ ok: true }, 200, { "Set-Cookie": await newSession(db, now, b.remember === true) });
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
    // 这一行删掉,编号记进 gone(goneKey,这条以后不再收)。说的是哪条帖子(收件:这条评论本身;回帖的待发:要回的那条帖子;
    // 项目帖没有别人的帖子,只删这张卡片),那条帖子的 goneKey 也记进 gone:收件、待发、问题记录以后都不再收它
    // (哪个字段带着它都不收,投递、刷新、管理员写的时候同一句里查)。
    // 库里带着这条帖子的别的几行一起删:收件里编号、链接、要回的是它的;待发里要回它、引用它、回复链接是它、点「已发」记下它的;
    // 问题记录里的那一行。待发到期删了目标帖子编号的,只剩到期时留下的两个哈希(gone:那条帖子的 goneKey;key:问题记录那一行的编号)
    const tg = table === "outbox" ? ((await getOut(db, b.id))?.mine?.target || {}) : {};
    const post = table === "inbox" ? b.id : String(tg.id || "");
    const tid = /^\d{1,25}$/.test(post) ? post : null;
    const hash = (v) => (/^[0-9a-f]{64}$/.test(String(v || "")) ? String(v) : null);
    const gk = tid ? await goneKey(tid) : hash(tg.gone), pk = tid ? await problemKey(tid) : hash(tg.key);
    const marks = [await goneStmt(db, b.id, now)];
    if (gk && table === "outbox") marks.push(markStmt(db, gk, now)); // 收件的编号就是这条帖子,上面已经记了
    const stmts = [db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(b.id)];
    if (tid) {
      // 编号在手:和记 gone 同一批,按编号找(投递、刷新同时来:要么先写进来、这一批照删,要么写的时候看见 gone、写不进来);
      // 到期只留哈希的旧卡片按 target.gone 认
      const tail = "%/status/" + tid;
      stmts.push(...marks,
        db.prepare("DELETE FROM inbox WHERE id = ? OR json_extract(mine, '$.replyToId') = ? OR json_extract(mine, '$.url') LIKE ?").bind(tid, tid, tail),
        db.prepare("DELETE FROM outbox WHERE json_extract(mine, '$.target.id') = ? OR json_extract(mine, '$.target.url') LIKE ? OR json_extract(mine, '$.quote') LIKE ? OR reply_url LIKE ? OR sent_target = ? OR json_extract(mine, '$.target.gone') = ?").bind(tid, tail, tail, tail, tid, gk));
    } else if (gk) {
      // 只剩哈希(到期的旧卡片):先记 gone(记下以后谁也写不进、改不了带着这条帖子的行),再一页页翻收件、没到期的待发,
      // 把带着的帖子编号算成 goneKey 比(rowsAbout;这一版以前收进来的行没存哈希,也认得出),找到的删掉。
      // 一次翻不完:翻到哪记进 kv,回 more,这张卡片先留着,再点一次删除接着往下翻;翻完了才删它和到期的旧卡片、问题记录那一行。
      // 中途出错也一样:gone 已经记下,剩下的行改不了,再点一次删除从记下的地方接着翻
      await db.batch(marks);
      const at = "del_scan:" + gk, saved = await getKv(db, at);
      let from = null;
      try { from = saved ? JSON.parse(saved) : null; } catch { from = null; }
      const rows = await rowsAbout(db, gk, from);
      const found = [
        db.prepare("DELETE FROM inbox WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(rows.inbox)),
        db.prepare("DELETE FROM outbox WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(rows.outbox)),
      ];
      if (rows.next) {
        // 翻到哪只在这张卡片还在(别的请求还没删完)、记的进度还是读到的那个(没被别的请求往前翻)时才记,
        // 不然同时点的两次删除,慢的那次会把删完的任务又写回一个旧进度。没记上、卡片也没了:别的请求已经删完了
        const res = await db.batch([...found, db.prepare("INSERT INTO kv (k, v) SELECT ?, ? WHERE EXISTS (SELECT 1 FROM outbox WHERE id = ?) AND (SELECT v FROM kv WHERE k = ?) IS ? ON CONFLICT(k) DO UPDATE SET v = excluded.v")
          .bind(at, JSON.stringify(rows.next), b.id, at, saved ?? null)]);
        const kept = Number((res && res[found.length] && res[found.length].meta && res[found.length].meta.changes) || 0) > 0;
        if (!kept && !(await db.prepare("SELECT 1 AS x FROM outbox WHERE id = ?").bind(b.id).first())) return reply({ ok: true });
        return reply({ error: "more" }, 409);
      }
      stmts.push(...found, db.prepare("DELETE FROM outbox WHERE json_extract(mine, '$.target.gone') = ?").bind(gk), db.prepare("DELETE FROM kv WHERE k = ?").bind(at));
    } else stmts.push(...marks);
    if (pk) stmts.push(db.prepare("DELETE FROM problems WHERE id = ?").bind(pk));
    await db.batch(stmts);
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
