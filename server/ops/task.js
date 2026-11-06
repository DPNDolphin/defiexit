// 定时任务和维护者读数,两个签名入口,和投递(ingest)的签名分开(签的文字开头不一样,一把钥匙签的东西拿到别的入口不认):
//
// POST /api/admin/task    定时任务(GitHub Actions)用的「小钥匙」,公钥在 TASK_PUBKEYS。只能做两件事:
//   { do: "sync" }                          请运营台自己刷新一次(和管理员点按钮是同一套,两分钟一次,另加每天上限)
//   { do: "leads", leads: [...], read, failed }  往「项目变动线索」里加监控找到的线索(只加不改,按编号去重,每次、每天有上限);
//                                           顺手把以前的需求摘要按页过一遍(db.js 的 fixNeeds,翻完为止)
//   改不了待发、收件、看板,也设不了管理员。钥匙丢了,别人最多让它多刷新几次、塞几条线索(来源链接只认白名单里的网站)。
// POST /api/admin/export  维护者(Claude 主窗口)用投递那把钥匙读:管理员点的决定、状态、时间,管理员自己写的备注(可能提到别人),
//   我们自己发出去的回复的链接和读数(浏览、点赞、回复数),线索(公开信息),定时任务的情况,
//   体检次数 hits(每种的总数、开始数的那天、最近 60 天每天的数,北京时间;见 db.js 的 hitCounts),
//   问题记录 problems(最近 90 天的数:每种、问得多的 20 个协议、每周几条、回了几成;见 db.js 的 problemCounts,只有数,不带编号、账号、链接),
//   宣传卡片 outreach(编号、渠道、目标、状态、点的时间,管理员记下的回音:一句话、链接、记的时间;不带正文和收件邮箱,那些是我自己写的)。
//   不回评论原文、评论人账号、目标帖子信息。导出前先跑一遍到期清理,过期的不会导出。
// 两个入口都查:签名、时间(±10 分钟)、nonce 只能用一次;task 还要求 ts 比上一次大,同一时刻只处理一包(锁 5 分钟,比最慢的一次刷新长)。
// 「每天」按 UTC 算。

import { iso, getKv, setKv, purge, fixNeeds, hitCounts, problemCounts, PROBLEM_DAYS } from "./db.js";
import { verify, SKEW_MS } from "./ingest.js";
import { sync } from "./sync.js";

export const taskText = (envName, method, path, raw) => `dx-task-v1\n${envName}\n${method}\n${path}\n${raw}`;
export const exportText = (envName, method, path, raw) => `dx-export-v1\n${envName}\n${method}\n${path}\n${raw}`;
export const LIMIT = { body: 256 * 1024, perDay: 200, syncPerDay: 96, leadsPerReq: 100, leadsPerDay: 300, lockMs: 5 * 60 * 1000 };

// 按天计数:先占一个名额再干活(带条件的写,满了就占不到),不是做完再 +1
async function reserve(db, key, cap) {
  const r = await db.prepare("INSERT INTO kv (k, v) VALUES (?, '1') ON CONFLICT(k) DO UPDATE SET v = CAST(CAST(kv.v AS INTEGER) + 1 AS TEXT) WHERE CAST(kv.v AS INTEGER) < ?").bind(key, cap).run();
  return !!(r.meta && r.meta.changes === 1);
}
const release = (db, key) => db.prepare("UPDATE kv SET v = CAST(CAST(v AS INTEGER) - 1 AS TEXT) WHERE k = ? AND CAST(v AS INTEGER) > 0").bind(key).run();

