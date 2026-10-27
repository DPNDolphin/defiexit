// 指南页:一页一步、新手 / 老司机切换、按用户账户填数字并跳过用不到的步骤、复制、
// 我卡在这一步(现场诊断 + 常见情况)、从官网回来时自动再查一次。
import { detectors, diagnosers } from "./detectors/index.js";
import { isEvmAddress } from "./lib/net.js";
import { el, toast, copy, contact } from "./lib/ui.js";

const art = document.querySelector(".guide");
const detect = detectors[art.dataset.detector];
const diagnose = diagnosers[art.dataset.detector];
const box = document.getElementById("steps");
const steps = [...box.querySelectorAll(".step")];
const pager = document.getElementById("pager");
const pos = document.getElementById("pos");
const [prevBtn, nextBtn] = pager.querySelectorAll("[data-go]");
const mine = document.getElementById("mine");
let flags = null;   // null:没填地址,所有步骤都显示
let base = null;    // 按账户算出来的原始数和开关(用户在现场诊断里改了选择,能退回来)
let addr = null;    // 用户填的地址,只在这一页的内存里
let lastDiag = null, lastAt = 0;
let cur = 0;

const title = (s) => s.querySelector("h3").firstChild.textContent;
const clock = (t) => new Date(t).toTimeString().slice(0, 8);

// ---------- 一页一步 ----------
const visible = () => steps.filter((s) => !flags || !s.dataset.when || flags[s.dataset.when]);

function show(i, scroll = false) {
  const vs = visible();
  cur = Math.max(0, Math.min(i, vs.length - 1));
  for (const s of steps) s.hidden = s !== vs[cur];
  vs.forEach((s, k) => { s.querySelector(".num").textContent = k + 1; });
  pos.textContent = `第 ${cur + 1} / ${vs.length} 步`;
  prevBtn.disabled = cur === 0;
  nextBtn.disabled = cur === vs.length - 1;
  if (scroll) box.scrollIntoView({ behavior: "smooth", block: "start" });
}

// 现场诊断说该在某一步:那一步被跳过了就先放出来,再算它是第几步
function reveal(id) {
  const s = steps.find((x) => x.dataset.id === id);
  if (!s) return null;
  if (flags && s.dataset.when && !flags[s.dataset.when]) {
    const keep = visible()[cur];
    flags[s.dataset.when] = true;
    show(Math.max(visible().indexOf(keep), 0));
  }
  return s;
}
function gotoStep(id) {
  const s = reveal(id);
  if (s) show(visible().indexOf(s), true);
}

art.classList.add("paged");
pager.hidden = false;
show(0);
pager.addEventListener("click", (e) => {
  const g = e.target.closest("[data-go]");
  if (g) show(cur + Number(g.dataset.go), true);
});
let touch = null;
box.addEventListener("touchstart", (e) => { touch = e.touches.length === 1 ? [e.touches[0].clientX, e.touches[0].clientY] : null; }, { passive: true });
box.addEventListener("touchend", (e) => {
  if (!touch) return;
  const dx = e.changedTouches[0].clientX - touch[0], dy = e.changedTouches[0].clientY - touch[1];
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 2) show(cur + (dx < 0 ? 1 : -1), true);
  touch = null;
}, { passive: true });
document.addEventListener("keydown", (e) => {
  if (e.target.closest("input")) return;
  if (e.key === "ArrowRight") show(cur + 1, true);
  if (e.key === "ArrowLeft") show(cur - 1, true);
});

// ---------- 新手 / 老司机 ----------
for (const tab of art.querySelectorAll("[data-mode][role=tab]")) {
  tab.addEventListener("click", () => {
    for (const t of art.querySelectorAll("[role=tab]")) t.setAttribute("aria-selected", String(t === tab));
    for (const m of art.querySelectorAll(".mode")) m.hidden = m.dataset.mode !== tab.dataset.mode;
  });
}

