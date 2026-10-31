// 检查结果页:# 后面的地址 → 三路一起查,合成一张清单:「存在项目里的」「钱包里的」。
//   ① 我们有指南的项目:各检测器在浏览器里直接只读查官方接口,查到就给一步一图的指南;
//   ② 全部资产:经本站接口交给 Zerion 查 40 多条链上的钱包余额和项目仓位;
//   ③ Zerion 查不到的链(X Layer、Merlin):浏览器直接只读查公共节点的钱包余额。
// 只列查到的,没查到的项目不列:只显示有什么。查不成的照实说,给「重试」。
// 每一张都有「取回」:有指南的进指南;没有的打开取回弹层,按仓位类型给通用取法,钱包里的币说怎么转出、手续费够不够。
import "./site.js";
import { detectors } from "./detectors/index.js";
import { isEvmAddress, shortAddr, floorTo } from "./lib/net.js";
import { el, icon, rowsTable, setText, copy, toast } from "./lib/ui.js";
import { makeT, pageLang, prefix, errText } from "./lib/i18n.js";
import { chainLogo, chainKey, gasSym, EXTRA } from "./lib/chains.js";
import { HOW } from "./lib/xlayer.text.js";

const lang = pageLang(), t = makeT(lang), P = prefix(lang);
const recipes = [...document.querySelectorAll("#recipes li")].map((li) => ({
  ...li.dataset,
  milestones: JSON.parse(li.dataset.milestones || "[]"),
  chips: JSON.parse(li.dataset.chips || "[]"),
  zerion: JSON.parse(li.dataset.zerion || "null"),
}));
const usd = (x) => floorTo(x, 2).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (x) => (x >= 1000 ? Math.round(x).toLocaleString("en-US") : x.toLocaleString("en-US", { maximumSignificantDigits: 6 }));
const $ = (id) => document.getElementById(id);
const badge = $("sumBadge"), line = $("sumLine"), big = $("sumBig"), note = $("sumNote"), cards = $("cards");
const sheet = $("exitSheet"), sheetH = $("exitH"), sheetBody = $("exitBody");
const addr = (new URLSearchParams(location.hash.slice(1)).get("a") || "").trim();
const results = new Map(); // 配方 id → { res } 或 { err }
const extra = new Map(); // Zerion 查不到的链:链编号 → { res } 或 { err }
let assets = { state: "pending", res: null }; // 全部资产:pending / ok / empty / off / busy / error
let lists = { defi: [], wallet: [] }; // 清单上正显示的,「取回」按钮按序号找

// Zerion 查到的项目,项目名和链都对上我们的配方(配方 JSON 的 zerion 字段)才算有指南;同名项目在别的链上不算
const recipeFor = (g) => recipes.find((r) => r.zerion?.chains.includes(g.chain) && r.zerion.apps.some((a) => g.app.toLowerCase().includes(a.toLowerCase())));
const chainChip = (cid, name, text = name) => el("span", { class: "chip" }, chainLogo(cid, name), text);

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
    el("div", { class: "rcard-h" }, el("h4", {}, r.protocol), chainChip(r.chain, r.chain, r.route)),
    rowsTable(res.rows, res.total || { label: t("expected"), value: `${res.vars.arrive} USDC` }),
    miniRoute(r, res.flags),
    res.warnings.length ? el("ul", { class: "warns" }, res.warnings.map((w) => el("li", {}, icon("alert"), el("span", {}, w)))) : null,
    r.chips.length ? el("ul", { class: "chips" }, r.chips.map((c) => el("li", {}, icon(c.icon), el("span", {}, c.text)))) : null,
    el("a", { class: "btn primary block", href: guide }, icon("exit"), t("exitGuideBtn")));
}

