// 每一页都加载:深浅色切换;换语言时记住选择,并带上 # 后面的地址(地址只在 # 后面,不会发给服务器)。
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

paint();
