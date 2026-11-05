// 体检计数(Cloudflare Pages Function,路径 /api/hit):数「有多少个不同的地址来体检过」,服务器永远看不到地址。
// 体检结果页查完一个这个浏览器没数过的地址,发来固定的 {"k":"checkup"}:没有地址、没有地址的摘要、没有任何编号,也不带 cookie
// (浏览器那边怎么去重、管理员自己的浏览器怎么不算,见 src/js/lib/count.js)。
// 这里只给当天(北京时间)的总数加一,记在运营台的 D1 里(表 hits:日期、种类、次数)。别的都不存:不记 IP、浏览器信息、每一次的时间,也不写日志。
// 数字是约数:换浏览器、清了浏览器数据再查同一个地址会再数一次;禁了本地存储的浏览器不数;有人照着格式刷也挡不全,只靠下面的上限压着。
// 维护者经签名导出(/api/admin/export 的 hits)读数字,运营台「数据」里的 12-15 目标也显示。

import { ensure, bjDay, HIT_KINDS } from "../../server/ops/db.js";

// 请求体最多 64 字节;每个实例每天最多数 perIsolate 次(只在内存里,Cloudflare 换实例就清零,挡一下从一处猛刷的);
// 每种每天最多数到 perDay(库里带条件的写,到了就不再加):刷不爆数字,也不会把运营台的数据库写满额度
export const LIMIT = { body: 64, perIsolate: 1000, perDay: 5000 };

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
};
const reply = (body, status, extra = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...HEADERS, ...extra } });

// 读请求体:最多读 max 字节,多一个字节就停下、不再往下读(不先把整个请求体收进内存);超了回 null
export async function readSmall(request, max) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const b = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    b.set(p, o);
    o += p.byteLength;
  }
  return new TextDecoder().decode(b);
}

// 这个实例今天数了几次(换一天从 0 数)
const mem = { day: "", n: 0 };
export function overCap(day, m = mem) {
  if (m.day !== day) {
    m.day = day;
    m.n = 0;
  }
  if (m.n >= LIMIT.perIsolate) return true;
  m.n++;
  return false;
}

export async function handle(request, env, now = new Date()) {
  if (request.method !== "POST") return reply({ error: "method" }, 405, { Allow: "POST" });
  const url = new URL(request.url);
  // 只给本站页面用:浏览器发 POST 一定带 Origin
  if (request.headers.get("Origin") !== url.origin) return reply({ error: "origin" }, 403);
  if (!/^application\/json\b/i.test(request.headers.get("Content-Type") || "")) return reply({ error: "type" }, 415);
  // 先看写明的长度:没写不收(页面发的这个请求一定带),超了不收;再按实际字节读,最多读 64 个(长度写得不对也读不多)
  const len = request.headers.get("Content-Length");
  if (!/^\d+$/.test(len || "")) return reply({ error: "length" }, 411);
  if (Number(len) > LIMIT.body) return reply({ error: "big" }, 413);
  const text = await readSmall(request, LIMIT.body);
  if (text === null) return reply({ error: "big" }, 413);
  let q;
  try {
    q = JSON.parse(text);
  } catch { /* 下面按格式不对处理 */ }
  // 只认一模一样的形状:一个对象,只有 k 一个键,值是认识的种类(多带一个字段也不收)
  if (!q || typeof q !== "object" || Array.isArray(q) || Object.keys(q).join() !== "k" || !HIT_KINDS.includes(q.k)) return reply({ error: "bad" }, 400);
  const db = env.OPS;
  if (!db) return reply({ need: "db" }, 503);
  const day = bjDay(now);
  if (overCap(day)) return reply({ error: "day" }, 429);
  try {
    await ensure(db);
    const r = await db.prepare("INSERT INTO hits (day, kind, n) VALUES (?, ?, 1) ON CONFLICT(day, kind) DO UPDATE SET n = hits.n + 1 WHERE hits.n < ?").bind(day, q.k, LIMIT.perDay).run();
    if (!(r.meta && r.meta.changes === 1)) return reply({ error: "day" }, 429);
  } catch {
    return reply({ error: "db" }, 503);
  }
  return new Response(null, { status: 204, headers: HEADERS });
}

export const onRequest = ({ request, env }) => handle(request, env);
