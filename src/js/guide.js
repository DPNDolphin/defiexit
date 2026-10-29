// 指南页:先看概况,再一页一步。「你在这里 → 出口」路线进度;签名前逐项打勾才能往下走;
// 遇到问题 → 底部弹出现场诊断 + 这一步的常见情况;按用户账户填数字、跳过用不到的步骤;
// 从官网回来时自动再查一次;最后一步逐笔核对到账,对上了才显示「已到账」。
import "./site.js";
import { detectors, diagnosers } from "./detectors/index.js";
import { isEvmAddress, shortAddr, floorTo } from "./lib/net.js";
import { el, icon, route, rowsTable, toast, copy, contact, setText } from "./lib/ui.js";
import { makeT, pageLang, prefix, errText } from "./lib/i18n.js";
import { zh } from "./lib/zh.js";
import { setupShot } from "./shot.js";
import { mountWalletRead } from "./lib/wallet.js";

const lang = pageLang(), t = makeT(lang), P = prefix(lang);
const $ = (id) => document.getElementById(id);
const art = $("guide");
const detect = detectors[art.dataset.detector];
const diagnose = diagnosers[art.dataset.detector];
const intro = $("intro"), doneBox = $("done"), bar = $("routeBar"), pager = $("pager"), follow = $("follow");
const steps = [...art.querySelectorAll(".step")];
const [prevBtn, nextBtn] = pager.querySelectorAll("[data-go]");
const mine = $("mine"), meForm = $("me"), meInput = $("addr");
const sheet = $("sheet"), diagBox = $("diag"), sheetSits = $("sheetSits"), sitsH = $("sitsH");
const lost = $("lost"); // 「页面和图里不一样?」的页面图鉴;配方没有图鉴时没有它
const shotView = $("lostShot"); // 图鉴里的「发截图给 AI 认」;没开这个功能时没有它
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

let flags = null;     // null:没填地址,所有步骤都显示
let base = null;      // 按账户算出来的原始数和开关(用户在现场诊断里改了选择,能退回来)
let addr = null;      // 用户填的地址:只在这一页的内存和 # 后面,不会发给我们
let pending = null;   // 正在算的那个地址和它的结果:{ a, done }(浏览器换 # 时会连着来两个事件,第二个要等第一个算完)
let here = null;      // 正在看的那一步;null 是概况页
let lastDiag = null, lastAt = 0;
let sheetFor = null;  // 弹层里现在放的是哪一步的常见情况
const ticks = new Map(); // 每一步的核对卡勾了哪几项
const picked = new Set(); // 在页面图鉴里点过哪几张(写进卡点报告)

const titleOf = (s) => s.querySelector(".step-title").textContent;
const isOpen = () => sheet.hasAttribute("open"); // 不认识 <dialog> 的老浏览器没有 sheet.open
// 「已经出来了」只认:到账逐笔对上了,而且诊断说前面没有别的事要做(账户里没剩能提的钱)
const finished = (d) => d?.arrival?.state === "arrived" && d.step === "arrive";
const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);
const visible = () => steps.filter((s) => !flags || !s.dataset.when || flags[s.dataset.when]);
const clean = (s) => s.replace(/\s+/g, "");

// ---------- 一页一步 ----------

function show(i, { push = true, scroll = true, keepHash = false } = {}) {
  closeSheet();
  closeLost();
  const vs = visible();
  const k = Math.max(-1, Math.min(i, vs.length - 1));
  here = k >= 0 ? vs[k] : null;
  intro.hidden = !!here;
  doneBox.hidden = true;
  for (const s of steps) s.hidden = s !== here;
  bar.hidden = pager.hidden = !here;
  follow.hidden = true;
  if (here) {
    drawRoute(vs, k);
    updatePager();
  }
  if (!keepHash) writeHash(here?.dataset.id, push);
  if (scroll) window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
}

