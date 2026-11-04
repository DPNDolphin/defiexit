// 运营台的数据库(Cloudflare D1,绑定名 OPS;正式、预览各一个库)。表在第一次用到时自动建,管理员不用跑 SQL。
// 待发(outbox)、收件(inbox)每一行把两类字段分开:
//   mine —— Claude 主窗口送进来的(目标帖子、分析、草稿),只能经签名投递改;
//   其余 —— 管理员在页面上点的(状态、决定、备注、他改过的草稿),投递永远不碰。
// 评论原文、目标帖子的账号信息 30 天后删(Pages 没有定时任务:每次有人打开运营台、刷新、投递时顺手删)。
// 到期的评论整行删掉,需求摘要另存一张表(不带帖子编号和账号);编号只留哈希,用来防止下次刷新又收进来。

export const KEEP_DAYS = 30;
const DDL = [
  "CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS admin (id INTEGER PRIMARY KEY CHECK (id = 1), name TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL, iter INTEGER NOT NULL, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS sessions (h TEXT PRIMARY KEY, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS fails (k TEXT PRIMARY KEY, n INTEGER NOT NULL, until TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS docs (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, mine TEXT NOT NULL, draft_admin TEXT, status TEXT NOT NULL DEFAULT '待发', decided_at TEXT, sent_text TEXT, sent_target TEXT, note TEXT, reply_url TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, purge_after TEXT NOT NULL, purged INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS inbox (id TEXT PRIMARY KEY, mine TEXT NOT NULL, text TEXT, decision TEXT, decided_at TEXT, note TEXT, replied INTEGER NOT NULL DEFAULT 0, replied_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, purge_after TEXT NOT NULL, purged INTEGER NOT NULL DEFAULT 0)",
  "CREATE TABLE IF NOT EXISTS nonces (n TEXT PRIMARY KEY, at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS watch (id TEXT PRIMARY KEY, on_ INTEGER NOT NULL)",
  // 到期或按要求删掉的编号,只存哈希(goneKey):以后刷新、投递都不再收进来
  "CREATE TABLE IF NOT EXISTS gone (id TEXT PRIMARY KEY, at TEXT NOT NULL)",
  // 到期评论留下的需求摘要:不带帖子编号、账号、原文
  "CREATE TABLE IF NOT EXISTS needs (id TEXT PRIMARY KEY, month TEXT NOT NULL, v TEXT NOT NULL)",
  // 监控找到的项目变动线索(公开信息,定时任务经 /api/admin/task 送进来,只加不改,留 90 天)
  "CREATE TABLE IF NOT EXISTS leads (id TEXT PRIMARY KEY, v TEXT NOT NULL, found_at TEXT NOT NULL)",
];
const ready = new WeakSet();

export async function ensure(db) {
  if (ready.has(db)) return;
  await db.batch(DDL.map((s) => db.prepare(s)));
  ready.add(db);
}

export const iso = (d) => new Date(d).toISOString();

export async function goneKey(id) {
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("dx-gone-v1:" + id)));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export const goneStmt = async (db, id, now) => db.prepare("INSERT INTO gone (id, at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING").bind(await goneKey(id), iso(now));
// 这些编号里哪些删过(到期或按要求)
export async function goneSet(db, ids) {
  const keys = new Map();
  for (const id of ids) keys.set(await goneKey(id), id);
  const hit = await existing(db, "gone", [...keys.keys()]);
  return new Set([...hit].map((k) => keys.get(k)));
}
// 把文字里的 @账号 换掉(到期时用:我们的草稿、发出去的话里可能带着对方账号)
export const scrub = (s) => (typeof s === "string" ? s.replace(/@[A-Za-z0-9_]{1,15}/g, "@某人") : s);

// D1 每条语句最多绑 100 个参数:按 50 个一组查
export async function existing(db, table, ids) {
  const found = new Set();
  for (let i = 0; i < ids.length; i += 50) {
    const part = ids.slice(i, i + 50);
    if (!part.length) continue;
    const { results } = await db.prepare(`SELECT id FROM ${table} WHERE id IN (${part.map(() => "?").join(",")})`).bind(...part).all();
    for (const r of results) found.add(String(r.id));
  }
  return found;
}
export const plusDays = (now, n) => iso(+now + n * 864e5);
const parse = (s, dflt) => { try { return JSON.parse(s); } catch { return dflt; } };

export async function getKv(db, k) {
  const r = await db.prepare("SELECT v FROM kv WHERE k = ?").bind(k).first();
  return r ? r.v : null;
}
export const setKv = (db, k, v) => db.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(k, String(v)).run();