// 我们有指南、查到了但太少(比如低于最小提现额):指南里写了门槛和办法
function dustCard(r, res) {
  return el("article", { class: "rcard" },
    el("div", { class: "rcard-h" }, el("h4", {}, r.protocol), chainChip(r.chain, r.chain, res.badge || t("dustBadge"))),
    res.rows.length ? rowsTable(res.rows) : null,
    res.note ? el("p", { class: "sub" }, res.note) : null,
    res.warnings.length ? el("ul", { class: "warns" }, res.warnings.map((w) => el("li", {}, icon("alert"), el("span", {}, w)))) : null,
    el("a", { class: "btn block", href: `${P}/r/${r.id}/#a=${addr}` }, icon("exit"), t("exitBtn")));
}

const itemRows = (g) => g.items.map((x) => ({
  label: `${t("assetType", x.type)} · ${x.sym}`,
  hint: x.usd === null ? t("assetsUnknown") : `${qty(x.qty)} ${x.sym}`,
  value: x.usd === null ? `${qty(x.qty)} ${x.sym}` : `$${usd(x.usd)}`,
}));

// 我们自己核对过取法、还没做成一步一图的仓位(X Layer 的 OKX Boost、DYORSwap):弹层里给专门的取法
const when = (sec) => new Date(sec * 1000).toLocaleString(lang === "en" ? "en-US" : "zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const howOf = (g) => g.how && HOW[lang]?.[g.how]?.({
  ready: g.ready, date: g.end ? when(g.end) : "",
  got: g.items.map((x) => `${qty(x.qty)} ${x.sym === "WOKB" ? "OKB" : x.sym}`).join(lang === "en" ? " + " : " 和 "),
});

// 项目仓位(Zerion 查到的,或者我们自己在 X Layer 上查到的)
function defiCard(g, i) {
  const r = recipeFor(g), h = howOf(g);
  return el("article", { class: "rcard" },
    el("div", { class: "rcard-h" }, el("h4", {}, g.app), chainChip(g.cid, g.chain)),
    h?.note ? el("p", { class: "sub" }, h.note) : null,
    rowsTable(itemRows(g)),
    g.debt > 0 ? el("ul", { class: "warns" }, el("li", {}, icon("alert"), el("span", {}, t("assetsDebt", usd(g.debt))))) : null,
    r ? el("a", { class: "btn primary block", href: `${P}/r/${r.id}/#a=${addr}&go=1` }, icon("exit"), t("exitGuideBtn"))
      : el("button", { class: "btn primary block", type: "button", "data-exit": `d${i}` }, icon("exit"), t("exitBtn")));
}

// 钱包余额,一条链一行
function walletRow(g, i) {
  const list = g.tokens.map((x) => `${x.sym} ${qty(x.qty)}`).join(" · ") + (g.more ? ` · ${t("assetsMore", g.more)}` : "");
  return el("div", { class: "aw" }, chainLogo(g.cid, g.chain), el("b", {}, g.chain), el("span", { class: "mono" }, `$${usd(g.usd)}`),
    el("button", { class: "btn small", type: "button", "data-exit": `w${i}` }, t("exitBtn")),
    el("small", {}, list));
}

// 查不成的一行:哪一路、为什么、重试
function failRow(name, text, retry) {
  return el("div", { class: "rline" }, el("b", {}, name), el("span", { class: "sub" }, text),
    el("button", { class: "btn small", type: "button", "data-retry": retry }, icon("refresh"), t("retry")));
}

// Zerion 查到的项目 + 我们自己查到的:同一条链上项目名对得上的,用 Zerion 的
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
function mergeDefi(z, more) {
  return [...z, ...more.filter((x) => !z.some((g) => chainKey(g.cid, g.chain) === chainKey(x.cid, x.chain) && (norm(g.app).includes(norm(x.app)) || norm(x.app).includes(norm(g.app)))))]
    .sort((a, b) => b.usd - a.usd);
}

// Zerion 的钱包余额 + 我们自己查的两条链。同一条链两边都有:只补 Zerion 没有的币
function mergeWallet(z, more) {
  const out = z.map((g) => ({ ...g, tokens: [...g.tokens] }));
  const key = (x) => (x.native ? "native" : x.addr || x.sym);
  for (const x of more) {
    const same = out.find((g) => chainKey(g.cid, g.chain) === chainKey(x.cid, x.chain));
    if (!same) {
      out.push(x);
      continue;
    }
    const has = new Set(same.tokens.map(key));
    for (const tk of x.tokens) if (!has.has(key(tk))) { same.tokens.push(tk); same.usd += tk.usd || 0; }
    if (!same.gas) same.gas = x.gas;
  }
  return out.sort((a, b) => b.usd - a.usd);
}