// 地址变了、选择变了,步骤数可能变:按正在看的这一步重画
function refresh() {
  if (!here) return;
  const vs = visible(), i = vs.indexOf(here);
  if (i < 0) return show(0, { push: false }); // 正看着的这一步按账户用不到了
  drawRoute(vs, i);
  updatePager();
}

function drawRoute(vs, i) {
  const r = route(vs.length, i);
  r.id = "route";
  r.setAttribute("aria-label", zh(t("routeAriaStep", i + 1, vs.length)));
  $("route").replaceWith(r);
  setText($("routePos"), t("stepOf", i + 1, vs.length));
  setText($("routeLeft"), vs[i].dataset.note || t("stepsLeft", vs.length - 1 - i));
}

const label = (btn, text, arrow) => btn.replaceChildren(el("span", {}, text), ...(arrow ? [icon("arrowRight")] : []));

function updatePager() {
  const vs = visible(), i = vs.indexOf(here);
  if (i < 0) return;
  const need = Number(here.dataset.checks || 0), got = ticks.get(here.dataset.id)?.size || 0;
  nextBtn.disabled = need > 0 && got < need;
  if (need && got < need) label(nextBtn, t("checkGate", got, need), false);
  else if (need) label(nextBtn, t("checkDone"), true);
  else if (i === vs.length - 1) label(nextBtn, addr && diagnose ? t("checkArrival") : t("finish"), !!(addr && diagnose));
  else label(nextBtn, t("next"), true);
}

prevBtn.addEventListener("click", () => show(visible().indexOf(here) - 1));
nextBtn.addEventListener("click", () => {
  const vs = visible(), i = vs.indexOf(here);
  if (i === vs.length - 1) return finish();
  show(i + 1);
});
$("start").addEventListener("click", () => show(0));

// 最后一步:有地址就去链上逐笔核对到账;对上了显示「已到账」,没对上就打开现场诊断
async function finish() {
  if (!addr || !diagnose) {
    location.href = `${P}/`;
    return;
  }
  nextBtn.disabled = true;
  label(nextBtn, t("checking"), false);
  try {
    const d = await diagnose(addr, Date.now(), lang);
    lastDiag = d;
    lastAt = Date.now();
    if (finished(d)) return showDone(d);
    openSheet(d);
  } catch {
    openSheet();
  } finally {
    updatePager();
  }
}

// 现场诊断说该在某一步:那一步要是按账户被跳过了,先放出来
function reveal(id) {
  const s = steps.find((x) => x.dataset.id === id);
  if (s && flags && s.dataset.when && !flags[s.dataset.when]) flags = { ...flags, [s.dataset.when]: true };
  return s || null;
}
function gotoStep(id) {
  const s = reveal(id);
  if (s) show(visible().indexOf(s));
}

// 手机上左右滑翻页(在截图上滑不算,方便放大看图)
let touch = null;
$("steps").addEventListener("touchstart", (e) => {
  touch = e.touches.length === 1 && !e.target.closest("figure") ? [e.touches[0].clientX, e.touches[0].clientY] : null;
}, { passive: true });
$("steps").addEventListener("touchend", (e) => {
  if (!touch || !here) return;
  const dx = e.changedTouches[0].clientX - touch[0], dy = e.changedTouches[0].clientY - touch[1];
  touch = null;
  if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return;
  if (dx < 0 && !nextBtn.disabled) nextBtn.click();
  else if (dx > 0) prevBtn.click();
}, { passive: true });
document.addEventListener("keydown", (e) => {
  if (!here || isOpen() || isLostOpen() || e.target.closest("input, textarea, select, [contenteditable]")) return;
  if (e.key === "ArrowRight" && !nextBtn.disabled) nextBtn.click();
  if (e.key === "ArrowLeft") prevBtn.click();
});

// ---------- 地址和 # ----------

