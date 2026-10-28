// 本地预览:把 dist/ 当静态站点服务,带上和线上一样的安全响应头。只监听 127.0.0.1。
// 用法:node scripts/serve.mjs [端口]
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { headers } from "./build.mjs";
import { site } from "./site.mjs";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const PORT = Number(process.argv[2] || 4321);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".woff2": "font/woff2", ".png": "image/png", ".json": "application/json", ".txt": "text/plain; charset=utf-8" };
const SEC = headers(site.connect);

createServer((req, res) => {
  let p = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
  let f = join(DIST, p);
  if (!f.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
  const ok = existsSync(f);
  if (!ok) f = join(DIST, "404.html");
  res.writeHead(ok ? 200 : 404, { "Content-Type": TYPES[extname(f)] || "application/octet-stream", ...SEC });
  res.end(readFileSync(f));
}).listen(PORT, "127.0.0.1", () => console.log(`http://127.0.0.1:${PORT}/`));
