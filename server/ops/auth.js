// 运营台登录:只有一个管理员。密码用 PBKDF2-SHA256 + 随机盐;登录凭证是随机 32 字节,浏览器里放在只给本主机的 cookie,
// 库里只存它的 SHA-256。输错按 IP 递增等待,最多 1 小时(不会把管理员永久锁在外面)。
// 迭代次数受 Cloudflare 免费计划每次请求 10ms CPU 的限制(本机实测 2 万次约 6ms),所以密码至少 20 位、要手机密码管理器随机生成,靠强密码兜底。

import { iso } from "./db.js";

export const ITER = 20000;
export const MIN_PASSWORD = 20;
export const SESSION_DAYS = 30; // 最长 30 天
export const IDLE_DAYS = 7; // 7 天没打开就要重新登录
// __Host- 开头:浏览器只认 Secure、Path=/、不带 Domain 的写法,别的子域名写不进、读不到
export const COOKIE = "__Host-dx_ops";
const enc = new TextEncoder();

export const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function unb64u(s) {
  const t = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "===".slice((t.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export const sha256 = async (s) => b64u(await crypto.subtle.digest("SHA-256", typeof s === "string" ? enc.encode(s) : s));

// 等长逐字节比较,不因为前几位对上就提前返回
export function same(a, b) {
  const x = enc.encode(String(a)), y = enc.encode(String(b));
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] || 0) ^ (y[i] || 0);
  return d === 0;
}

export async function hashPassword(password, salt = b64u(crypto.getRandomValues(new Uint8Array(16))), iter = ITER) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: unb64u(salt), iterations: iter }, key, 256);
  return { salt, hash: b64u(bits), iter };
}
export async function checkPassword(password, row) {
  const { hash } = await hashPassword(password, row.salt, row.iter);
  return same(hash, row.hash);
}

export const cookie = (token, maxAge) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
export function readCookie(request) {
  const m = (request.headers.get("Cookie") || "").match(new RegExp(`(?:^|;\\s*)${COOKIE}=([A-Za-z0-9_-]{20,100})`));
  return m ? m[1] : null;
}

export async function newSession(db, now) {
  const token = b64u(crypto.getRandomValues(new Uint8Array(32)));
  await db.prepare("INSERT INTO sessions (h, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?)").bind(await sha256(token), iso(now), iso(+now + SESSION_DAYS * 864e5), iso(now)).run();
  return cookie(token, SESSION_DAYS * 86400);
}
// 每个请求都查库:过期、闲置太久都算没登录;闲置时间最多一小时记一次,少写库
export async function hasSession(db, request, now) {
  const t = readCookie(request);
  if (!t) return false;
  const h = await sha256(t);
  const r = await db.prepare("SELECT expires_at, last_seen FROM sessions WHERE h = ?").bind(h).first();
  if (!r || r.expires_at <= iso(now) || r.last_seen <= iso(+now - IDLE_DAYS * 864e5)) return false;
  if (r.last_seen <= iso(+now - 3600e3)) await db.prepare("UPDATE sessions SET last_seen = ? WHERE h = ?").bind(iso(now), h).run();
  return true;
}
export async function endSession(db, request) {
  const t = readCookie(request);
  if (t) await db.prepare("DELETE FROM sessions WHERE h = ?").bind(await sha256(t)).run();
  return cookie("", 0);
}
export const endAll = (db) => db.prepare("DELETE FROM sessions").run();

// ---------- 输错等待 ----------
// 只按 IP 算:前 2 次不等,之后 5 秒、10 秒……翻倍,最多 1 小时。不设全局计数:那样别人每分钟错一次就能一直把管理员挡在外面;
// 密码至少 16 位、手机生成,分散到很多 IP 硬猜也猜不到。等待期间的请求不验密码、不加次数。
const CAP = 3600;
export const waitFor = (n) => (n < 3 ? 0 : Math.min(CAP, 2 ** (n - 3) * 5));
const ipKey = async (ip) => "ip:" + (await sha256(ip)).slice(0, 16);

export async function mustWait(db, ip, now) {
  const r = await db.prepare("SELECT until FROM fails WHERE k = ?").bind(await ipKey(ip)).first();
  return r && r.until > iso(now) ? Math.ceil((Date.parse(r.until) - +now) / 1000) : 0;
}
// 同一时刻错很多次也要累加:计数在库里原子加一,等待时间只往后推,不会被晚到的那次改短
export async function failed(db, ip, now) {
  const k = await ipKey(ip);
  const r = await db.prepare("INSERT INTO fails (k, n, until) VALUES (?, 1, ?) ON CONFLICT(k) DO UPDATE SET n = fails.n + 1 RETURNING n").bind(k, iso(now)).first();
  const n = r ? Number(r.n) : 1;
  await db.prepare("UPDATE fails SET until = MAX(until, ?) WHERE k = ?").bind(iso(+now + waitFor(n) * 1000), k).run();
}
export async function succeeded(db, ip) {
  await db.prepare("DELETE FROM fails WHERE k = ?").bind(await ipKey(ip)).run();
}