// ---------- 合成一张清单 ----------

function paint() {
  const recipesDone = recipes.every((r) => results.has(r.id));
  const assetsDone = assets.state !== "pending";
  const extraDone = EXTRA.every((c) => extra.has(c.cid));
  const done = recipesDone && assetsDone && extraDone;
  const all = recipes.map((r) => ({ r, ...results.get(r.id) }));
  const found = all.filter((x) => x.res?.status === "found");
  const dust = all.filter((x) => x.res?.status === "dust");
  const failed = all.filter((x) => x.err);
  const xFailed = EXTRA.filter((c) => extra.get(c.cid)?.err);
  // Zerion 或我们自己在 X Layer 上查到的仓位,和配方对上、而且配方已经查到的,不重复列(比如 OKX Boost)
  const shown = new Set([...found, ...dust].map((x) => x.r.id));
  const xs = EXTRA.map((c) => extra.get(c.cid)?.res).filter(Boolean);
  const zDefi = mergeDefi(assets.res?.defi || [], xs.flatMap((x) => x.defi || [])).filter((g) => !shown.has(recipeFor(g)?.id));
  const wallets = mergeWallet(assets.res?.wallet || [], xs.map((x) => x.wallet).filter(Boolean));
  lists = { defi: zDefi, wallet: wallets };
  const nDefi = found.length + zDefi.length;
  const defiUsd = found.reduce((s, x) => s + x.res.usd, 0) + zDefi.reduce((s, g) => s + g.usd, 0);
  const walletUsd = wallets.reduce((s, g) => s + g.usd, 0);
  const guided = found.length + zDefi.filter(recipeFor).length;
  const partial = failed.length > 0 || xFailed.length > 0 || assets.state === "busy" || assets.state === "error";

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
  } else if (wallets.length && done) {
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
  if (wallets.length) {
    nodes.push(el("h3", { class: "list-h" }, t("assetsWalletH", usd(walletUsd))), el("p", { class: "sub" }, t("assetsWalletP")),
      el("div", { class: "awallet" }, ...wallets.map(walletRow)));
  }
  if (!done) nodes.push(el("div", { class: "rcard skeleton", "aria-hidden": "true" }));
  for (const x of failed) nodes.push(failRow(x.r.protocol, t("failRow", errText(t, x.err)), x.r.id));
  for (const c of xFailed) nodes.push(failRow(c.chain, t("failRow", errText(t, extra.get(c.cid).err)), `x:${c.cid}`));
  if (assets.state === "busy" || assets.state === "error") nodes.push(failRow(t("assetsH"), t(assets.state === "busy" ? "assetsBusy" : "assetsFail"), "assets"));
  if (done && !nDefi && !dust.length && !wallets.length && !partial) {
    // 什么都没查到。查了全部资产的,照实说查了多少;没接全部资产(off)才叫用户自己去 DeBank 看
    const list = recipes.map((r) => r.protocol).join(lang === "en" ? ", " : "、");
    nodes.push(el("section", { class: "nothing" },
      el("h2", {}, assets.state === "empty" ? t("nothingAllH") : t("nothingH", recipes.length)),
      el("p", { class: "sub" }, assets.state === "empty" ? t("nothingAllP") : t("nothingP", list)),
      assets.state === "empty" ? null : el("p", { class: "sub" }, t("nothingTip")),
      el("a", { class: "btn primary block", href: `${P}/` }, t("another"))));
  }
  // 没价格的币(多半是空投来的仿冒币)只说个数
  const unpriced = (assets.res?.unpriced || 0) + xs.reduce((s, x) => s + (x.wallet?.unpriced || 0), 0);
  if (assets.res || wallets.length) {
    nodes.push(el("p", { class: "fine" }, t("assetsSub")),
      assets.res?.dust ? el("p", { class: "fine" }, t("assetsDust", assets.res.dust)) : null,
      unpriced ? el("p", { class: "fine" }, t("assetsUnpriced", unpriced)) : null,
      el("p", { class: "fine" }, t("assetsPriv")));
  }
  cards.replaceChildren(...nodes.filter(Boolean));
}

