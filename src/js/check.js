// 检查结果页:# 后面的地址 → 各检测器在浏览器里并行只读查询 → 能取的钱、要走哪几站、从哪开始。
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
const $ = (id) => document.getElementById(id);
const badge = $("sumBadge"), line = $("sumLine"), big = $("sumBig"), note = $("sumNote"), cards = $("cards");
const addr = (new URLSearchParams(location.hash.slice(1)).get("a") || "").trim();
const results = new Map(); // 配方 id → { res } 或 { err }
let assetsState = "pending"; // 全部资产:pending / ok / empty / off / error
let assetsRes = null; // 全部资产查到东西时的结果

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

function foundCard(r, res) {
  const guide = `${P}/r/${r.id}/#a=${addr}&go=1`;
  return el("article", { class: "rcard" },
    el("div", { class: "rcard-h" }, el("h2", {}, r.protocol), el("span", { class: "chip mono" }, r.route)),
    rowsTable(res.rows, res.total || { label: t("expected"), value: `${res.vars.arrive} USDC` }),
    miniRoute(r, res.flags),
    res.warnings.length ? el("ul", { class: "warns" }, res.warnings.map((w) => el("li", {}, icon("alert"), el("span", {}, w)))) : null,
    r.chips.length ? el("ul", { class: "chips" }, r.chips.map((c) => el("li", {}, icon(c.icon), el("span", {}, c.text)))) : null,
    el("a", { class: "btn primary block", href: guide }, t("startGuide"), icon("arrowRight")));
}

function dustCard(r, res) {
  return el("article", { class: "rcard" },
    el("div", { class: "rcard-h" }, el("h2", {}, r.protocol), el("span", { class: "chip" }, res.badge || t("dustBadge"))),
    res.rows.length ? rowsTable(res.rows) : null,
    res.note ? el("p", { class: "sub" }, res.note) : null,
    res.warnings.length ? el("ul", { class: "warns" }, res.warnings.map((w) => el("li", {}, icon("alert"), el("span", {}, w)))) : null,
    el("a", { class: "btn block", href: `${P}/r/${r.id}/#a=${addr}` }, t("seeGuide")));
}

function lineRow(r, text, retry) {
  return el("div", { class: "rline" }, el("b", {}, r.protocol), el("span", { class: "sub" }, text),
    retry ? el("button", { class: "btn small", type: "button", "data-retry": r.id }, icon("refresh"), t("retry")) : null);
}

function render() {
  const all = recipes.map((r) => ({ r, ...results.get(r.id) }));
  const found = all.filter((x) => x.res?.status === "found");
  const dust = all.filter((x) => x.res?.status === "dust");
  const empty = all.filter((x) => x.res?.status === "empty");
  const failed = all.filter((x) => x.err);
  const pending = all.filter((x) => !x.res && !x.err);

  if (pending.length) return;
  // 有没查成的:不说「查完了」,免得被当成整个钱包都查过了
  badge.replaceChildren(icon(failed.length ? "alert" : "check"), el("span", {}, t(failed.length ? "checkedPart" : "checked")));
  badge.className = failed.length ? "badge" : "badge ok";
  if (found.length) {
    setText(line, t("foundN", found.length));
    setText(big, t("about", usd(found.reduce((s, x) => s + x.res.usd, 0))));
    setText(note, t("calcNote"));
    big.hidden = note.hidden = false;
  } else if (assetsRes?.defi.length) {
    // 我们有指南的项目里没查到,但别的项目里存着钱:先报这个,别让用户以为地址里没钱
    const guided = assetsRes.defi.filter(recipeFor).length;
    setText(line, t("defiN", assetsRes.defi.length));
    setText(big, t("about", usd(assetsRes.totals.defi)));
    setText(note, guided ? t("defiGuided", guided) : t("defiNoGuide"));
    big.hidden = note.hidden = false;
  } else if (assetsRes?.wallet.length && !failed.length) {
    setText(line, t("walletOnly"));
    setText(big, t("about", usd(assetsRes.totals.wallet)));
    setText(note, t("walletOnlyNote"));
    big.hidden = note.hidden = false;
  } else if (failed.length) {
    setText(line, t("someFailed"));
  } else {
    setText(line, "");
  }
  const nodes = [
    ...found.map((x) => foundCard(x.r, x.res)),
    ...dust.map((x) => dustCard(x.r, x.res)),
    ...failed.map((x) => lineRow(x.r, t("failRow", errText(t, x.err)), true)),
    ...empty.map((x) => lineRow(x.r, t("noneRow"))),
  ];
  if (!found.length && !dust.length && !failed.length && !assetsRes) {
    // 只说这次查了哪几个项目:没查到不等于钱包里没钱。下面查了全部资产的,就指过去;没查成才叫用户自己去 DeBank 看
    const all = assetsState === "ok" || assetsState === "empty";
    nodes.push(el("section", { class: "nothing" },
      el("h2", {}, t("nothingH", recipes.length)),
      all ? el("p", { class: "sub" }, t("nothingP2")) : el("p", { class: "sub" }, t("nothingP", recipes.map((r) => r.protocol).join(lang === "en" ? ", " : "、"))),
      all ? null : el("p", { class: "sub" }, t("nothingTip")),
      el("a", { class: "btn primary block", href: `${P}/` }, t("another"))));
  }
  cards.replaceChildren(...nodes);
}