function writeHash(stepId, push) {
  const p = new URLSearchParams();
  if (addr) p.set("a", addr);
  if (stepId) p.set("s", stepId);
  const q = p.toString();
  const url = location.pathname + (q ? `#${q}` : "");
  if (url !== location.pathname + location.hash) history[push ? "pushState" : "replaceState"](null, "", url);
}

async function applyHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  const a = clean(p.get("a") || "");
  if (isEvmAddress(a) && a !== addr) {
    const job = pending?.a === a ? pending : (pending = { a, done: personalize(a) });
    meInput.value = a;
    const ok = await job.done;
    if (pending === job) pending = null;
    // 查不成:停在概况页,让用户看到为什么(检测器可能在说「先别照指南操作」),# 里的地址也留着
    if (!ok) return show(-1, { push: false, keepHash: true });
  }
  if (p.get("go")) return show(0, { push: false });
  const s = p.get("s");
  const vs = visible(), i = s ? vs.findIndex((x) => x.dataset.id === s) : -1;
  show(i, { push: false, scroll: vs[i] !== here });
}

// ---------- 按用户账户算 ----------

function setVars(vars) {
  for (const [k, v] of Object.entries(vars)) for (const n of art.querySelectorAll(`[data-var="${k}"]`)) n.textContent = v;
}

// 页面上变量的原始说明文字(「你的 USDH 数量」这类),查不成时换回来
const defaults = [...art.querySelectorAll("[data-var]")].map((n) => [n, n.textContent]);

// 按新地址查不成:之前那个地址算出来的数和开关全部作废,回到通用步骤
function unpersonalize() {
  addr = null;
  base = null;
  flags = null;
  for (const [n, v] of defaults) n.textContent = v;
  art.classList.remove("personal");
  $("exit").href = `${P}/`;
  resetTicks();
  refresh();
}

// 核对卡上的数(地址、金额)变了,之前打的勾就不算数,要重新核对
function resetTicks() {
  ticks.clear();
  for (const b of art.querySelectorAll('.tick[aria-pressed="true"]')) b.setAttribute("aria-pressed", "false");
}

async function personalize(a) {
  mine.hidden = false;
  mine.replaceChildren(el("p", { class: "sub" }, el("span", { class: "spin", "aria-hidden": "true" }), " ", t("calcing")));
  try {
    const res = await detect(a, lang);
    addr = a;
    base = { vars: res.vars, flags: res.flags };
    flags = { ...res.flags };
    setVars(res.vars);
    resetTicks();
    art.classList.add("personal");
    $("exit").href = `${P}/check/#a=${a}`;
    const skipped = steps.length - visible().length;
    // 账户已经空了(多半是刚提完):不说「跳过了几步」「统一账户」这些,直接指去核对到账
    const empty = res.status === "empty";
    const toArrive = empty ? el("button", { class: "btn small", type: "button" }, t("toArrive"), icon("arrowRight")) : null;
    toArrive?.addEventListener("click", () => gotoStep("arrive"));
    mine.replaceChildren(...[
      el("div", { class: "mine-h" }, el("h2", {}, t("yourAccount")), el("span", { class: "chip mono" }, shortAddr(a))),
      res.rows.length ? rowsTable(res.rows, res.status === "found" ? res.total || { label: t("expected"), value: `${res.vars.arrive} USDC` } : null) : el("p", { class: "sub" }, empty ? t("emptyAcct") : t("noBalance")),
      res.warnings.length ? el("ul", { class: "warns" }, res.warnings.map((w) => el("li", {}, icon("alert"), el("span", {}, w)))) : null,
      res.note && !empty ? el("p", { class: "sub" }, res.note) : null,
      skipped && !empty ? el("p", { class: "sub" }, t("skipped", skipped)) : null,
      empty ? el("p", { class: "sub" }, t("emptyArrive")) : null,
      toArrive,
      el("p", { class: "sub" }, t("stuckHint")),
    ].filter(Boolean));
    refresh();
    return true;
  } catch (err) {
    unpersonalize();
    mine.replaceChildren(el("p", { class: "err" }, t("calcFail", errText(t, err))));
    return false;
  }
}

meForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const a = clean(meInput.value);
  if (!isEvmAddress(a)) return toast(t("badAddr"));
  if (await personalize(a)) writeHash(here?.dataset.id, false);
});
mountWalletRead(meInput, t);

// ---------- 遇到问题:底部弹层 ----------

function openSheet(preloaded = null) {
  if (isOpen()) return preloaded && paintDiag(preloaded);
  sheetFor = here;
  // 把这一步的常见情况挪进弹层,关的时候放回去
  const help = here?.querySelector(".help");
  if (help) sheetSits.append(...help.children);
  sitsH.hidden = !sheetSits.children.length;
  setText(sitsH, addr ? t("sitsH") : t("sitsHFirst"));
  if (typeof sheet.showModal === "function") sheet.showModal();
  else sheet.setAttribute("open", "");
  if (preloaded) paintDiag(preloaded);
  else runDiag();
}
// 常见情况放回原来那一步(关弹层时马上放回;按返回键关掉的,在 close 事件里放回。放过一次就不再放)
function restoreSits() {
  if (!sheetFor) return;
  const help = sheetFor.querySelector(".help");
  if (help) help.append(...sheetSits.children);
  sheetSits.replaceChildren();
  sheetFor = null;
}
function closeSheet() {
  if (!isOpen()) return;
  restoreSits();
  if (typeof sheet.close === "function") sheet.close();
  else sheet.removeAttribute("open");
}
sheet.addEventListener("close", restoreSits);
sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(); });
$("sheetClose").addEventListener("click", closeSheet);
$("recheck").addEventListener("click", () => runDiag());
$("stuckBtn").addEventListener("click", () => openSheet());

// ---------- 页面和图里不一样:页面图鉴 ----------
// 链上查得到账户到了哪一步,查不到用户手机上是哪个页面:让用户点最像的那张,显示审过的答案

function isLostOpen() {
  return !!lost?.hasAttribute("open");
}
function openLost() {
  if (!lost) return;
  closeSheet();
  lostPick();
  if (typeof lost.showModal === "function") lost.showModal();
  else lost.setAttribute("open", "");
}
function closeLost() {
  if (!isLostOpen()) return;
  if (typeof lost.close === "function") lost.close();
  else lost.removeAttribute("open");
}
function lostPick() {
  $("lostPick").hidden = false;
  $("lostAns").hidden = true;
  if (shotView) shotView.hidden = true;
  lost.scrollTop = 0;
}
// 图鉴说「去某一步」或「某一步之后的下一步」(按这个账户用得到的步骤算,比如没奖励就直接到解押)
function lostTarget(b) {
  if (b.dataset.scrAfter) {
    const i = steps.findIndex((s) => s.dataset.id === b.dataset.scrAfter);
    return visible().find((s) => steps.indexOf(s) > i) || null;
  }
  return steps.find((s) => s.dataset.id === b.dataset.scrGo) || null;
}
function lostShow(id) {
  const a = [...lost.querySelectorAll("[data-scr-a]")].find((x) => x.dataset.scrA === id);
  if (!a) return;
  picked.add(id);
  for (const x of lost.querySelectorAll("[data-scr-a]")) x.hidden = x !== a;
  const b = a.querySelector("[data-scr-go]");
  const s = b && lostTarget(b);
  // 认出了页面,不等于这个账户要做那一步:按账户用不到的步骤不放出来,只说明一句
  const unneeded = !!(s && flags && s.dataset.when && !flags[s.dataset.when]);
  $("lostSkip").hidden = !unneeded;
  if (b) {
    b.hidden = !s || unneeded;
    if (s && !unneeded) {
      const vs = visible(), list = vs.includes(s) ? vs : steps.filter((x) => vs.includes(x) || x === s);
      label(b, s === here ? t("lostStay") : t("goStep", list.indexOf(s) + 1, titleOf(s)), s !== here);
    }
  }
  $("lostPick").hidden = true;
  $("lostAns").hidden = false;
  if (shotView) shotView.hidden = true;
  lost.scrollTop = 0;
}
function lostGo(b) {
  const s = lostTarget(b);
  closeLost();
  if (s && s !== here) gotoStep(s.dataset.id);
}
if (lost) {
  lost.addEventListener("click", (e) => { if (e.target === lost) closeLost(); });
  $("lostClose").addEventListener("click", closeLost);
  $("lostBack").addEventListener("click", lostPick);
  $("lostDiag").addEventListener("click", () => { closeLost(); openSheet(); });
  $("lostReport").addEventListener("click", () => report(here));
  // 发截图给 AI 认:认出来的页面照样走 lostShow(审过的答案 + 去第几步);关掉弹层时原图、新图都丢掉
  const shot = setupShot({ t, lang, picked, showAnswer: lostShow });
  if (shot) {
    $("shotOpen").addEventListener("click", () => {
      shot.open();
      $("lostPick").hidden = true;
      $("lostAns").hidden = true;
      shotView.hidden = false;
      lost.scrollTop = 0;
    });
    $("shotBack").addEventListener("click", lostPick);
    lost.addEventListener("close", shot.close);
  }
}

