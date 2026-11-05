// 签名投递:Claude 主窗口把看板数据、待发草稿、评论分析送进运营台。主窗口那台电脑没有后台账号,也没有数据库凭证,
// 只有 Ed25519 私钥(正式、预览各一把,不进任何仓库);公钥写在 wrangler.toml 的 INGEST_PUBKEYS(公开的,没关系;
// 写几把就认几把,换钥匙 = 加新的、删旧的、重新发布)。
// 签的是「dx-ingest-v1 / 环境 / 方法 / 路径 / 原始请求体」,所以预览的包投不进正式库,换了路径也不认。
// 请求体带 ts(毫秒,按服务器时钟 ±10 分钟)和 nonce;ts 还必须比上一次收下的大(旧包不能盖新数据);nonce 和数据同一个事务写入。
// 投递只能:替换看板的几份 JSON;新建待发、收件,或者改它们 Claude 写的部分(mine)。永远不碰管理员点的状态、决定、备注、改过的草稿;
// 待发一旦被管理员点过「已发 / 跳过」,草稿和目标帖子就不能再改;目标帖子的编号建好以后不能换;回帖和自己发的帖子建好以后不能互换;
// 项目帖引用的原帖建好以后不能换、不能去掉(原来没有的,管理员没改过草稿才能补上)。
// 草稿入库前检查:不许出现私信、客服、加群、转账、授权、助记词、私钥、找回、领取、recover、claim、返佣等词;链接分三种(回复写法 11-05):
//   对人的首回(待发里回别人的)一个链接、域名都不许带,连 defiexit.com 也不带(对方接着问了,续答再给);
//   项目帖只许 defiexit.com(引用的原帖另放 quote);收件里的续答许 defiexit.com,加上运营规则(rules.officialHosts)列的官方网址。
// 只查送进来的草稿,库里原有的不回头查(照常显示)。不合格的那一条不入库,回执里写明哪条为什么;回执不含任何库里的数据。

import { iso, plusDays, KEEP_DAYS, DOC_KEYS, docStmt, getKv, getDoc, getDocs, goneSet } from "./db.js";
import { unb64u, sha256 } from "./auth.js";

export const SKEW_MS = 10 * 60 * 1000;
export const MAX = { draft: 1000, short: 300, doc: 200 * 1024, items: 50, perDay: 200, body: 512 * 1024 };

export const signedText = (envName, method, path, raw) => `dx-ingest-v1\n${envName}\n${method}\n${path}\n${raw}`;

export async function verify(text, sigB64u, pubList) {
  if (!sigB64u) return false;
  const keys = String(pubList || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const k of keys) {
    try {
      const key = await crypto.subtle.importKey("raw", unb64u(k), { name: "Ed25519" }, false, ["verify"]);
      if (await crypto.subtle.verify({ name: "Ed25519" }, key, unb64u(sigB64u), new TextEncoder().encode(text))) return true;
    } catch { /* 下一把 */ }
  }
  return false;
}

