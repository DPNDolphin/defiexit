// 每一页都加载:深浅色切换;换语言时记住选择,并带上 # 后面的地址(地址只在 # 后面,不会发给服务器);
// 语言菜单是 <details>,不靠脚本也能开关;这里只补上按 Esc 收起(焦点回到菜单按钮)、点菜单外面收起;
// 打开的是 #owner:记成管理员自己的浏览器,在这里体检、打开页面都不计数(见 lib/count.js)。
// 页面显示完以后数一次「打开页面」(不带地址和编号,不挡页面;见 lib/count.js 的 countView)。
import { takeOwnerHash, countView } from "./lib/count.js";
import { toast } from "./lib/ui.js";
import { makeT, pageLang } from "./lib/i18n.js";

const root = document.documentElement;
const meta = document.querySelector('meta[name="theme-color"]');
const BG = { dark: "#0A0F1E", light: "#F6F8FC" };
const save = (k, v) => {
  try { localStorage.setItem(k, v); } catch { /* 存不了就算了,只是下次不记得 */ }
};

function paint() {
  const light = root.dataset.theme === "light";
  if (meta) meta.content = light ? BG.light : BG.dark;
  for (const b of document.querySelectorAll("[data-theme-toggle]")) b.setAttribute("aria-pressed", String(light));
}

for (const b of document.querySelectorAll("[data-theme-toggle]")) {
  b.addEventListener("click", () => {
    root.dataset.theme = root.dataset.theme === "light" ? "dark" : "light";
    save("dx-theme", root.dataset.theme);
    paint();
  });
}

for (const a of document.querySelectorAll("a[data-lang]")) {
  a.addEventListener("click", (e) => {
    save("dx-lang", a.dataset.lang);
    if (location.hash.length > 1) {
      e.preventDefault();
      location.href = a.getAttribute("href") + location.hash;
    }
  });
}

// 语言菜单:按 Esc、点外面都收起来(页面上没有菜单就不挂)
const menus = [...document.querySelectorAll("details.lang-menu")];
if (menus.length) {
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    for (const m of menus) {
      if (!m.open) continue;
      m.open = false;
      m.querySelector("summary")?.focus();
    }
  });
  document.addEventListener("click", (e) => {
    for (const m of menus) if (m.open && !m.contains(e.target)) m.open = false;
  });
}

paint();
// #owner:打开页面时带着的,和已经开着的页面在地址后面补上的(只改 # 不会重新加载页面)都算
const owner = () => {
  if (takeOwnerHash()) toast(makeT(pageLang())("ownerOn"));
};
owner();
window.addEventListener("hashchange", owner);
// 数一次打开页面:等页面显示完(load)再发,放到下一轮,不和页面抢;#owner 上面已经先记过了,管理员自己打开这一次也不数
const view = () => setTimeout(() => countView(), 0);
if (document.readyState === "complete") view();
else window.addEventListener("load", view, { once: true });
