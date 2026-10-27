// 指南页:一页一步、新手 / 老司机切换、按用户账户填数字并跳过用不到的步骤、复制、我卡在这一步。
import { detectors } from "./detectors/index.js";
import { isEvmAddress } from "./lib/net.js";
import { el, toast, copy, contact } from "./lib/ui.js";

const art = document.querySelector(".guide");
const detect = detectors[art.dataset.detector];
const box = document.getElementById("steps");
const steps = [...box.querySelectorAll(".step")];
const pager = document.getElementById("pager");
const pos = document.getElementById("pos");
const [prevBtn, nextBtn] = pager.querySelectorAll("[data-go]");
const mine = document.getElementById("mine");
let flags = null; // null:没填地址,所有步骤都显示
let cur = 0;

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

// ---------- 复制、卡住 ----------
const varText = (k) => art.querySelector(`[data-var="${k}"]`)?.textContent || "";
art.addEventListener("click", async (e) => {
  const c = e.target.closest(".copy");
  if (c) {
    const text = c.dataset.copy ?? c.dataset.copyVar.replace(/\{\{(\w+)\}\}/g, (_, k) => varText(k));
    toast((await copy(text)) ? `已复制:${text}` : "复制失败,请长按手动复制");
    return;
  }
  const s = e.target.closest(".stuck");
  if (s) {
    const n = s.closest(".step").querySelector(".num").textContent;
    const msg = `【DeFiExit 求助】${art.dataset.title} · 第 ${n} 步「${s.dataset.stuck}」\n我的情况:(写在这里,可以附截图;不要发助记词、私钥)`;
    const ok = await copy(msg);
    const where = contact() ? `到 ${contact()} 私信发给我们` : "联系方式即将公布";
    toast(ok ? `求助模板已复制。${where};我们从不先私信你,别信私信你的「客服」。` : "复制失败,请截图这一页来问我们", 7000);
  }
});

// ---------- 按用户账户算 ----------
async function personalize(a) {
  mine.hidden = false;
  mine.replaceChildren(el("p", {}, "正在按你的账户计算…"));
  try {
    const res = await detect(a);
    for (const [k, v] of Object.entries(res.vars)) for (const n of art.querySelectorAll(`[data-var="${k}"]`)) n.textContent = v;
    flags = res.flags;
    art.classList.add("personal");
    const skipped = steps.length - visible().length;
    mine.replaceChildren(
      el("h4", {}, "你的账户"),
      res.lines.length ? el("ul", {}, res.lines.map((t) => el("li", {}, t))) : el("p", {}, "没查到余额"),
      res.status === "found" ? el("p", { class: "big" }, `预计到账约 ${res.vars.arrive} USDC`) : null,
      res.note ? el("p", {}, res.note) : null,
      res.warnings.length ? el("ul", { class: "warn" }, res.warnings.map((t) => el("li", {}, t))) : null,
      skipped ? el("p", { class: "sub" }, `按你的账户,跳过了 ${skipped} 个用不到的步骤。`) : null);
    show(0);
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