// ---------- 取回弹层(没有指南的项目、钱包里的币) ----------

// 仓位是哪一类 → 通用取法的哪一条(按 Zerion 的仓位类型和项目模块)
const KINDS = ["lp", "deposit", "staked", "locked", "vesting", "reward", "investment", "other"];
function kindOf(x) {
  if (x.mod === "liquidity-pool") return "lp";
  if (x.mod === "vesting") return "vesting";
  if (x.type === "reward" || x.mod === "rewards") return "reward";
  if (x.type === "locked" || x.mod === "locked") return "locked";
  if (x.type === "staked" || ["staked", "farming", "nft-staked"].includes(x.mod)) return "staked";
  if (x.type === "investment") return "investment";
  return x.type === "deposit" ? "deposit" : "other";
}

const steps = (list) => el("ol", { class: "marks xs" },
  list.filter(Boolean).map((s, i) => el("li", {}, el("span", { class: "n", "aria-hidden": "true" }, String(i + 1)), el("div", { class: "t" }, s))));
const tail = () => [
  el("button", { class: "btn block", type: "button", "data-recheck": "" }, icon("refresh"), t("exitRecheck")),
  el("p", { class: "fine" }, t("exitNoSign")),
];
const chainLine = (g) => el("p", { class: "chainline" }, chainLogo(g.cid, g.chain), g.chain);
const finding = (cls, mark, head, text) => el("div", { class: `finding ${cls}` }, el("span", { class: "mk" }, icon(mark)), el("div", {}, el("b", {}, head), el("p", {}, text)));
// 复制一行:合约地址前面写币名、显示缩写;网址整条显示(长了就折行)
const copyRow = (text, label = null) => el("div", { class: "copyrow" },
  label ? el("span", {}, el("b", {}, label), " ", el("code", {}, shortAddr(text))) : el("span", { class: "url" }, text),
  el("button", { class: "copy", type: "button", "data-copy": text, "aria-label": `${t("copy")} ${label || ""}`.trim() }, icon("copy"), t("copy")));

// 专门的取法(我们核对过的仓位)
function exitHow(g, h) {
  return [
    chainLine(g),
    rowsTable(itemRows(g)),
    h.status ? finding(h.status.ok ? "ok" : "wait", h.status.ok ? "check" : "clock", h.status.head, h.status.text) : null,
    h.warn ? el("p", { class: "tip bad" }, icon("x"), el("span", {}, h.warn)) : null,
    el("p", { class: "sub" }, h.lead),
    steps(h.steps.map((s) => (typeof s === "string" ? s : el("div", {}, s.text, copyRow(s.copy))))),
    h.after ? el("p", { class: "tip" }, icon("info"), el("span", {}, h.after)) : null,
    ...tail(),
    el("p", { class: "fine" }, HOW[lang].foot),
  ];
}

function exitDefi(g) {
  const kinds = new Set(g.items.filter((x) => x.type !== "loan").map(kindOf));
  return [
    chainLine(g),
    rowsTable(itemRows(g)),
    g.debt > 0 ? el("ul", { class: "warns" }, el("li", {}, icon("alert"), el("span", {}, t("exitDebt", usd(g.debt))))) : null,
    el("p", { class: "sub" }, t("exitDefiLead", g.app)),
    steps([
      el("div", {}, t("exitOpen", g.app), el("p", { class: "tip" }, icon("alert"), el("span", {}, t("exitOpenTip")))),
      t("exitConnect", g.chain),
      ...KINDS.filter((k) => kinds.has(k)).map((k) => t("exitKind", k)),
      t("exitSign"),
      t("exitDone"),
    ]),
    ...tail(),
  ];
}

