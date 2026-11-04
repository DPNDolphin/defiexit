// 刷新:管理员点「刷新」或定时任务来时,服务器经 api.fxtwitter.com(第三方、非官方,随时可能失灵)读被监控帖子的公开计数和回复。
// - 读数追加进看板 x_posts(每条帖子最多留 300 个点);
// - 我们自己发出去的回复和项目帖(待发里点了「已发」、链接核到了的,7 天内)也读:浏览、点赞记进 out_stats,别人接着回的进收件;
//   没读过的先读,其余按上次读的时间轮着来;只收那条帖子往下那一串的评论,发帖人不是我们的账号就不收;
// - 免费计划一次请求最多 50 个子请求(fetch 和 D1 查询一起算):一次最多读 MAX_FETCH 条帖子,读了 TIME_BUDGET_MS 就停,
//   读到的评论一条语句查重(json_each),新评论、已回复标记一次各最多 MAX_NEW 条(新的先),没收完的下次照样再查;写全放进最后一个 batch(只算一次);
// - 新回复进收件,只存帖子编号、账号名、时间、原文,状态「等我分析」(分析和起草由 Claude 主窗口做,经签名投递送进来);
// - 发帖人自己(按账号的固定编号认,不按昵称)回了某条评论,就把那条标成「已回复」,记下他回的话;
// - 待发里管理员点过「已发」的,去目标帖子底下找他那条回复,找到就填上链接(这才算核到,不靠自报)。
// 读不到的帖子写进 errors(带原因),页面明说「不算没有新评论」;接口给的回复比帖子显示的少,也标「可能没读全」。两分钟内只许刷一次(按钮和定时任务共用)。

import { iso, plusDays, KEEP_DAYS, getDocs, docStmt, existing, goneSet } from "./db.js";

export const UPSTREAM = "https://api.fxtwitter.com/2/conversation/";
export const MIN_GAP_MS = 120 * 1000;
const MAX_POINTS = 300, MAX_REPLIES = 200, MAX_SENT_CHECKS = 4, MAX_NEW = 100, MAX_STATS = 300;
export const AUTO_DAYS = 7, MAX_FETCH = 20, TIME_BUDGET_MS = 45 * 1000;

async function conversation(id, fetchImpl) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    // 不跟跳转:回跳转就当读不到。Cloudflare 的 fetch 只认 "follow" / "manual",写 "error" 会当场报错(11-04 之前正式站的刷新因此一条都没读到)
    const r = await fetchImpl(UPSTREAM + id, { headers: { "User-Agent": "defiexit-ops/1.0", Accept: "application/json" }, redirect: "manual", signal: ctl.signal });
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
const obj = (s) => { try { const o = JSON.parse(s); return o && typeof o === "object" && !Array.isArray(o) ? o : {}; } catch { return {}; } };
const kvSet = (db, k, v) => db.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(k, v);

