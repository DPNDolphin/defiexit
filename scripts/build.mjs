// 静态站点生成:recipes/*/recipe.json(+ i18n/en.json)→ dist/,中文一套、英文一套(/en/)。零依赖,只用 Node 自带模块。
// 用法:node scripts/build.mjs
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, copyFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { site } from "./site.mjs";
import { zh as zhPunct } from "../src/js/lib/zh.js";
import { makeT } from "../src/js/lib/i18n.js";
import { svgString as ico } from "../src/js/lib/icons.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const LANGS = ["zh", "en"];
const HTML_LANG = { zh: "zh-CN", en: "en" };
const pre = (lang) => (lang === "en" ? "/en" : "");

// 版本号:页脚显示构建时的提交,谁都能去 GitHub 核对线上跑的是哪一版。会进网站的那几个目录有没提交的改动,就标出来,不冒充干净版本
// (只看这几个目录和文件:Cloudflare 构建时会在根目录自己生成 package-lock.json,不影响网站内容)
function version() {
  try {
    const git = (...args) => execFileSync("git", args, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    return { commit: git("rev-parse", "--short", "HEAD"), dirty: git("status", "--porcelain", "--", "src", "recipes", "scripts", "static", "functions", "wrangler.toml") !== "" };
  } catch {
    return null;
  }
}
const VER = version();

// ---------- 文字处理 ----------

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const punct = (s, lang) => (lang === "zh" ? zhPunct(s) : String(s));

// 配方和界面文字里的轻量标记:**粗体**、`代码`、{{变量}}。其余一律转义,写不进 HTML。
function rich(text, vars = {}, lang = "zh") {
  const parts = String(text).split(/(`[^`]*`|\{\{\w+\}\})/);
  // 先在「非代码、非变量」的片段上统一换标点(判断「挨着汉字」时把整句当上下文)
  const masked = parts.map((p) => (p.startsWith("`") || p.startsWith("{{") ? "\u0000".repeat(p.length) : p)).join("");
  const conv = punct(masked, lang);
  let pos = 0;
  return parts.map((p) => {
    const seg = conv.slice(pos, pos + p.length);
    pos += p.length;
    if (p.startsWith("`")) return `<code>${esc(p.slice(1, -1))}</code>`;
    if (p.startsWith("{{")) {
      const k = p.slice(2, -2);
      if (!(k in vars)) throw new Error(`未定义的变量 {{${k}}}`);
      return `<span class="var" data-var="${k}">${esc(punct(vars[k], lang))}</span>`;
    }
    return esc(seg).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
  }).join("");
}
// 纯文字(给 data-*、aria-label、placeholder 用):去掉 ** 标记,换好标点
const plain = (s, lang) => esc(punct(String(s).replace(/\*\*/g, ""), lang));

// 截图说明:「! 提示 ① 点这里 ② 填那个 ✗ 别点这个」拆成一段一段
const CIRCLED = "①②③④⑤⑥⑦⑧⑨";
export function splitMarks(caption) {
  const out = [];
  const re = /(^|\s)(!|✗)\s+|([①②③④⑤⑥⑦⑧⑨])\s*/g;
  let last = 0, cur = { k: "plain" }, m;
  const push = (end) => {
    const text = caption.slice(last, end).trim();
    if (text) out.push({ ...cur, text });
  };
  while ((m = re.exec(caption))) {
    push(m.index);
    cur = m[3] ? { k: "n", n: CIRCLED.indexOf(m[3]) + 1 } : { k: m[2] === "!" ? "tip" : "bad" };
    last = re.lastIndex;
  }
  push(caption.length);
  return out;
}

// webp 的宽高(写进 <img>,图片没下载完也先占好位置,页面不跳)
function webpSize(file) {
  const b = readFileSync(file);
  const kind = b.toString("ascii", 12, 16);
  if (kind === "VP8X") return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
  if (kind === "VP8 ") return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
  if (kind === "VP8L") {
    const n = b.readUInt32LE(21);
    return { w: (n & 0x3fff) + 1, h: ((n >> 14) & 0x3fff) + 1 };
  }
  return null;
}

// ---------- 页面框架 ----------

const LOGO = `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect width="32" height="32" rx="8" fill="currentColor"/><path d="M17 8h7v16h-7" fill="none" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/><path d="M7 16h12M15 12l4 4-4 4" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function langSwitch(lang, path, tx) {
  const links = LANGS.map((l) => `<a href="${pre(l)}${path}" hreflang="${HTML_LANG[l]}" lang="${HTML_LANG[l]}" data-lang="${l}"${l === lang ? ' aria-current="page"' : ""}>${l === "zh" ? "中文" : "EN"}</a>`).join("");
  return `<nav class="langs" aria-label="${tx.attr("langNav")}">${links}</nav>`;
}
const themeBtn = (tx) => `<button class="iconbtn theme" type="button" data-theme-toggle aria-pressed="false" aria-label="${tx.attr("lightMode")}">${ico("sun", "i-sun")}${ico("moon", "i-moon")}</button>`;

// 每种语言一套取文字的小工具:t 取原文,h 取成 HTML,attr 取成属性值
function texts(lang) {
  const t = makeT(lang);
  return { lang, t, h: (k, ...a) => rich(t(k, ...a), {}, lang), attr: (k, ...a) => plain(t(k, ...a), lang) };
}

function page({ tx, kind, path, title, desc, body, script, header, noindex = false }) {
  const { lang } = tx;
  const url = (l) => `https://${site.domain}${pre(l)}${path}`;
  const alt = LANGS.map((l) => `<link rel="alternate" hreflang="${HTML_LANG[l]}" href="${esc(url(l))}">`).join("\n");
  const tools = kind === "home" || kind === "404";
  return `<!doctype html>
<html lang="${HTML_LANG[lang]}" data-page="${kind}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${noindex ? '<meta name="robots" content="noindex">\n' : ""}<meta name="theme-color" content="#0A0F1E">
<meta name="dx-contact" content="${esc(site.contact || "")}">${site.turnstile ? `\n<meta name="dx-turnstile" content="${esc(site.turnstile)}">` : ""}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="canonical" href="${esc(url(lang))}">
${alt}
<link rel="alternate" hreflang="x-default" href="${esc(url("zh"))}">
<link rel="preload" href="/assets/fonts/atkinson-next.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/barlow-sc-800.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/site.css">
<script src="/assets/js/boot.js"></script>
<script type="module" src="/assets/js/${script}"></script>
</head>
<body class="p-${kind}">
<a class="skip" href="#main">${tx.h("skip")}</a>
<header class="top">${header}</header>
<main id="main">${body}</main>
<footer class="foot"><div class="wrap">
  <p>${tx.h("footOfficial")}</p>
  <p>${tx.h("footOpen")} · <a href="${esc(site.github)}" rel="noopener">GitHub</a> · ${tx.h("footData")}</p>
  ${VER ? `<p class="fine">${tx.h("footVersion")} <a href="${esc(site.github)}/commit/${esc(VER.commit)}" rel="noopener">${esc(VER.commit)}</a>${VER.dirty ? tx.h("footDirty") : ""}</p>` : ""}
  <p class="fine">${tx.h("footFine")}</p>
  ${tools ? "" : `<div class="foot-tools">${langSwitch(lang, path, tx)}${themeBtn(tx)}</div>`}
</div></footer>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
</body>
</html>`;
}

// 首页和 404 的顶栏:品牌、(电脑上)导航、语言、深浅色
function brandBar(tx, path, nav = false) {
  const P = pre(tx.lang);
  const links = nav ? `<nav class="links" aria-label="DeFiExit"><a href="#how">${tx.h("navHow")}</a><a href="#safety">${tx.h("navSafety")}</a><a href="#supported">${tx.h("navSupported")}</a><a href="${esc(site.github)}" rel="noopener">GitHub</a></nav>` : "";
  return `<div class="wrap bar"><a class="brand" href="${P}/">${LOGO}<span><span class="name">${esc(site.name)}</span><span class="sub">${tx.h("brandSub")}</span></span></a>${links}<div class="tools">${langSwitch(tx.lang, path, tx)}${themeBtn(tx)}</div></div>`;
}

// 首页的路线:你的地址 → 三站 → 出口
function heroRoute(tx) {
  const seg = '<span class="seg dash"></span>';
  return `<div class="route hero-route" role="img" aria-label="${tx.attr("routeAria")}"><span class="from mono">${tx.h("routeFrom")}</span>${seg}<span class="node ring"></span>${seg}<span class="node ring"></span>${seg}<span class="exit-sign">${ico("exit")}EXIT</span></div>`;
}

// ---------- 首页 ----------

function home(tx, recipes) {
  // 核对卡样子:拿第一份配方的第一张签名核对卡,前两项画成已勾
  const demoR = recipes.find((r) => r.steps.some((s) => s.check?.confirm));
  const demo = demoR?.steps.find((s) => s.check?.confirm).check;
  const tick = (x, on) => `<div class="tick demo${on ? " on" : ""}"><span class="box">${ico("check")}</span><span class="tt"><b>${rich(x.title, demoR.vars, tx.lang).replace(/<span class="var"[^>]*>(.*?)<\/span>/g, "$1")}</b></span></div>`;
  // 「已实测」只给真按指南取回过一次的配方;还没实测的如实标出来
  const supported = recipes.map((r) => `<li><span><b>${esc(r.protocol)}</b><span>${rich(r.covers, {}, tx.lang)}</span></span>${r.tested === false ? `<span class="tag-wait">${ico("clock")}${tx.h("untested")}</span>` : `<span class="tag-ok">${ico("check")}${tx.h("tested")}</span>`}</li>`).join("");
  return page({
    tx, kind: "home", path: "/", script: "home.js",
    title: tx.t("homeTitle"), desc: tx.t("homeDesc"),
    header: brandBar(tx, "/", true),
    body: `
<section class="hero grid-bg">
  <div class="wrap hero-in">
    <div class="hero-text">
      <span class="badge"><span class="dot"></span>${tx.h("heroBadge")}</span>
      <h1 class="display">${tx.h("heroH1a")} <span class="hl">${tx.h("heroH1b")}</span></h1>
      <p class="lead">${tx.h("heroLead")}</p>
      ${heroRoute(tx)}
    </div>
    <form id="scan" class="card form scan" autocomplete="off" novalidate>
      <label for="addr">${tx.h("addrLabel")}</label>
      <input id="addr" name="addr" class="input mono" spellcheck="false" autocapitalize="off" autocorrect="off" placeholder="${tx.attr("addrPlaceholder")}" aria-describedby="addrHint">
      <p class="err" id="addrErr" role="alert" hidden></p>
      <button class="btn primary block" type="submit">${tx.h("checkFree")}${ico("arrowRight")}</button>
      <p class="hint" id="addrHint">${tx.h("addrHint")}</p>
      <p class="hint">${tx.h("scopeNow", recipes.map((r) => r.protocol).join(tx.lang === "en" ? ", " : "、"))}</p>
    </form>
    <ul class="feats">
      <li>${ico("eye")}<span>${tx.h("feat1")}</span></li>
      <li>${ico("unlink")}<span>${tx.h("feat2")}</span></li>
      <li>${ico("lock")}<span>${tx.h("feat3")}</span></li>
    </ul>
  </div>
</section>
<section class="sec" id="how">
  <div class="wrap">
    <h2>${tx.h("stepsH")}</h2>
    <ol class="tri">
      <li><span class="mk"><span class="num">1</span><span class="rail"></span></span><span class="tx"><h3>${tx.h("s1t")}</h3><p>${tx.h("s1d")}</p></span></li>
      <li><span class="mk"><span class="num">2</span><span class="rail"></span></span><span class="tx"><h3>${tx.h("s2t")}</h3><p>${tx.h("s2d")}</p></span></li>
      <li><span class="mk"><span class="num exit">${ico("exit")}</span></span><span class="tx"><h3>${tx.h("s3t")}</h3><p>${tx.h("s3d")}</p></span></li>
    </ol>
  </div>
</section>
${demo ? `<section class="sec showcase" id="safety">
  <div class="wrap two">
    <div class="card demo-card" aria-hidden="true">
      <p class="demo-h">${rich(demo.title, {}, tx.lang)}</p>
      ${demo.confirm.map((x, i) => tick(x, i < 2)).join("")}
      <p class="demo-no">${tx.h("cardDemoNo")}</p>
    </div>
    <div class="showcase-text">
      <h2>${tx.h("cardH")}</h2>
      <p>${tx.h("cardP1")}</p>
      <p>${tx.h("cardP2")}</p>
    </div>
  </div>
</section>` : ""}
<section class="sec" id="promise">
  <div class="wrap">
    <h2>${tx.h("promH")}</h2>
    <div class="promises">
      <div class="promise">${ico("shield")}<h3>${tx.h("p1t")}</h3><p>${tx.h("p1d")}</p></div>
      <div class="promise">${ico("pen")}<h3>${tx.h("p2t")}</h3><p>${tx.h("p2d")}</p></div>
      <div class="promise">${ico("tag")}<h3>${tx.h("p3t")}</h3><p>${tx.h("p3d")}</p></div>
      <div class="promise">${ico("nodm")}<h3>${tx.h("p4t")}</h3><p>${tx.h("p4d")}</p></div>
    </div>
  </div>
</section>
<section class="sec" id="supported">
  <div class="wrap">
    <h2>${tx.h("supH")}</h2>
    <ul class="supported">${supported}</ul>
    <p class="proof">${ico("check")}<span>${tx.h("supProof")}</span></p>
    <p class="sub">${tx.h("supMore")}</p>
  </div>
</section>
<div class="wrap"><p class="banner">${ico("alert")}<span>${tx.h("banner")}</span></p></div>`,
  });
}

// ---------- 检查结果页 ----------

function checkPage(tx, recipes) {
  const P = pre(tx.lang);
  const list = recipes.map((r) => {
    const milestones = r.steps.filter((s) => s.milestone).map((s) => ({ label: punct(s.milestone, tx.lang), when: s.when || null }));
    const chips = (r.chips || []).map((c) => ({ icon: c.icon, text: punct(c.text, tx.lang) }));
    return `<li data-id="${esc(r.id)}" data-detector="${esc(r.detector)}" data-protocol="${esc(r.protocol)}" data-route="${esc(r.route)}" data-chain="${esc(r.chain || "")}" data-milestones="${esc(JSON.stringify(milestones))}" data-chips="${esc(JSON.stringify(chips))}" data-zerion="${esc(JSON.stringify(r.zerion || null))}"></li>`;
  }).join("");
  return page({
    tx, kind: "check", path: "/check/", script: "check.js", noindex: true,
    title: `${tx.t("checkTitle")} · ${site.name}`, desc: tx.t("checkDesc"),
    header: `<div class="wrap narrow bar"><a class="iconbtn" href="${P}/" aria-label="${tx.attr("backHome")}">${ico("arrowLeft")}</a><span class="bar-title">${tx.h("checkTitle")}</span><span class="chip mono" id="addrChip" hidden></span></div>`,
    body: `
<div class="wrap narrow">
  <h1 class="sr-only">${tx.h("checkTitle")}</h1>
  <section class="sum" id="sum" aria-live="polite">
    <span class="badge" id="sumBadge"><span class="spin" aria-hidden="true"></span>${tx.h("checking")}</span>
    <p class="sub" id="sumLine"></p>
    <p class="big" id="sumBig" hidden></p>
    <p class="sub" id="sumNote" hidden></p>
  </section>
  <div id="cards" class="cards" aria-live="polite"></div>
  <p class="fine resfoot">${tx.h("resultsFoot")}</p>
  <ul id="recipes" hidden>${list}</ul>
  <dialog class="sheet" id="exitSheet" aria-labelledby="exitH">
    <div class="sheet-in">
      <span class="grip" aria-hidden="true"></span>
      <div class="sheet-head"><h2 id="exitH"></h2><button class="iconbtn" type="button" id="exitClose" aria-label="${tx.attr("close")}">${ico("x")}</button></div>
      <div class="exit" id="exitBody"></div>
    </div>
  </dialog>
</div>`,
  });
}

// ---------- 指南页 ----------

function guide(tx, R, shot) {
  const { lang } = tx;
  const P = pre(lang);
  const V = R.vars;
  const literal = new Set(R.literalVars || []);
  // 没填地址时变量显示的是说明文字(「你的 USDH 数量」),标成 ph,样式上和真数字区分开
  const r = (s) => rich(s, V, lang).replace(/<span class="var" data-var="(\w+)">/g, (m, k) => (literal.has(k) ? m : `<span class="var ph" data-var="${k}">`));
  // 带 {{变量}} 的复制按钮:要等用户填了地址、算出自己的数才显示(默认值本身就能用的变量除外,比如保底价)
  const needsAddr = (c) => [...c.matchAll(/\{\{(\w+)\}\}/g)].some((m) => !literal.has(m[1]));
  const copyBtn = (c) => `<button class="copy${needsAddr(c) ? " needs-addr" : ""}" type="button" data-copy-var="${esc(c)}">${ico("copy")}${tx.h("copy")}</button>`;
  // 配方里要用户复制的原文(网址这类):说明文字里一出现,整段就是复制按钮,点一下就复制
  const lit = new Set(R.steps.flatMap((s) => s.copy || []).filter((c) => !c.includes("{{")).map(esc));
  const rc = (s) => r(s).replace(/<code>([^<]*)<\/code>/g, (m, v) => (lit.has(v) ? `<button class="copy code-copy" type="button" data-copy="${v}" aria-label="${tx.attr("copy")} ${v}"><code>${v}</code>${ico("copy")}</button>` : m));
  const tipHtml = (k, text) => `<p class="tip${k === "bad" ? " bad" : ""}">${ico(k === "bad" ? "x" : "alert")}<span>${rc(text)}</span></p>`;
  const segsHtml = (segs, inline = () => "") => {
    let out = "", list = [];
    const flush = () => { if (list.length) out += `<ol class="marks">${list.join("")}</ol>`; list = []; };
    for (const g of segs) {
      if (g.k === "n") list.push(`<li value="${g.n}"><span class="n" aria-hidden="true">${g.n}</span><span class="t">${rc(g.text)}</span>${inline(g.text)}</li>`);
      else {
        flush();
        out += g.k === "plain" ? `<p class="cap">${rc(g.text)}</p>` : tipHtml(g.k, g.text);
      }
    }
    flush();
    return out;
  };
  const shotHtml = (im, inline) => {
    const size = webpSize(join(ROOT, "recipes", R.id, "img", im.src));
    const wh = size ? ` width="${size.w}" height="${size.h}"` : "";
    return `<div class="shot"><figure><img src="/r/${esc(R.id)}/img/${esc(im.src)}" alt="${tx.attr("shotAlt")}"${wh} loading="lazy" decoding="async"></figure>${segsHtml(splitMarks(im.caption), inline)}</div>`;
  };

  const steps = R.steps.map((s) => {
    const copyLeft = new Set(s.copy || []);
    // 说明里出现了要复制的 {{变量}},复制按钮就放在那一行后面
    const inlineCopies = (text) => {
      const vs = [...text.matchAll(/\{\{(\w+)\}\}/g)].map((m) => `{{${m[1]}}}`).filter((c) => copyLeft.has(c));
      vs.forEach((c) => copyLeft.delete(c));
      return vs.map(copyBtn).join("");
    };
    const items = (s.items || []).map((x) => {
      const m = /^(!|✗)\s+/.exec(x);
      return m ? { tip: m[1] === "!" ? "tip" : "bad", text: x.slice(m[0].length) } : { text: x };
    });
    const bullets = items.filter((x) => !x.tip);
    const tips = items.filter((x) => x.tip);
    const itemsHtml = (bullets.length ? `<ul class="items">${bullets.map((x) => `<li>${rc(x.text)}</li>`).join("")}</ul>` : "") + tips.map((x) => tipHtml(x.tip, x.text)).join("");
    const shots = (s.images || []).map((im) => shotHtml(im, inlineCopies)).join("");
    const copyRows = [...copyLeft].map((c) => `<div class="copyrow"><span class="mono">${r(c)}</span>${copyBtn(c)}</div>`).join("");
    // 配方里 images 写在 items 前面,页面上就先图后字(比如「填卖单」的提醒放在截图说明后面)
    const keys = Object.keys(s);
    const content = s.images && s.items && keys.indexOf("images") < keys.indexOf("items") ? shots + itemsHtml : itemsHtml + shots;
    const c = s.check;
    let check = "";
    if (c?.kind === "arrive") {
      check = `<section class="card arrive"><h3>${r(c.title)}</h3><dl>${c.rows.map(([k, v]) => `<div><dt>${r(k)}</dt><dd>${r(v)}</dd></div>`).join("")}</dl>${c.foot ? `<p class="sub">${r(c.foot)}</p>` : ""}</section>`;
    } else if (c) {
      check = `<section class="check" aria-labelledby="ck-${esc(s.id)}">
    <div class="check-head"><span class="ic">${ico("shield")}</span><h3 id="ck-${esc(s.id)}">${r(c.title)}</h3></div>
    <p class="sub">${r(c.lead)}</p>
    <div class="ticks">${c.confirm.map((x, k) => `<button class="tick" type="button" data-k="${k}" aria-pressed="false"><span class="box">${ico("check")}</span><span class="tt"><b>${r(x.title)}</b><span>${r(x.sub)}</span></span></button>`).join("")}</div>
    <div class="reject"><p>${tx.h("rejectH")}</p><ul>${c.reject.map((x) => `<li>${ico("x")}<span>${r(x)}</span></li>`).join("")}</ul></div>
    ${c.normal?.length ? `<details class="normal"><summary>${tx.h("normalH")}</summary><ul>${c.normal.map((x) => `<li>${r(x)}</li>`).join("")}</ul></details>` : ""}
    <button class="link-stop" type="button" data-open-sheet>${tx.h("checkStop")}</button>
    ${c.skip ? `<button class="link-skip" type="button" data-skip>${r(c.skip)}</button>` : ""}
  </section>`;
    }
    // 常见情况(审过的答案):平时藏着,点「遇到问题」时挪进底部弹层
    const sits = (s.situations || []).map((x) => `<details class="sit${x.stop ? " stop" : ""}" data-sit="${esc(x.id)}"><summary>${r(x.see)}</summary><p>${rc(x.do)}</p></details>`).join("");
    // 岔路:用户可能停在别的页面(比如 WOOFi 的 K 线交易页),先点这几下回到这一步的起点。默认收起,小图对照着认
    const dt = s.detour;
    const thumbSize = dt && webpSize(join(ROOT, "recipes", R.id, "img", dt.thumb));
    const detour = dt ? `<details class="detour"><summary><img src="/r/${esc(R.id)}/img/${esc(dt.thumb)}" alt=""${thumbSize ? ` width="${thumbSize.w}" height="${thumbSize.h}"` : ""} loading="lazy" decoding="async"><span>${r(dt.see)}</span></summary>${dt.images.map((im) => shotHtml(im)).join("")}</details>` : "";
    const attrs = [
      `data-id="${esc(s.id)}"`,
      s.when ? `data-when="${esc(s.when)}"` : "",
      c?.confirm ? `data-checks="${c.confirm.length}"` : "",
      s.note ? `data-note="${plain(s.note, lang)}"` : "",
    ].filter(Boolean).join(" ");
    return `<section class="step" id="s-${esc(s.id)}" ${attrs}>
  <h2 class="step-title">${r(s.title)}</h2>
  ${R.screens ? `<button class="lost-btn" type="button" data-lost>${ico("help")}${tx.h("lostBtn")}</button>` : ""}
  ${s.note ? `<p class="step-note">${r(s.note)}</p>` : ""}
  ${s.whenText ? `<p class="when">${r(s.whenText)}</p>` : ""}
  ${detour}${content}${copyRows}${check}
  <div class="help" hidden>${sits}</div>
</section>`;
  }).join("\n");

  const support = R.support ? `<a class="btn small" href="${esc(R.support.url)}" rel="noopener noreferrer" target="_blank">${r(R.support.label)}</a>` : "";
  // 页面图鉴:手机上的页面和指南里的图对不上时,点最像自己手机的那一张,显示审过的答案和该去哪一步
  const screens = R.screens || [];
  // 要停手的情况(地区限制、地址被拦、要签名或授权、域名不对)不和普通页面混在一起:单独一个红框放最上面
  const stops = screens.filter((x) => x.stop).map((x) => `<button class="scr-stop" type="button" data-scr="${esc(x.id)}">${ico("x")}<span>${r(x.name)}</span></button>`).join("");
  const tiles = screens.filter((x) => !x.stop).map((x) => {
    const size = x.img && webpSize(join(ROOT, "recipes", R.id, "img", x.img));
    const pic = x.img
      ? `<img src="/r/${esc(R.id)}/img/${esc(x.img)}" alt=""${size ? ` width="${size.w}" height="${size.h}"` : ""} loading="lazy" decoding="async">`
      : `<span class="scr-ic">${ico(x.stop ? "x" : "help")}</span>`;
    return `<button class="scr${x.stop ? " stop" : ""}" type="button" data-scr="${esc(x.id)}"><span class="scr-pic">${pic}</span><span class="scr-name">${r(x.name)}</span></button>`;
  }).join("");
  const answers = screens.map((x) => `<section class="scr-a${x.stop ? " stop" : ""}" data-scr-a="${esc(x.id)}" hidden>
        <h3>${r(x.name)}</h3>
        <p>${rc(x.do)}</p>
        ${(x.images || []).map((im) => shotHtml(im)).join("")}
        ${!x.stop && (x.goto || x.after) ? `<button class="btn primary block" type="button" data-scr-go="${esc(x.goto || "")}" data-scr-after="${esc(x.after || "")}"></button>` : ""}
      </section>`).join("");
  // 截图求助:选图 → 竖向裁剪 → 手机里重新生成一张新图 → 放大预览 + 两个勾 → 发给 AI。
  // AI 只回编号;认出来后并排放「你的截图」和「我们审过的图」,用户逐条核对文字特征(放在 <template> 里)才显示审过的答案
  const shotOn = !!(site.shotAI && shot && screens.length);
  const agree = (text, attr) => `<label class="agree"><input type="checkbox" ${attr}><span class="box">${ico("check")}</span><span>${text}</span></label>`;
  const shotView = shotOn ? `<div id="lostShot" class="shot-ai" hidden data-r="${esc(R.id)}" data-v="${esc(shot.v)}">
        <h3>${tx.h("shotH")}</h3>
        <section class="shot-p" id="shotPick">
          <p class="sub">${tx.h("shotIntro")}</p>
          <input class="sr-only" type="file" id="shotFile" accept="image/*" tabindex="-1" aria-hidden="true">
          <button class="btn primary block" type="button" id="shotChoose">${ico("image")}${tx.h("shotChoose")}</button>
        </section>
        <section class="shot-p" id="shotCrop" hidden>
          <p class="sub">${tx.h("shotCropSub")}</p>
          <div class="crop-wrap"><div class="crop" id="shotCropBox"><canvas id="shotCv" width="1" height="1"></canvas><span class="crop-sh top"></span><span class="crop-sh bot"></span><button class="crop-h top" type="button" role="slider" aria-label="${tx.attr("shotTop")}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></button><button class="crop-h bot" type="button" role="slider" aria-label="${tx.attr("shotBottom")}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><span></span></button></div></div>
          <div class="shot-row"><button class="btn" type="button" data-shot-again>${tx.h("shotAgain")}</button><button class="btn primary" type="button" id="shotUse">${tx.h("shotUse")}</button></div>
        </section>
        <section class="shot-p" id="shotSend" hidden>
          <p class="shot-lead">${tx.h("shotPrevH")}</p>
          <figure class="shot-prev"><img id="shotPrev" alt="${tx.attr("shotPrevAlt")}"></figure>
          <p class="fine">${tx.h("shotPrivacy")}</p>
          ${agree(tx.h("shotAgree1"), "data-agree")}
          ${agree(tx.h("shotAgree2"), "data-agree")}
          <div id="shotTs" hidden></div>
          <div class="shot-row"><button class="btn" type="button" data-shot-again>${tx.h("shotAgain")}</button><button class="btn primary" type="button" id="shotGo" disabled>${tx.h("shotSend")}</button></div>
        </section>
        <section class="shot-p" id="shotWait" hidden><p class="sub" role="status"><span class="spin" aria-hidden="true"></span> ${tx.h("shotWait")}</p></section>
        <section class="shot-p" id="shotMatch" hidden>
          <p class="shot-lead">${tx.h("shotMatchH")}</p>
          <div class="pair"><figure><img id="shotMine" alt=""><figcaption>${tx.h("shotMine")}</figcaption></figure><figure><img id="shotOurs" alt=""><figcaption>${tx.h("shotOurs")}</figcaption></figure></div>
          <p class="sub">${tx.h("shotFeatH")}</p>
          <div class="feats-ck" id="shotFeats"></div>
          <button class="btn primary block" type="button" id="shotYes" disabled>${tx.h("shotYes")}${ico("arrowRight")}</button>
          <button class="btn block" type="button" id="shotNo">${tx.h("shotNo")}</button>
        </section>
        <section class="shot-p shot-warn" id="shotMiss" hidden><p id="shotMissMsg"></p><button class="btn block" type="button" data-shot-again>${tx.h("shotRetry")}</button></section>
        <section class="shot-p shot-warn" id="shotSecret" hidden><p>${tx.h("shotSecret")}</p><button class="btn block" type="button" data-shot-again>${tx.h("shotRetry")}</button></section>
        <button class="btn block" type="button" id="shotBack">${ico("arrowLeft")}${tx.h("shotBack")}</button>
        ${screens.filter((x) => !x.stop).map((x) => `<template data-feat="${esc(x.id)}">${x.features.map((f) => agree(r(f), "data-feat-ck")).join("")}</template>`).join("")}
      </div>` : "";
  const lostSheet = screens.length ? `<dialog class="sheet" id="lost" aria-labelledby="lostH">
    <div class="sheet-in">
      <span class="grip" aria-hidden="true"></span>
      <div class="sheet-head"><h2 id="lostH">${tx.h("lostH")}</h2><button class="iconbtn" type="button" id="lostClose" aria-label="${tx.attr("close")}">${ico("x")}</button></div>
      <div id="lostPick">
        ${stops ? `<div class="scr-stops"><p>${tx.h("lostStopH")}</p>${stops}</div>` : ""}
        <p class="sub">${tx.h("lostSub")}</p>
        <div class="scrs">${tiles}</div>
        ${shotOn ? `<button class="btn block shot-open" type="button" id="shotOpen">${ico("image")}${tx.h("shotOpen")}</button>` : ""}
        ${R.screensVerified ? `<p class="fine">${tx.h("lostAsOf", R.screensVerified)}</p>` : ""}
      </div>
      <div id="lostAns" hidden>${answers}<p class="sub" id="lostSkip" hidden>${tx.h("lostSkip")}</p><button class="btn block" type="button" id="lostBack">${ico("arrowLeft")}${tx.h("lostBack")}</button></div>
      ${shotView}
      <div class="fallback">
        <p>${tx.h("lostNone")}</p>
        <div class="fb-row">${support}<button class="btn small" type="button" id="lostDiag">${tx.h("lostDiag")}</button><button class="btn small" type="button" id="lostReport">${ico("copy")}${tx.h("report")}</button></div>
        ${R.support ? `<p class="sub">${r(R.support.note)}</p>` : ""}
      </div>
    </div>
  </dialog>` : "";
  const official = R.official.map((o) => `<div class="official"><span>${r(o.label)}</span><b class="mono">${esc(o.domain)}</b><button class="copy" type="button" data-copy="${esc(o.url)}">${ico("copy")}${tx.h("copyUrl")}</button></div>`).join("");
  const facts = R.facts.map(([k, v]) => `<div><dt>${r(k)}</dt><dd>${r(v)}</dd></div>`).join("");
  // 实测记录:哪天、用什么钱包、卡在哪、指南怎么补的。不写金额和地址
  const tests = R.fieldTests?.length ? `<section class="tests"><h2>${tx.h("testsH")}</h2><ul>${R.fieldTests.map((t) => `<li>${ico("check")}<span><b class="mono">${esc(t.date)}</b> ${r(t.text)}</span></li>`).join("")}</ul></section>` : "";
  const sources = R.sources.map((s) => `<li><a href="${esc(s.url)}" rel="noopener nofollow">${esc(s.label)}</a></li>`).join("");
  return page({
    tx, kind: "guide", path: `/r/${R.id}/`, script: "guide.js",
    title: `${R.title} · ${site.name}`, desc: R.summary.replace(/\*\*/g, ""),
    header: `<div class="wrap narrow bar"><a class="iconbtn" id="exit" href="${P}/" aria-label="${tx.attr("exitGuide")}">${ico("x")}</a><span class="bar-title">${r(R.short)}</span><button class="pill-warn" type="button" id="stuckBtn">${ico("help")}${tx.h("stuck")}</button></div>`,
    body: `
<article class="guide wrap narrow" id="guide" data-recipe="${esc(R.id)}" data-detector="${esc(R.detector)}" data-title="${plain(R.short, lang)}">
  <div class="route-bar" id="routeBar" hidden>
    <div class="route" id="route" role="img"></div>
    <div class="route-cap"><span class="pos" id="routePos"></span><span id="routeLeft"></span></div>
  </div>
  <section class="intro" id="intro">
    <h1 class="display">${esc(punct(R.title, lang))}</h1>
    <p class="lead">${r(R.summary)}</p>
    <dl class="facts">${facts}</dl>
    ${tests}
    ${official}
    <form id="me" class="card form" autocomplete="off" novalidate>
      <label for="addr">${tx.h("meLabel")}</label>
      <input id="addr" name="addr" class="input mono" spellcheck="false" autocapitalize="off" autocorrect="off" placeholder="${tx.attr("addrPlaceholder")}">
      <button class="btn" type="submit">${tx.h("meBtn")}</button>
    </form>
    <div id="mine" class="card mine" hidden></div>
    <button class="btn primary block" type="button" id="start">${tx.h("startGuide")}${ico("arrowRight")}</button>
    <details class="pro"><summary>${tx.h("proToggle")}</summary><div class="pro-card">${R.pro.map((p) => `<p>${r(p)}</p>`).join("")}</div></details>
    <section class="meta">
      <p>${rich(tx.t("lastVerified", R.lastVerified, R.verified), {}, lang)}</p>
      <h2>${tx.h("sourcesH")}</h2>
      <ul>${sources}</ul>
    </section>
  </section>
  <div class="steps" id="steps">${steps}</div>
  <section class="done" id="done" hidden data-where="${plain(R.done.where, lang)}" data-from="${plain(R.done.from, lang)}" data-look="${plain(R.done.look, lang)}"></section>
  <nav class="pager" id="pager" aria-label="${tx.attr("pagerNav")}" hidden><div class="wrap narrow pager-in"><button class="btn" type="button" data-go="-1">${tx.h("prev")}</button><button class="btn primary" type="button" data-go="1">${tx.h("next")}${ico("arrowRight")}</button></div></nav>
  <dialog class="sheet" id="sheet" aria-labelledby="sheetH">
    <div class="sheet-in">
      <span class="grip" aria-hidden="true"></span>
      <div class="sheet-head"><h2 id="sheetH">${tx.h("diagH")}</h2><button class="btn small" type="button" id="recheck">${ico("refresh")}${tx.h("recheck")}</button><button class="iconbtn" type="button" id="sheetClose" aria-label="${tx.attr("close")}">${ico("x")}</button></div>
      <div class="diag" id="diag" aria-live="polite"></div>
      <h3 class="sits-h" id="sitsH">${tx.h("sitsH")}</h3>
      <div class="sits" id="sheetSits"></div>
      <div class="fallback">
        <p>${tx.h("fallback")}</p>
        <div class="fb-row">${support}<button class="btn small" type="button" id="report">${ico("copy")}${tx.h("report")}</button></div>
        ${R.support ? `<p class="sub">${r(R.support.note)}</p>` : ""}
      </div>
    </div>
  </dialog>
  ${lostSheet}
  <div class="follow" id="follow" role="status" hidden><span></span><button class="btn small" type="button" data-goto="">${tx.h("followGo")}</button><button class="iconbtn" type="button" data-follow-x aria-label="${tx.attr("close")}">${ico("x")}</button></div>
</article>`,
  });
}

// ---------- 找不到页面(中英都放) ----------

function notFound() {
  const zh = texts("zh"), en = texts("en");
  return page({
    tx: zh, kind: "404", path: "/", script: "site.js", noindex: true,
    title: `${zh.t("nfTitle")} · ${site.name}`, desc: "",
    header: brandBar(zh, "/"),
    body: `<section class="wrap narrow nf"><h1 class="display">${zh.h("nfTitle")}</h1><p lang="en">${en.h("nfTitle")}</p><p><a class="btn primary" href="/">${zh.h("nfBack")}</a> <a class="btn" href="/en/" lang="en">${en.h("nfBack")}</a></p></section>`,
  });
}

// ---------- 安全响应头(Cloudflare Pages 读 _headers;本地预览也用同一份) ----------

// img-src 的 blob::截图求助在手机里裁好的那张图,预览和对照都直接显示它(不经过网络)。
// 配了 Turnstile 人机验证才放开它的脚本和小窗口(challenges.cloudflare.com),没配就不放
export function headers(connect, { turnstile = null } = {}) {
  const ts = turnstile ? " https://challenges.cloudflare.com" : "";
  return {
    "Content-Security-Policy": [
      "default-src 'self'", `script-src 'self'${ts}`, "style-src 'self'", "img-src 'self' data: blob:", "font-src 'self'",
      `connect-src 'self' ${connect.join(" ")}`, ...(ts ? [`frame-src${ts}`] : []), "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
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

// ---------- 配方:读取、校验、出英文版 ----------

function copyDir(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const f of readdirSync(src)) {
    const s = join(src, f), d = join(dst, f);
    if (statSync(s).isDirectory()) copyDir(s, d);
    else copyFileSync(s, d);
  }
}

// 英文版:按 i18n/en.json 换掉每一处给人看的文字。缺一条、条数对不上、还混着汉字,都直接报错
export function localize(r, o, file) {
  const need = (v, path) => {
    if (typeof v !== "string" || !v.trim()) throw new Error(`${file}: 缺 ${path}`);
    return v;
  };
  const same = (a, b, path) => {
    if (!Array.isArray(b) || b.length !== a.length) throw new Error(`${file}: ${path} 应该有 ${a.length} 条`);
    return b;
  };
  // 截图:写一句话就只换说明;写成 {src, caption} 就连图一起换(官网界面跟着手机语言走,比如 WOOFi 的永续页)
  const img = (im, y, path) => (typeof y === "string"
    ? { ...im, caption: need(y, path) }
    : { ...im, src: need(y?.src, `${path}.src`), caption: need(y?.caption, `${path}.caption`) });
  const L = JSON.parse(JSON.stringify(r));
  for (const k of ["title", "short", "verified", "covers", "summary"]) L[k] = need(o[k], k);
  L.facts = same(r.facts, o.facts, "facts").map((x, i) => [need(x?.[0], `facts[${i}][0]`), need(x?.[1], `facts[${i}][1]`)]);
  L.chips = same(r.chips || [], o.chips || [], "chips").map((x, i) => ({ ...r.chips[i], text: need(x, `chips[${i}]`) }));
  if (r.support) L.support = { ...r.support, label: need(o.support?.label, "support.label"), note: need(o.support?.note, "support.note"), ...(o.support?.url ? { url: need(o.support.url, "support.url") } : {}) };
  // 官网网址可以换成英文版的(比如 OKX 的网址里带着 zh-hans);不写就和中文一样
  L.official = same(r.official, o.official, "official").map((x, i) => ({ ...r.official[i], label: need(x?.label, `official[${i}].label`), ...(x?.url ? { url: need(x.url, `official[${i}].url`) } : {}) }));
  for (const k of Object.keys(r.vars)) if (!(r.literalVars || []).includes(k)) L.vars[k] = need(o.vars?.[k], `vars.${k}`);
  L.pro = same(r.pro, o.pro, "pro").map((x, i) => need(x, `pro[${i}]`));
  L.done = { where: need(o.done?.where, "done.where"), from: need(o.done?.from, "done.from"), look: need(o.done?.look, "done.look") };
  L.sources = same(r.sources, o.sources, "sources").map((x, i) => ({ ...r.sources[i], label: need(x, `sources[${i}]`) }));
  if (r.fieldTests) L.fieldTests = same(r.fieldTests, o.fieldTests, "fieldTests").map((x, i) => ({ ...r.fieldTests[i], text: need(x, `fieldTests[${i}]`) }));
  L.steps = r.steps.map((s) => {
    const x = o.steps?.[s.id] || {};
    const p = `steps.${s.id}`;
    const S = { ...s, title: need(x.title, `${p}.title`) };
    for (const k of ["note", "whenText", "milestone"]) if (s[k]) S[k] = need(x[k], `${p}.${k}`);
    if (s.items) S.items = same(s.items, x.items, `${p}.items`).map((y, i) => need(y, `${p}.items[${i}]`));
    // 要复制的网址同上:英文版可以换,不写就和中文一样
    if (s.copy && x.copy) S.copy = same(s.copy, x.copy, `${p}.copy`).map((y, i) => need(y, `${p}.copy[${i}]`));
    if (s.images) S.images = same(s.images, x.images, `${p}.images`).map((y, i) => img(s.images[i], y, `${p}.images[${i}]`));
    if (s.detour) {
      const d = x.detour || {}, q = `${p}.detour`;
      S.detour = { ...s.detour, see: need(d.see, `${q}.see`), thumb: d.thumb || s.detour.thumb, images: same(s.detour.images, d.images, `${q}.images`).map((y, i) => img(s.detour.images[i], y, `${q}.images[${i}]`)) };
    }
    if (s.situations) {
      S.situations = s.situations.map((y) => {
        const z = x.situations?.[y.id];
        return { ...y, see: need(z?.see, `${p}.situations.${y.id}.see`), do: need(z?.do, `${p}.situations.${y.id}.do`) };
      });
    }
    if (s.check) {
      const c = s.check, d = x.check || {}, q = `${p}.check`;
      S.check = { ...c, title: need(d.title, `${q}.title`) };
      if (c.lead) S.check.lead = need(d.lead, `${q}.lead`);
      if (c.confirm) S.check.confirm = same(c.confirm, d.confirm, `${q}.confirm`).map((y, i) => ({ title: need(y?.title, `${q}.confirm[${i}].title`), sub: need(y?.sub, `${q}.confirm[${i}].sub`) }));
      if (c.reject) S.check.reject = same(c.reject, d.reject, `${q}.reject`).map((y, i) => need(y, `${q}.reject[${i}]`));
      if (c.normal) S.check.normal = same(c.normal, d.normal, `${q}.normal`).map((y, i) => need(y, `${q}.normal[${i}]`));
      if (c.rows) S.check.rows = same(c.rows, d.rows, `${q}.rows`).map((y, i) => [need(y?.[0], `${q}.rows[${i}][0]`), need(y?.[1], `${q}.rows[${i}][1]`)]);
      if (c.foot) S.check.foot = need(d.foot, `${q}.foot`);
      if (c.skip) S.check.skip = need(d.skip, `${q}.skip`);
    }
    return S;
  });
  if (r.screens) {
    L.screens = r.screens.map((y) => {
      const z = o.screens?.[y.id], q = `screens.${y.id}`;
      const S = { ...y, name: need(z?.name, `${q}.name`), do: need(z?.do, `${q}.do`) };
      delete S.ai; // 只给 AI 看的判定条件(里面夹着中文界面上的词),服务端从中文配方里取,英文版页面用不到
      if (z?.img) S.img = z.img;
      if (y.features) S.features = same(y.features, z?.features, `${q}.features`).map((w, i) => need(w, `${q}.features[${i}]`));
      if (y.images) S.images = same(y.images, z?.images, `${q}.images`).map((w, i) => img(y.images[i], w, `${q}.images[${i}]`));
      return S;
    });
  }
  const cjk = JSON.stringify(L).match(/[　-〿一-鿿＀-￯]+/);
  if (cjk) throw new Error(`${file}: 英文版里还有中文「${cjk[0]}」`);
  return L;
}

function loadRecipes() {
  const dir = join(ROOT, "recipes");
  return readdirSync(dir).filter((d) => existsSync(join(dir, d, "recipe.json"))).map((d) => {
    const r = JSON.parse(readFileSync(join(dir, d, "recipe.json"), "utf8"));
    if (r.id !== d) throw new Error(`配方目录名 ${d} 和 id ${r.id} 不一致`);
    const stepIds = new Set(r.steps.map((s) => s.id));
    for (const t of r.fieldTests || []) if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date || "") || !t.text) throw new Error(`${d}: 实测记录要有日期(YYYY-MM-DD)和说明`);
    const scrIds = new Set();
    for (const x of r.screens || []) {
      if (!x.id || !x.name || !x.do) throw new Error(`${d}: 页面图鉴缺 id、name 或 do`);
      if (scrIds.has(x.id)) throw new Error(`${d}: 页面图鉴 id 重复 ${x.id}`);
      scrIds.add(x.id);
      for (const k of ["goto", "after"]) if (x[k] && !stepIds.has(x[k])) throw new Error(`${d}: 页面图鉴 ${x.id} 的 ${k} 指向不存在的步骤 ${x[k]}`);
      if (x.stop && (x.goto || x.after)) throw new Error(`${d}: 页面图鉴 ${x.id} 是「停下」,不能再带去某一步`);
      // 截图求助:AI 认出一页后,用户要逐条核对这几条看得见的文字特征;停手的页面不核对,直接让停下
      if (x.stop) {
        if (x.features) throw new Error(`${d}: 页面图鉴 ${x.id} 是「停下」,不用写文字特征`);
        // 停手的页面直接让人停下,不再核对:所以要给 AI 写清什么时候算、什么时候不算,免得把普通页面认成停手
        if (typeof x.ai !== "string" || !x.ai.trim()) throw new Error(`${d}: 页面图鉴 ${x.id} 是「停下」,要写 ai(只给 AI 看的英文判定条件:什么时候算、什么时候不算)`);
      } else {
        if (!x.img) throw new Error(`${d}: 页面图鉴 ${x.id} 缺小图 img(截图求助要拿它和用户的截图对照)`);
        if (!Array.isArray(x.features) || x.features.length < 2 || x.features.length > 3 || x.features.some((f) => typeof f !== "string" || !f.trim())) throw new Error(`${d}: 页面图鉴 ${x.id} 要有 2–3 条文字特征 features`);
      }
    }
    for (const s of r.steps) {
      const ids = new Set();
      for (const x of s.situations || []) {
        if (!x.id || !x.see || !x.do) throw new Error(`${d}/${s.id}: 常见情况缺 id、see 或 do`);
        if (ids.has(x.id)) throw new Error(`${d}/${s.id}: 常见情况 id 重复 ${x.id}`);
        ids.add(x.id);
      }
      if (s.check && s.check.kind !== "arrive" && !(s.check.confirm?.length && s.check.reject?.length)) throw new Error(`${d}/${s.id}: 核对卡缺 confirm 或 reject`);
      if (s.detour && !(s.detour.see && s.detour.thumb && s.detour.images?.length)) throw new Error(`${d}/${s.id}: 岔路缺 see、thumb 或 images`);
    }
    const enFile = join(dir, d, "i18n", "en.json");
    if (!existsSync(enFile)) throw new Error(`${d}: 缺英文版 i18n/en.json`);
    const out = { zh: r, en: localize(r, JSON.parse(readFileSync(enFile, "utf8")), `${d}/i18n/en.json`) };
    // 中英两套用到的每一张图都要在(英文版可以换成英文界面的截图)
    for (const L of Object.values(out)) {
      const srcs = [...L.steps.flatMap((s) => [...(s.images || []), ...(s.detour?.images || [])]), ...(L.screens || []).flatMap((x) => x.images || [])].map((im) => im.src);
      for (const s of L.steps) if (s.detour) srcs.push(s.detour.thumb);
      for (const x of L.screens || []) if (x.img) srcs.push(x.img);
      for (const src of srcs) if (!existsSync(join(dir, d, "img", src))) throw new Error(`${d}: 缺图片 ${src}`);
    }
    return out;
  });
}

// 截图求助的候选页面:中英两套的编号、名字、文字特征。服务端从这份静态文件取白名单(和页面上的图鉴是同一版),
// 版本号 v 跟着内容变:页面带着 v 发请求,对不上说明手机上开着的是旧页面
export function shotData(r) {
  if (!r.zh.screens?.length) return null;
  const txt = (s) => String(s).replace(/\*\*|`/g, "");
  const screens = r.zh.screens.map((x, i) => {
    const e = r.en.screens[i];
    const o = { id: x.id, stop: !!x.stop, name: { zh: txt(x.name), en: txt(e.name) } };
    if (x.features) o.features = { zh: x.features.map(txt), en: e.features.map(txt) };
    if (x.ai) o.ai = txt(x.ai);
    return o;
  });
  const body = { recipe: r.zh.id, site: r.zh.official[0].domain, screens };
  return { v: createHash("sha256").update(JSON.stringify(body)).digest("hex").slice(0, 12), ...body };
}

export function build() {
  const recipes = loadRecipes();
  const shots = new Map(recipes.map((r) => [r.zh.id, shotData(r)]));
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(join(DIST, "assets"), { recursive: true });
  copyDir(join(ROOT, "src"), join(DIST, "assets"));
  copyDir(join(ROOT, "static", "fonts"), join(DIST, "assets", "fonts"));
  copyDir(join(ROOT, "static", "chains"), join(DIST, "assets", "chains"));
  copyFileSync(join(ROOT, "static", "favicon.svg"), join(DIST, "favicon.svg"));
  const write = (rel, html) => {
    const f = join(DIST, rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, html);
  };
  for (const lang of LANGS) {
    const tx = texts(lang);
    const rs = recipes.map((r) => r[lang]);
    write(`${pre(lang)}/index.html`, home(tx, rs));
    write(`${pre(lang)}/check/index.html`, checkPage(tx, rs));
    for (const R of rs) write(`${pre(lang)}/r/${R.id}/index.html`, guide(tx, R, shots.get(R.id)));
  }
  for (const r of recipes) copyDir(join(ROOT, "recipes", r.zh.id, "img"), join(DIST, "r", r.zh.id, "img"));
  for (const [id, s] of shots) if (s) write(`r/${id}/screens.json`, JSON.stringify(s));
  // 只有 /api/* 走 Pages Functions;网页、图片、图鉴数据都是静态文件,不占函数的调用次数
  write("_routes.json", JSON.stringify({ version: 1, include: ["/api/*"], exclude: [] }));
  write("404.html", notFound());
  const h = headers(site.connect, site);
  // 网页本身加 no-transform:Cloudflare 就不会往页面里插它的访问统计脚本,也不会改动页面内容
  // (官方文档:带 no-transform 的响应不做自动注入,也不压缩;网页只有几十 KB,不压缩也快)
  const pages = ["/", "/en/", "/check/", "/en/check/", ...recipes.flatMap((r) => [`/r/${r.zh.id}/`, `/en/r/${r.zh.id}/`]), "/404.html"];
  const noTransform = pages.map((p) => `${p}\n  Cache-Control: public, max-age=0, must-revalidate, no-transform`).join("\n");
  write("_headers", "/*\n" + Object.entries(h).map(([k, v]) => `  ${k}: ${v}`).join("\n") + "\n" + noTransform + "\n");
  write("robots.txt", "User-agent: *\nAllow: /\n");
  console.log(`built ${recipes.length} recipe(s) × ${LANGS.length} languages → dist/`);
}

// 直接运行时才构建(被 serve.mjs 引用时不构建)
const same = (a, b) => a && b && a.replace(/\\/g, "/").toLowerCase() === b.replace(/\\/g, "/").toLowerCase();
if (same(fileURLToPath(import.meta.url), process.argv[1])) build();