function addrForm() {
  const input = el("input", { class: "input mono", spellcheck: "false", autocapitalize: "off", autocomplete: "off", placeholder: zh(t("addrPlaceholder")), "aria-label": zh(t("addrLabel")) });
  const f = el("form", { class: "form", novalidate: true }, el("p", { class: "sub" }, t("diagNeedAddr")), input, el("button", { class: "btn primary block", type: "submit" }, t("diagAddrBtn")));
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const a = clean(input.value);
    if (!isEvmAddress(a)) return toast(t("badAddr"));
    meInput.value = a;
    if (!(await personalize(a))) return;
    writeHash(here?.dataset.id, false);
    setText(sitsH, t("sitsH"));
    runDiag();
  });
  mountWalletRead(input, t);
  return f;
}

async function runDiag() {
  if (!diagnose) return diagBox.replaceChildren();
  if (!addr) return diagBox.replaceChildren(addrForm());
  diagBox.replaceChildren(el("p", { class: "sub" }, el("span", { class: "spin", "aria-hidden": "true" }), " ", t("diagLoading")));
  try {
    paintDiag(await diagnose(addr, Date.now(), lang));
  } catch (err) {
    diagBox.replaceChildren(el("p", { class: "err" }, t("diagFail", errText(t, err))));
  }
}

function paintDiag(d) {
  lastDiag = d;
  lastAt = Date.now();
  diagBox.replaceChildren(...renderDiag(d));
}

const MARK = { ok: "arrowRight", done: "check", wait: "clock", stop: "x", info: "info" };

function renderDiag(d) {
  const out = [el("p", { class: "sub at" }, t("diagAt", hhmm(d.at)))];
  for (const f of d.findings) {
    out.push(el("div", { class: `finding ${f.level}` }, el("span", { class: "mk" }, icon(MARK[f.level] || "info")), el("div", {}, f.head ? el("b", {}, f.head) : null, el("p", {}, f.text))));
  }
  if (finished(d)) out.push(el("button", { class: "btn primary block", type: "button", "data-done": "" }, t("seeDone"), icon("arrowRight")));
  const target = d.step && reveal(d.step);
  if (target) {
    refresh(); // 被跳过的步骤放出来了,当前这一步的编号可能变了
    const vs = visible(), n = vs.indexOf(target) + 1;
    out.push(el("div", { class: "where" }, route(vs.length, n - 1), el("p", {}, target === sheetFor ? t("whereHere") : t("whereAt", n, titleOf(target)))));
    if (target !== sheetFor && !finished(d)) out.push(el("button", { class: "btn primary block", type: "button", "data-goto": target.dataset.id }, t("goStep", n, titleOf(target)), icon("arrowRight")));
  }
  if (d.choice?.options) out.push(renderChoice(d.choice.options));
  out.push(el("details", { class: "raw" }, el("summary", {}, t("rawFacts")), el("ul", {}, d.facts.map((x) => el("li", {}, x)))));
  return out;
}

