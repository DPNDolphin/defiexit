// 检查结果页:# 后面的地址 → 两路一起查,合成一张清单:「存在项目里的」「钱包里的」。
//   ① 我们有指南的项目:各检测器在浏览器里直接只读查官方接口,查到就给一步一图的指南;
//   ② 全部资产:经本站接口交给 Zerion 查 40 多条链上的钱包余额和项目仓位。
// 只列查到的,没查到的项目不列:只显示有什么。查不成的照实说,给「重试」。
import "./site.js";
import { detectors } from "./detectors/index.js";
import { isEvmAddress, shortAddr, floorTo } from "./lib/net.js";
import { el, icon, rowsTable, setText } from "./lib/ui.js";
import { makeT, pageLang, prefix, errText } from "./lib/i18n.js";

const lang = pageLang(), t = makeT(lang), P = prefix(lang);
const recipes = [...document.querySelectorAll("#recipes li")].map((li) => ({
  ...li.dataset,
  milestones: JSON.parse(li.dataset.milestones || "[]"),
  chips: JSON.parse(li.dataset.chips || "[]"),
  zerion: JSON.parse(li.dataset.zerion || "null"),
}));
const usd = (x) => floorTo(x, 2).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (x) => (x >= 1000 ? Math.round(x).toLocaleString("en-US") : String(Number(x.toPrecision(6))));
const $ = (id) => document.getElementById(id);
const badge = $("sumBadge"), line = $("sumLine"), big = $("sumBig"), note = $("sumNote"), cards = $("cards");
const addr = (new URLSearchParams(location.hash.slice(1)).get("a") || "").trim();
const results = new Map(); // 配方 id → { res } 或 { err }
let assets = { state: "pending", res: null }; // 全部资产:pending / ok / empty / off / busy / error

// Zerion 查到的项目,项目名和链都对上我们的配方(配方 JSON 的 zerion 字段)才算有指南;同名项目在别的链上不算
const recipeFor = (g) => recipes.find((r) => r.zerion?.chains.includes(g.chain) && r.zerion.apps.some((a) => g.app.toLowerCase().includes(a.toLowerCase())));

// ---------- 卡片 ----------

// 结果卡里的小路线:你在这里 → 这个账户要走的几站 → 出口(最后一站「到账」就是出口)
function miniRoute(r, flags) {
  const ms = r.milestones.filter((m) => !m.when || flags?.[m.when]);
  const box = el("div", { class: "route" });
  box.append(el("span", { class: "node here" }));
  ms.forEach((m, i) => {
    box.append(el("span", { class: "seg dash" }));
    box.append(i === ms.length - 1 ? el("span", { class: "exit-box" }, icon("exit")) : el("span", { class: "node ring" }));
  });
  const labels = el("div", { class: "labels" }, el("span", { class: "here" }, t("youAreHere")), ms.map((m) => el("span", {}, m.label)));
  labels.style.gridTemplateColumns = `repeat(${ms.length + 1}, minmax(0, 1fr))`;
  return el("div", { class: "minimap", role: "img", "aria-label": [t("youAreHere"), ...ms.map((m) => m.label)].join(" → ") }, box, labels);
}

// 我们有指南、而且查到了能取的钱
function foundCard(r, res) {
  const guide = `${P}/r/${r.id}/#a=${addr}&go=1`;
  return el("article", { class: "rcard" },
    el("div", { class: "rcard-h" }, el("h4", {}, r.protocol), el("span", { class: "chip mono" }, r.route)),
    rowsTable(res.rows, res.total || { label: t("expected"), value: `${res.vars.arrive} USDC` }),
    miniRoute(r, res.flags),
    res.warnings.length ? el("ul", { class: "warns" }, res.warnings.map((w) => el("li", {}, icon("alert"), el("span", {}, w)))) : null,
    r.chips.length ? el("ul", { class: "chips" }, r.chips.map((c) => el("li", {}, icon(c.icon), el("span", {}, c.text)))) : null,
    el("a", { class: "btn primary block", href: guide }, t("startGuide"), icon("arrowRight")));
}

// 我们有指南、查到了但太少(比如低于最小提现额)
function dustCard(r, res) {
  return el("article", { class: "rcard" },
    el("div", { class: "rcard-h" }, el("h4", {}, r.protocol), el("span", { class: "chip" }, res.badge || t("dustBadge"))),
    res.rows.length ? rowsTable(res.rows) : null,
    res.note ? el("p", { class: "sub" }, res.note) : null,
    res.warnings.length ? el("ul", { class: "warns" }, res.warnings.map((w) => el("li", {}, icon("alert"), el("span", {}, w)))) : null,
    el("a", { class: "btn block", href: `${P}/r/${r.id}/#a=${addr}` }, t("seeGuide")));
}

