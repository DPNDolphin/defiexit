// 本地预览:把 dist/ 当静态站点服务,带上和线上一样的安全响应头。只监听 127.0.0.1。
// 用法:node scripts/serve.mjs [端口]
// /api/see(截图求助)跑的是真的 functions/api/see.js,只是 AI 换成本地假的:不连 Cloudflare、不花额度。
// 假 AI 回什么由环境变量 DX_FAKE_AI 定:页面编号(如 stake)/ none / secret / quota(额度用完)/ slow(超时),默认 none。
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { headers } from "./build.mjs";
import { site } from "./site.mjs";
import { onRequest as see } from "../functions/api/see.js";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const PORT = Number(process.argv[2] || 4321);
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml", ".webp": "image/webp", ".woff2": "font/woff2", ".png": "image/png", ".json": "application/json", ".txt": "text/plain; charset=utf-8" };
const SEC = headers(site.connect, site);

// 静态文件;/api/see 里的 env.ASSETS.fetch 也走这里
function file(pathname) {
  const p = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
  let f = join(DIST, p);
  if (!f.startsWith(DIST)) return { status: 403 };
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, "index.html");
  const ok = existsSync(f);
  if (!ok) f = join(DIST, "404.html");
  return { status: ok ? 200 : 404, type: TYPES[extname(f)] || "application/octet-stream", body: readFileSync(f) };
}

const fakeEnv = {
  ASSETS: { fetch: async (u) => { const r = file(new URL(u).pathname); return new Response(r.body ?? null, { status: r.status, headers: { "Content-Type": r.type || "text/plain" } }); } },
  AI: {
    run: async () => {
      const mode = process.env.DX_FAKE_AI || "none";
      await new Promise((r) => setTimeout(r, mode === "slow" ? 60000 : 800));
      if (mode === "quota") throw new Error("4006: you have used up your daily free allocation of 10,000 neurons");
      return { choices: [{ message: { content: JSON.stringify({ screen: mode }) } }] };
    },
  },
  SEE_TIMEOUT_MS: process.env.DX_FAKE_TIMEOUT_MS || "",
};

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/api/see") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks);
    const r = await see({ request: new Request(url, { method: req.method, headers: req.headers, body }), env: fakeEnv });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  const r = file(url.pathname);
  if (r.status === 403) { res.writeHead(403); return res.end(); }
  res.writeHead(r.status, { "Content-Type": r.type, ...SEC });
  res.end(r.body);
}).listen(PORT, "127.0.0.1", () => console.log(`http://127.0.0.1:${PORT}/  (/api/see 用假 AI:${process.env.DX_FAKE_AI || "none"})`));