export async function sync(db, fetchImpl, now) {
  // 两分钟一次:抢锁用一条带条件的写(管理员的按钮和定时任务同时来,只有一个改得动)
  const lock = await db.prepare("INSERT INTO kv (k, v) VALUES ('sync_at_ms', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v WHERE CAST(kv.v AS INTEGER) <= ?").bind(String(+now), +now - MIN_GAP_MS).run();
  if (!lock.meta || lock.meta.changes !== 1) return { status: 429, body: { error: "busy" } };
  const started = Date.now();
  let fetched = 0;
  const canFetch = () => fetched < MAX_FETCH && Date.now() - started < TIME_BUDGET_MS;
  const read1 = (id) => { fetched++; return conversation(id, fetchImpl); };

  const docs = await getDocs(db);
  const x = docs.x_posts || { posts: [] };
  const off = new Set(((await db.prepare("SELECT id FROM watch WHERE on_ = 0").all()).results || []).map((r) => String(r.id)));
  const posts = (x.posts || []).filter((p) => /^\d{1,25}$/.test(String(p.id)) && !off.has(String(p.id)));
  const kv = Object.fromEntries(((await db.prepare("SELECT k, v FROM kv WHERE k IN ('auto_reads', 'out_stats', 'our_ids')").all()).results || []).map((r) => [r.k, r.v]));
  const reads = obj(kv.auto_reads), stats = obj(kv.out_stats);
  const t = iso(now);
  const errors = [], partial = [];
  let newReplies = 0, marked = 0, read = 0;
  const stmts = [];
  const owners = new Set(); // 发帖人账号的固定编号(从被监控帖子本身读出来)
  const comments = new Map(); // 这次读到的别人的评论(同一条在几条帖子底下都出现只算一次)
  const ownerReplies = new Map(); // 发帖人自己回了哪条评论 → 他回的话

  // 读一条帖子底下的回复:只收这条帖子往下的那一串(父→子一层层找到底;没写回的是哪条的当作直接回它),别的分支不收;
  // 发帖人编号读不出来就不收(分不清哪条是我们的)。这次读不到的(比如父评论没返回),下次读到了照样收:不记「读到哪里」,每次都拿去查重
  const take = (name, j) => {
    const st = j.status, focal = String(st.id);
    const owner = String((st.author && st.author.id) || "");
    if (owner) owners.add(owner);
    const reps = (Array.isArray(j.replies) ? j.replies : []).slice(0, MAX_REPLIES).filter((r) => /^\d{1,25}$/.test(String(r.id || "")));
    if (num(st.replies) != null && reps.length < st.replies) partial.push(name);
    if (!owner) return st;
    const kids = new Map();
    for (const r of reps) {
      const to = r.replying_to && r.replying_to.status != null ? String(r.replying_to.status) : focal;
      // 发帖人自己的回复:整段里都记下(回的那条这次没返回也算数;那条是不是我们收件里的,由数据库说了算)
      if (String((r.author && r.author.id) || "") === owner) {
        if (/^\d{1,25}$/.test(to) && to !== focal && !ownerReplies.has(to)) ownerReplies.set(to, { at: bjIso(r.created_timestamp) || t, text: clip(r.text, 1000) });
        continue;
      }
      if (!kids.has(to)) kids.set(to, []);
      kids.get(to).push(r);
    }
    const queue = [focal], inThread = new Set([focal]);
    while (queue.length) {
      for (const r of kids.get(queue.shift()) || []) {
        const id = String(r.id);
        if (inThread.has(id)) continue;
        inThread.add(id);
        queue.push(id);
        const a = r.author || {};
        const sn = /^[A-Za-z0-9_]{1,15}$/.test(String(a.screen_name || "")) ? a.screen_name : null;
        if (sn && !comments.has(id)) comments.set(id, { id, focal, mine: { source: clip(name, 40), url: `https://x.com/${sn}/status/${id}`, author: sn, at: bjIso(r.created_timestamp) || t, replyToId: id }, text: clip(r.text, 2000) });
      }
    }
    return st;
  };

  for (const p of posts) {
    if (!canFetch()) { errors.push(`${p.name || p.id}(这次没来得及读)`); continue; }
    const { j, error } = await read1(p.id);
    if (error) { errors.push(`${p.name || p.id}(${error})`); continue; }
    read++;
    const st = take(p.name || p.id, j);
    p.points = [...(p.points || []), { at: t, views: num(st.views), likes: num(st.likes), replies: num(st.replies), reposts: num(st.reposts), bookmarks: num(st.bookmarks) }].slice(-MAX_POINTS);
  }
  // 我们自己的账号 = 被监控帖子的发帖人;认出来就记住(kv our_ids),以后旧帖子不监控了也认得(管理员贴的链接不算,免得贴错)
  let stored = [];
  try { stored = JSON.parse(kv.our_ids || "[]"); } catch { stored = []; }
  const ours = new Set([...owners, ...(Array.isArray(stored) ? stored : []).map(String).filter((v) => /^\d{1,25}$/.test(v))].slice(0, 10));

  // 7 天内点了「已发」的一次查出来:还没核到链接的,去目标帖子底下找管理员那条回复(按账号编号认;一个我们的账号都不认得就先不核);
  // 自己发的帖子没有目标帖子(sent_target 是空的),不在这里找。核到的链接先攒着,和别的写一起写
  const { results: sentAll } = await db.prepare("SELECT id, mine, sent_target, reply_url, decided_at FROM outbox WHERE status = '已发' AND purged = 0 AND decided_at >= ? ORDER BY decided_at DESC LIMIT 300").bind(iso(+now - AUTO_DAYS * 864e5)).all();
  const links = [], found = [];
  for (const r of ours.size ? (sentAll || []).filter((q) => !q.reply_url && q.sent_target).slice(0, MAX_SENT_CHECKS) : []) {
    if (!canFetch()) break;
    const target = String(r.sent_target);
    const { j, error } = await read1(target);
    if (error) { errors.push(`待发 ${r.id}(${error})`); continue; }
    const mineReply = (j.replies || []).find((q) => q.replying_to && String(q.replying_to.status) === target && ours.has(String(q.author && q.author.id)));
    if (mineReply && /^\d{1,25}$/.test(String(mineReply.id)) && /^[A-Za-z0-9_]{1,15}$/.test(String(mineReply.author.screen_name))) {
      const url = `https://x.com/${mineReply.author.screen_name}/status/${mineReply.id}`;
      links.push(db.prepare("UPDATE outbox SET reply_url = ?, updated_at = ? WHERE id = ?").bind(url, t, r.id));
      found.push({ ...r, reply_url: url }); // 这一次就接着读它(读数、别人接着回的)
    }
  }

  // 我们自己发出去的(链接是服务器自己核到的,或管理员、维护者贴的):已经在被监控帖子里的、管理员停了读评论的不读;没读过的先读,其余轮着读
  const watched = new Set(posts.map((p) => String(p.id)));
  const autos = [];
  for (const r of [...found, ...(sentAll || []).filter((q) => q.reply_url)]) {
    const m = /^https:\/\/(?:x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/(\d{1,25})$/.exec(String(r.reply_url || ""));
    if (!m || watched.has(m[1]) || off.has(m[1]) || autos.some((a) => a.id === m[1])) continue;
    let mine = {};
    try { mine = JSON.parse(r.mine) || {}; } catch { /* 读不出就只用编号 */ }
    const tg = mine.target || {};
    const name = mine.kind === "post" ? "项目帖 · " + (mine.topic || r.id) : "我们的回复 · " + (tg.protocol || "@" + (tg.handle || "?"));
    autos.push({ out: r.id, id: m[1], name: clip(name, 40), last: typeof reads[m[1]] === "string" ? reads[m[1]] : "" });
  }
  autos.sort((a, b) => a.last.localeCompare(b.last)); // 没读过的("")在前;同样新的保持「最近发的在前」
  for (const a of autos) {
    if (!canFetch()) break;
    reads[a.id] = t; // 读不到也算轮过一次,免得一条坏的一直占着名额
    const { j, error } = await read1(a.id);
    if (error) { errors.push(`${a.name}(${error})`); continue; }
    if (!ours.has(String((j.status.author && j.status.author.id) || ""))) { errors.push(`${a.name}(${ours.size ? "不是我们账号发的" : "没认出我们的账号"},不收评论)`); continue; }
    read++;
    const st = take(a.name, j);
    stats[a.out] = { views: num(st.views), likes: num(st.likes), replies: num(st.replies), reposts: num(st.reposts), at: t };
  }

  // 新评论:读到的全部拿去查重(一条语句);收件里没有的先查到期删过的(全查,不设上限,免得删过的一直占着名额),
  // 再收最多 MAX_NEW 条:被发帖人回过的先收(收进来就标已回复,证据不丢),其余各条帖子轮流、每条先拿自己最新的(一条帖子评论再多也挤不掉别的);
  // 没收到的下次照样会再查,不会永远跳过。计数按数据库实际写进去的行数
  const newest = (a, b) => b.length - a.length || (b > a ? 1 : b < a ? -1 : 0); // 帖子编号是数字串:长的大,一样长按字面比(比转成大整数省 CPU)
  const fair = (list, n) => {
    const by = new Map();
    for (const c of list) { if (!by.has(c.focal)) by.set(c.focal, []); by.get(c.focal).push(c); }
    const lanes = [...by.values()].map((l) => l.sort((a, b) => newest(a.id, b.id)));
    const out = [];
    for (let i = 0; out.length < n && lanes.some((l) => i < l.length); i++) for (const l of lanes) if (i < l.length && out.length < n) out.push(l[i]);
    return out;
  };
  const all = [...comments.values()];
  const known = await existing(db, "inbox", all.map((c) => c.id));
  const unknown = all.filter((c) => !known.has(c.id));
  const gone = await goneSet(db, unknown.map((c) => c.id));
  const fresh = unknown.filter((c) => !gone.has(c.id));
  const answered = fair(fresh.filter((c) => ownerReplies.has(c.id)), MAX_NEW);
  const pick = [...answered, ...fair(fresh.filter((c) => !ownerReplies.has(c.id)), MAX_NEW - answered.length)];
  const insAt = [], markAt = [];
  for (const c of pick) {
    const rep = ownerReplies.get(c.id);
    insAt.push(stmts.length);
    if (rep) stmts.push(db.prepare("INSERT INTO inbox (id, mine, text, replied, replied_at, created_at, updated_at, purge_after) VALUES (?, ?, ?, 1, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING").bind(c.id, JSON.stringify({ ...c.mine, yourReply: rep.text }), c.text, rep.at, t, t, plusDays(now, KEEP_DAYS)));
    else stmts.push(db.prepare("INSERT INTO inbox (id, mine, text, created_at, updated_at, purge_after) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING").bind(c.id, JSON.stringify(c.mine), c.text, t, t, plusDays(now, KEEP_DAYS)));
  }
  const more = fresh.length > pick.length;
  // 收件里已经有、还没标已回复、发帖人回了的:标上,记下他回的话(一条 json_each 查询;一次最多 MAX_NEW 条)
  const targets = [...ownerReplies.keys()].filter((id) => !pick.some((c) => c.id === id));
  const open = targets.length ? new Set((((await db.prepare("SELECT value AS id FROM json_each(?) WHERE value IN (SELECT id FROM inbox WHERE replied = 0)").bind(JSON.stringify(targets)).all()).results) || []).map((r) => String(r.id))) : new Set();
  for (const to of targets.filter((id) => open.has(id)).sort(newest).slice(0, MAX_NEW)) {
    const it = ownerReplies.get(to);
    markAt.push(stmts.length);
    stmts.push(db.prepare(
      "UPDATE inbox SET replied = 1, replied_at = COALESCE(replied_at, ?), mine = CASE WHEN purged = 1 OR json_extract(mine, '$.yourReply') IS NOT NULL THEN mine ELSE json_set(mine, '$.yourReply', ?) END, updated_at = ? WHERE id = ? AND replied = 0",
    ).bind(it.at, it.text, t, to));
  }
  stmts.push(...links);

  // 上次读的时间只记还在 7 天里的;读数留最近 MAX_STATS 条
  const inWindow = new Set(autos.map((a) => a.id));
  for (const k of Object.keys(reads)) if (!inWindow.has(k) || typeof reads[k] !== "string") delete reads[k];
  const keptStats = Object.fromEntries(Object.entries(stats).filter(([, v]) => v && typeof v === "object" && typeof v.at === "string").sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, MAX_STATS));
  const note = errors.length ? `${errors.length} 条没读到` : partial.length ? `${partial.join("、")} 的评论可能没读全` : more ? "新评论太多,这次没收完,下次接着收" : "";

  // 写之前再确认锁还是这一次的:中间有更新的一次刷新抢到了(这次太慢),就不写,免得旧读数盖掉新读数
  if (String(await db.prepare("SELECT v FROM kv WHERE k = 'sync_at_ms'").first("v")) !== String(+now)) return { status: 409, body: { error: "superseded" } };
  stmts.push(kvSet(db, "auto_reads", JSON.stringify(reads)), kvSet(db, "out_stats", JSON.stringify(keptStats)), kvSet(db, "sync_note", note), kvSet(db, "our_ids", JSON.stringify([...ours])));
  if (posts.length) stmts.push(docStmt(db, "x_posts", { ...x, posts: (x.posts || []).map((p) => posts.find((q) => q.id === p.id) || p), updatedAt: t }, now));
  const res = await db.batch(stmts);
  const changed = (i) => Number((res && res[i] && res[i].meta && res[i].meta.changes) || 0);
  for (let k = 0; k < insAt.length; k++) { const n = changed(insAt[k]); newReplies += n; if (n && ownerReplies.has(pick[k].id)) marked++; }
  for (const i of markAt) marked += changed(i);
  return { status: 200, body: { ok: true, at: t, read, newReplies, marked, errors, partial } };
}
