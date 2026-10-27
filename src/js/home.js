// 首页:粘贴地址 → 各检测器并行只读查询 → 列出能取回的仓位。
import { detectors } from "./detectors/index.js";
import { isEvmAddress, floorTo } from "./lib/net.js";
import { el } from "./lib/ui.js";
import { zh } from "./lib/zh.js";

const form = document.getElementById("scan");
const input = document.getElementById("addr");
const box = document.getElementById("results");
const recipes = [...document.querySelectorAll("#supported li")].map((li) => ({ ...li.dataset }));
const usd = (x) => floorTo(x, 2).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const a = input.value.trim();
  box.hidden = false;
  box.replaceChildren();
  if (!isEvmAddress(a)) {
    box.append(el("p", { class: "err" }, "地址格式不对:应该是 0x 开头,一共 42 位。"));
    return;
  }
  const btn = form.querySelector("button");
  btn.disabled = true;
  const sum = el("p", { class: "sum" }, "体检中…");
  box.append(sum);
  let found = 0;
  await Promise.all(recipes.map(async (r) => {
    const row = el("div", { class: "result loading" }, el("b", {}, r.protocol), el("span", {}, "查询中…"));
    box.append(row);
    try {
      const res = await detectors[r.detector](a);
      if (res.status === "found") found++;
      row.replaceWith(render(r, res, a));
    } catch (err) {
      row.className = "result error";
      row.replaceChildren(el("b", {}, r.protocol), el("span", {}, `查询失败:${err.message},稍后再试`));
    }
  }));
  sum.textContent = zh(found ? `查到 ${found} 处可以取回的钱,点开指南照着做。` : "目前支持的协议里,没查到可以取回的钱。");
  btn.disabled = false;
});

function render(r, res, a) {
  if (res.status === "empty") return el("div", { class: "result empty" }, el("b", {}, r.protocol), el("span", {}, "没有余额"));
  const link = el("a", { class: "go", href: `/r/${r.id}/#a=${a}` }, res.status === "found" ? "看指南(按你的账户算好了)" : "看看指南");
  return el("div", { class: `result ${res.status}` },
    el("div", { class: "head" },
      el("div", {}, el("b", {}, r.protocol), el("small", {}, r.route)),
      res.status === "found" ? el("strong", {}, `约 $${usd(res.usd)}`) : el("em", {}, "零头")),
    el("ul", {}, res.lines.map((t) => el("li", {}, t))),
    res.note ? el("p", { class: "note" }, res.note) : null,
    res.warnings.length ? el("ul", { class: "warn" }, res.warnings.map((t) => el("li", {}, t))) : null,
    link);
}
