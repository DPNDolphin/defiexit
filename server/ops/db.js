// 运营台的数据库(Cloudflare D1,绑定名 OPS;正式、预览各一个库)。表在第一次用到时自动建,管理员不用跑 SQL。
// 待发(outbox)、收件(inbox)每一行把两类字段分开:
//   mine —— Claude 主窗口送进来的(目标帖子、分析、草稿),只能经签名投递改;
//   其余 —— 管理员在页面上点的(状态、决定、备注、他改过的草稿),投递永远不碰。
// 评论原文、目标帖子的账号信息 30 天后删(Pages 没有定时任务:每次有人打开运营台、刷新、投递时顺手删)。
// 到期的评论整行删掉,需求摘要另存一张表(不带帖子编号和账号);编号只留哈希,用来防止下次刷新又收进来。
// 体检计数(公开接口 /api/hit)也记在这个库里:每天一个数,不带地址和任何访客信息。
// 问题记录(problems):X 上说自己钱卡住的帖子,一条帖子一行(哪个协议、哪条链、哪种问题、从哪找到的、哪天发的、我们回没回),只用来数大家最常问什么;
// 帖子编号只存哈希,帖子链接和账号 30 天后删,只留这几样能数的。运营台和导出只给数,不给单条。
// 宣传卡片(outreach):我写好、管理员自己发出去的媒体投稿、给项目团队的邮件、安全资源清单的提交、技术社区的帖子。
// 和待发一样两类字段分开(mine 是我写的,其余是管理员点的状态和他记下的回音);都是机构的公开信息和我们自己的文字。
// 收件邮箱在点过「已发 / 跳过」180 天后删掉(只留哈希,见 purge),别的不自动删;按要求删的见 reachKeys。

import { softName, safeLabel } from "./names.js";

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
  // 按要求删掉的、收件到期删掉的编号,只存哈希(两种标记,见下面的 goneKey、expKey):以后刷新、投递都不再收进来
  "CREATE TABLE IF NOT EXISTS gone (id TEXT PRIMARY KEY, at TEXT NOT NULL)",
  // 到期评论留下的需求摘要:不带帖子编号、账号、原文
  "CREATE TABLE IF NOT EXISTS needs (id TEXT PRIMARY KEY, month TEXT NOT NULL, v TEXT NOT NULL)",
  // 监控找到的项目变动线索(公开信息,定时任务经 /api/admin/task 送进来,只加不改,留 90 天)
  "CREATE TABLE IF NOT EXISTS leads (id TEXT PRIMARY KEY, v TEXT NOT NULL, found_at TEXT NOT NULL)",
  // 体检计数(functions/api/hit.js):每个北京日、每种一行,只有日期、种类、次数;不记地址、IP、每一次的时间
  "CREATE TABLE IF NOT EXISTS hits (day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, kind))",
  // 问题记录:id 是帖子编号的哈希(problemKey,编号本身不存);day 是帖子发的那天(北京时间);url、handle 30 天后清空,别的一直留着用来数
  "CREATE TABLE IF NOT EXISTS problems (id TEXT PRIMARY KEY, protocol TEXT NOT NULL, chain TEXT, type TEXT NOT NULL, source TEXT NOT NULL, day TEXT NOT NULL, replied INTEGER NOT NULL DEFAULT 0, url TEXT, handle TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, purge_after TEXT NOT NULL, purged INTEGER NOT NULL DEFAULT 0)",
  // 这张表只增不减(到期也留着数):按日期数、找到期的都走索引,每次打开运营台不用把整张表读一遍
  "CREATE INDEX IF NOT EXISTS problems_day ON problems (day)",
  "CREATE INDEX IF NOT EXISTS problems_due ON problems (purge_after) WHERE purged = 0",
  // 宣传卡片:mine 是我写的(渠道、目标、语言、网址、收件邮箱、邮件标题、标题、正文、说明,见 ingest.js 的 cleanReach),只能经签名投递改,
  // 管理员点过「已发 / 跳过」就不再改;其余是管理员点的:状态、点的时间、回音(一句话、一个链接、记的时间)
  "CREATE TABLE IF NOT EXISTS outreach (id TEXT PRIMARY KEY, mine TEXT NOT NULL, status TEXT NOT NULL DEFAULT '待发', decided_at TEXT, result_note TEXT, result_url TEXT, result_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
];
const ready = new WeakSet();

