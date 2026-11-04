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
import { handle as assets } from "../functions/api/assets.js";
import { handle as adminApi } from "../functions/api/admin/[[path]].js";
import { serve as adminPage } from "../functions/admin/[[path]].js";

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
  ASSETS: { fetch: async (u) => { const r = file(new URL(typeof u === "string" || u instanceof URL ? u : u.url).pathname); return new Response(r.body ?? null, { status: r.status, headers: { "Content-Type": r.type || "text/plain" } }); } },
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

// /api/assets 用假 Zerion:DX_FAKE_ZERION=ok(编的数据,test/fixtures/zerion-positions.json)/ empty / busy / error;不设就当没配密钥(off)
const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "..", "test", "fixtures", "zerion-positions.json");
async function fakeZerion() {
  const mode = process.env.DX_FAKE_ZERION;
  await new Promise((r) => setTimeout(r, 600));
  if (mode === "busy") return new Response("{}", { status: 429 });
  if (mode === "error") return new Response("{}", { status: 500 });
  return new Response(mode === "empty" ? '{"data":[]}' : readFileSync(FIXTURE), { status: 200, headers: { "Content-Type": "application/json" } });
}

let OPS_ENV = null;
async function opsEnv() {
  if (!OPS_ENV) {
    const { LocalD1 } = await import("./d1-local.mjs");
    OPS_ENV = { OPS: new LocalD1(process.env.DX_OPS_DB || ":memory:"), ADMIN_HOSTS: "localhost,127.0.0.1", OPS_ENV: "local", INGEST_PUBKEYS: process.env.DX_INGEST_PUB || "", TASK_PUBKEYS: process.env.DX_TASK_PUB || "", SETUP_CODE: process.env.DX_SETUP_CODE || "", ASSETS: fakeEnv.ASSETS };
  }
  return OPS_ENV;
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/api/assets") {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks);
    const r = await assets(new Request(url, { method: req.method, headers: req.headers, body }), { ZERION_API_KEY: process.env.DX_FAKE_ZERION ? "fake" : "" }, fakeZerion);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
  // 运营台:本地用 Node 自带的 SQLite 当 D1(DX_OPS_DB 写文件路径,不写就只在内存里);用 http://localhost:端口/admin/ 打开
  // (登录凭证带 Secure,浏览器只在 localhost 上肯存)。设置码、投递公钥从环境变量来:DX_SETUP_CODE、DX_INGEST_PUB
  if (url.pathname === "/admin" || url.pathname.startsWith("/admin/") || url.pathname.startsWith("/api/admin/")) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = ["GET", "HEAD"].includes(req.method) ? undefined : Buffer.concat(chunks);
    const request = new Request(new URL(req.url, `http://${req.headers.host || "localhost:" + PORT}`), { method: req.method, headers: req.headers, body });
    const r = url.pathname.startsWith("/api/") ? await adminApi(request, await opsEnv()) : await adminPage(request, await opsEnv());
    const h = Object.fromEntries(r.headers);
    res.writeHead(r.status, h);
    return res.end(Buffer.from(await r.arrayBuffer()));
  }
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
