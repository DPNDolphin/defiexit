// 运营台网页(路径 /admin、/admin/*):只在 admin 主机上发,别的主机 404。只发下面这几个固定文件,别的路径一律 404。
// 网页本身由 Pages 的静态文件提供(dist/admin/),这里经 env.ASSETS 取出来,换上运营台自己的安全头(只许连本站、不缓存)。

import { hostOk, gone, PAGE_HEADERS } from "../../server/ops/http.js";

export const FILES = {
  "/admin/": "/admin/",
  "/admin/admin.js": "/admin/admin.js",
  "/admin/pace.js": "/admin/pace.js",
  "/admin/admin.css": "/admin/admin.css",
  "/admin/favicon.svg": "/admin/favicon.svg",
  "/admin/fonts/atkinson-next.woff2": "/admin/fonts/atkinson-next.woff2",
  "/admin/fonts/atkinson-mono.woff2": "/admin/fonts/atkinson-mono.woff2",
  "/admin/fonts/barlow-sc-800.woff2": "/admin/fonts/barlow-sc-800.woff2",
};
const TYPES = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

export async function serve(request, env) {
  if (!hostOk(request, env)) return gone();
  const url = new URL(request.url);
  if (url.pathname === "/admin") return new Response(null, { status: 301, headers: { Location: "/admin/", "Cache-Control": "no-store" } });
  const file = FILES[url.pathname];
  if (!file || !["GET", "HEAD"].includes(request.method)) return gone();
  const res = await env.ASSETS.fetch(new Request(new URL(file, url.origin), { method: "GET" }));
  if (!res.ok) return gone();
  const headers = new Headers(PAGE_HEADERS);
  const ext = file.match(/\.[a-z0-9]+$/)?.[0];
  headers.set("Content-Type", TYPES[ext] || "text/html; charset=utf-8");
  return new Response(request.method === "HEAD" ? null : res.body, { status: 200, headers });
}

export const onRequest = ({ request, env }) => serve(request, env);