export async function ensure(db) {
  if (ready.has(db)) return;
  await db.batch(DDL.map((s) => db.prepare(s)));
  ready.add(db);
}

export const iso = (d) => new Date(d).toISOString();

// gone 里的两种标记(都只存哈希):
//   按要求删的:goneKey(编号)。帖子编号(收件这条评论、待发要回的那条帖子)记了它,那条帖子收件、待发、问题记录以后都不再收,
//     哪一行的哪个字段带着它都不收(收件的编号、链接、要回的那条;待发的目标帖子、引用的原帖、回复链接、点「已发」记下的目标,见 inPosts、outPosts);
//     待发卡片的编号也记它,那张卡片不再收。以前的版本到期时也记这一种,但 11-03 上线以来还没有评论到期(最早 12-02 到期),
//     所以正式库里现有的每一行都是按要求删的,照这一种认。
//     这一版上线以前按要求删的待发卡片,只记了卡片编号的 goneKey,没记它要回的那条帖子(卡片整行连目标帖子编号一起删了,
//     库里推不回来):那些帖子以后再送来,收件、问题记录、换了编号的待发照样收(同一张卡片的编号照样不收)。这是旧数据的缺口,代码补不上;
//   收件评论 30 天到期删的:expKey(goneKey(编号)),只挡收件(刷新、投递不再收回来),不挡待发和问题记录。
//     直接在 goneKey 前面加 exp:,不另算哈希(刷新读到的几千条评论,每条只算一次)
export async function goneKey(id) {
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("dx-gone-v1:" + id)));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export const expKey = (key) => "exp:" + key;
export const markStmt = (db, key, now) => db.prepare("INSERT INTO gone (id, at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING").bind(key, iso(now));
export const goneStmt = async (db, id, now) => markStmt(db, await goneKey(id), now);
// 写的时候一起查(查和写同一句,和管理员点「删除」同时来也写不回去):这些标记 gone 里一个都没有才写。
// 标记整串当一个 JSON 参数(goneArg),一个个按 gone 的主键查,不扫整张表
export const NOT_GONE = "NOT EXISTS (SELECT 1 FROM json_each(?) j JOIN gone g ON g.id = j.value)";
export const goneArg = (keys) => JSON.stringify([...new Set(keys.filter(Boolean))]);
// 一行里带着的帖子编号:收件是这条评论本身、它的链接、要回的那条(replyToId);
// 待发是要回的那条帖子(编号、链接)、项目帖引用的原帖、我们那条回复(或项目帖)的链接、点「已发」时记下的目标
const POST_ID = /^\d{1,25}$/, STATUS_ID = /\/status\/(\d{1,25})$/;
const postId = (v) => (typeof v === "string" && POST_ID.test(v) ? v : null);
export const urlPost = (u) => { const m = typeof u === "string" ? STATUS_ID.exec(u) : null; return m ? m[1] : null; };
const uniq = (a) => [...new Set(a.filter(Boolean))];
export const inPosts = (id, mine) => uniq([postId(id), urlPost(mine && mine.url), postId(mine && mine.replyToId)]);
export function outPosts(mine, replyUrl, sentTarget) {
  const t = (mine && mine.target) || {};
  return uniq([postId(t.id), urlPost(t.url), urlPost(mine && mine.quote), urlPost(replyUrl), postId(sentTarget)]);
}
export async function postKeys(ids) { const out = []; for (const id of ids) out.push(await goneKey(id)); return out; }
// 改一行(UPDATE)时查的是改完以后这一行还带着的帖子,不只是这次写进去的:写的用新的,没写的用读到的;
// 没写的那几样在语句里核对还是读到的样子(读和写之间被别的改了就不写),再把它们的 goneKey 一起查 gone。
// 待发:卡片本身、到期留下的那条帖子的哈希(target.gone)、带着的每条帖子;收件:这条评论本身、链接里的、要回的那条
const MINE_REFS = ["$.target.id", "$.target.url", "$.quote", "$.target.gone"];
const obj = (v) => (v && typeof v === "object" ? v : {});
export function sameRefs(mine, col = "mine") {
  const m = obj(mine), t = obj(m.target);
  return [MINE_REFS.map((p) => `json_extract(${col}, '${p}') IS ?`).join(" AND "), [t.id, t.url, m.quote, t.gone].map((v) => v ?? null)];
}
export function sameInRefs(mine, col = "mine") {
  const m = obj(mine);
  return [`json_extract(${col}, '$.url') IS ? AND json_extract(${col}, '$.replyToId') IS ?`, [m.url ?? null, m.replyToId ?? null]];
}
export async function outKeys(cardId, mine, replyUrl, sentTarget) {
  const g = obj(obj(mine).target).gone;
  return uniq([await goneKey(cardId), /^[0-9a-f]{64}$/.test(String(g || "")) ? String(g) : null, ...(await postKeys(outPosts(mine, replyUrl, sentTarget)))]);
}
export async function inKeys(id, mine) {
  return uniq([await goneKey(id), ...(await postKeys(inPosts(id, mine).filter((p) => p !== id)))]);
}
// 宣传卡片按要求删掉时记进 gone 的两种标记(都只存哈希;前缀和帖子编号、待发卡片的分开,撞不到一起):
//   这张卡片的编号 reachCardKey:以后同一个编号不再收;
//   收件邮箱 reachToKey(统一成小写):以后写给这个邮箱的卡片都不再收(对方说别再发了,删一张就够)
export const reachCardKey = (id) => goneKey("o:" + id);
export const reachToKey = (to) => goneKey("to:" + String(to).toLowerCase());
export async function reachKeys(id, mine) {
  const to = obj(mine).to;
  return uniq([await reachCardKey(id), typeof to === "string" && to ? await reachToKey(to) : null]);
}
// 库里带着这条帖子(只知道它的 goneKey)的收件、没到期的待发,按要求删到期的旧卡片时才用:按编号一页页翻,每页只读编号和链接那几样,
// 把带着的帖子编号算成 goneKey 比(这一版以前收进来的行没存哈希,也认得出)。一次最多翻 SCAN.pages 页,
// 没翻完回 next(下次从这里接着翻;gone 已经先记了,这中间谁也写不进带着这条帖子的行,翻过的不用再翻)
export const SCAN = { page: 1000, pages: 20 };
export async function rowsAbout(db, gk, from) {
  const memo = new Map();
  const about = async (posts) => {
    for (const p of posts) {
      if (!memo.has(p)) memo.set(p, await goneKey(p));
      if (memo.get(p) === gk) return true;
    }
    return false;
  };
  const found = { inbox: [], outbox: [] };
  let table = obj(from).table === "outbox" ? "outbox" : "inbox", at = typeof obj(from).at === "string" ? from.at : "";
  for (let n = 0; n < SCAN.pages; n++) {
    const q = table === "inbox"
      ? "SELECT id, json_extract(mine, '$.url') AS url, json_extract(mine, '$.replyToId') AS rto FROM inbox WHERE id > ? ORDER BY id LIMIT ?"
      : "SELECT id, json_extract(mine, '$.target.id') AS tid, json_extract(mine, '$.target.url') AS turl, json_extract(mine, '$.quote') AS quote, reply_url, sent_target FROM outbox WHERE purged = 0 AND id > ? ORDER BY id LIMIT ?";
    const rows = (await db.prepare(q).bind(at, SCAN.page).all()).results || [];
    for (const r of rows) {
      const posts = table === "inbox" ? inPosts(r.id, { url: r.url, replyToId: r.rto }) : outPosts({ target: { id: r.tid, url: r.turl }, quote: r.quote }, r.reply_url, r.sent_target);
      if (await about(posts)) found[table].push(r.id);
    }
    if (rows.length === SCAN.page) { at = String(rows[rows.length - 1].id); continue; }
    if (table === "outbox") return { ...found, next: null };
    table = "outbox";
    at = "";
  }
  return { ...found, next: { table, at } };
}
// 一批编号的 goneKey(每个算一次,查 gone 和写的时候都用它)
export async function goneKeys(ids) {
  const keys = new Map();
  for (const id of ids) if (!keys.has(id)) keys.set(id, await goneKey(id));
  return keys;
}
// 收件不再收的编号(按要求删过的、30 天到期删过的):keys 是 goneKeys 算好的,一条查询
export async function inboxGone(db, keys) {
  const all = [...keys.values()];
  const hit = await existing(db, "gone", [...all, ...all.map(expKey)]);
  return new Set([...keys].filter(([, k]) => hit.has(k) || hit.has(expKey(k))).map(([id]) => id));
}
// 把文字里的 @账号 换掉(到期时用:我们的草稿、发出去的话里可能带着对方账号)
export const scrub = (s) => (typeof s === "string" ? s.replace(/@[A-Za-z0-9_]{1,15}/g, "@某人") : s);