async function check(r) {
  results.delete(r.id);
  try {
    results.set(r.id, { res: await detectors[r.detector](addr, lang) });
  } catch (err) {
    results.set(r.id, { err });
  }
}

async function run(list) {
  badge.className = "badge";
  badge.replaceChildren(el("span", { class: "spin", "aria-hidden": "true" }), el("span", {}, t("checking")));
  setText(line, t("checkingN", list.length));
  big.hidden = note.hidden = true;
  if (list.length === recipes.length) cards.replaceChildren(...recipes.map(() => el("div", { class: "rcard skeleton", "aria-hidden": "true" })));
  await Promise.all(list.map(check));
  render();
}

// ---------- 全部资产:经本站接口交给 Zerion 查各条链上的余额和项目仓位;接口没配好(off)这一块就不出现 ----------

const assetsBox = $("assets");
const qty = (x) => (x >= 1000 ? Math.round(x).toLocaleString("en-US") : String(Number(x.toPrecision(6))));
// Zerion 查到的项目,项目名和链都对上我们的配方(配方 JSON 的 zerion 字段)才算有指南;同名项目在别的链上不算
const recipeFor = (g) => recipes.find((r) => r.zerion?.chains.includes(g.chain) && r.zerion.apps.some((a) => g.app.toLowerCase().includes(a.toLowerCase())));

async function loadAssets() {
  assetsBox.hidden = false;
  assetsBox.replaceChildren(el("h2", {}, t("assetsH")), el("p", { class: "sub" }, el("span", { class: "spin", "aria-hidden": "true" }), " ", t("assetsLoading")));
  let res = null;
  try {
    const r = await fetch("/api/assets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ a: addr }), credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
    res = await r.json();
  } catch { /* 当没查成 */ }
  paintAssets(res);
  render(); // 「没查到」那段的说法跟着变
}

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

function walletRow(g) {
  const list = g.tokens.map((x) => `${x.sym} ${qty(x.qty)}`).join(" · ") + (g.more ? ` · ${t("assetsMore", g.more)}` : "");
  return el("div", { class: "aw" }, el("b", {}, g.chain), el("span", { class: "mono" }, `$${usd(g.usd)}`), el("small", {}, list));
}

function paintAssets(res) {
  const s = res?.status;
  assetsState = s === "ok" || s === "empty" || s === "off" ? s : "error";
  assetsRes = s === "ok" ? res : null;
  if (s === "off") return void (assetsBox.hidden = true);
  const head = [el("h2", {}, t("assetsH")), el("p", { class: "sub" }, t("assetsSub"))];
  const priv = el("p", { class: "fine" }, t("assetsPriv"));
  if (s === "empty") return assetsBox.replaceChildren(...head, el("p", { class: "sub" }, t("assetsEmpty")), priv);
  if (s !== "ok") {
    const b = el("button", { class: "btn small", type: "button" }, icon("refresh"), t("retry"));
    b.addEventListener("click", loadAssets);
    return assetsBox.replaceChildren(...head, el("p", { class: "sub" }, t(s === "busy" ? "assetsBusy" : "assetsFail")), b);
  }
  assetsBox.replaceChildren(...head,
    ...(res.defi.length ? [el("h3", {}, t("assetsDefiH", usd(res.totals.defi))), el("p", { class: "sub" }, t("assetsDefiP")), ...res.defi.map(defiCard)] : []),
    ...(res.wallet.length ? [el("h3", {}, t("assetsWalletH", usd(res.totals.wallet))), el("p", { class: "sub" }, t("assetsWalletP")), el("div", { class: "awallet" }, ...res.wallet.map(walletRow))] : []),
    res.dust ? el("p", { class: "fine" }, t("assetsDust", res.dust)) : null,
    priv);
}

// 同一个标签页里只改了 # 后面的地址:整页重新查,不让旧账户的结果挂着新地址
window.addEventListener("hashchange", () => location.reload());

cards.addEventListener("click", (e) => {
  const b = e.target.closest("[data-retry]");
  if (b) run(recipes.filter((r) => r.id === b.dataset.retry));
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