// 线索的来源链接只认这些网站(和 scripts/monitor/sources.json 对上;加论坛要两边一起加)
export const LEAD_HOSTS = new Set([
  "defillama.com", "governance.aave.com", "www.comp.xyz", "research.lido.fi", "gov.uniswap.org", "forum.morpho.org", "forum.balancer.fi",
  "forum.arbitrum.foundation", "gov.optimism.io", "gov.frax.finance", "forum.euler.finance", "gov.yearn.fi", "community.venus.io",
  "dao.rocketpool.net", "forum.zknation.io", "forum.polygon.technology", "forum.eigenlayer.xyz", "gov.fluid.io", "community.radiant.capital",
]);
const KINDS = ["事件", "论坛", "锁仓骤降"];
const clip = (s, n) => String(s ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim().slice(0, n);
const hex = async (s) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join("");
const parse = (s, d = null) => { try { return JSON.parse(s); } catch { return d; } };

function hostOf(u) { try { const x = new URL(u); return x.protocol === "https:" ? x.hostname.toLowerCase() : null; } catch { return null; } }

export async function cleanLead(x) {
  if (!x || typeof x !== "object") return { error: "不是对象" };
  if (!KINDS.includes(x.kind)) return { error: "kind 不认识" };
  const key = clip(x.key, 300), protocol = clip(x.protocol, 80), text = clip(x.text, 400), source = clip(x.source, 300);
  if (!key || !protocol || !text) return { error: "缺 key、protocol 或 text" };
  const host = hostOf(source);
  if (!host || !LEAD_HOSTS.has(host)) return { error: "来源不在白名单:" + (host || "不是 https") };
  const when = /^\d{4}-\d{2}-\d{2}$/.test(String(x.when || "")) ? x.when : undefined;
  const site = hostOf(clip(x.site, 200)) || undefined; // 只留域名,不当链接
  const handle = /^@[A-Za-z0-9_]{1,15}$/.test(String(x.x || "")) ? x.x : undefined;
  const chains = Array.isArray(x.chains) ? x.chains.slice(0, 5).map((c) => clip(c, 30)).filter(Boolean) : undefined;
  const tvl = Number.isFinite(x.tvl) && x.tvl >= 0 && x.tvl < 1e13 ? Math.round(x.tvl) : undefined;
  const v = Object.fromEntries(Object.entries({ kind: x.kind, protocol, text, source, when, site, x: handle, category: clip(x.category, 40) || undefined, chains, tvl }).filter(([, val]) => val !== undefined));
  return { id: await hex("dx-lead-v1:" + key), v };
}

// 签名、时间、nonce 的公共检查:过了回 { ok: true, body },没过回 { status, body: { error } }(调用方只认 ok)
async function checked(db, text, sig, pubkeys, raw, now, prefix) {
  if (raw.length > LIMIT.body) return { status: 413, body: { error: "big" } };
  if (!(await verify(text, sig, pubkeys))) return { status: 401, body: { error: "sig" } };
  const body = parse(raw);
  if (!body || typeof body !== "object" || body.v !== 1) return { status: 400, body: { error: "bad" } };
  if (typeof body.ts !== "number" || Math.abs(+now - body.ts) > SKEW_MS) return { status: 401, body: { error: "stale" } };
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(String(body.nonce || ""))) return { status: 400, body: { error: "nonce" } };
  // nonce 先占上(主键冲突 = 用过了),跟后面的写入分开:就算后面出错,这个 nonce 也不能再用
  try {
    await db.prepare("INSERT INTO nonces (n, at) VALUES (?, ?)").bind(prefix + body.nonce, iso(now)).run();
  } catch {
    return { status: 409, body: { error: "replay" } };
  }
  return { ok: true, body };
}