// 查哪些编号已经在表里:一条语句(编号整串当一个 JSON 参数传给 json_each,不受「每条语句最多绑 100 个参数」的限制,
// 查多少个都只算一次查询)。table 只由代码里写死的表名传进来
export async function existing(db, table, ids) {
  if (!ids.length) return new Set();
  const { results } = await db.prepare(`SELECT value AS id FROM json_each(?) WHERE value IN (SELECT id FROM ${table})`).bind(JSON.stringify(ids.map(String))).all();
  return new Set((results || []).map((r) => String(r.id)));
}
export const plusDays = (now, n) => iso(+now + n * 864e5);
const parse = (s, dflt) => { try { return JSON.parse(s); } catch { return dflt; } };

export async function getKv(db, k) {
  const r = await db.prepare("SELECT v FROM kv WHERE k = ?").bind(k).first();
  return r ? r.v : null;
}
export const setKv = (db, k, v) => db.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(k, String(v)).run();

// ---------- 看板的几份 JSON ----------
// rules 不是看板,是运营规则(每天放出几条对人的首回、收件续答能带哪些官方网址):改它不用重新发布,和看板一样签名送进来
export const DOC_KEYS = ["summary", "x_posts", "goal_1215", "funnel", "protocols", "clocks", "bot", "rules"];
export async function getDocs(db) {
  const { results } = await db.prepare("SELECT k, v FROM docs").all();
  return Object.fromEntries(results.filter((r) => DOC_KEYS.includes(r.k)).map((r) => [r.k, parse(r.v, null)]));
}
export async function getDoc(db, k) {
  const r = await db.prepare("SELECT v FROM docs WHERE k = ?").bind(k).first();
  return r ? parse(r.v, null) : null;
}
export const docStmt = (db, k, v, now) => db.prepare("INSERT INTO docs (k, v, updated_at) VALUES (?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at").bind(k, JSON.stringify(v), iso(now));
export const putDoc = (db, k, v, now) => docStmt(db, k, v, now).run();

