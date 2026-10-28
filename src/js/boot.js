// 页面画出来之前就跑(普通脚本,不是模块):套用用户选过的深浅色(默认深色);
// 中文首页:用户没选过语言、浏览器也不是中文的,跳一次英文版。
(function () {
  var d = document.documentElement;
  function get(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  var theme = get("dx-theme");
  if (theme === "light" || theme === "dark") d.setAttribute("data-theme", theme);
  if (d.getAttribute("data-page") === "home" && d.lang.indexOf("zh") === 0 && !get("dx-lang")) {
    var langs = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""];
    var zh = false;
    for (var i = 0; i < langs.length; i++) if (/^zh\b/i.test(langs[i])) zh = true;
    if (!zh) location.replace("/en/" + location.hash);
  }
})();
