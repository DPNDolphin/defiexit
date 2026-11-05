// 退出截止日历:「还有 N 天」是构建那天算好写进页面的;打开时按现在重算一遍(写了截止时间的按那个时间,只写了日子的
// 倒数算到那一天 00:00 UTC、那一天里写「按 UTC 算,今天是截止日」、过完才算已过;48 小时以内的写还剩几小时),
// 构建以后才过了截止日的挪进「已过截止日」;分几步截止的,每一步也重标(见 lib/relabel.js,字没变就不碰页面)。
// 页面开着不动时每分钟再算一遍(页面藏在后台时不算),切回来、从浏览器缓存里回来时马上算一遍。
// 从 X 上点进来带着 #某一条、而那一条在收起的「已过截止日」里:先展开,再跳过去。只改文字和位置,不连任何接口。
import "./site.js";
import { makeT, pageLang } from "./lib/i18n.js";
import { relabel } from "./lib/relabel.js";

const t = makeT(pageLang());
const again = () => relabel(document, t, new Date());
again();
setInterval(() => { if (!document.hidden) again(); }, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) again(); });
window.addEventListener("pageshow", again);

function reveal() {
  let id = "";
  try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
  const a = id ? document.getElementById(id) : null;
  const box = a?.closest("details");
  if (box && !box.open) {
    box.open = true;
    a.scrollIntoView();
  }
}
reveal();
window.addEventListener("hashchange", reveal);