// ---------- 体检计数 ----------
// 数哪几种(/api/hit 只收这几个);「每天」按北京时间(UTC+8),日期写成 2026-11-05
export const HIT_KINDS = ["checkup"];
export const HIT_DAYS = 60;
export const bjDay = (now) => iso(+now + 8 * 3600e3).slice(0, 10);
// 给运营台和导出:每种一个从开始数起的总数 total、开始数的那天 since,加上最近 HIT_DAYS 天每天的数 byDay(没人来的那天不列)
export async function hitCounts(db, now) {
  const [all, recent] = await Promise.all([
    db.prepare("SELECT kind, SUM(n) AS total, MIN(day) AS since FROM hits GROUP BY kind").all(),
    db.prepare("SELECT day, kind, n FROM hits WHERE day >= ? ORDER BY day").bind(bjDay(+now - (HIT_DAYS - 1) * 864e5)).all(),
  ]);
  return Object.fromEntries(HIT_KINDS.map((k) => {
    const a = all.results.find((r) => r.kind === k);
    const byDay = Object.fromEntries(recent.results.filter((r) => r.kind === k).map((r) => [r.day, r.n]));
    return [k, { total: a ? Number(a.total) : 0, since: a ? a.since : null, byDay }];
  }));
}

// ---------- 问题记录(大家最常问) ----------
// 种类、来源只收这几个(投递时查);页面上的中文名在 admin/admin.js。导出给最近 PROBLEM_DAYS 天的数
export const PROBLEM_TYPES = ["bridge-wait", "chain-shutdown", "migration", "unstake-wait", "frontend-down", "wallet-missing", "deadline-missed", "scam", "other"];
export const PROBLEM_SOURCES = ["bot", "announcement", "comment"];
export const PROBLEM_DAYS = 90;
// 问题记录的编号:帖子编号的哈希(前缀和 goneKey 的不一样),从入库起就只存它。同一条帖子再送来还认得出,从库里却找不回原帖。
// 按要求删过的帖子(gone 里有它的 goneKey)不收;收件到期删评论时记的是 expKey,挡不住问题记录的更新
export async function problemKey(id) {
  const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("dx-problem-v1:" + id)));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