// ---------- 草稿检查 ----------
const BANNED = ["私信", "私聊", "客服", "加群", "进群", "电报", "转账", "汇款", "授权", "助记词", "私钥", "密码", "找回", "领取", "返佣", "recover", "claim", "rebate", "telegram", "whatsapp", "dm me", "seed phrase", "private key"];
const ALLOWED_HOSTS = ["defiexit.com", "www.defiexit.com"];
// 待发的草稿许带哪些网址:项目帖只许本站;回别人的(对人的首回)一个都不许
export const outHosts = (mine) => (mine && mine.kind === "post" ? ALLOWED_HOSTS : []);
// 收件续答许带的网址:本站,加上运营规则里列的官方网址(入库时已经查过格式)
const inHosts = (rules) => [...ALLOWED_HOSTS, ...(rules && Array.isArray(rules.officialHosts) ? rules.officialHosts : [])];
// 链接的几种写法:带协议的(任何 xxx://)、英文域名(含 xn-- 编码的)、IP 地址、中文域名(汉字之间夹着英文句点)
const SCHEME = /[a-z][a-z0-9+.-]{1,20}:\/\/[^\s]*/gi;
const ASCII_HOST = /[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})(?![a-z0-9-])/gi;
const IPV4 = /(?:^|[^\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/;
const UNICODE_HOST = /[^\x00-\x7f]\.[\p{L}\p{N}]|[\p{L}\p{N}]\.[^\x00-\x7f]/u; // 英文句点紧挨着汉字等非英文字符
// 长得像句点的:中文句号「。」、全角「．」、半角「｡」,浏览器都当成网址里的点(evil。com 就是 evil.com)。夹在英文字母、数字之间的先换成点再找;
// 夹在汉字之间的是正常的句号,不动
const DOTS = /(?<=[a-z0-9-])[\u3002\uff0e\uff61](?=[a-z0-9-])/gi;
// 英文域名前后紧挨着字母、数字(哪种文字都算)、附加符号、连字号或下划线:真正的主机名比找到的长(éblast.io 其实是 xn--blast-9ra.io),当可疑网址
const GLUED_BEFORE = /[\p{L}\p{N}\p{M}_-]$/u, GLUED_AFTER = /^[\p{L}\p{N}\p{M}_-]/u;
// 最后一段是英文字母、紧跟着别的文字的字母(blast.ió):上面的英文域名找不出来,一样当可疑网址
const TLD_GLUED = /[a-z0-9-]\.[a-z]+(?![\x00-\x7f])[\p{L}\p{N}\p{M}]/iu;
function hostOf(s) {
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : "http://" + s).hostname.toLowerCase().replace(/\.$/, ""); } catch { return null; }
}