// ---------- 现场诊断 ----------
function renderChoice(c) {
  const out = el("div", { class: "choice" }, el("h5", {}, "怎么办,你自己选:"));
  if (c.sell) {
    out.append(el("div", { class: "opt" },
      el("b", {}, `① 按现在的价格卖:价格填 ${c.sell.floorPx}`),
      el("p", {}, `按你的 ${c.amount} USDH,照现在的买盘约得 ${c.sell.expect} USDC,比 1:1 少约 ${c.sell.loss};限价单不会低于这个价成交,最少约 ${c.sell.min}。价格一直在变,下单前回来点「再查一次」。`),
      c.cancelFirst ? el("p", { class: "warn" }, "要先在官网页面下方的 Open Orders 里点 Cancel,撤掉原来那一单,再按新价格挂。") : null,
      el("button", { type: "button", "data-pick": "sell" }, "选这条:把指南里的价格换成这个")));
  } else if (c.bid !== null) {
    out.append(el("div", { class: "opt" }, el("b", {}, "① 按现在的价格卖"), el("p", {}, "现在的买盘不够把你的 USDH 全部卖掉,先别卖。")));
  }
  out.append(el("div", { class: "opt" },
    el("b", {}, "② 走发行方的官方 1:1 赎回"),
    el("p", {}, "Hyperliquid 官网写明:USDH 的发行方 Bridge 在 redeem.bridge.xyz 维持 1:1 赎回。要在 Bridge 注册开户,可能要实名。这条路我们还没实测,具体步骤以 Bridge 官网为准。账户里的 USDC 现在就可以先提。"),
    el("button", { type: "button", "data-pick": "redeem" }, "选这条:指南先只提 USDC")));
  out.append(el("div", { class: "opt" }, el("b", {}, "③ 先等等"), el("p", {}, "USDH 已经停发,买盘可能越来越差。要等的话,过一阵回来点「再查一次」。")));
  return out;
}

function renderDiag(d, here) {
  const out = [el("h4", {}, "现场诊断", el("small", {}, `${clock(d.at)} 查的`), el("button", { class: "recheck", type: "button" }, "再查一次"))];
  const target = d.step && reveal(d.step);
  if (target && target === here) out.push(el("p", { class: "where" }, "按你账户的实际情况,你就在这一步。"));
  else if (target) {
    const n = visible().indexOf(target) + 1;
    out.push(el("p", { class: "where" }, `按你账户的实际情况,你现在应该在第 ${n} 步「${title(target)}」。`,
      el("button", { type: "button", "data-goto": d.step }, `去第 ${n} 步`)));
  }
  out.push(el("ul", { class: "findings" }, d.findings.map((f) => el("li", { class: f.level }, f.text))));
  if (d.choice) out.push(renderChoice(d.choice));
  out.push(el("details", { class: "raw" }, el("summary", {}, "查到的原始情况"), el("ul", {}, d.facts.map((t) => el("li", {}, t)))));
  return out;
}

async function runDiag(step) {
  const out = step.querySelector(".diag");
  if (!diagnose) return out.replaceChildren();
  if (!addr) return out.replaceChildren(el("p", { class: "sub" }, "先在页面上方填你的地址,才能实时查你账户的情况。下面的常见情况不填地址也能看。"));
  out.replaceChildren(el("p", { class: "sub" }, "正在从你的浏览器查 Hyperliquid 官方接口和 Arbitrum 公共节点…"));
  try {
    lastDiag = await diagnose(addr);
    lastAt = Date.now();
    out.replaceChildren(...renderDiag(lastDiag, step));
  } catch (err) {
    out.replaceChildren(el("p", { class: "err" }, `现场诊断没查成:${err.message}。下面的常见情况照样能看;拿不准就先别签任何东西。`));
  }
}

function setVars(vars) {
  for (const [k, v] of Object.entries(vars)) for (const n of art.querySelectorAll(`[data-var="${k}"]`)) n.textContent = v;
  const big = document.getElementById("big");
  if (big && vars.arrive) big.textContent = `预计到账约 ${vars.arrive} USDC`;
}

function pick(kind) {
  const c = lastDiag?.choice;
  if (!c || !base) return;
  if (kind === "sell" && c.sell) {
    setVars(c.sell.vars);
    flags = { ...base.flags, needsSell: true };
    gotoStep("fill");
    toast(`${c.cancelFirst ? "先在官网 Open Orders 里撤掉原来那一单。" : ""}指南里的价格已换成 ${c.sell.floorPx}。下单前回来点「再查一次」,价格变了要重算。`, 7000);
  } else if (kind === "redeem") {
    setVars(base.vars);
    flags = { ...base.flags, needsSell: false };
    show(0, true);
    toast("指南已改成只提 USDC。USDH 去 Bridge 官网按它的步骤赎回。", 6000);
  }
}

// 从官网回到这一页时,自己再查一次;发现该换一步了,只提示,用户点了才翻
const follow = el("div", { class: "follow", hidden: true }, el("span", {}), el("button", { type: "button", "data-goto": "" }, "去看看"), el("button", { type: "button", class: "x", "aria-label": "关掉" }, "×"));
art.append(follow);
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !addr || !diagnose || Date.now() - lastAt < 15000) return;
  lastAt = Date.now();
  try {
    lastDiag = await diagnose(addr);
    const here = visible()[cur];
    const target = lastDiag.step && reveal(lastDiag.step);
    if (target && target !== here) {
      follow.querySelector("span").textContent = `刚查了你的账户:你现在应该在第 ${visible().indexOf(target) + 1} 步「${title(target)}」。`;
      follow.querySelector("[data-goto]").dataset.goto = lastDiag.step;
      follow.hidden = false;
    }
  } catch { /* 查不成就不提示,不打扰 */ }
});