function gasNote(g) {
  if (!("gas" in g)) return null; // 旧的缓存结果里没有这一项:不下结论
  const sym = g.gas?.sym || gasSym(g.cid, g.chain);
  if (!g.gas) return finding("wait", "alert", t("exitGasNone", sym), t("exitGasNoneP", sym, g.chain));
  if (g.gas.usd !== null && g.gas.usd < 0.01) return finding("wait", "alert", t("exitGasLow", qty(g.gas.qty), g.gas.sym), t("exitGasLowP", g.gas.sym, g.chain));
  return finding("ok", "check", t("exitGasOk", qty(g.gas.qty), g.gas.sym), t("exitGasOkP"));
}

function exitWallet(g) {
  const toks = g.tokens.filter((x) => !x.native && x.addr);
  return [
    chainLine(g),
    rowsTable(g.tokens.map((x) => ({ label: x.sym, hint: x.usd === null ? t("assetsUnknown") : null, value: x.usd === null ? qty(x.qty) : `${qty(x.qty)} · $${usd(x.usd)}` }))),
    gasNote(g),
    g.usd < 1 ? el("p", { class: "tip" }, icon("info"), el("span", {}, t("exitDust", usd(g.usd)))) : null,
    el("p", { class: "sub" }, t("exitWalletLead")),
    steps([
      t("exitSwitch", g.chain),
      toks.length ? el("div", {}, t("exitAddToken"), ...toks.map((x) => copyRow(x.addr, x.sym))) : null,
      t("exitMove", g.chain),
      t("exitWDone"),
    ]),
    ...tail(),
  ];
}

function openExit(id) {
  const g = id[0] === "d" ? lists.defi[Number(id.slice(1))] : lists.wallet[Number(id.slice(1))];
  if (!g) return;
  const h = id[0] === "d" ? howOf(g) : null;
  setText(sheetH, h ? h.title : id[0] === "d" ? t("exitDefiH", g.app) : t("exitWalletH", g.chain));
  sheetBody.replaceChildren(...(h ? exitHow(g, h) : id[0] === "d" ? exitDefi(g) : exitWallet(g)).filter(Boolean));
  if (typeof sheet.showModal === "function") sheet.showModal();
  else sheet.setAttribute("open", "");
  sheet.scrollTop = 0;
}
function closeExit() {
  if (!sheet.hasAttribute("open")) return;
  if (typeof sheet.close === "function") sheet.close();
  else sheet.removeAttribute("open");
}

sheet.addEventListener("click", async (e) => {
  if (e.target === sheet) return closeExit();
  const c = e.target.closest(".copy");
  if (c) {
    const ok = await copy(c.dataset.copy);
    // 按钮本身也变一下色,不只靠底部的提示
    if (ok) {
      c.classList.add("ok");
      setTimeout(() => c.classList.remove("ok"), 1600);
    }
    return toast(ok ? t("copied", c.dataset.copy) : t("copyFail"));
  }
  if (e.target.closest("[data-recheck]")) {
    // 用户取完回来再查:不用缓存,三路全部重查
    closeExit();
    window.scrollTo(0, 0);
    loadAssets({ fresh: true });
    runExtra(EXTRA);
    run(recipes);
  }
});
$("exitClose").addEventListener("click", closeExit);

// ---------- 三路查询 ----------

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

// Zerion 查不到的链:一条链查完就先显示出来
async function runExtra(list) {
  for (const c of list) extra.delete(c.cid);
  paint();
  await Promise.all(list.map(async (c) => {
    try {
      extra.set(c.cid, { res: await c.query(addr) });
    } catch (err) {
      extra.set(c.cid, { err });
    }
    paint();
  }));
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
  const x = e.target.closest("[data-exit]");
  if (x) return openExit(x.dataset.exit);
  const b = e.target.closest("[data-retry]");
  if (!b) return;
  const k = b.dataset.retry;
  if (k === "assets") loadAssets({ fresh: true });
  else if (k.startsWith("x:")) runExtra(EXTRA.filter((c) => c.cid === k.slice(2)));
  else run(recipes.filter((r) => r.id === k));
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
  runExtra(EXTRA);
}
