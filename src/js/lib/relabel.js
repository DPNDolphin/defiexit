// 截止日历页的倒数重标(deadlines.js 打开时、每分钟、切回来时调):按 now 重算每一条的倒数、颜色、分几步截止的每一步,
// 构建以后才过了截止日的挪进「已过截止日」,两段的条数跟着改。字和样子变了才写,没变就不碰页面。回的是这一次改了几处
import { zh } from "./zh.js";
import { daysLeft, timeLeft, urgency } from "./deadline.js";

export function relabel(doc, t, now = new Date()) {
  const openList = doc.getElementById("openList"), passedList = doc.getElementById("passedList");
  let n = 0;
  const put = (node, k, v) => { if (node && node[k] !== v) { node[k] = v; n++; } };
  // 「还没到 / 已过」和颜色按 daysLeft(只写了日子的,那一天过完才算过);字按 timeLeft(只往少里说)
  for (const a of doc.querySelectorAll(".dl[data-deadline]")) {
    const at = a.dataset.at || null, k = daysLeft(a.dataset.deadline, now, at);
    const pill = a.querySelector(".dl-left");
    put(pill, "className", `dl-left ${urgency(k)}`);
    put(pill?.querySelector("span"), "textContent", zh(t("dlLeft", timeLeft(a.dataset.deadline, now, at))));
    // 「已过」那一段最近过的在最上面;「还没到」那一段是日子早的在前,按页面顺序一条条放到最上面,顺序正好对
    if (k < 0 && openList?.contains(a)) { passedList?.prepend(a.closest("li")); n++; }
  }
  // 分几步截止的:过了的标「已过」,还没过的第一步加粗
  for (const ol of doc.querySelectorAll(".dl-steps")) {
    let first = true;
    for (const li of ol.children) {
      const at = li.dataset.at || null, k = daysLeft(li.dataset.deadline, now, at);
      put(li, "className", k < 0 ? "done" : first ? "next" : "");
      if (k >= 0) first = false;
      put(li.querySelector(".dl-step-left"), "textContent", zh(k < 0 ? t("dlStepPast") : t("dlLeft", timeLeft(li.dataset.deadline, now, at))));
    }
  }
  for (const [key, list] of [["open", openList], ["passed", passedList]]) {
    for (const x of doc.querySelectorAll(`[data-n="${key}"]`)) put(x, "textContent", String(list ? list.children.length : 0));
  }
  return n;
}