export async function task(db, { raw, sig, envName, method, path, pubkeys }, now, fetchImpl) {
  if (!String(pubkeys || "").trim()) return { status: 404, body: { error: "off" } };
  const c = await checked(db, taskText(envName, method, path, raw), sig, pubkeys, raw, now, "t:");
  if (!c.ok) return c;
  const body = c.body;
  // 同一时刻只处理一包;ts 要比上一包大(旧包不能再放一遍)
  const lock = await db.prepare("INSERT INTO kv (k, v) VALUES ('task_lock', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v WHERE CAST(kv.v AS INTEGER) < ?").bind(String(+now), +now - LIMIT.lockMs).run();
  if (!lock.meta || lock.meta.changes !== 1) return { status: 409, body: { error: "busy" } };
  try {
    if (body.ts <= Number((await getKv(db, "task_ts")) || 0)) return { status: 409, body: { error: "old" } };
    const day = iso(now).slice(0, 10);
    if (!(await reserve(db, "task_day:" + day, LIMIT.perDay))) return { status: 429, body: { error: "day" } };
    await setKv(db, "task_ts", String(body.ts));

    if (body.do === "sync") {
      if (!(await reserve(db, "auto_sync_day:" + day, LIMIT.syncPerDay))) return { status: 429, body: { error: "sync-day" } };
      const r = await sync(db, fetchImpl, now);
      if (r.status !== 200) await release(db, "auto_sync_day:" + day); // 没刷成不占名额
      const b = r.body || {};
      // 「刚刷过」「被更新的一次刷新顶掉」都不算失败,不盖掉上一次的结果
      // read:读到了几条被监控的帖子;errors 留前几条(帖子名和原因),页面和导出能看出是哪条、为什么
      const errs = (b.errors || []).slice(0, 6).map((e) => String(e).slice(0, 80));
      if (r.status !== 429 && r.status !== 409) await setKv(db, "auto_sync_last", JSON.stringify({ at: iso(now), ok: r.status === 200, error: b.error || null, read: b.read ?? null, newReplies: b.newReplies || 0, failed: (b.errors || []).length, errors: errs }));
      return { status: r.status, body: r.status === 200 ? { ok: true, read: b.read ?? null, newReplies: b.newReplies || 0, failed: (b.errors || []).length, errors: errs } : { error: b.error || "sync" } };
    }

    if (body.do === "leads") {
      const list = Array.isArray(body.leads) ? body.leads : [];
      if (list.length > LIMIT.leadsPerReq) return { status: 413, body: { error: "too-many" } };
      const rejected = [], fresh = new Map();
      for (const x of list) {
        const l = await cleanLead(x);
        if (l.error) rejected.push(l.error); else fresh.set(l.id, l.v);
      }
      const ids = [...fresh.keys()];
      const have = new Set();
      for (let i = 0; i < ids.length; i += 50) {
        const part = ids.slice(i, i + 50);
        const { results } = await db.prepare(`SELECT id FROM leads WHERE id IN (${part.map(() => "?").join(",")})`).bind(...part).all();
        for (const r of results) have.add(r.id);
      }
      const dayUsed = Number((await getKv(db, "leads_day:" + day)) || 0);
      const add = ids.filter((id) => !have.has(id)).slice(0, Math.max(0, LIMIT.leadsPerDay - dayUsed));
      const t = iso(now);
      const stmts = add.map((id) => db.prepare("INSERT INTO leads (id, v, found_at) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING").bind(id, JSON.stringify(fresh.get(id)), t));
      const failed = Array.isArray(body.failed) ? body.failed.slice(0, 30).map((s) => clip(s, 80)) : [];
      const read = Number.isInteger(body.read) && body.read >= 0 && body.read < 100000 ? body.read : null;
      stmts.push(db.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind("leads_day:" + day, String(dayUsed + add.length)));
      stmts.push(db.prepare("INSERT INTO kv (k, v) VALUES ('monitor_last', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(JSON.stringify({ at: t, read, failed, sent: list.length, stored: add.length, rejected: rejected.length })));
      await db.batch(stmts);
      // 顺手把以前的需求摘要过一遍(db.js 的 fixNeeds,一次翻几页、接着上次翻):这一次请求用的数据库查询少;出错不连累线索
      try { await fixNeeds(db); } catch { /* 下次接着翻 */ }
      return { status: 200, body: { ok: true, stored: add.length, duplicate: ids.length - add.length, rejected: rejected.slice(0, 10) } };
    }
    return { status: 400, body: { error: "do" } };
  } finally {
    await db.prepare("DELETE FROM kv WHERE k = 'task_lock' AND v = ?").bind(String(+now)).run();
  }
}

export async function listLeads(db, n = 30) {
  const { results } = await db.prepare("SELECT id, v, found_at FROM leads ORDER BY found_at DESC, id LIMIT ?").bind(n).all();
  return results.map((r) => ({ id: r.id, found_at: r.found_at, ...(parse(r.v, {}) || {}) }));
}

export async function autoState(db) {
  return { sync: parse(await getKv(db, "auto_sync_last")), monitor: parse(await getKv(db, "monitor_last")) };
}

export async function exportFor(db, { raw, sig, envName, method, path, pubkeys }, now) {
  const c = await checked(db, exportText(envName, method, path, raw), sig, pubkeys, raw, now, "e:");
  if (!c.ok) return c;
  await purge(db, now); // 到期的先删掉,不会被导出
  const since = typeof c.body.since === "string" && !Number.isNaN(Date.parse(c.body.since)) ? c.body.since : "1970-01-01T00:00:00.000Z";
  const inbox = (await db.prepare("SELECT id, decision, decided_at, replied, replied_at, note FROM inbox WHERE updated_at >= ? ORDER BY updated_at DESC LIMIT 500").bind(since).all()).results
    .map((r) => ({ id: r.id, decision: r.decision, decided_at: r.decided_at, replied: !!r.replied, replied_at: r.replied_at, note: r.note }));
  const outbox = (await db.prepare("SELECT id, status, decided_at, reply_url, note FROM outbox WHERE updated_at >= ? ORDER BY updated_at DESC LIMIT 500").bind(since).all()).results;
  const outreach = (await db.prepare("SELECT id, json_extract(mine, '$.channel') AS channel, json_extract(mine, '$.target') AS target, status, decided_at, result_note, result_url, result_at FROM outreach WHERE updated_at >= ? ORDER BY updated_at DESC LIMIT 500").bind(since).all()).results;
  const leads = (await db.prepare("SELECT id, v, found_at FROM leads WHERE found_at >= ? ORDER BY found_at DESC LIMIT 300").bind(since).all()).results
    .map((r) => ({ id: r.id, found_at: r.found_at, ...(parse(r.v, {}) || {}) }));
  let outStats = {};
  try { outStats = JSON.parse((await getKv(db, "out_stats")) || "{}") || {}; } catch { outStats = {}; }
  // 体检次数不看 since:总是给总数和最近 60 天;问题记录也不看 since:总是最近 90 天的数
  return { status: 200, body: { ok: true, at: iso(now), inbox, outbox, outreach, leads, auto: await autoState(db), outStats, hits: await hitCounts(db, now), problems: await problemCounts(db, now, PROBLEM_DAYS, 20) } };
}
