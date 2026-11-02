// 刷新:管理员点「刷新评论和读数」时,服务器经 api.fxtwitter.com(第三方、非官方,随时可能失灵)读被监控帖子的公开计数和回复。
// - 读数追加进看板 x_posts(每条帖子最多留 300 个点);
// - 新回复进收件,只存帖子编号、账号名、时间、原文,状态「等我分析」(分析和起草由 Claude 主窗口做,经签名投递送进来);
// - 发帖人自己(按账号的固定编号认,不按昵称)回了某条评论,就把那条标成「已回复」,记下他回的话;
// - 待发里管理员点过「已发」的,去目标帖子底下找他那条回复,找到就填上链接(这才算核到,不靠自报)。
// 读不到的帖子写进 errors,页面明说「不算没有新评论」;接口给的回复比帖子显示的少,也标「可能没读全」。两分钟内只许刷一次。

import { iso, plusDays, KEEP_DAYS, getKv, setKv, getDocs, putDoc, existing } from "./db.js";

export const UPSTREAM = "https://api.fxtwitter.com/2/conversation/";
export const MIN_GAP_MS = 120 * 1000;
const MAX_POINTS = 300, MAX_REPLIES = 200, MAX_SENT_CHECKS = 5;

async function conversation(id, fetchImpl) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetchImpl(UPSTREAM + id, { headers: { "User-Agent": "defiexit-ops/1.0", Accept: "application/json" }, redirect: "error", signal: ctl.signal });
    if (!r.ok) return { error: "HTTP " + r.status };
    const j = await r.json();
    if (!j || !j.status || String(j.status.id) !== String(id)) return { error: "回的不是这条帖子" };
    return { j };
  } catch (e) {
    return { error: e && e.name === "AbortError" ? "超时" : "读不到" };
  } finally {
    clearTimeout(timer);
  }
}

const num = (v) => (Number.isInteger(v) && v >= 0 && v < 1e10 ? v : null);
const clip = (s, n) => String(s ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").slice(0, n);
const bjIso = (ts) => (Number.isFinite(ts) ? iso(ts * 1000) : null);

export async function sync(db, fetchImpl, now) {
  const last = Number((await getKv(db, "sync_at_ms")) || 0);
  if (+now - last < MIN_GAP_MS) return { status: 429, body: { error: "busy" } };
  await setKv(db, "sync_at_ms", +now);

  const docs = await getDocs(db);
  const x = docs.x_posts || { posts: [] };
  const off = new Set(((await db.prepare("SELECT id FROM watch WHERE on_ = 0").all()).results || []).map((r) => r.id));
  const posts = (x.posts || []).filter((p) => /^\d{1,25}$/.test(String(p.id)) && !off.has(String(p.id)));
  const t = iso(now);
  const errors = [], partial = [];
  let newReplies = 0, marked = 0;
  const stmts = [];
  const owners = new Set(); // 发帖人账号的固定编号(从被监控帖子本身读出来)
  const fresh = []; // 这次读到的别人的评论,最后一起查重、一起写(查库次数不随评论条数涨)
  const marks = []; // 发帖人自己的回复:等新评论写进去以后再标「已回复」

  for (const p of posts) {
    const { j, error } = await conversation(p.id, fetchImpl);
    if (error) { errors.push(p.name || p.id); continue; }
    const st = j.status;
    const owner = String(st.author && st.author.id || "");
    if (owner) owners.add(owner);
    p.points = [...(p.points || []), { at: t, views: num(st.views), likes: num(st.likes), replies: num(st.replies), reposts: num(st.reposts), bookmarks: num(st.bookmarks) }].slice(-MAX_POINTS);
    const reps = (Array.isArray(j.replies) ? j.replies : []).slice(0, MAX_REPLIES);
    if (num(st.replies) != null && reps.length < st.replies) partial.push(p.name || p.id);
    for (const r of reps) {
      const id = String(r.id || "");
      if (!/^\d{1,25}$/.test(id)) continue;
      const a = r.author || {};
      const sn = /^[A-Za-z0-9_]{1,15}$/.test(String(a.screen_name || "")) ? a.screen_name : null;
      if (owner && String(a.id) === owner) {
        // 发帖人自己的回复:回的是哪条评论,就把那条标成已回复
        const to = r.replying_to && r.replying_to.status;
        if (/^\d{1,25}$/.test(String(to || ""))) {
          marks.push(db.prepare(
            "UPDATE inbox SET replied = 1, replied_at = COALESCE(replied_at, ?), mine = CASE WHEN purged = 1 OR json_extract(mine, '$.yourReply') IS NOT NULL THEN mine ELSE json_set(mine, '$.yourReply', ?) END, updated_at = ? WHERE id = ?",
          ).bind(bjIso(r.created_timestamp) || t, clip(r.text, 1000), t, String(to)));
          marked++;
        }
        continue;
      }
      if (!sn) continue;
      fresh.push({ id, mine: { source: clip(p.name, 40), url: `https://x.com/${sn}/status/${id}`, author: sn, at: bjIso(r.created_timestamp) || t, replyToId: id }, text: clip(r.text, 2000) });
    }
  }
  const ids = [...new Set(fresh.map((x) => x.id))];
  const known = await existing(db, "inbox", ids);
  const gone = await existing(db, "gone", ids);
  const seen = new Set();
  for (const x of fresh) {
    if (known.has(x.id) || gone.has(x.id) || seen.has(x.id)) continue;
    seen.add(x.id);
    stmts.push(db.prepare("INSERT INTO inbox (id, mine, text, created_at, updated_at, purge_after) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING").bind(x.id, JSON.stringify(x.mine), x.text, t, t, plusDays(now, KEEP_DAYS)));
    newReplies++;
  }
  stmts.push(...marks);

  // 已发但还没核到链接的待发:去目标帖子底下找管理员那条回复(按账号编号认;这次一条被监控帖子都没读到,就先不核)
  const { results: sent } = await db.prepare("SELECT id, mine, sent_target FROM outbox WHERE status = '已发' AND reply_url IS NULL AND purged = 0 ORDER BY decided_at DESC LIMIT ?").bind(MAX_SENT_CHECKS).all();
  for (const r of owners.size ? sent : []) {
    let target;
    try { target = String(r.sent_target || JSON.parse(r.mine).target.id); } catch { continue; }
    const { j, error } = await conversation(target, fetchImpl);
    if (error) { errors.push("待发 " + r.id); continue; }
    const mineReply = (j.replies || []).find((q) => q.replying_to && String(q.replying_to.status) === target && owners.has(String(q.author && q.author.id)));
    if (mineReply && /^\d{1,25}$/.test(String(mineReply.id)) && /^[A-Za-z0-9_]{1,15}$/.test(String(mineReply.author.screen_name))) {
      stmts.push(db.prepare("UPDATE outbox SET reply_url = ?, updated_at = ? WHERE id = ?").bind(`https://x.com/${mineReply.author.screen_name}/status/${mineReply.id}`, t, r.id));
    }
  }

  if (stmts.length) await db.batch(stmts);
  if (posts.length) await putDoc(db, "x_posts", { ...x, posts: (x.posts || []).map((p) => posts.find((q) => q.id === p.id) || p), updatedAt: t }, now);
  const note = errors.length ? `${errors.length} 条没读到` : partial.length ? `${partial.join("、")} 的评论可能没读全` : "";
  await setKv(db, "sync_note", note);
  return { status: 200, body: { ok: true, at: t, newReplies, marked, errors, partial } };
}
