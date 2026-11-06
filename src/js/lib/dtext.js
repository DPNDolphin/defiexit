// 检测器(体检、现场诊断)和 X Layer 取法这几块给用户看的话:中英两套写在各自的 *.text.js 里(TEXT、HOW);
// 别的语言一个文件一块:src/js/detectors/i18n/<名字>.<编号>.js(名字:hyperliquid、woofi、dyorswap、okx-boost、xlayer),
// 和英文那一套一样的结构,可以只翻一部分。构建时生成的 /assets/js/lang/<编号>.js 在页面的主脚本之前装进来(构建脚本读文件时也装)。
// 取的时候按语言来:中英直接用;别的语言把译文一层层盖在英文上(缺的那一组、那一条退回英文);没有译文就整套用英文
const EXTRA = {};
const MERGED = new Map();
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

export function addText(name, code, dict) {
  if (!EXTRA[name]) EXTRA[name] = {};
  EXTRA[name][code] = dict;
  MERGED.delete(`${name} ${code}`);
}

// 译文盖在英文上:两边都是一组(对象)的往下一层接着盖;别的(文字、函数)有译文就用译文
export const overlay = (en, x) => Object.fromEntries(Object.keys(en).map((k) => [k, !(k in x) ? en[k] : isObj(en[k]) && isObj(x[k]) ? overlay(en[k], x[k]) : x[k]]));

// 这一块实际用的是哪种语言的话(有这种语言的就是它,不然是英文):拼列表的分隔符跟着它走
export const textLang = (name, TEXT, lang) => (TEXT[lang] || (EXTRA[name] && EXTRA[name][lang]) ? lang : "en");

export function pickText(name, TEXT, lang) {
  if (TEXT[lang]) return TEXT[lang];
  const x = EXTRA[name] && EXTRA[name][lang];
  if (!x) return TEXT.en;
  const key = `${name} ${lang}`;
  if (!MERGED.has(key)) MERGED.set(key, overlay(TEXT.en, x));
  return MERGED.get(key);
}