// ISO 周(周一开始;一年的第 1 周是有 1 月 4 日的那周):2026-11-05 → 2026-W45;年头年尾几天可能算进相邻那年(2027-01-01 → 2026-W53)
export function isoWeek(day) {
  const t = Date.parse(day + "T00:00:00Z");
  const thu = t + (3 - ((new Date(t).getUTCDay() + 6) % 7)) * 864e5; // 同一周的周四
  const y = new Date(thu).getUTCFullYear();
  return y + "-W" + String(Math.floor((thu - Date.UTC(y, 0, 1)) / (7 * 864e5)) + 1).padStart(2, "0");
}
// 给运营台和导出:最近 days 天(北京时间,含今天;按帖子发的那天算)的数,只有条数,没有编号、账号、链接。
// 明天的不算(投递许服务器的钟差 10 分钟,快到零点的帖子可能已经写成明天,到了那天再算)。
// since 从哪天算起,total 共几条,replied 我们回了几条,repliedShare 回了几成(0–1,三位小数;一条都没有是 null),
// byType 每种几条(九种都列,没有的写 0),byProtocol 条数最多的 top 个协议(一样多的按名字),byWeek 每周几条(没有的那周不列)
export async function problemCounts(db, now, days, top) {
  const since = bjDay(+now - (days - 1) * 864e5), today = bjDay(now);
  const { results } = await db.prepare("SELECT day, type, protocol, COUNT(*) AS n, SUM(replied) AS r FROM problems WHERE day >= ? AND day <= ? GROUP BY day, type, protocol ORDER BY day").bind(since, today).all();
  const byType = Object.fromEntries(PROBLEM_TYPES.map((k) => [k, 0])), byWeek = {}, protos = new Map();
  let total = 0, replied = 0;
  for (const x of results) {
    const n = Number(x.n), wk = isoWeek(x.day);
    total += n;
    replied += Number(x.r) || 0;
    byType[x.type] = (byType[x.type] || 0) + n;
    byWeek[wk] = (byWeek[wk] || 0) + n;
    protos.set(x.protocol, (protos.get(x.protocol) || 0) + n);
  }
  const byProtocol = [...protos].map(([protocol, n]) => ({ protocol, n })).sort((a, b) => b.n - a.n || a.protocol.localeCompare(b.protocol)).slice(0, top);
  return { since, total, replied, repliedShare: total ? Math.round((replied / total) * 1000) / 1000 : null, byType, byProtocol, byWeek };
}

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
// 宣传卡片:运营台给全部还没点的(先送来的在前),和点过的最近 REACH_LIST.page 张(最近点的在前);更早点过的一页页翻(reachDone,
// 从页面上最早的那张往前接着给,不会被新的挤掉)。点过的一共几张从库里数:more 是还没给出去的张数,after 是这一页最早那张(翻页从它往前)
export const REACH_LIST = { page: 100 };
export function reachRow(r) {
  return { id: r.id, mine: parse(r.mine, {}), status: r.status, decided_at: r.decided_at, result_note: r.result_note, result_url: r.result_url, result_at: r.result_at, created_at: r.created_at };
}
const DONE_ORDER = "ORDER BY COALESCE(decided_at, '') DESC, id DESC";
const DONE_OLDER = "status != '待发' AND (COALESCE(decided_at, '') < ? OR (COALESCE(decided_at, '') = ? AND id < ?))";
const lastOf = (page) => (page.length ? { at: page[page.length - 1].decided_at || "", id: page[page.length - 1].id } : null);
// 还没点的、点过的这一页、点过的一共几张,放在一个 batch 里读(D1 的 batch 是一个事务):三样是同一个时刻的,
// 中间插不进别的写。不然数完是 100 张、接着有一张刚点了「已发」、再取最近 100 张就把最早那张挤掉了,more 算成 0,那张翻不到
export async function listReach(db) {
  const [pend, done, all] = await db.batch([
    db.prepare("SELECT * FROM outreach WHERE status = '待发' ORDER BY created_at, id"),
    db.prepare(`SELECT * FROM outreach WHERE status != '待发' ${DONE_ORDER} LIMIT ?`).bind(REACH_LIST.page),
    db.prepare("SELECT COUNT(*) AS n FROM outreach WHERE status != '待发'"),
  ]);
  const page = done.results.map(reachRow), n = Number((all.results[0] && all.results[0].n) || 0);
  return { items: [...pend.results.map(reachRow), ...page], more: Math.max(0, n - page.length), after: lastOf(page) };
}
// 比 (at, id) 那张更早点过的下一页,和这一页之后还剩几张(比 (at, id) 更早的一共几张减去这一页;两句也在一个 batch 里,同一个时刻)
export async function reachDone(db, at, id) {
  const [rows, older] = await db.batch([
    db.prepare(`SELECT * FROM outreach WHERE ${DONE_OLDER} ${DONE_ORDER} LIMIT ?`).bind(at, at, id, REACH_LIST.page),
    db.prepare(`SELECT COUNT(*) AS n FROM outreach WHERE ${DONE_OLDER}`).bind(at, at, id),
  ]);
  const page = rows.results.map(reachRow), n = Number((older.results[0] && older.results[0].n) || 0);
  return { items: page, more: Math.max(0, n - page.length), after: lastOf(page) };
}
export async function getReach(db, id) {
  const r = await db.prepare("SELECT * FROM outreach WHERE id = ?").bind(id).first();
  return r ? reachRow(r) : null;
}

