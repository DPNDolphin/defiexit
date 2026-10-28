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
}));
const usd = (x) => floorTo(x, 2).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const $ = (id) => document.getElementById(id);
const badge = $("sumBadge"), line = $("sumLine"), big = $("sumBig"), note = $("sumNote"), cards = $("cards");
const addr = (new URLSearchParams(location.hash.slice(1)).get("a") || "").trim();
const results = new Map(); // 配方 id → { res } 或 { err }

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
    rowsTable(res.rows, { label: t("expected"), value: `${res.vars.arrive} USDC` }),
    miniRoute(r, res.flags),
    res.warnings.length ? el("ul", { class: "warns" }, res.warnings.map((w) => el("li", {}, icon("alert"), el("span", {}, w)))) : null,
    r.chips.length ? el("ul", { class: "chips" }, r.chips.map((c) => el("li", {}, icon(c.icon), el("span", {}, c.text)))) : null,
    el("a", { class: "btn primary block", href: guide }, t("startGuide"), icon("arrowRight")));
}

function dustCard(r, res) {
  return el("article", { class: "rcard" },
    el("div", { class: "rcard-h" }, el("h2", {}, r.protocol), el("span", { class: "chip" }, t("dustBadge"))),
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
  badge.replaceChildren(icon("check"), el("span", {}, t("checked")));
  badge.className = "badge ok";
  if (found.length) {
    setText(line, t("foundN", found.length));
    setText(big, t("about", usd(found.reduce((s, x) => s + x.res.usd, 0))));
    setText(note, t("calcNote"));
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
  if (!found.length && !dust.length && !failed.length) {
    nodes.push(el("section", { class: "nothing" },
      el("h2", {}, t("nothingH")),
      el("p", { class: "sub" }, t("nothingP", recipes.map((r) => r.protocol).join(lang === "en" ? ", " : "、"))),
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
}
