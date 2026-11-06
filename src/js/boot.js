// 页面画出来之前就跑(普通脚本,不是模块):套用用户选过的深浅色(默认深色);
// 中文首页:用户没选过语言、浏览器也不是中文的,跳一次:浏览器的语言里有我们出了的(按浏览器里的先后),去那一版;
// 都没有就去英文版。出了哪几种语言,看页面头上的 <link rel="alternate" hreflang>(构建时按出了的语言写,在这个脚本前面)。
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
    if (!zh) {
      var alts = document.querySelectorAll('link[rel="alternate"][hreflang]'), to = "/en/";
      search: for (var j = 0; j < langs.length; j++) {
        var want = String(langs[j]).toLowerCase().split("-")[0];
        for (var k = 0; k < alts.length; k++) {
          var h = alts[k].getAttribute("hreflang").toLowerCase().split("-")[0];
          if (h === want && h !== "zh" && h !== "x") {
            to = new URL(alts[k].href).pathname;
            break search;
          }
        }
      }
      location.replace(to + location.hash);
    }
  }
})();