// ---------- 看板的几份 JSON ----------
export const DOC_KEYS = ["summary", "x_posts", "goal_1215", "funnel", "protocols", "clocks", "bot"];
export async function getDocs(db) {
  const { results } = await db.prepare("SELECT k, v FROM docs").all();
  return Object.fromEntries(results.filter((r) => DOC_KEYS.includes(r.k)).map((r) => [r.k, parse(r.v, null)]));
}
export const docStmt = (db, k, v, now) => db.prepare("INSERT INTO docs (k, v, updated_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at").bind(k, JSON.stringify(v), iso(now));
export const putDoc = (db, k, v, now) => docStmt(db, k, v, now).run();

// ---------- 待发、收件:给页面的样子 ----------
export function outRow(r) {
  return { id: r.id, mine: parse(r.mine, {}), draft_admin: r.draft_admin, status: r.status, decided_at: r.decided_at, sent_text: r.sent_text, note: r.note, reply_url: r.reply_url, created_at: r.created_at, purged: !!r.purged };
}
export function inRow(r) {
  return { id: r.id, mine: parse(r.mine, {}), text: r.text, decision: r.decision, decided_at: r.decided_at, note: r.note, replied: !!r.replied, replied_at: r.replied_at, created_at: r.created_at, purged: !!r.purged };
}
export async function listOut(db) {
  const { results } = await db.prepare("SELECT * FROM outbox ORDER BY created_at").all();
  return results.map(outRow);
}
export async function listIn(db) {
  const { results } = await db.prepare("SELECT * FROM inbox ORDER BY created_at DESC LIMIT 500").all();
  return results.map(inRow);
}
export async function getOut(db, id) {
  const r = await db.prepare("SELECT * FROM outbox WHERE id = ?").bind(id).first();
  return r ? outRow(r) : null;
}
export async function getIn(db, id) {
  const r = await db.prepare("SELECT * FROM inbox WHERE id = ?").bind(id).first();
  return r ? inRow(r) : null;
}

// ---------- 到期删除 ----------
// 收件:删原文、账号名、帖子链接、草稿、备注,只留类型、需求摘要、建议(都是 Claude 写的、不带账号名)和管理员的决定
// 待发:删目标帖子的账号、链接、编号、「卡在哪」的描述和备注,只留协议、链、类型、我们的草稿和管理员点的状态
// (自己发的帖子没有目标帖子:留题目和草稿)
export async function purge(db, now) {
  const t = iso(now);
  const ins = (await db.prepare("SELECT id, mine, decision FROM inbox WHERE purge_after <= ?").bind(t).all()).results;
  const outs = (await db.prepare("SELECT id, mine, draft_admin, sent_text FROM outbox WHERE purged = 0 AND purge_after <= ?").bind(t).all()).results;
  const stmts = [];
  for (const r of ins) {
    const m = parse(r.mine, {});
    const at = typeof m.at === "string" ? m.at : t;
    const keep = { source: m.source, type: m.type, need: scrub(m.need), suggestion: m.suggestion, decision: r.decision || null };
    stmts.push(db.prepare("INSERT INTO needs (id, month, v) VALUES (?, ?, ?)").bind(crypto.randomUUID(), at.slice(0, 7), JSON.stringify(keep)));
    stmts.push(await goneStmt(db, r.id, now));
    stmts.push(db.prepare("DELETE FROM inbox WHERE id = ?").bind(r.id));
  }
  for (const r of outs) {
    const m = parse(r.mine, {});
    const tg = m.target || {};
    const keep = m.kind === "post"
      ? { kind: "post", topic: m.topic, why: scrub(m.why), draft: scrub(m.draft) }
      : { target: { protocol: tg.protocol, chain: tg.chain, type: tg.type }, why: scrub(m.why), draft: scrub(m.draft) };
    stmts.push(db.prepare("UPDATE outbox SET mine = ?, draft_admin = ?, sent_text = ?, reply_url = NULL, sent_target = NULL, note = NULL, purged = 1, updated_at = ? WHERE id = ?").bind(JSON.stringify(keep), scrub(r.draft_admin) ?? null, scrub(r.sent_text) ?? null, t, r.id));
  }
  stmts.push(db.prepare("DELETE FROM leads WHERE found_at <= ?").bind(plusDays(now, -90)));
  stmts.push(db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(t));
  stmts.push(db.prepare("DELETE FROM nonces WHERE at <= ?").bind(plusDays(now, -2)));
  await db.batch(stmts);
  return { inbox: ins.length, outbox: outs.length };
}
