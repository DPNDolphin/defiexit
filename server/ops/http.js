// 运营台服务端的公共小件:回复格式、主机名门禁、同源检查、读请求体。
// 运营台只在 admin 主机上开:正式环境 admin.defiexit.com,预览环境 *.defiexit.pages.dev(wrangler.toml 里分环境写 ADMIN_HOSTS)。
// 主机名不对一律当作不存在(404),主站 defiexit.com 上看不到后台。

export const HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
};

// 运营台网页本身的安全头:比主站更紧,只许连本站接口
export const PAGE_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", "font-src 'self'",
    "connect-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
  ].join("; "),
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow",
  "Cache-Control": "no-store",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

export const reply = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { ...HEADERS, ...extra } });
export const gone = () => new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });

// ADMIN_HOSTS:逗号分隔;"*.example.com" 只配子域名,不配 example.com 本身。没配就谁都不认(宁可打不开)
export function hostOk(request, env) {
  const host = new URL(request.url).hostname.toLowerCase();
  const allow = String(env?.ADMIN_HOSTS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return allow.some((a) => (a.startsWith("*.") ? host.endsWith(a.slice(1)) && host.length > a.length - 1 : host === a));
}

// 改东西的请求必须来自运营台自己的页面:浏览器会带 Origin,和本站对不上就拒绝(配合 SameSite=Strict 的登录凭证)
export function sameOrigin(request) {
  const o = request.headers.get("Origin");
  return !!o && o === new URL(request.url).origin;
}

export async function readJson(request, max = 64 * 1024) {
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > max) return { error: "big" };
  const text = await request.text();
  if (text.length > max) return { error: "big" };
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? { value: v, text } : { error: "bad" };
  } catch {
    return { error: "bad" };
  }
}

export const clientIp = (request) => request.headers.get("CF-Connecting-IP") || "unknown";