// Zerion 查到的项目仓位
function defiCard(g) {
  const r = recipeFor(g);
  const rows = g.items.map((x) => ({
    label: `${t("assetType", x.type)} · ${x.sym}`,
    hint: x.usd === null ? t("assetsUnknown") : `${qty(x.qty)} ${x.sym}`,
    value: x.usd === null ? `${qty(x.qty)} ${x.sym}` : `$${usd(x.usd)}`,
  }));
  return el("article", { class: "rcard" },
    el("div", { class: "rcard-h" }, el("h4", {}, g.app), el("span", { class: "chip" }, g.chain)),
    rowsTable(rows),
    g.debt > 0 ? el("ul", { class: "warns" }, el("li", {}, icon("alert"), el("span", {}, t("assetsDebt", usd(g.debt))))) : null,
    r ? el("a", { class: "btn primary block", href: `${P}/r/${r.id}/#a=${addr}&go=1` }, t("assetsHasGuide"), icon("arrowRight"))
      : el("p", { class: "sub" }, t("assetsNoGuide")));
}

// Zerion 查到的钱包余额,一条链一行
function walletRow(g) {
  const list = g.tokens.map((x) => `${x.sym} ${qty(x.qty)}`).join(" · ") + (g.more ? ` · ${t("assetsMore", g.more)}` : "");
  return el("div", { class: "aw" }, el("b", {}, g.chain), el("span", { class: "mono" }, `$${usd(g.usd)}`), el("small", {}, list));
}

// 查不成的一行:哪一路、为什么、重试
function failRow(name, text, retry) {
  return el("div", { class: "rline" }, el("b", {}, name), el("span", { class: "sub" }, text),
    el("button", { class: "btn small", type: "button", "data-retry": retry }, icon("refresh"), t("retry")));
}

// ---------- 合成一张清单 ----------

function paint() {
  const recipesDone = recipes.every((r) => results.has(r.id));
  const assetsDone = assets.state !== "pending";
  const done = recipesDone && assetsDone;
  const all = recipes.map((r) => ({ r, ...results.get(r.id) }));
  const found = all.filter((x) => x.res?.status === "found");
  const dust = all.filter((x) => x.res?.status === "dust");
  const failed = all.filter((x) => x.err);
  // Zerion 里和我们配方对上、而且配方已经查到的,不重复列
  const shown = new Set([...found, ...dust].map((x) => x.r.id));
  const zDefi = (assets.res?.defi || []).filter((g) => !shown.has(recipeFor(g)?.id));
  const zWallet = assets.res?.wallet || [];
  const nDefi = found.length + zDefi.length;
  const defiUsd = found.reduce((s, x) => s + x.res.usd, 0) + zDefi.reduce((s, g) => s + g.usd, 0);
  const walletUsd = zWallet.reduce((s, g) => s + g.usd, 0);
  const guided = found.length + zDefi.filter(recipeFor).length;
  const partial = failed.length > 0 || assets.state === "busy" || assets.state === "error";

  // 顶上:先说存在项目里的钱,没有再说钱包里的
  if (!done) {
    badge.className = "badge";
    badge.replaceChildren(el("span", { class: "spin", "aria-hidden": "true" }), el("span", {}, t("checking")));
  } else {
    // 有一路没查成:不说「查完了」,免得被当成整个钱包都查过了
    badge.replaceChildren(icon(partial ? "alert" : "check"), el("span", {}, t(partial ? "checkedPart" : "checked")));
    badge.className = partial ? "badge" : "badge ok";
  }
  big.hidden = note.hidden = true;
  if (nDefi) {
    setText(line, t("defiN", nDefi));
    setText(big, t("about", usd(defiUsd)));
    setText(note, guided ? t("defiGuided", guided) : t("defiNoGuide"));
    big.hidden = note.hidden = false;
  } else if (zWallet.length && done) {
    setText(line, t("walletOnly"));
    setText(big, t("about", usd(walletUsd)));
    setText(note, t("walletOnlyNote"));
    big.hidden = note.hidden = false;
  } else {
    setText(line, done ? (partial ? t("someFailed") : "") : t("checkingAll"));
  }

  const nodes = [];
  if (nDefi || dust.length) {
    nodes.push(el("h3", { class: "list-h" }, t("assetsDefiH", usd(defiUsd))), el("p", { class: "sub" }, t("assetsDefiP")),
      ...found.map((x) => foundCard(x.r, x.res)), ...zDefi.map(defiCard), ...dust.map((x) => dustCard(x.r, x.res)));
  }
  if (zWallet.length) {
    nodes.push(el("h3", { class: "list-h" }, t("assetsWalletH", usd(walletUsd))), el("p", { class: "sub" }, t("assetsWalletP")),
      el("div", { class: "awallet" }, ...zWallet.map(walletRow)));
  }
  if (!done) nodes.push(el("div", { class: "rcard skeleton", "aria-hidden": "true" }));
  for (const x of failed) nodes.push(failRow(x.r.protocol, t("failRow", errText(t, x.err)), x.r.id));
  if (assets.state === "busy" || assets.state === "error") nodes.push(failRow(t("assetsH"), t(assets.state === "busy" ? "assetsBusy" : "assetsFail"), "assets"));
  if (done && !nDefi && !dust.length && !zWallet.length && !partial) {
    // 什么都没查到。查了全部资产的,照实说查了多少;没接全部资产(off)才叫用户自己去 DeBank 看
    const list = recipes.map((r) => r.protocol).join(lang === "en" ? ", " : "、");
    nodes.push(el("section", { class: "nothing" },
      el("h2", {}, assets.state === "empty" ? t("nothingAllH") : t("nothingH", recipes.length)),
      el("p", { class: "sub" }, assets.state === "empty" ? t("nothingAllP") : t("nothingP", list)),
      assets.state === "empty" ? null : el("p", { class: "sub" }, t("nothingTip")),
      el("a", { class: "btn primary block", href: `${P}/` }, t("another"))));
  }
  if (assets.res) {
    nodes.push(el("p", { class: "fine" }, t("assetsSub")),
      assets.res.dust ? el("p", { class: "fine" }, t("assetsDust", assets.res.dust)) : null,
      el("p", { class: "fine" }, t("assetsPriv")));
  }
  cards.replaceChildren(...nodes.filter(Boolean));
}