// ---------- 点击:复制、卡住、再查、去某一步、选择、卡点报告 ----------
const varText = (k) => art.querySelector(`[data-var="${k}"]`)?.textContent || "";
art.addEventListener("click", async (e) => {
  const t = e.target;
  const c = t.closest(".copy");
  if (c) {
    const text = c.dataset.copy ?? c.dataset.copyVar.replace(/\{\{(\w+)\}\}/g, (_, k) => varText(k));
    toast((await copy(text)) ? `已复制:${text}` : "复制失败,请长按手动复制");
    return;
  }
  const stuck = t.closest(".stuck");
  if (stuck) {
    const step = stuck.closest(".step"), help = step.querySelector(".help");
    help.hidden = !help.hidden;
    stuck.setAttribute("aria-expanded", String(!help.hidden));
    if (!help.hidden) runDiag(step);
    return;
  }
  if (t.closest(".recheck")) return runDiag(t.closest(".step"));
  const go = t.closest("[data-goto]");
  if (go && go.dataset.goto) { follow.hidden = true; return gotoStep(go.dataset.goto); }
  if (t.closest(".follow .x")) { follow.hidden = true; return; }
  const p = t.closest("[data-pick]");
  if (p) return pick(p.dataset.pick);
  const rep = t.closest(".report");
  if (rep) {
    // 只有配方、步骤、诊断代码和看过的情况,不含地址和金额
    const step = rep.closest(".step");
    const codes = lastDiag ? lastDiag.findings.map((f) => f.code).join(", ") : "没查(没填地址)";
    const seen = [...step.querySelectorAll(".sit[open]")].map((x) => x.dataset.sit).join(", ") || "无";
    const msg = `【DeFiExit 卡点报告】${art.dataset.title} · 第 ${step.querySelector(".num").textContent} 步「${title(step)}」\n现场诊断:${codes}\n看过的常见情况:${seen}\n(不含地址。不要发助记词、私钥)`;
    const ok = await copy(msg);
    const where = contact() ? `发到 ${contact()}` : "报告渠道马上公布";
    toast(ok ? `卡点报告已复制,${where}。我们从不先私信你,别信私信你的「客服」。` : "复制失败,请截图这一页", 7000);
  }
});

// ---------- 按用户账户算 ----------
async function personalize(a) {
  mine.hidden = false;
  mine.replaceChildren(el("p", {}, "正在按你的账户计算…"));
  try {
    const res = await detect(a);
    addr = a;
    base = { vars: res.vars, flags: res.flags };
    const keep = visible()[cur];
    flags = { ...res.flags };
    setVars(res.vars);
    art.classList.add("personal");
    const skipped = steps.length - visible().length;
    mine.replaceChildren(
      el("h4", {}, "你的账户"),
      res.lines.length ? el("ul", {}, res.lines.map((t) => el("li", {}, t))) : el("p", {}, "没查到余额"),
      res.status === "found" ? el("p", { class: "big", id: "big" }, `预计到账约 ${res.vars.arrive} USDC`) : null,
      res.note ? el("p", {}, res.note) : null,
      res.warnings.length ? el("ul", { class: "warn" }, res.warnings.map((t) => el("li", {}, t))) : null,
      skipped ? el("p", { class: "sub" }, `按你的账户,跳过了 ${skipped} 个用不到的步骤。`) : null,
      el("p", { class: "sub" }, "卡住了就点每一步下面的「我卡在这一步」:会实时查你账户的情况,告诉你实际做到了哪一步。"));
    show(Math.max(visible().indexOf(keep), 0));
  } catch (err) {
    mine.replaceChildren(el("p", { class: "err" }, `查询失败:${err.message}。下面是通用步骤,照样能用。`));
  }
}

const form = document.getElementById("me");
const input = document.getElementById("addr");
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const a = input.value.trim();
  if (!isEvmAddress(a)) return toast("地址格式不对:应该是 0x 开头,一共 42 位");
  history.replaceState(null, "", `#a=${a}`); // 地址只放在 # 后面:不会发给任何服务器
  input.dataset.done = a;
  personalize(a);
});
function fromHash() {
  const a = new URLSearchParams(location.hash.slice(1)).get("a");
  if (a && isEvmAddress(a) && a !== input.dataset.done) {
    input.value = a;
    input.dataset.done = a;
    personalize(a);
  }
}
fromHash();
window.addEventListener("hashchange", fromHash); // 已经在指南页、只换了 # 后面的地址时也要重算