function renderChoice(c) {
  return el("div", { class: "choice" }, el("h3", {}, c.title), c.list.map((o, i) => el("div", { class: "opt" },
    el("b", {}, o.head), el("p", {}, o.body), o.warn ? el("p", { class: "opt-warn" }, o.warn) : null,
    o.pick ? el("button", { class: "btn small", type: "button", "data-pick": String(i) }, o.pick) : null)));
}

function pick(i) {
  const ap = lastDiag?.choice?.options?.list[i]?.apply;
  if (!ap || !base) return;
  setVars(ap.resetVars ? base.vars : ap.vars);
  resetTicks();
  flags = { ...base.flags, ...ap.flags };
  if (ap.goto) gotoStep(ap.goto);
  else show(0);
  toast(ap.toast, 7000);
}

async function report(s = sheetFor) {
  const n = s ? visible().indexOf(s) + 1 : 0;
  const codes = lastDiag ? lastDiag.findings.map((f) => f.code).join(", ") : t("reportNoDiag");
  // 看过的常见情况,加上在页面图鉴里点过的页面(screen:编号)
  const seen = [...[...sheetSits.querySelectorAll(".sit[open]")].map((x) => x.dataset.sit), ...[...picked].map((x) => `screen:${x}`)].join(", ") || t("reportNone");
  // 只有配方、步骤、诊断代码和看过的情况,不含地址和金额
  const ok = await copy(t("reportText", art.dataset.title, n, s ? titleOf(s) : "-", codes, seen));
  toast(ok ? t("reportToast", contact() ? t("reportWhere", contact()) : t("reportSoon")) : t("reportFail"), 7000);
}

// ---------- 到账:逐笔核对过才显示 ----------

function showDone(d) {
  closeSheet();
  const a = d.arrival, vs = visible(), ds = doneBox.dataset;
  const fee = Number(a.fee), net = Number(a.usdc);
  const total = Number.isFinite(fee) ? String(+(net + fee).toFixed(6)) : "?";
  // 一笔 USDC(Hyperliquid):大数字 + 三行核对;好几种币(WOOFi):每种一个数,逐笔列出从哪个合约来
  const amount = a.items
    ? el("ul", { class: "amounts" }, a.items.map((x) => el("li", {}, el("b", {}, x.amount), el("span", {}, x.sym))))
    : el("p", { class: "amount" }, el("b", {}, floorTo(net, 2).toFixed(2)), el("span", {}, "USDC"));
  const checked = a.items
    ? [...a.items.map((x) => x.text), t("doneTo", shortAddr(addr))]
    : [ds.from, t("doneTo", shortAddr(addr)), t("doneSum", total, Number.isFinite(fee) ? String(fee) : "?", String(net))];
  here = null;
  intro.hidden = bar.hidden = pager.hidden = follow.hidden = true;
  for (const s of steps) s.hidden = true;
  const r = route(vs.length, vs.length, true);
  r.setAttribute("aria-label", zh(t("routeAriaDone")));
  doneBox.replaceChildren(
    r,
    el("span", { class: "badge ok" }, icon("check"), el("span", {}, t("arrivedBadge"))),
    el("h1", { class: "display" }, t("doneH")),
    amount,
    el("p", { class: "sub" }, ds.where),
    el("section", { class: "card verified" },
      el("h2", {}, t("doneChecked")),
      el("ul", {}, checked.map((x) => el("li", {}, icon("check"), el("span", {}, x)))),
      el("p", { class: "sub" }, ds.look)),
    el("div", { class: "acts" },
      el("a", { class: "btn primary block", href: `${P}/` }, t("another2")),
      el("button", { class: "btn block", type: "button", "data-share": "" }, icon("share"), t("share"))),
    el("p", { class: "fine" }, t("remember")));
  doneBox.hidden = false;
  window.scrollTo({ top: 0, behavior: "auto" });
}

