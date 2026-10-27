// 静态站点生成:recipes/*/recipe.json → dist/。零依赖,只用 Node 自带模块。
// 用法:node scripts/build.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, copyFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { site } from "./site.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

// 版本号:页脚显示构建时的提交,谁都能去 GitHub 核对线上跑的是哪一版。工作区有没提交的改动就标出来,不冒充干净版本
function version() {
  try {
    const git = (...args) => execFileSync("git", args, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return { commit: git("rev-parse", "--short", "HEAD"), dirty: git("status", "--porcelain") !== "" };
  } catch {
    return null;
  }
}
const VER = version();

// ---------- 文字处理 ----------

import { zh as zhPunct } from "../src/js/lib/zh.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 配方里的轻量标记:**粗体**、`代码`、{{变量}}。其余一律转义,配方作者写不进 HTML。
function rich(text, vars = {}) {
  const parts = String(text).split(/(`[^`]*`|\{\{\w+\}\})/);
  // 先在「非代码、非变量」的片段上统一换标点(判断「挨着汉字」时把整句当上下文)
  const masked = parts.map((p) => (p.startsWith("`") || p.startsWith("{{") ? "\u0000".repeat(p.length) : p)).join("");
  const conv = zhPunct(masked);
  let pos = 0;
  return parts.map((p) => {
    const seg = conv.slice(pos, pos + p.length);
    pos += p.length;
    if (p.startsWith("`")) return `<code>${esc(p.slice(1, -1))}</code>`;
    if (p.startsWith("{{")) {
      const k = p.slice(2, -2);
      if (!(k in vars)) throw new Error(`未定义的变量 {{${k}}}`);
      return `<span class="var" data-var="${k}">${esc(vars[k])}</span>`;
    }
    return esc(seg).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  }).join("");
}

// 图片说明里的 ①②③ / ! / ✗ 标成彩色
const marks = (html) => html
  .replace(/([①②③④⑤⑥⑦⑧⑨])/g, '<i class="n">$1</i>')
  .replace(/(^|\s)!(?=\s)/g, '$1<i class="n info">!</i>')
  .replace(/(^|\s)✗(?=\s)/g, '$1<i class="n bad">✗</i>');

// ---------- 页面框架 ----------

const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="currentColor"/><path d="M9 8h9v4h-5v8h5v4H9z" fill="#fff"/><path d="M17 16h8m-3-3.5L25.5 16 22 19.5" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function page({ title, desc, body, script, path = "/" }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="#0b7a4b">
<meta name="dx-contact" content="${esc(site.contact || "")}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="canonical" href="https://${esc(site.domain)}${esc(path)}">
<link rel="stylesheet" href="/assets/site.css">
${script ? `<script type="module" src="/assets/js/${script}"></script>` : ""}
</head>
<body>
<header class="top"><a class="brand" href="/">${LOGO}<span>${esc(site.name)}</span><small>${esc(site.nameZh)}</small></a></header>
<main>${body}</main>
<footer class="foot">
  <p><b>官方网站只有 ${esc(site.domain)}</b>${zhPunct("。我们不收私钥和助记词,不代签,从不先私信你。")}</p>
  <p>开源 · MIT · <a href="${esc(site.github)}" rel="noopener">GitHub</a> · ${zhPunct("本站只读,不连接钱包;我们不存任何数据")}</p>
  ${VER ? `<p class="fine">版本 <a href="${esc(site.github)}/commit/${esc(VER.commit)}" rel="noopener">${esc(VER.commit)}</a>${VER.dirty ? zhPunct("(含未提交的改动,不是正式版本)") : ""}</p>` : ""}
  <p class="fine">${zhPunct("本站内容不构成投资建议。操作前请对照官方页面和核对卡,自己确认每一步。")}</p>
</footer>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
</body>
</html>`;
}

// ---------- 首页 ----------

function home(recipes) {
  const list = recipes.map((r) => `<li data-id="${esc(r.id)}" data-detector="${esc(r.detector)}" data-protocol="${esc(r.protocol)}" data-route="${esc(r.route)}"><b>${esc(r.protocol)}</b><span>${rich(r.summary)}</span></li>`).join("");
  return page({
    title: `${site.name} · ${site.nameZh}:链上资产体检`,
    desc: "粘贴钱包地址,免费体检遗忘在链上的资产;查到了,给你一步一图的官方取回路线。只读,不用连钱包,不碰私钥。",
    script: "home.js",
    body: `
<section class="hero">
  <h1>${zhPunct("你的钱包里,有没有被遗忘在链上的钱?")}</h1>
  <p>${zhPunct("粘贴钱包地址,免费体检。查到了,就给你一步一图的官方路线,你在自己钱包里签名,钱直接回到你的地址。")}</p>
  <form id="scan" class="scan" autocomplete="off">
    <label for="addr">钱包地址</label>
    <div class="row"><input id="addr" name="addr" inputmode="text" spellcheck="false" placeholder="0x 开头的 42 位地址"><button type="submit">开始体检</button></div>
    <p class="hint">${zhPunct("只要地址,不用连钱包。地址只从你的浏览器直接发给协议的官方公开接口(目前是 Hyperliquid),不经过我们;这些接口能看到你的地址和 IP。")}</p>
  </form>
  <div id="results" class="results" hidden></div>
</section>
<section class="card">
  <h2>目前能查的</h2>
  <ul class="supported" id="supported">${list}</ul>
  <p class="sub">${zhPunct("更多协议陆续加入。先做被问得最多的。")}</p>
</section>
<section class="card promise">
  <h2>我们的承诺</h2>
  <ul>
    <li><b>只读</b>${zhPunct(":体检只要地址,本站不连接钱包,也没有任何签名请求。")}</li>
    <li><b>不碰私钥</b>${zhPunct(":任何人向你要私钥或助记词,都是骗子,包括冒充我们的人。")}</li>
    <li><b>你自己签</b>${zhPunct(":每一步都在官方网站上,由你自己的钱包签名。签名前,有核对卡告诉你弹窗里应该看到什么。")}</li>
    <li><b>开源免费</b>${zhPunct(":代码和每份指南都公开,谁都能查;不收任何费用。")}</li>
    <li><b>不先私信</b>${zhPunct(":我们从不主动私信任何人。")}</li>
  </ul>
</section>
<section class="card how">
  <h2>怎么用</h2>
  <ol>
    <li>${zhPunct("粘贴地址,体检看有没有能取回的仓位。")}</li>
    <li>${zhPunct("打开对应的指南,按你的账户算好的数字,一页一步做。")}</li>
    <li>${zhPunct("每次签名先对照核对卡;最后按到账核对确认钱到了。")}</li>
  </ol>
</section>`,
  });
}

// ---------- 指南页 ----------

function guide(r) {
  const V = r.vars;
  const facts = r.facts.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${rich(v, V)}</dd></div>`).join("");
  const site_ = (o) => `<div class="official"><span>${esc(o.label)}</span><b>${esc(o.domain)}</b><button class="copy" data-copy="${esc(o.url)}">复制网址</button></div>`;
  const official = r.official.map(site_).join("");
  const support = r.support ? `${site_(r.support)}<p class="sub">${rich(r.support.note, V)}</p>` : "";
  const literal = new Set(r.literalVars || []);
  const steps = r.steps.map((s, i) => {
    const imgs = (s.images || []).map((im) => `<figure><img src="img/${esc(im.src)}" alt="" loading="lazy" decoding="async"><figcaption>${marks(rich(im.caption, V))}</figcaption></figure>`).join("");
    const items = s.items ? `<ul class="items">${s.items.map((t) => `<li>${rich(t, V)}</li>`).join("")}</ul>` : "";
    // 带 {{变量}} 的复制按钮:要等用户填了地址、算出自己的数才显示(默认值本身就能用的变量除外,比如保底价)
    const needsAddr = (c) => [...c.matchAll(/\{\{(\w+)\}\}/g)].some((m) => !literal.has(m[1]));
    const copy = s.copy ? `<div class="copies">${s.copy.map((c) => `<button class="copy${needsAddr(c) ? " needs-addr" : ""}" data-copy-var="${esc(c)}">复制 ${rich(c, V)}</button>`).join("")}</div>` : "";
    // 卡住时:现场诊断(浏览器里实时查,guide.js 填)+ 常见情况(审过的答案,不用 JS 也能展开)+ 官方支持 + 卡点报告
    const sits = (s.situations || []).map((x) => `<details class="sit${x.stop ? " stop" : ""}" data-sit="${esc(x.id)}"><summary>${rich(x.see, V)}</summary><p>${rich(x.do, V)}</p></details>`).join("");
    const help = `<div class="help" hidden>
    <div class="diag" aria-live="polite"></div>
    ${sits ? `<h5>选一个最像你的情况</h5><div class="sits">${sits}</div>` : ""}
    <div class="fallback"><p><b>${zhPunct("都不是:先停下,别签任何东西。")}</b></p>${support}<button class="report" type="button">${zhPunct("复制卡点报告(不含地址)")}</button></div>
  </div>`;
    const ck = s.check ? `<div class="check${s.check.kind === "arrive" ? " arrive" : ""}"><h4>${rich(s.check.title, V)}</h4><dl>${s.check.rows.map(([k, v]) => `<div><dt>${rich(k, V)}</dt><dd>${rich(v, V)}</dd></div>`).join("")}</dl>${s.check.foot ? `<p>${rich(s.check.foot, V)}</p>` : ""}</div>` : "";
    return `<section class="step" data-step="${i}" data-id="${esc(s.id)}"${s.when ? ` data-when="${esc(s.when)}"` : ""}>
  <header><span class="num">${i + 1}</span><h3>${rich(s.title, V)}${s.note ? `<small>${rich(s.note, V)}</small>` : ""}</h3></header>
  ${s.whenText ? `<p class="when">${rich(s.whenText, V)}</p>` : ""}
  ${items}${imgs}${copy}${ck}
  <button class="stuck" type="button" aria-expanded="false">我卡在这一步</button>
  ${help}
</section>`;
  }).join("\n");
  const pro = `<div class="pro-card">${r.pro.map((t) => `<p>${rich(t, V)}</p>`).join("")}</div>`;
  const sources = r.sources.map((s) => `<li><a href="${esc(s.url)}" rel="noopener nofollow">${esc(s.label)}</a></li>`).join("");
  return page({
    title: `${r.title} · ${site.name}`,
    desc: r.summary,
    script: "guide.js",
    path: `/r/${r.id}/`,
    body: `
<article class="guide" data-recipe="${esc(r.id)}" data-detector="${esc(r.detector)}" data-title="${esc(r.title)}">
  <a class="back" href="/">← 体检首页</a>
  <h1>${esc(r.title)}</h1>
  <p class="lead">${rich(r.summary, V)}</p>
  <dl class="facts">${facts}</dl>
  ${official}
  <form id="me" class="me" autocomplete="off">
    <label for="addr">${zhPunct("填你的地址,下面的数字和步骤会按你的账户算好(可不填)")}</label>
    <div class="row"><input id="addr" name="addr" spellcheck="false" placeholder="0x 开头的 42 位地址"><button type="submit">按我的账户算</button></div>
  </form>
  <div id="mine" class="mine" hidden></div>
  <div class="tabs" role="tablist">
    <button role="tab" aria-selected="true" data-mode="novice">新手版 · 一页一步</button>
    <button role="tab" aria-selected="false" data-mode="pro">老司机版 · 一张卡</button>
  </div>
  <div class="mode" data-mode="novice">
    <div class="steps" id="steps">${steps}</div>
    <nav class="pager" id="pager" hidden><button data-go="-1">上一步</button><span id="pos"></span><button data-go="1">下一步</button></nav>
  </div>
  <div class="mode" data-mode="pro" hidden>${pro}</div>
  <section class="meta">
    <p>${zhPunct(`最后核验:${r.lastVerified}。${r.verified}`)}</p>
    <h4>依据</h4><ul>${sources}</ul>
  </section>
</article>`,
  });
}

// ---------- 安全响应头(Cloudflare Pages 读 _headers;本地预览也用同一份) ----------

export function headers(connect) {
  return {
    "Content-Security-Policy": [
      "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", "font-src 'self'",
      `connect-src 'self' ${connect.join(" ")}`, "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), clipboard-read=()",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
    // 只走 HTTPS(一年);稳定后再考虑加 preload 提交到浏览器内置名单
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  };
}

// ---------- 主流程 ----------

function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const f of readdirSync(src)) {
    const s = join(src, f), d = join(dst, f);
    if (statSync(s).isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}

function loadRecipes() {
  const dir = join(ROOT, "recipes");
  return readdirSync(dir).filter((d) => existsSync(join(dir, d, "recipe.json"))).map((d) => {
    const r = JSON.parse(readFileSync(join(dir, d, "recipe.json"), "utf8"));
    if (r.id !== d) throw new Error(`配方目录名 ${d} 和 id ${r.id} 不一致`);
    for (const s of r.steps) {
      for (const im of s.images || []) {
        if (!existsSync(join(dir, d, "img", im.src))) throw new Error(`${d}: 缺图片 ${im.src}`);
      }
      const ids = new Set();
      for (const x of s.situations || []) {
        if (!x.id || !x.see || !x.do) throw new Error(`${d}/${s.id}: 常见情况缺 id、see 或 do`);
        if (ids.has(x.id)) throw new Error(`${d}/${s.id}: 常见情况 id 重复 ${x.id}`);
        ids.add(x.id);
      }
    }
    return r;
  });
}

export function build() {
  const recipes = loadRecipes();
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(join(DIST, "assets"), { recursive: true });
  copyDir(join(ROOT, "src"), join(DIST, "assets"));
  copyFileSync(join(ROOT, "static", "favicon.svg"), join(DIST, "favicon.svg"));
  writeFileSync(join(DIST, "index.html"), home(recipes));
  for (const r of recipes) {
    const out = join(DIST, "r", r.id);
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, "index.html"), guide(r));
    copyDir(join(ROOT, "recipes", r.id, "img"), join(out, "img"));
  }
  writeFileSync(join(DIST, "404.html"), page({ title: `找不到页面 · ${site.name}`, desc: "", body: `<section class="card"><h1>找不到这个页面</h1><p><a href="/">回到体检首页</a></p></section>` }));
  const h = headers(site.connect);
  writeFileSync(join(DIST, "_headers"), "/*\n" + Object.entries(h).map(([k, v]) => `  ${k}: ${v}`).join("\n") + "\n");
  writeFileSync(join(DIST, "robots.txt"), "User-agent: *\nAllow: /\n");
  console.log(`built ${recipes.length} recipe(s) → dist/`);
}

// 直接运行时才构建(被 serve.mjs 引用时不构建)
const same = (a, b) => a && b && a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
if (same(fileURLToPath(import.meta.url), process.argv[1])) build();