// hosts:这份草稿许带的网址,主机名一模一样才算(blast.io 不放行 xblast.io、blast.io.evil.com),带协议的只认 https;
// 给空的 = 一个链接、域名都不许带(对人的首回)
export function checkText(s, max = MAX.draft, hosts = ALLOWED_HOSTS) {
  if (typeof s !== "string") return "不是文字";
  const t = s.trim();
  if (!t) return "是空的";
  if (t.length > max) return `超过 ${max} 字`;
  const low = t.toLowerCase();
  const word = BANNED.find((w) => low.includes(w));
  if (word) return `含不许用的词「${word}」`;
  const off = (h) => (hosts.length ? `含站外链接「${h}」` : `含链接或域名「${h}」(对人的首回一个都不带,连 defiexit.com 也不带)`);
  // 先统一写法再找网址(三种规矩都一样):全角字母、全角的点换成半角(NFKC),英文之间的「。」换成点,长得像的绕不过去。敏感词照旧查原文
  const u = t.normalize("NFKC").replace(DOTS, ".");
  for (const m of u.matchAll(SCHEME)) {
    const host = hostOf(m[0]);
    if (!host || !hosts.includes(host) || !/^https:\/\//i.test(m[0])) return off(host || m[0].slice(0, 30));
  }
  const rest = u.replace(SCHEME, " ");
  for (const m of rest.matchAll(ASCII_HOST)) {
    const host = hostOf(m[0]);
    if (!host || !hosts.includes(host)) return off(host || m[0]);
    if (GLUED_BEFORE.test(rest.slice(0, m.index)) || GLUED_AFTER.test(rest.slice(m.index + m[0].length))) return `含可疑网址「${host}」(紧挨着别的字母或汉字,真正的网址比它长;前后空一格)`;
  }
  if (IPV4.test(u)) return "含 IP 地址";
  if (UNICODE_HOST.test(u) || TLD_GLUED.test(u)) return "含中文域名或可疑网址(汉字之间别用英文句点)";
  return null;
}

const str = (v, max = MAX.short) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
const tweetId = (v) => (/^\d{1,25}$/.test(String(v ?? "")) ? String(v) : undefined);
const xUrl = (v) => (/^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{1,25}$/.test(String(v ?? "")) ? String(v) : undefined);
const handle = (v) => (/^[A-Za-z0-9_]{1,15}$/.test(String(v ?? "")) ? String(v) : undefined);
const when = (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : undefined);
const itemId = (v) => (/^[a-z0-9][a-z0-9-]{2,63}$/.test(String(v ?? "")) ? String(v) : undefined);
const drop = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

// 待发有两种:回别人的帖子(要目标帖子),或者自己发一条新帖(kind: "post",没有目标帖子,topic 是一句话的题目,quote 可选:引用的官方原帖)
export function cleanOut(x) {
  const id = itemId(x?.id);
  if (!id) return { error: "id 不合格" };
  const post = x.kind === "post";
  if (!post && x.kind !== undefined) return { id, error: "kind 只能不写(回帖)或写 post(自己发的帖子)" };
  let target;
  if (!post) {
    const t = x.target || {};
    target = drop({ id: tweetId(t.id), handle: handle(t.handle), url: xUrl(t.url), postedAt: when(t.postedAt), protocol: str(t.protocol, 60), chain: str(t.chain, 40), type: str(t.type, 40), summary: str(t.summary, 200) });
    if (!target.id || !target.url || !target.url.endsWith("/status/" + target.id)) return { id, error: "目标帖子的编号或链接不合格(两者要对得上)" };
  }
  // 项目帖可以引用一条官方在 X 上的原帖(quote):发出去下面带着原帖的卡片;链接不写进草稿,草稿照样只许 defiexit.com
  const quote = x.quote == null ? undefined : xUrl(x.quote);
  if (x.quote != null && (!post || !quote)) return { id, error: post ? "引用的原帖链接不合格(要 https://x.com/账号/status/编号)" : "回帖不能带引用" };
  const bad = checkText(x.draft, MAX.draft, outHosts(x));
  if (bad) return { id, error: "草稿" + bad };
  const mine = post ? drop({ kind: "post", topic: str(x.topic, 40), quote, why: str(x.why), draft: x.draft.trim() }) : drop({ target, why: str(x.why), draft: x.draft.trim() });
  return { id, mine, replyUrl: xUrl(x.replyUrl) };
}

// hosts:续答许带的网址(本站 + 运营规则里的官方网址)
export function cleanIn(x, hosts = ALLOWED_HOSTS) {
  const id = tweetId(x?.id);
  if (!id) return { error: "id 要是评论的帖子编号" };
  if (x.draft != null) {
    const bad = checkText(x.draft, MAX.draft, hosts);
    if (bad) return { id, error: "草稿" + bad };
  }
  const mine = drop({
    source: str(x.source, 40), url: xUrl(x.url), author: handle(x.author), at: when(x.at), type: str(x.type, 60), need: str(x.need),
    suggestion: ["采纳", "以后再说", "不采纳"].includes(x.suggestion) ? x.suggestion : undefined,
    suggestionWhy: str(x.suggestionWhy), draft: typeof x.draft === "string" ? x.draft.trim() : undefined, replyToId: tweetId(x.replyToId), yourReply: str(x.yourReply, MAX.draft),
  });
  return { id, mine, text: str(x.text, 2000), replied: x.replied === true, repliedAt: when(x.repliedAt) };
}

// 看板 JSON:逐项查形状(页面渲染时还会再兜一层);数字不许是负数或特别大
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const okStr = (v, n = 300) => v === undefined || (typeof v === "string" && v.length <= n);
const okNum = (v, nullable) => (nullable && v === null) || v === undefined || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e9);
const okArr = (v, n, each) => Array.isArray(v) && v.length <= n && v.every((x) => isObj(x) && each(x));
const HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const okHost = (h) => typeof h === "string" && HOST.test(h) && !h.split(".").some((l) => l.startsWith("xn--"));
const SHAPES = {
  summary: (v) => okStr(v.updatedAt, 40) && (v.asks === undefined || okArr(v.asks, 12, (a) => typeof a.text === "string" && a.text.length <= 200 && okStr(a.when, 10) && (a.href === undefined || /^#[a-z]+$/.test(a.href)))),
  x_posts: (v) => okArr(v.posts, 10, (p) => /^\d{1,25}$/.test(String(p.id)) && okStr(p.name, 40) && okStr(p.url, 120) && (p.points === undefined || okArr(p.points, 300, (r) => typeof r.at === "string" && ["views", "likes", "replies", "reposts", "bookmarks"].every((f) => okNum(r[f], true)))))
    && (v.square === undefined || okArr(v.square, 10, (r) => okStr(r.name, 60) && okNum(r.views, true) && okNum(r.comments, true))) && okStr(v.squareNote, 300) && okStr(v.source, 200),
  goal_1215: (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v.deadline)) && okArr(v.items, 8, (it) => typeof it.label === "string" && okNum(it.value, true) && okNum(it.goal) && okStr(it.unit, 10) && okStr(it.note, 300)) && okStr(v.source, 200),
  funnel: (v) => okNum(v.target) && okArr(v.stages, 8, (s) => typeof s.key === "string" && typeof s.label === "string" && okNum(s.value)) && okStr(v.note, 300),
  protocols: (v) => okArr(v.rows, 50, (r) => typeof r.protocol === "string" && okStr(r.chain, 40) && okNum(r.posts) && okNum(r.people)) && okStr(v.note, 300),
  clocks: (v) => okArr(v.rows, 20, (r) => typeof r.name === "string" && okStr(r.short, 20) && okStr(r.due, 10) && okStr(r.status, 20) && okStr(r.reading, 1000)) && okStr(v.source, 200),
  bot: (v) => (v.rows === undefined || okArr(v.rows, 50, (r) => okNum(r.n) && typeof r.title === "string" && okStr(r.state, 20) && okNum(r.comments))) && okStr(v.note, 300) && okStr(v.source, 200) && okStr(v.error, 300),
  // 运营规则:dailyReplyCap 每天(北京时间)最多放出几条对人的首回,整数 1–50,没写按 15(运营台页面按它数今天放几条);
  // officialHosts 收件续答能带的官方网址,只写主机名(小写、不带 https:// 和路径,不收 xn-- 编码的),一模一样才放行,子域名要另写一条
  rules: (v) => (v.dailyReplyCap === undefined || (Number.isInteger(v.dailyReplyCap) && v.dailyReplyCap >= 1 && v.dailyReplyCap <= 50))
    && (v.officialHosts === undefined || (Array.isArray(v.officialHosts) && v.officialHosts.length <= 200 && v.officialHosts.every(okHost))) && okStr(v.note, 300) && okStr(v.updatedAt, 40),
};
function cleanDoc(k, v) {
  if (!DOC_KEYS.includes(k) || !isObj(v)) return "不认识的看板项";
  if (JSON.stringify(v).length > MAX.doc) return "太大";
  return SHAPES[k](v) ? null : "格式不对";
}

// x_posts 有两个写的人:管理员点「刷新」时服务器追加读数,Claude 投递时带来本地记的读数。按帖子、按时间合并,谁的都不丢
export function mergeReadings(old, incoming) {
  const before = new Map(((old && old.posts) || []).map((p) => [String(p.id), p.points || []]));
  const posts = (incoming.posts || []).map((p) => {
    const byAt = new Map();
    for (const pt of [...(before.get(String(p.id)) || []), ...(p.points || [])]) if (pt && typeof pt.at === "string") byAt.set(pt.at, pt);
    return { ...p, points: [...byAt.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-300) };
  });
  return { ...incoming, posts };
}

// 验签、查时间和 nonce、校验、写入(nonce、ts 记录和数据同一批写,要么都成要么都不成)。
// 返回 { status, body }:200 收下(可能有部分条目被拒),4xx 整包不收
export async function ingest(db, { raw, sig, envName, method, path, pubkeys }, now) {
  if (raw.length > MAX.body) return { status: 413, body: { error: "big" } };
  if (!(await verify(signedText(envName, method, path, raw), sig, pubkeys))) return { status: 401, body: { error: "sig" } };
  let body;
  try { body = JSON.parse(raw); } catch { return { status: 400, body: { error: "bad" } }; }
  if (!body || typeof body !== "object" || body.v !== 1) return { status: 400, body: { error: "bad" } };
  if (typeof body.ts !== "number" || Math.abs(+now - body.ts) > SKEW_MS) return { status: 401, body: { error: "stale" } };
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(String(body.nonce || ""))) return { status: 400, body: { error: "nonce" } };
  // 一次只处理一包(两包同时到,后到的回 busy):「比上一包新」的检查和写入之间不会被别的包插进来。锁 60 秒没放就算失效
  const lock = await db.prepare("INSERT INTO kv (k, v) VALUES ('ingest_lock', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v WHERE CAST(kv.v AS INTEGER) < ?").bind(String(+now), +now - 60000).run();
  if (!lock.meta || lock.meta.changes !== 1) return { status: 409, body: { error: "busy" } };
  try {
    return await locked(db, raw, body, now);
  } finally {
    await db.prepare("DELETE FROM kv WHERE k = 'ingest_lock' AND v = ?").bind(String(+now)).run();
  }
}

async function locked(db, raw, body, now) {
  const lastTs = Number((await getKv(db, "ingest_ts")) || 0);
  if (body.ts <= lastTs) return { status: 409, body: { error: "old" } };
  if (await db.prepare("SELECT 1 FROM nonces WHERE n = ?").bind(body.nonce).first()) return { status: 409, body: { error: "replay" } };
  const day = iso(now).slice(0, 10);
  const used = Number((await getKv(db, "ingest_day:" + day)) || 0);
  if (used >= MAX.perDay) return { status: 429, body: { error: "day" } };

  const t = iso(now);
  const rejected = [];
  const stmts = [
    db.prepare("INSERT INTO nonces (n, at) VALUES (?, ?)").bind(body.nonce, t),
    db.prepare("INSERT INTO kv (k, v) VALUES ('ingest_ts', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(body.ts)),
    db.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind("ingest_day:" + day, String(used + 1)),
  ];
  let docs = 0, outN = 0, inN = 0, setup = false;
  // 一次性设置链接:我在本机生成一串随机码,只把它的 SHA-256 送进来;还没有管理员时才收,最多 48 小时有效
  if (body.setup !== undefined) {
    const s = body.setup;
    const hasAdmin = await db.prepare("SELECT 1 FROM admin WHERE id = 1").first();
    if (hasAdmin) rejected.push({ kind: "setup", id: "setup", why: "已经有管理员了" });
    else if (!s || !/^[0-9a-f]{64}$/.test(String(s.hash)) || !(s.hours > 0 && s.hours <= 48)) rejected.push({ kind: "setup", id: "setup", why: "格式不对" });
    else {
      stmts.push(db.prepare("INSERT INTO kv (k, v) VALUES ('setup_hash', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(s.hash));
      stmts.push(db.prepare("INSERT INTO kv (k, v) VALUES ('setup_exp', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(+now + s.hours * 3600e3)));
      setup = true;
    }
  }
  const current = body.docs && body.docs.x_posts ? await getDocs(db) : {};
  let rules = null; // 这一包带了合格的运营规则,收件就按这一包的查;没带(或不合格)按库里的
  for (const [k, v0] of Object.entries(body.docs || {})) {
    const bad = cleanDoc(k, v0);
    if (bad) { rejected.push({ kind: "doc", id: k, why: bad }); continue; }
    const v = k === "x_posts" ? mergeReadings(current.x_posts, v0) : v0;
    if (k === "rules") rules = v;
    stmts.push(docStmt(db, k, v, now));
    docs++;
  }

  const outs = Array.isArray(body.outbox) ? body.outbox.slice(0, MAX.items) : [];
  const ins = Array.isArray(body.inbox) ? body.inbox.slice(0, MAX.items) : [];
  const ids = outs.map((x) => itemId(x?.id)).filter(Boolean);
  const have = new Map();
  if (ids.length) {
    const { results } = await db.prepare(`SELECT id, mine, status, purged, draft_admin FROM outbox WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
    for (const r of results) have.set(r.id, r);
  }
  const gone = await goneSet(db, [...ids, ...ins.map((x) => String(x?.id ?? ""))].filter(Boolean));
  for (const x of outs) {
    const c = cleanOut(x);
    if (c.error) { rejected.push({ kind: "outbox", id: c.id || "?", why: c.error }); continue; }
    if (gone.has(c.id)) { rejected.push({ kind: "outbox", id: c.id, why: "管理员按要求删过,不再收" }); continue; }
    const old = have.get(c.id);
    if (!old) {
      stmts.push(db.prepare("INSERT INTO outbox (id, mine, reply_url, created_at, updated_at, purge_after) VALUES (?, ?, ?, ?, ?, ?)").bind(c.id, JSON.stringify(c.mine), c.replyUrl ?? null, t, t, plusDays(now, KEEP_DAYS)));
    } else {
      const oldMine = (() => { try { return JSON.parse(old.mine) || {}; } catch { return {}; } })();
      if ((oldMine.kind || "reply") !== (c.mine.kind || "reply")) { rejected.push({ kind: "outbox", id: c.id, why: "回帖和自己发的帖子不能互换" }); continue; }
      const oldTarget = oldMine.target?.id;
      if (oldTarget && oldTarget !== c.mine.target?.id) { rejected.push({ kind: "outbox", id: c.id, why: "目标帖子不能换" }); continue; }
      if (old.purged || old.status !== "待发") {
        // 管理员点过了(或已到期删过):只许给「已发」且没到期删过的补他那条回复的链接
        if (c.replyUrl && !old.purged && old.status === "已发") stmts.push(db.prepare("UPDATE outbox SET reply_url = ?, updated_at = ? WHERE id = ? AND status = '已发' AND purged = 0").bind(c.replyUrl, t, c.id));
        else rejected.push({ kind: "outbox", id: c.id, why: "管理员已经处理过,草稿不再改" });
      } else {
        // 引用的原帖建好以后不能换、不能去掉(老板可能已经照着它改了草稿);原来没有的,老板没改过草稿才能补上
        const oldQuote = oldMine.quote || null, newQuote = c.mine.quote || null;
        if (oldQuote !== newQuote && (oldQuote || old.draft_admin != null)) { rejected.push({ kind: "outbox", id: c.id, why: "引用的原帖建好以后不能换" }); continue; }
        // 条件写在语句里:读和写之间管理员点了「已发 / 跳过」(补引用时还有:改了草稿),这条就不改
        stmts.push(db.prepare("UPDATE outbox SET mine = ?, reply_url = COALESCE(?, reply_url), updated_at = ? WHERE id = ? AND status = '待发' AND purged = 0" + (oldQuote !== newQuote ? " AND draft_admin IS NULL" : "")).bind(JSON.stringify(c.mine), c.replyUrl ?? null, t, c.id));
      }
    }
    outN++;
  }

  if (!rules && ins.some((x) => x && x.draft != null)) rules = await getDoc(db, "rules");
  const hosts = inHosts(rules);
  for (const x of ins) {
    const c = cleanIn(x, hosts);
    if (c.error) { rejected.push({ kind: "inbox", id: c.id || "?", why: c.error }); continue; }
    if (gone.has(c.id)) { rejected.push({ kind: "inbox", id: c.id, why: "管理员按要求删过,不再收" }); continue; }
    // 原文只在新建时写;到期删过的不再补回;回复保留期从第一次入库算,更新不重置;replied 只会从 0 变 1
    stmts.push(db.prepare(
      "INSERT INTO inbox (id, mine, text, replied, replied_at, created_at, updated_at, purge_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET mine = CASE WHEN inbox.purged = 1 THEN inbox.mine ELSE json_patch(inbox.mine, excluded.mine) END, " +
      "replied = MAX(inbox.replied, excluded.replied), replied_at = COALESCE(inbox.replied_at, excluded.replied_at), updated_at = excluded.updated_at",
    ).bind(c.id, JSON.stringify(c.mine), c.text ?? null, c.replied ? 1 : 0, c.repliedAt ?? null, t, t, plusDays(now, KEEP_DAYS)));
    inN++;
  }

  try {
    await db.batch(stmts);
  } catch (e) {
    // 同一个 nonce 同时投两次:后到的那批整个回滚
    if (/UNIQUE|constraint/i.test(String(e && e.message))) return { status: 409, body: { error: "replay" } };
    throw e;
  }
  return { status: 200, body: { ok: true, receipt: (await sha256(raw)).slice(0, 16), docs, outbox: outN, inbox: inN, setup, rejected } };
}