// ---------- 两路查询 ----------

async function check(r) {
  results.delete(r.id);
  try {
    results.set(r.id, { res: await detectors[r.detector](addr, lang) });
  } catch (err) {
    results.set(r.id, { err });
  }
}

async function run(list) {
  for (const r of list) results.delete(r.id);
  paint();
  await Promise.all(list.map(check));
  paint();
}

// 同一个标签页里 10 分钟内再看同一个地址:用这个标签页自己记下的结果(只存在用户浏览器里,关掉标签页就没了),
// 不重复去 Zerion 查——免费档每天只有 300 次
const ASSETS_KEY = `dx-assets:${addr.toLowerCase()}`, ASSETS_MS = 10 * 60 * 1000;
function assetsCached() {
  try {
    const c = JSON.parse(sessionStorage.getItem(ASSETS_KEY) || "null");
    return c && Date.now() - c.at < ASSETS_MS ? c.res : null;
  } catch {
    return null;
  }
}
function assetsKeep(res) {
  try {
    sessionStorage.setItem(ASSETS_KEY, JSON.stringify({ at: Date.now(), res }));
  } catch { /* 存不了就算了,下次再查 */ }
}

async function loadAssets({ fresh = false } = {}) {
  let res = fresh ? null : assetsCached();
  if (!res) {
    assets = { state: "pending", res: null };
    paint();
    try {
      const r = await fetch("/api/assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ a: addr }), credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
      res = await r.json();
    } catch { /* 当没查成 */ }
    if (res?.status === "ok" || res?.status === "empty") assetsKeep(res);
  }
  const s = res?.status;
  assets = { state: ["ok", "empty", "off", "busy"].includes(s) ? s : "error", res: s === "ok" ? res : null };
  paint();
}

// 同一个标签页里只改了 # 后面的地址:整页重新查,不让旧账户的结果挂着新地址
window.addEventListener("hashchange", () => location.reload());

cards.addEventListener("click", (e) => {
  const b = e.target.closest("[data-retry]");
  if (!b) return;
  if (b.dataset.retry === "assets") loadAssets({ fresh: true });
  else run(recipes.filter((r) => r.id === b.dataset.retry));
});

if (!isEvmAddress(addr)) {
  badge.className = "badge stop";
  badge.replaceChildren(icon("alert"), el("span", {}, t("badHash")));
  cards.replaceChildren(el("a", { class: "btn primary block", href: `${P}/` }, t("another")));
} else {
  const chip = $("addrChip");
  chip.textContent = shortAddr(addr);
  chip.hidden = false;
  run(recipes);
  loadAssets();
}