async function share() {
  const url = new URL(`${P}/`, document.querySelector('link[rel="canonical"]').href).href;
  if (navigator.share) {
    try { await navigator.share({ title: "DeFiExit", text: t("shareText"), url }); } catch { /* 用户取消了 */ }
    return;
  }
  toast((await copy(url)) ? t("shareCopied") : t("copyFail"));
}

// ---------- 点击:复制、打勾、弹层里的按钮 ----------

const varText = (k) => art.querySelector(`[data-var="${k}"]`)?.textContent || "";

art.addEventListener("click", async (e) => {
  const x = e.target;
  const c = x.closest(".copy");
  if (c) {
    const text = c.dataset.copy ?? c.dataset.copyVar.replace(/\{\{(\w+)\}\}/g, (_, k) => varText(k));
    const ok = await copy(text);
    // 按钮本身也变一下色,不只靠底部的提示
    if (ok) {
      c.classList.add("ok");
      setTimeout(() => c.classList.remove("ok"), 1600);
    }
    return toast(ok ? t("copied", text) : t("copyFail"));
  }
  if (x.closest("[data-lost]")) return openLost();
  const sc = x.closest("[data-scr]");
  if (sc) return lostShow(sc.dataset.scr);
  const sg = x.closest("[data-scr-go]");
  if (sg) return lostGo(sg);
  const tk = x.closest(".tick");
  if (tk) {
    const s = tk.closest(".step"), set = ticks.get(s.dataset.id) || new Set();
    if (set.has(tk.dataset.k)) set.delete(tk.dataset.k);
    else set.add(tk.dataset.k);
    ticks.set(s.dataset.id, set);
    tk.setAttribute("aria-pressed", String(set.has(tk.dataset.k)));
    if (s === here) updatePager();
    return;
  }
  if (x.closest("[data-open-sheet]")) return openSheet();
  // 这一步用不到(比如统一账户不用划转):明说跳过,不用假装打勾
  if (x.closest("[data-skip]")) return show(visible().indexOf(here) + 1);
  const go = x.closest("[data-goto]");
  if (go?.dataset.goto) return gotoStep(go.dataset.goto);
  if (x.closest("[data-follow-x]")) {
    follow.hidden = true;
    return;
  }
  const p = x.closest("[data-pick]");
  if (p) return pick(Number(p.dataset.pick));
  if (x.closest("[data-done]") && finished(lastDiag)) return showDone(lastDiag);
  if (x.closest("[data-share]")) return share();
  if (x.closest("#report")) return report();
});

// 从官网切回这一页时,自己再查一次;发现该换一步了,只提示,用户点了才翻
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !addr || !diagnose || Date.now() - lastAt < 15000) return;
  // 弹层开着:就在弹层里重新查一遍
  if (isOpen()) return runDiag();
  if (!here) return;
  lastAt = Date.now();
  try {
    const d = await diagnose(addr, Date.now(), lang);
    lastDiag = d;
    const target = d.step && reveal(d.step);
    refresh();
    if (target && here && target !== here) {
      setText(follow.querySelector("span"), t("follow", visible().indexOf(target) + 1, titleOf(target)));
      follow.querySelector("[data-goto]").dataset.goto = target.dataset.id;
      follow.hidden = false;
    }
  } catch { /* 查不成就不提示,不打扰 */ }
});

art.classList.add("paged");
window.addEventListener("popstate", applyHash);
window.addEventListener("hashchange", applyHash);
applyHash();
