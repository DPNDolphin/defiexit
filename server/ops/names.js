// 网址的几种写法和「只收名字」的检查:投递的草稿检查(ingest.js 的 checkText)、问题记录和待发里的协议、链、到期清理(db.js 的 purge)都用这一份。
// 这里不引别的文件(db.js、ingest.js 都引它,不绕圈)。

// 英文域名(含 xn-- 编码的)、IP 地址、中文域名(英文句点紧挨着汉字等非英文字符)
export const ASCII_HOST = /[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})(?![a-z0-9-])/gi;
export const IPV4 = /(?:^|[^\d.])\d{1,3}(?:\.\d{1,3}){3}(?![\d.])/;
export const UNICODE_HOST = /[^\x00-\x7f]\.[\p{L}\p{N}]|[\p{L}\p{N}]\.[^\x00-\x7f]/u;
// 长得像句点的:中文句号「。」、全角「．」、半角「｡」,浏览器都当成网址里的点(evil。com 就是 evil.com)。夹在英文字母、数字之间的先换成点再找;
// 夹在汉字之间的是正常的句号,不动
export const DOTS = /(?<=[a-z0-9-])[\u3002\uff0e\uff61](?=[a-z0-9-])/gi;
// 最后一段是英文字母、紧跟着别的文字的字母(blast.ió):上面的英文域名找不出来,一样当可疑网址
export const TLD_GLUED = /[a-z0-9-]\.[a-z]+(?![\x00-\x7f])[\p{L}\p{N}\p{M}]/iu;

// 协议、链只收名字:字母(含汉字)、数字、空格和 . - ( )。这两样到期也不删,所以能认出人、认出帖子、认出钱包的都不收:
// 链接、像网址的(ether.fi、yearn.finance 这种名字本身像网址的也不收,写成 ether fi)、IP、@、
// 钱包地址(0x 加 6 位以上十六进制;连着 25 个以上不带空格的字母、数字,base58、bech32 的地址和长编号都是这样)、连着 6 位以上的数字(帖子编号)。
const NAME = /^[\p{L}\p{Nd} .()-]+$/u, HOST1 = new RegExp(ASCII_HOST.source, "i"), HEX = /0x[0-9a-f]{6,}/i, RUN = /[\p{L}\p{Nd}]{25,}/u;
export const NAME_RULE = "只写名字:字母、数字、空格和 . - ( );像网址的不收,比如 ether.fi 写成 ether fi;不带链接、@、钱包地址(0x 加 6 位以上十六进制、连着 25 个以上的字母数字)和连着 6 位以上的数字";
export const RISK_RULE = "带链接、像网址的(比如 ether.fi 写成 ether fi)、IP、@、钱包地址(0x 加 6 位以上十六进制、连着 25 个以上的字母数字)、连着 6 位以上数字的不存";
// 能认出人、帖子、钱包的写法(不看别的字符)
const risky = (s) => /:\/\//.test(s) || s.includes("@") || /\p{Nd}{6,}/u.test(s) || HEX.test(s) || RUN.test(s) || HOST1.test(s) || IPV4.test(s) || UNICODE_HOST.test(s) || TLD_GLUED.test(s);
export const nameOk = (s) => NAME.test(s) && !risky(s);
// 先统一写法(NFKC:全角的换成半角;英文之间长得像句点的换成点;连着的空白并成一个)
const norm = (v) => v.normalize("NFKC").replace(DOTS, ".").replace(/\s+/g, " ").trim();
// 短标签(需求摘要的来源,到期以后一直留着,比如「我们的回复 · OpenEden」「项目帖 · 20261106 每日观察」):
// 只把认得出人、帖子、钱包的那几样换成「…」:链接、网址、IP、@账号、0x 地址、连着 25 个以上的英文字母数字(base58、bech32 地址)、
// 连着 15 位以上的数字(帖子编号)。汉字、日期、短数字照留(上面名字检查的 risky 太严,长标题、日期会被整段抹掉)。
// 没有要换的,原样回(不改写法)
const LABEL_RISK = new RegExp([/[a-z][a-z0-9+.-]*:\/\/\S*/, ASCII_HOST, /\d{1,3}(?:\.\d{1,3}){3}/, /@[A-Za-z0-9_]{1,15}/, /0x[0-9a-f]{6,}/, /[A-Za-z0-9]{25,}/, /\d{15,}/].map((r) => r.source).join("|"), "gi");
export const safeLabel = (s) => {
  if (typeof s !== "string") return s;
  const n = norm(s), out = n.replace(LABEL_RISK, "…");
  return out === n ? s : out;
};

// 问题记录的协议、链:不合格的整条不收(回执里写 NAME_RULE)。太长的截掉再存:截之前先把前面多看 100 个字一起查,
// 截断处正好切在一串地址中间,也不会留下半截。不是文字或是空的回 undefined,不合格回 null
export function plainName(v, max) {
  if (typeof v !== "string") return undefined;
  const all = norm(v);
  const s = all.slice(0, max).trim();
  if (!s) return undefined;
  return nameOk(all.slice(0, max + 100)) && nameOk(s) ? s : null;
}

// 待发目标帖子的协议、链、类型(到期也留着):不因为写法整张卡片不收(「Blast L2 → 以太坊」「StandX 有序关停」这种照收)。
// 统一写法以后,能认出人、帖子、钱包的(见 risky)这一项不存,回 null;别的不在字母、数字、空格和 . - ( ) 里的字:
// 箭头、斜杠、逗号这类分隔的换成 " - ",引号去掉,别的换成空格。太长的截掉(截之前一起查)。不是文字或是空的回 undefined
const SEP = /[/\\|→←↔⇒⇐⟶⟵>〉》<〈《~·•:;,、+&=–—]/u, QUOTES = /['"`‘’“”]/gu;
export function softName(v, max) {
  if (typeof v !== "string") return undefined;
  const all = norm(v);
  if (!all) return undefined;
  if (risky(all.slice(0, max + 100))) return null;
  const s = all.replace(QUOTES, "").replace(/[^\p{L}\p{Nd} .()-]+/gu, (m) => (SEP.test(m) ? " - " : " "))
    .replace(/\s+/g, " ").replace(/(?:\s*-\s*){2,}/g, " - ").replace(/^[\s-]+|[\s-]+$/g, "")
    .slice(0, max).replace(/[\s-]+$/, "");
  if (!s) return undefined;
  return nameOk(s) ? s : null;
}
