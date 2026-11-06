// 网站的语言,构建脚本和浏览器共用这一份:编号、网址前缀、<html lang>(也是 hreflang)、og:locale、
// 语言菜单里的名字(本族语)、菜单按钮上的短名、数字和日期按哪里的写法(Intl)、列举几样东西时用什么隔开、
// 是不是汉字假名韩文这一类(cjk:数字和后面的量词之间不空格,比如截止日历顶上的「27件」)。
// 中文在根目录,英文在 /en,别的在 /<编号>。中英两套界面文字写在 i18n.js 里;别的语言要有 src/js/lib/i18n/<编号>.js
// 才出页面、才进语言菜单(没有就不出,不影响别的语言)。缺的文字一律退回英文。
export const LANGS = [
  { code: "zh", cjk: true, prefix: "", html: "zh-CN", og: "zh_CN", label: "中文", short: "中文", locale: "zh-CN", sep: "、" },
  { code: "en", prefix: "/en", html: "en", og: "en_US", label: "English", short: "EN", locale: "en-US", sep: ", " },
  { code: "es", prefix: "/es", html: "es", og: "es_ES", label: "Español", short: "ES", locale: "es", sep: ", " },
  { code: "pt", prefix: "/pt", html: "pt-BR", og: "pt_BR", label: "Português", short: "PT", locale: "pt-BR", sep: ", " },
  { code: "ru", prefix: "/ru", html: "ru", og: "ru_RU", label: "Русский", short: "RU", locale: "ru", sep: ", " },
  { code: "tr", prefix: "/tr", html: "tr", og: "tr_TR", label: "Türkçe", short: "TR", locale: "tr", sep: ", " },
  { code: "vi", prefix: "/vi", html: "vi", og: "vi_VN", label: "Tiếng Việt", short: "VI", locale: "vi", sep: ", " },
  { code: "id", prefix: "/id", html: "id", og: "id_ID", label: "Bahasa Indonesia", short: "ID", locale: "id", sep: ", " },
  { code: "ko", cjk: true, prefix: "/ko", html: "ko", og: "ko_KR", label: "한국어", short: "한국어", locale: "ko", sep: ", " },
  { code: "ja", cjk: true, prefix: "/ja", html: "ja", og: "ja_JP", label: "日本語", short: "日本語", locale: "ja", sep: "、" },
  { code: "fr", prefix: "/fr", html: "fr", og: "fr_FR", label: "Français", short: "FR", locale: "fr", sep: ", " },
  { code: "de", prefix: "/de", html: "de", og: "de_DE", label: "Deutsch", short: "DE", locale: "de", sep: ", " },
];
// 中英两套是底本:配方、截止日历、专题都先写中文和英文;别的语言照英文翻,缺了退回英文
export const BASE = ["zh", "en"];

const byCode = new Map(LANGS.map((l) => [l.code, l]));
export const langInfo = (code) => byCode.get(code) || null;

// <html lang> 的值 → 编号:先找一模一样的(pt-BR),再按主语言找(pt-PT 也算 pt);认不出来的当英文
export function langOf(html) {
  const s = String(html || "").toLowerCase();
  const hit = LANGS.find((l) => l.html.toLowerCase() === s) || LANGS.find((l) => l.code === s.split("-")[0]);
  return hit ? hit.code : "en";
}

export const prefixOf = (code) => (byCode.get(code) || byCode.get("en")).prefix;
// 数字、日期按哪里的写法:中文、英文照原来(zh-CN、en-US);认不出来的按英文
export const locale = (code) => (byCode.get(code) || byCode.get("en")).locale;
// 列举几样东西(项目名、链名)时用什么隔开:中文、日文用顿号,别的用逗号
export const listSep = (code) => (byCode.get(code) || byCode.get("en")).sep;