// ---------- 到期删除 ----------
// 收件:删原文、账号名、帖子链接、草稿、备注,只留类型、需求摘要、建议(都是 Claude 写的、不带账号名;摘要里的 @账号换掉,
// 来源里能认出人、帖子、钱包的那一段换成「…」,见 names.js 的 safeLabel)和管理员的决定;
// 编号记进 gone(到期的标记 expKey:刷新、投递不再收回来,不挡问题记录和待发)
// 待发:删目标帖子的账号、链接、编号、「卡在哪」的描述和备注,只留协议、链、类型、我们的草稿和管理员点的状态
// (协议、链、类型一直留着:按 names.js 的 softName 再过一遍,能认出人、帖子、钱包的不留;这一版以前收进来的也在这时候过)
// (目标帖子的编号换成两个哈希:key 是问题记录里那一行的编号,gone 是它的 goneKey,删编号之前从编号算好,以前收进来的也一样。
//  以后按要求删这条,还删得掉问题记录里同一条帖子的那一行,那条帖子也照样记进 gone,收件、待发、问题记录都不再收)
// (自己发的帖子没有目标帖子:留题目和草稿,引用的原帖链接也删)
// 问题记录:删帖子链接和账号(编号本来就只存哈希),只留协议、链、种类、来源、日期、回没回。一句写完,到期的一次全删
// 宣传卡片:点过「已发 / 跳过」满 REACH_TO_DAYS 天,收件邮箱删掉(mine 里去掉 to,记一个 toGone,页面上写明是到期删的;别的留着)。
// 删明文之前先算好它的哈希留在 toKey(和按要求删时记进 gone 的 reachToKey 是同一个):以后再按要求删这张卡片,照样挡得住这个邮箱。
// 还没点的、改回待发的不删(重新点「已发 / 跳过」从那时起算)。读和写之间邮箱、状态变了的这次不改(语句里核对)
export const REACH_TO_DAYS = 180;
export async function purge(db, now) {
  const t = iso(now), cut = plusDays(now, -REACH_TO_DAYS);
  const ins = (await db.prepare("SELECT id, mine, decision FROM inbox WHERE purge_after <= ?").bind(t).all()).results;
  const outs = (await db.prepare("SELECT id, mine, draft_admin, sent_text FROM outbox WHERE purged = 0 AND purge_after <= ?").bind(t).all()).results;
  const due = (await db.prepare("SELECT id, json_extract(mine, '$.to') AS addr FROM outreach WHERE status != '待发' AND decided_at <= ? AND json_extract(mine, '$.to') IS NOT NULL").bind(cut).all()).results;
  const stmts = [];
  for (const r of ins) {
    const m = parse(r.mine, {});
    const at = typeof m.at === "string" ? m.at : t;
    const keep = { source: safeLabel(m.source), type: m.type, need: scrub(m.need), suggestion: m.suggestion, decision: r.decision || null };
    stmts.push(db.prepare("INSERT INTO needs (id, month, v) VALUES (?, ?, ?)").bind(crypto.randomUUID(), at.slice(0, 7), JSON.stringify(keep)));
    stmts.push(markStmt(db, expKey(await goneKey(r.id)), now));
    stmts.push(db.prepare("DELETE FROM inbox WHERE id = ?").bind(r.id));
  }
  for (const r of outs) {
    const m = parse(r.mine, {});
    const tg = m.target || {};
    const tid = /^\d{1,25}$/.test(String(tg.id || "")) ? String(tg.id) : null;
    const [key, gone] = tid ? [await problemKey(tid), await goneKey(tid)] : [];
    const name = (v, max) => softName(v, max) || undefined;
    const keep = m.kind === "post"
      ? { kind: "post", topic: m.topic, why: scrub(m.why), draft: scrub(m.draft) }
      : { target: { protocol: name(tg.protocol, 60), chain: name(tg.chain, 40), type: name(tg.type, 40), key, gone }, why: scrub(m.why), draft: scrub(m.draft) };
    stmts.push(db.prepare("UPDATE outbox SET mine = ?, draft_admin = ?, sent_text = ?, reply_url = NULL, sent_target = NULL, note = NULL, purged = 1, updated_at = ? WHERE id = ?").bind(JSON.stringify(keep), scrub(r.draft_admin) ?? null, scrub(r.sent_text) ?? null, t, r.id));
  }
  const probAt = stmts.length;
  stmts.push(db.prepare("UPDATE problems SET url = NULL, handle = NULL, purged = 1, updated_at = ? WHERE purged = 0 AND purge_after <= ?").bind(t, t));
  stmts.push(db.prepare("DELETE FROM leads WHERE found_at <= ?").bind(plusDays(now, -90)));
  stmts.push(db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(t));
  stmts.push(db.prepare("DELETE FROM nonces WHERE at <= ?").bind(plusDays(now, -2)));
  const reachAt = stmts.length;
  for (const r of due) {
    stmts.push(db.prepare("UPDATE outreach SET mine = json_set(json_remove(mine, '$.to'), '$.toGone', json('true'), '$.toKey', ?), updated_at = ? WHERE id = ? AND status != '待发' AND decided_at <= ? AND json_extract(mine, '$.to') IS ?")
      .bind(await reachToKey(String(r.addr)), t, r.id, cut, r.addr));
  }
  const res = await db.batch(stmts);
  const n = (at) => Number((res && res[at] && res[at].meta && res[at].meta.changes) || 0);
  return { inbox: ins.length, outbox: outs.length, problems: n(probAt), outreach: due.reduce((k, _, i) => k + n(reachAt + i), 0) };
}
// 以前到期留下的需求摘要,来源只换掉了 @账号(更早的一个都没换):库里已经有的,按编号一页页用 safeLabel 过一遍。
// 只在定时任务里跑(每 6 小时那一次,见 task.js;打开运营台、投递都不跑),一次最多 NEEDS_FIX.pages 页,翻到哪记在 kv needs_v2_at;
// 全翻完了才记 needs_v2,以后不再翻。出错只停在这里(task.js 接住),下次从记下的地方接着翻。回 true:翻完了
export const NEEDS_FIX = { page: 500, pages: 4 };
const kvStmt = (db, k, v) => db.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(k, String(v));
export async function fixNeeds(db) {
  if (await getKv(db, "needs_v2")) return true;
  let at = (await getKv(db, "needs_v2_at")) || "";
  for (let n = 0; n < NEEDS_FIX.pages; n++) {
    const rows = (await db.prepare("SELECT id, v FROM needs WHERE id > ? ORDER BY id LIMIT ?").bind(at, NEEDS_FIX.page).all()).results || [];
    const stmts = [];
    for (const r of rows) {
      const v = parse(r.v, null);
      if (v && typeof v === "object" && safeLabel(v.source) !== v.source) stmts.push(db.prepare("UPDATE needs SET v = ? WHERE id = ?").bind(JSON.stringify({ ...v, source: safeLabel(v.source) }), r.id));
    }
    if (rows.length) at = String(rows[rows.length - 1].id);
    const done = rows.length < NEEDS_FIX.page;
    stmts.push(done ? kvStmt(db, "needs_v2", 1) : kvStmt(db, "needs_v2_at", at));
    if (done) stmts.push(db.prepare("DELETE FROM kv WHERE k = 'needs_v2_at'"));
    await db.batch(stmts);
    if (done) return true;
  }
  return false;
}
