// 别的语言(构建时用):读译文文件、逐条核对、把译文合进数据。语言登记在 src/js/lib/langs.js。
// 别的语言都照英文翻,文件只加不改(README「多语言」那一条也写了):
//   界面文字  src/js/lib/i18n/<编号>.js            export default { 键: 文字或函数 },键和 STR.en 一样
//   截止日历  data/i18n/<编号>/deadlines.json     { 事件编号: { name, summary, deadlineNote, who, todo, caution, official: [], milestones: [] } }
//   专题      data/i18n/<编号>/topics/<slug>.json  { title, summary, sections: [{ h, p: [], list: [] }], faq: [{ q, a }], sources: [] }
//   指南      recipes/<id>/i18n/<编号>.json        和同一份配方的 en.json 结构、条数一模一样
// 缺的(整个文件、某一条、某一个字段)退回英文;有的就逐条和英文核对,写错了构建直接报错,写明哪个文件、哪一条、错在哪。
// 有界面文字文件的语言才出页面、进语言菜单;别的几样文件只要在,就照样核对(写错了的不会等到上线那天才发现)。
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { LANGS, BASE, langInfo } from "../src/js/lib/langs.js";
import { STR, addUI } from "../src/js/lib/i18n.js";
import { addText } from "../src/js/lib/dtext.js";
import { TEXT as HL } from "../src/js/detectors/hyperliquid.text.js";
import { TEXT as WF } from "../src/js/detectors/woofi.text.js";
import { TEXT as DY } from "../src/js/detectors/dyorswap.text.js";
import { TEXT as OK } from "../src/js/detectors/okx-boost.text.js";
import { HOW } from "../src/js/lib/xlayer.text.js";

const EXTRA = LANGS.filter((l) => !BASE.includes(l.code)).map((l) => l.code);
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const rel = (root, f) => relative(root, f).replace(/\\/g, "/");

// ---------- 译文里不能改的东西:数字、网址、域名、0x 地址、`代码`、$币符号、{{变量}}、①② 这类编号、**粗体** ----------

// 网址只认网址里能有的那些字符(日文里网址后面常常直接接假名),末尾的标点不算
const URL_RE = /https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]*/g;
const CODE_RE = /`[^`]*`/g;
const VAR_RE = /\{\{\w+\}\}/g; // 指南里按用户账户填的数(漏了,页面上就没有用户自己的数)
const MARK_RE = /[①②③④⑤⑥⑦⑧⑨]/g; // 截图说明里的编号,对着图上的红框
const ADDR_RE = /0x[0-9a-fA-F]+(?:…[0-9a-fA-F]+)?/g;
const DOMAIN_RE = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}\b/gi;
const SYM_RE = /\$[A-Za-z][A-Za-z0-9]*/g;
// 译文里多出来的「域名」只认常见的顶级域(西语的 p.ej.、德语的 z.Zt. 不算);英文里有的,不管什么样都要原样留着
const TLDS = new Set("com net org io xyz fi finance app exchange network link one country tech gg co ai dev info money foundation trade so me us uk eu de fr es it nl jp kr cn hk sg tw vn id ru br tr in global world site online pro cc to".split(" "));
// 英文的月份名、数字词:译文可以把它们写成数字(日文的「11月25日」、「2 回」),所以译文里多出来的这些数不算错
const MONTHS = { Jan: 1, January: 1, Feb: 2, February: 2, Mar: 3, March: 3, Apr: 4, April: 4, May: 5, Jun: 6, June: 6, Jul: 7, July: 7, Aug: 8, August: 8, Sep: 9, Sept: 9, September: 9, Oct: 10, October: 10, Nov: 11, November: 11, Dec: 12, December: 12 };
// (「a thousand」写成「1,000」是 1 和 000 两段)
const WORDS = { a: [1], an: [1], one: [1], once: [1], single: [1], first: [1], two: [2], twice: [2], second: [2], both: [2], three: [3], third: [3], four: [4], fourth: [4], five: [5], fifth: [5], six: [6], sixth: [6], seven: [7], seventh: [7], eight: [8], eighth: [8], nine: [9], ninth: [9], ten: [10], tenth: [10], eleven: [11], twelve: [12], dozen: [12], hundred: [100, 1, 0], thousand: [1000, 1, 0], million: [1000000, 1, 0] };

function take(s, re, f = (x) => x) {
  const out = [];
  const rest = s.replace(re, (m) => {
    out.push(f(m));
    return " ";
  });
  return [out, rest];
}

// 一句话里不能改的几样,各是一个列表(一样的出现几次就记几次)
export function tokens(s) {
  let rest = String(s);
  let codes, vars, urls, addrs, domains, syms;
  [codes, rest] = take(rest, CODE_RE);
  [vars, rest] = take(rest, VAR_RE);
  [urls, rest] = take(rest, URL_RE, (u) => u.replace(/[.,;:!?)\]}'"]+$/, ""));
  [addrs, rest] = take(rest, ADDR_RE);
  [domains, rest] = take(rest, DOMAIN_RE, (d) => d.toLowerCase());
  [syms, rest] = take(rest, SYM_RE);
  const marks = rest.match(MARK_RE) || [], bold = rest.match(/\*\*/g) || [];
  return { codes, vars, urls, addrs, domains, syms, marks, bold, nums: rest.match(/\d+/g) || [], prose: rest };
}

const count = (list) => list.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
// a 里有、b 里没有(或者少了)的第一个
const missing = (a, b) => {
  const nb = count(b);
  for (const [x, n] of count(a)) if ((nb.get(x) || 0) < n) return x;
  return null;
};

// 译文和英文比:英文里的这几样,译文里一样不少、原样都在;译文也不能多出来网址、地址、代码、币符号、常见顶级域的域名。
// 数字:英文里的每个数,译文里都要有(一个都不能改、不能丢);译文多出来的数,只能是英文里月份名、数字词说的那个数。回的是错在哪,对就回 null
// code:译文是哪种语言(认这种语言的月份名用;不给就只认英文月份名)
export function tokenDiff(en, tr, code = null) {
  [en, tr] = isoDates(String(en), String(tr), code);
  const a = tokens(en), b = tokens(tr);
  const NAMES = { codes: "`代码`", vars: "{{变量}}", urls: "网址", addrs: "0x 地址", domains: "域名", syms: "$币符号", marks: "编号", bold: "**粗体** 标记" };
  for (const k of Object.keys(NAMES)) {
    const lost = missing(a[k], b[k]);
    if (lost !== null) return `英文里的${NAMES[k]}「${lost}」译文里要原样留着`;
    const extra = missing(k === "domains" ? b[k].filter((d) => TLDS.has(d.split(".").pop())) : b[k], a[k]);
    if (extra !== null) return `译文里多了英文没有的${NAMES[k]}「${extra}」`;
  }
  // 数:先按一段段数字比(千分位写成逗号、空格、不换行空格、撇号都一样);对不上再按数值比
  // (45,818 和 45818、5.2 million 和 520万 / 520만、500,000 和 50万):两样都对不上才算错
  const ok = explained(a.prose);
  const byDigits = sameNums(a.nums, b.nums, ok);
  return byDigits && sameNums(numValues(a.prose), numValues(b.prose), ok) ? byDigits : null;
}

// 英文里写成 2026-11-05 的日子:译文可以照原样写,也可以按这种语言的习惯写(「5 November 2026」「2026年11月5日」「5. Nov. 2026」):
// 年、日(前面的 0 可以不写)都在,月写成数字或者这种语言的月份名(按 Intl 的长、短写法认,俄文这种还认「5 ноября」里的变格)就算对。
// 对上的这几个数从两边拿掉,不再按一个个数去比;对不上的照常比(会报少了哪个数)
const MONTH_NAMES = new Map();
function monthNames(code, m) {
  const loc = (code && langInfo(code)?.locale) || "en-US", key = `${loc} ${m}`;
  if (!MONTH_NAMES.has(key)) {
    const d = new Date(Date.UTC(2026, m - 1, 15));
    const names = [{ month: "long" }, { month: "short" }].map((o) => new Intl.DateTimeFormat(loc, { ...o, timeZone: "UTC" }).format(d));
    for (const month of ["long", "short"]) names.push(...new Intl.DateTimeFormat(loc, { day: "numeric", month, year: "numeric", timeZone: "UTC" }).formatToParts(d).filter((p) => p.type === "month").map((p) => p.value));
    MONTH_NAMES.set(key, [...new Set(names.map((x) => x.toLowerCase().replace(/\.$/, "")).filter((x) => !/^\d+$/.test(x)))]);
  }
  return MONTH_NAMES.get(key);
}
function isoDates(en, tr, code) {
  for (const [iso, y, mo, d] of [...en.matchAll(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g)]) {
    if (tr.includes(iso)) {
      en = en.replace(iso, " ");
      tr = tr.replace(iso, " ");
      continue;
    }
    const num = (n) => new RegExp(`(?<!\\d)0?${Number(n)}(?!\\d)`);
    // 月份名里也可能带着数字(越南文「tháng 11」、日文「11月」):对上的那个月份名整个拿掉,里面的数不再算
    const name = monthNames(code, Number(mo)).find((x) => tr.toLowerCase().includes(x));
    let t = name ? tr.replace(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ") : tr;
    if (!new RegExp(`(?<!\\d)${y}(?!\\d)`).test(t) || !num(d).test(t) || !(name || num(mo).test(t))) continue;
    t = t.replace(new RegExp(`(?<!\\d)${y}(?!\\d)`), " ").replace(num(d), " ");
    if (!name) t = t.replace(num(mo), " ");
    en = en.replace(iso, " ");
    tr = t;
  }
  return [en, tr];
}

// 英文里月份名、数字词说的数(Nov 是 11、two 是 2、a thousand 是 1000):译文把它们写成数字,多出来的这些不算错
const norm = (v) => String(Number(Number(v).toPrecision(12)));
const explained = (prose) => new Set([...prose.matchAll(/\b[A-Za-z]+\b/g)].flatMap(([w]) => [MONTHS[w], ...(WORDS[w.toLowerCase()] || [])]).filter((x) => x !== undefined).map(norm));
// 英文的每一个译文里都要有;译文多出来的只能是 ok 里的。回的是错在哪,对就回 null
function sameNums(en, tr, ok) {
  const lost = missing(en, tr);
  if (lost !== null) return `英文里的数字「${lost}」译文里要原样留着(数字、金额、日期、时间都不改)`;
  const nb = count(tr);
  for (const [x, n] of count(en)) nb.set(x, nb.get(x) - n);
  for (const [x, n] of nb) if (n > 0 && !ok.has(norm(x))) return `译文里多了英文没有的数字「${x}」`;
  return null;
}
// 一句话里的数按数值列出来:千分位可以是逗号、空格、不换行空格、窄空格、撇号(后面正好三位),小数点是英文的点;
// 后面紧跟的量级一起算:英文 thousand / million / billion / trillion,日文、韩文的 千/천、万/萬/만、億/亿/억、兆/조
const VALUE_RE = /\d{1,3}(?:[,  ' ]\d{3})+(?:\.\d+)?(?!\d)|\d+(?:\.\d+)?/g;
const SCALE = { thousand: 1e3, million: 1e6, billion: 1e9, trillion: 1e12, "千": 1e3, "천": 1e3, "万": 1e4, "萬": 1e4, "만": 1e4, "億": 1e8, "亿": 1e8, "억": 1e8, "兆": 1e12, "조": 1e12 };
function numValues(prose) {
  return [...prose.matchAll(VALUE_RE)].map((m) => {
    const s = /^\s?(thousand|million|billion|trillion|千|천|万|萬|만|億|亿|억|兆|조)/i.exec(prose.slice(m.index + m[0].length));
    return norm(Number(m[0].replace(/[,  ' ]/g, "")) * (s ? SCALE[s[1].toLowerCase()] : 1));
  });
}

// ---------- 截止日历、专题译文里的数,换成这种语言的写法 ----------

// 只换照英文写的数:带千分位逗号的(344,056、$500,000、1,707.26)、带小数点的(0.2、0.5%),小数位数照原样,
// 用 Intl.NumberFormat 按这种语言写(德文 344.056、0,2;法文 344 056、0,2;日文、韩文和英文一样);千分位已经换成不换行空格、
// 小数还是英文点的(45 818.5),只换小数点。给了英文原文 en 的,只换原文里有的那几个数(按数值和小数位数对):
// 译文自己换过写法的(德文的 344.056 是 344056)不会被当成小数再换一遍。
// 网址、`代码`、{{变量}}、日子(2026-11-25)、时间(10:00)、粘着字母的(V3、L2、USDT0、0x…)不动;别的字(不换行空格之类)一个不改。
// 指南、界面文字不换(要和官网、钱包上看到的一样)
const EN_NUM = /(^|[^\p{L}\p{N}_.,])(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{1,3}(?:[  ]\d{3})+\.\d+|\d+\.\d+)(?![\p{L}\p{N}_]|[.,]\d)/gu;
const KEEP_RE = /(`[^`]*`|https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]*|\{\{\w+\}\})/;
const prose = (s) => String(s).split(KEEP_RE).filter((_, i) => i % 2 === 0).join(" ");
// 一个数的「数值 + 小数位数」:344,056 → 344056.;45 818.5 和 45,818.5 → 45818.5
const numKey = (num) => {
  const [a, f = ""] = num.replace(/[,  ]/g, "").split(".");
  return `${BigInt(a)}.${f}`;
};
export function localNumbers(s, locale, en = null) {
  const dec = new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === "decimal")?.value || ".";
  const int = (digits, group) => new Intl.NumberFormat(locale, { useGrouping: group ? "auto" : false, maximumFractionDigits: 0 }).format(BigInt(digits));
  const seen = en == null ? null : new Set([...prose(en).matchAll(EN_NUM)].map((m) => numKey(m[2])));
  return String(s).split(KEEP_RE).map((seg, i) => (i % 2 ? seg : seg.replace(EN_NUM, (m, pre, num) => {
    if (seen && !seen.has(numKey(num))) return m;
    const [a, frac] = num.split(".");
    // 千分位已经是不换行空格的:整数部分原样留着,只换小数点
    const head = /[  ]/.test(a) ? a : int(a.replace(/,/g, ""), a.includes(","));
    return pre + head + (frac === undefined ? "" : dec + frac);
  }))).join("");
}

// ---------- 译文里不能混着中文 ----------

const CJK = /[\u3000-\u303F\u4E00-\u9FFF\uFF00-\uFFEF]+/; // 汉字、中文标点、全角符号:和配方英文版的检查一样
const HAN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]+/; // 汉字(含扩展 A 和兼容汉字;写成转义,免得兼容汉字被规范化成别的字)
// 只有简体中文才用的字(日文写作「説、時、銭、確、認……」):日文译文里出现这些,多半是中文没换掉
const SIMPLIFIED = /[们这说时钱链币账户务项页网么吗呢还进过发问题关闭开设计请认证签权确实处给让对应击该显钮单输读选择错误类转换资额价钥词记态现场询结产帮图动钟从个长见间线续种无报险骗领质锁桥]/;

// 回的是混进去的那一段中文,没有就回 null。zhSrc 是这一条的中文原文(有的话):日文里和中文原文一模一样、汉字有 6 个以上的,也算没翻
// (「数量 × 0.995」「注意」这种日文本来就这么写的不算)
const hanCount = (s) => (s.match(new RegExp(HAN.source, "g")) || []).join("").length;
export function chineseIn(code, s, zhSrc = null) {
  s = String(s);
  if (code === "zh") return null;
  if (code === "ja") {
    if (zhSrc && s === zhSrc && hanCount(s) >= 6) return s.slice(0, 24);
    return s.match(SIMPLIFIED)?.[0] || null;
  }
  if (code === "ko") return s.match(HAN)?.[0] || null;
  return s.match(CJK)?.[0] || null;
}

// 指南里页面按记号拆段、上色的两处(见 build.mjs):截图说明里前后带空格的「! 」(黄色提示)「✗ 」(红色:别这样做),
// 在哪儿都算(splitMarks);步骤条目只看开头那一个。这两处的记号要和英文一样,别处的感叹号不管。
// 所以截图说明里别写前后都带空格的感叹号(法文习惯的「Attention ! Ne…」会被拆成一段提示),改写或者去掉前面的空格
const captionMarks = (s) => (String(s).match(/(^|\s)(!|✗)\s+/g) || []).map((m) => m.trim()).join(" ");
const itemMark = (s) => /^(!|✗)\s+/.exec(String(s))?.[1] || "";
// 是哪一种:截图说明(steps.<id>.images[i]、它的 .caption,岔路、页面图鉴里的也算)、步骤条目(.items[i])
const guideKind = (path) => (/images\[\d+\](\.caption)?$/.test(path) ? "caption" : /\.items\[\d+\]$/.test(path) ? "item" : null);

// 一条译文:要是不空的一段文字,不能改的都留着,不混中文。fail 收报错(前面已经带着文件名);
// kind:指南里的截图说明("caption")、步骤条目("item"),记号要和英文一样
export function checkText(code, en, tr, path, fail, zhSrc = null, kind = null) {
  if (typeof tr !== "string" || !tr.trim()) return fail(`${path} 要是不空的一段文字`);
  const diff = tokenDiff(en, tr, code);
  if (diff) fail(`${path}:${diff}`);
  const cjk = chineseIn(code, tr, zhSrc);
  if (cjk) fail(`${path} 里有中文「${cjk}」`);
  if (kind === "caption" && captionMarks(tr) !== captionMarks(en)) fail(`${path}:截图说明里前后带空格的「! 」「✗ 」要和英文一样(英文「${captionMarks(en)}」,这里「${captionMarks(tr)}」):页面按它们拆成提示、别这样做;别处的感叹号前后不要都带空格`);
  if (kind === "item" && itemMark(tr) !== itemMark(en)) fail(`${path}:开头要和英文一样${itemMark(en) ? `是「${itemMark(en)} 」` : "不带「! 」「✗ 」"}(「! 」是黄色提示,「✗ 」是红色的别这样做)`);
}

// ---------- 界面文字:src/js/lib/i18n/<编号>.js ----------

// 每个函数拿几组参数各跑一遍:不能报错,英文出字的这里也要出字;英文里显示出来的参数(数、名字、日期),这里也要显示。
// 第几个参数只是选哪一句(kind 这类)、不用显示的,写在 ENUM_ARGS 里
const LEFT = [{ days: 13, hours: null, day: null }, { days: 1, hours: null, day: null }, { days: 0, hours: 5, day: null }, { days: 0, hours: 1, day: null }, { days: 0, hours: 0, day: null }, { days: 0, hours: null, day: "2026-11-25" }, { days: -1, hours: null, day: null }];
const KINDS = ["move", "bridge", "swap", "redeem", "rewards", "other"];
export const SAMPLES = {
  checkingN: [[1], [7]], foundN: [[1], [7]], about: [["1,234.56"]], failRow: [["the check timed out"]], nothingH: [[1], [7]], nothingP: [["Hyperliquid, WOOFi"]],
  assetsDefiH: [["1,234.56"]], assetsWalletH: [["1,234.56"]], exitDefiH: [["PancakeSwap"]], exitDefiLead: [["PancakeSwap"]], exitDebt: [["1,234.56"]], exitOpen: [["PancakeSwap"]], exitConnect: [["Arbitrum"]],
  exitKind: ["lp", "deposit", "staked", "locked", "vesting", "reward", "investment", "other"].map((k) => [k]), exitWalletH: [["Arbitrum"]],
  exitGasOk: [["0.0123", "ETH"]], exitGasLow: [["0.0123", "ETH"]], exitGasLowP: [["ETH", "Arbitrum"]], exitGasNone: [["ETH"], [""]], exitGasNoneP: [["ETH", "Arbitrum"], ["", "Arbitrum"]],
  exitDust: [["0.42"]], exitSwitch: [["Arbitrum"]], exitMove: [["Arbitrum"]], assetsDebt: [["1,234.56"]],
  assetType: ["deposit", "staked", "locked", "reward", "loan", "investment", "wallet"].map((k) => [k]), assetsMore: [[1], [7]], assetsDust: [[1], [7]], assetsUnpriced: [[1], [7]],
  defiN: [[1], [7]], defiGuided: [[1], [7]], scopeNow: [["Hyperliquid, WOOFi"]], walletGot: [["0x12ab…34cd"]],
  dueTitle: KINDS.flatMap((k) => [[k, "Sophon", "Nov 25"], [k, "Sophon", ""], [k, "opBNB", "Nov 25", { tokens: ["CAKE"] }], [k, "Mantle, Ethereum", "Dec 5", { tokens: ["cmETH", "STG debt"], before: false }], [k, "", ""]]),
  dueToken: [["CAKE", false], ["CAKE", true]], dueDate: [[2026, 11, 25, true], [2027, 1, 5, false]], dueLeft: LEFT.map((x) => [x]), dueNext: LEFT.map((x) => ["Dec 31", x, "Airdrop claims close"]),
  stepOf: [[3, 7]], stepsLeft: [[0], [1], [5]], routeAriaStep: [[3, 7]], checkGate: [[2, 3]], movesBy: [["WOOFi"]], movesP: [["WOOFi's contract"]], stepsAt: [[[6]], [[8, 9]], [[7, 8, 9]]],
  copied: [["https://woofi.com/stake"]], calcFail: [["the check timed out"]], skipped: [[1], [3]], lastVerified: [["2026-10-29", "Tested end to end."]], doneTo: [["0x12ab…34cd"]], doneSum: [["10.5", "1.25", "9.25"]],
  diagAt: [["12:34"]], diagFail: [["the check timed out"]], whereAt: [[4, "Withdraw", true], [4, "Withdraw", false]], goStep: [[4, "Withdraw"]], reportText: [["WOOFi", 4, "Withdraw", "a1, b2", "none"]],
  reportToast: [["Send it to @defiexit"]], reportWhere: [["@defiexit"]], follow: [[4, "Withdraw", true], [4, "Withdraw", false]], lostAsOf: [["2026-10-29"]],
  shotMiss: ["none", "no", "busy", "timeout", "stale", "slow", "big", "other"].map((k) => [k]), errHttp: [[503]], lastChecked: [["2026-11-05"]], shareXAria: [["Sophon shuts down"]],
  dlLeft: LEFT.map((x) => [x]), dlType: ["chain-shutdown", "frontend-down", "withdraw-only", "token-migration", "bridge-route-end", "stablecoin-redemption", "rewards-deadline", "other"].map((k) => [k]),
  dlAnnounced: [["2026-11-01"]], tpDeadline: [["Sophon shuts down"]], tpGuide: [["WOOFi to your wallet"]],
};
const ENUM_ARGS = { exitKind: [0], assetType: [0], shotMiss: [0], dlType: [0], dueTitle: [0] };
// 参数里显示得出来的值:数(1 和 0 不算:「一个」可以写成字)、不空的文字;数组、对象里的也算
const shown = (args, skip = []) => args.flatMap((a, i) => (skip.includes(i) ? [] : [a])).flatMap(function flat(v) {
  if (Array.isArray(v)) return v.flatMap(flat);
  if (isObj(v)) return Object.values(v).flatMap(flat);
  if (typeof v === "number") return Math.abs(v) >= 2 ? [String(v)] : [];
  return typeof v === "string" && v.length >= 2 ? [v] : [];
});

export function checkUI(code, dict, file) {
  const fail = (m) => { throw new Error(`${file}: ${m}`); };
  if (!isObj(dict)) fail("要 export default 一个对象:{ 键: 文字 }(键和 src/js/lib/i18n.js 里 STR.en 的一样)");
  for (const [k, v] of Object.entries(dict)) {
    const en = STR.en[k];
    if (en === undefined) fail(`${k} 不是界面文字的键(STR.en 里没有这个键;拼错了?)`);
    if (typeof v !== typeof en) fail(`${k} 要和英文一样是${typeof en === "function" ? "函数" : "一段文字"}`);
    if (typeof v === "string") checkText(code, en, v, k, fail, typeof STR.zh[k] === "string" ? STR.zh[k] : null);
    else if (v.length !== en.length) fail(`${k} 的参数要和英文一样(英文的函数有 ${en.length} 个参数,这里是 ${v.length} 个)`);
  }
  for (const [k, list] of Object.entries(SAMPLES)) {
    const v = dict[k];
    if (typeof v !== "function") continue;
    for (const args of list) {
      const call = `${k}(${args.map((a) => JSON.stringify(a)).join(", ")})`;
      const en = STR.en[k](...args);
      let out;
      try {
        out = v(...args);
      } catch (e) {
        fail(`${call} 出错了:${e.message}`);
      }
      if (typeof en !== "string") continue;
      if (typeof out !== "string" || !out.trim()) fail(`${call} 要回一段不空的文字`);
      for (const bad of ["undefined", "NaN", "[object Object]"]) if (out.includes(bad) && !en.includes(bad)) fail(`${call} 回的文字里有「${bad}」:${out}`);
      for (const x of shown(args, ENUM_ARGS[k])) if (en.includes(x) && !out.includes(x)) fail(`${call}:英文显示了参数「${x}」,这里没显示:${out}`);
      const cjk = chineseIn(code, out);
      if (cjk) fail(`${call} 回的文字里有中文「${cjk}」`);
    }
  }
  return dict;
}

// 读界面文字文件,核对过就装进 i18n.js(makeT 用得到)。回的是要出页面的语言(中英在前,别的按登记的顺序)。
// root 是放译文的那一层(平时是仓库根目录;测试用 test/fixtures 下面照仓库排的一套)
export async function loadUI(root) {
  const dir = join(root, "src", "js", "lib", "i18n");
  const files = existsSync(dir) ? readdirSync(dir) : [];
  for (const f of files) {
    const code = f.replace(/\.js$/, "");
    if (!f.endsWith(".js") || !EXTRA.includes(code)) throw new Error(`${rel(root, join(dir, f))}: 只放登记过的新语言的界面文字(${EXTRA.join("、")}.js);中英两套写在 src/js/lib/i18n.js 里`);
  }
  const codes = [];
  for (const code of EXTRA) {
    const file = join(dir, `${code}.js`);
    if (!existsSync(file)) continue;
    const mod = await import(pathToFileURL(file).href);
    addUI(code, checkUI(code, mod.default, rel(root, file)));
    codes.push(code);
  }
  return [...BASE, ...codes];
}

// ---------- 检测器、X Layer 取法给用户看的话:src/js/detectors/i18n/<名字>.<编号>.js ----------

// 名字 → 英文那一套(译文照它的结构写,可以只翻一部分,见 src/js/lib/dtext.js)
export const DTEXT = { hyperliquid: HL.en, woofi: WF.en, dyorswap: DY.en, "okx-boost": OK.en, xlayer: HOW.en };
const DTEXT_SRC = (name) => (name === "xlayer" ? "src/js/lib/xlayer.text.js 的 HOW.en" : `src/js/detectors/${name}.text.js 的 TEXT.en`);

// 替身参数:函数拿参数做什么(显示、取属性、map、join、比大小)都不出错;显示出来的是「⟦a⟧」「⟦a.amount⟧」这样的记号
// (第几个参数、取了哪个属性),英文显示了的记号译文里也要有。empty:参数本身在,里面取出来的都是空的(v.ready 这种判断走另一边)
const MARK = /⟦[^⟧]*⟧/g;
function stand(path, empty = false) {
  const item = () => stand(`${path}[0]`, empty);
  // 底下是个数组:译文写了 Array.isArray(items) 这种防着不是列表的,照样当列表用
  return new Proxy([], {
    get(_, k) {
      if (k === Symbol.toPrimitive) return (hint) => (hint === "number" ? (empty ? 0 : 7) : empty ? "" : `⟦${path}⟧`);
      if (k === Symbol.iterator) return function* () { if (!empty) yield item(); };
      if (typeof k === "symbol" || k === "then") return undefined;
      if (["toString", "toLocaleString", "toFixed", "toPrecision", "join", "trim", "toUpperCase", "toLowerCase"].includes(k)) return () => (empty ? "" : `⟦${path}⟧`);
      if (k === "valueOf") return () => (empty ? 0 : 7);
      if (k === "length") return empty ? 0 : 1;
      if (k === "map" || k === "flatMap") return (fn) => (empty ? [] : [fn(item(), 0)].flat());
      if (k === "filter") return (fn) => (empty || !fn(item(), 0) ? [] : [item()]);
      if (k === "forEach") return (fn) => { if (!empty) fn(item(), 0); };
      if (k === "reduce") return (fn, init) => (empty ? init : fn(init, item(), 0));
      if (["some", "every", "includes"].includes(k)) return () => !empty;
      if (["slice", "concat", "sort", "reverse"].includes(k)) return () => (empty ? [] : [item()]);
      return empty ? "" : stand(`${path}.${k}`);
    },
  });
}
// 每个函数跑四遍:参数都在、参数是 null、参数在但里面是空的、参数是 1(单数那一句);英文这样调用也会出错的那一遍不比
const RUNS = [
  ["参数都在", (n) => Array.from({ length: n }, (_, i) => stand(String.fromCharCode(97 + i)))],
  ["参数是 null", (n) => Array(n).fill(null)],
  ["参数里的值是空的", (n) => Array.from({ length: n }, (_, i) => stand(String.fromCharCode(97 + i), true))],
  ["参数是 1", (n) => Array(n).fill(1)],
];
// 英文回什么样,译文就回什么样:文字对文字(英文显示的参数都要显示,不能改的都留着);对象、列表一样的字段、一样的条数
function sameOut(code, en, tr, path, fail, full) {
  if (typeof en === "string") {
    if (typeof tr !== "string" || (en.trim() && !tr.trim())) return fail(`${path} 要和英文一样回一段文字`);
    for (const bad of ["undefined", "NaN", "[object Object]"]) if (tr.includes(bad) && !en.includes(bad)) fail(`${path} 回的文字里有「${bad}」:${tr}`);
    const cjk = chineseIn(code, tr);
    if (cjk) fail(`${path} 回的文字里有中文「${cjk}」`);
    if (!full) return;
    for (const m of new Set(en.match(MARK) || [])) if (!tr.includes(m)) fail(`${path}:英文显示了参数 ${m},这里没显示:${tr}`);
    const diff = tokenDiff(en.replace(MARK, " "), tr.replace(MARK, " "), code);
    if (diff) fail(`${path}:${diff}`);
    return;
  }
  if (Array.isArray(en)) {
    if (!Array.isArray(tr) || tr.length !== en.length) return fail(`${path} 要和英文一样是 ${en.length} 条的列表`);
    return en.forEach((x, i) => sameOut(code, x, tr[i], `${path}[${i}]`, fail, full));
  }
  if (isObj(en)) {
    if (!isObj(tr)) return fail(`${path} 要和英文一样是 { … }`);
    for (const k of Object.keys(tr)) if (!(k in en)) fail(`${path}.${k}:英文回的没有这一项`);
    for (const k of Object.keys(en)) {
      if (!(k in tr)) fail(`${path} 缺 ${k}(英文回的有)`);
      sameOut(code, en[k], tr[k], `${path}.${k}`, fail, full);
    }
    return;
  }
  if (typeof tr !== typeof en || (typeof en === "boolean" && tr !== en)) fail(`${path} 要和英文一样:${JSON.stringify(en)}`);
}

export function checkDText(code, name, dict, file) {
  const fail = (m) => { throw new Error(`${file}: ${m}`); };
  if (!isObj(dict)) fail(`要 export default 一个对象,结构和 ${DTEXT_SRC(name)} 一样`);
  const walk = (en, x, path) => {
    for (const [k, v] of Object.entries(x)) {
      const p = path ? `${path}.${k}` : k, e = en[k];
      if (!(k in en)) fail(`${p}:${DTEXT_SRC(name)} 里没有这个键(拼错了?)`);
      if (isObj(e)) {
        if (!isObj(v)) fail(`${p} 要和英文一样是一组 { … }`);
        walk(e, v, p);
        continue;
      }
      if (typeof v !== typeof e) fail(`${p} 要和英文一样是${typeof e === "function" ? "函数" : "一段文字"}`);
      if (typeof e === "string") {
        checkText(code, e, v, p, fail);
        continue;
      }
      if (v.length !== e.length) fail(`${p} 的参数要和英文一样(英文的函数有 ${e.length} 个参数,这里是 ${v.length} 个)`);
      RUNS.forEach(([what, args], i) => {
        const a = args(e.length);
        let want, got;
        try { want = e(...a); } catch { return; }
        try { got = v(...a); } catch (err) { fail(`${p}(${what})出错了:${err.message}`); }
        sameOut(code, want, got, `${p}(${what})`, fail, i === 0);
      });
    }
  };
  walk(DTEXT[name], dict, "");
  return dict;
}

// 读 src/js/detectors/i18n/:文件名 <名字>.<编号>.js;核对过就装进 lib/dtext.js。回 { 编号: [名字…] }(构建时给页面生成装译文的那一段)
export async function loadDTexts(root) {
  const dir = join(root, "src", "js", "detectors", "i18n");
  const out = {};
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).sort()) {
    const m = /^([a-z-]+)\.([a-z]+)\.js$/.exec(f), file = rel(root, join(dir, f));
    if (!m || !DTEXT[m[1]] || !EXTRA.includes(m[2])) throw new Error(`${file}: 文件名要是 <名字>.<编号>.js(名字:${Object.keys(DTEXT).join("、")};编号:${EXTRA.join("、")})`);
    const mod = await import(pathToFileURL(join(dir, f)).href);
    addText(m[1], m[2], checkDText(m[2], m[1], mod.default, file));
    (out[m[2]] = out[m[2]] || []).push(m[1]);
  }
  return out;
}

// ---------- 截止日历:data/i18n/<编号>/deadlines.json ----------

export const DL_TEXT = ["name", "summary", "deadlineNote", "who", "todo", "caution"];

// O 是译文,D 是 data/deadlines.json(已经过 checkDeadlines)。xLen、flat、ban 从构建脚本传进来(转发到 X 的字数、标题里不写的词)
export function checkDeadlineOverlay(code, O, D, file, { xLen, flat, ban }) {
  const fail = (m) => { throw new Error(`${file}: ${m}`); };
  if (!isObj(O)) fail("要是 { 事件编号: { 字段: 译文 } }");
  const byId = new Map(D.events.map((e) => [e.id, e]));
  for (const [id, x] of Object.entries(O)) {
    const e = byId.get(id);
    if (!e) fail(`${id} 不是 data/deadlines.json 里的事件编号`);
    if (!isObj(x)) fail(`${id} 要是 { 字段: 译文 }`);
    for (const [k, v] of Object.entries(x)) {
      if (DL_TEXT.includes(k)) {
        if (e[k] === undefined) fail(`${id}.${k}:这一条没有 ${k},不用写`);
        checkText(code, e[k].en, v, `${id}.${k}`, fail, e[k].zh);
      } else if (k === "official" || k === "milestones") {
        const src = k === "official" ? e.official.map((o) => o.label) : (e.milestones || []).map((m) => m.note);
        if (!src.length) fail(`${id}.${k}:这一条没有 ${k},不用写`);
        if (!Array.isArray(v) || v.length !== src.length) fail(`${id}.${k} 要是 ${src.length} 条的列表,和英文的 ${k} 一条一条对上`);
        v.forEach((y, j) => checkText(code, src[j].en, y, `${id}.${k}[${j}]`, fail, src[j].zh));
      } else fail(`${id}.${k} 不是能翻的字段(只有 ${[...DL_TEXT, "official", "milestones"].join("、")})`);
    }
    if (typeof x.name === "string" && ban.test(x.name)) fail(`${id}.name 里不写 claim / recover 这类词`);
    if (typeof x.summary === "string" && xLen(flat(x.summary, code)) + 24 > 280) fail(`${id}.summary 太长,转发到 X 会超过 280 字`);
  }
  return O;
}

// 把译文合进截止日历:每一处中英两套的文字 { zh, en } 加上 [编号](没翻的用英文)。改的是传进来的这一份
// 译文里照英文写的数换成这种语言的写法(见 localNumbers);没翻的用英文,并记下这一页有没翻的(D.partial / T.partial:哪几种语言)
function filler(code, mark) {
  const loc = langInfo(code).locale;
  return (v, tr) => {
    if (typeof tr === "string") return localNumbers(tr, loc, v.en);
    mark();
    return v.en;
  };
}
const flag = (o, k, code) => () => { (o[k] = o[k] || new Set()).add(code); };

export function applyDeadlines(D, code, O = {}) {
  const fill = filler(code, flag(D, "partial", code));
  for (const e of D.events) {
    const x = O[e.id] || {};
    for (const k of DL_TEXT) if (e[k]) e[k][code] = fill(e[k], x[k]);
    e.official.forEach((o, j) => { o.label[code] = fill(o.label, x.official?.[j]); });
    (e.milestones || []).forEach((m, j) => { m.note[code] = fill(m.note, x.milestones?.[j]); });
  }
  return D;
}

// ---------- 专题:data/i18n/<编号>/topics/<slug>.json ----------

export function checkTopicOverlay(code, O, T, file, { ban }) {
  const fail = (m) => { throw new Error(`${file}: ${m}`); };
  if (!isObj(O)) fail("要是 { title, summary, sections, faq, sources }");
  const list = (k, src, v, each) => {
    if (!Array.isArray(v) || v.length !== src.length) fail(`${k} 要是 ${src.length} 条的列表,和英文一条一条对上`);
    v.forEach((y, i) => each(src[i], y, `${k}[${i}]`));
  };
  const keys = (v, ok, path) => { for (const k of Object.keys(v)) if (!ok.includes(k)) fail(`${path}${k} 不是能翻的字段(只有 ${ok.join("、")})`); };
  keys(O, ["title", "summary", "sections", "faq", "sources"], "");
  for (const k of ["title", "summary"]) if (O[k] !== undefined) checkText(code, T[k].en, O[k], k, fail, T[k].zh);
  if (typeof O.title === "string" && ban.test(O.title)) fail("title 里不写 claim / recover 这类词");
  if (O.sections !== undefined) {
    list("sections", T.sections, O.sections, (s, y, path) => {
      if (!isObj(y)) fail(`${path} 要是 { h, p, list }`);
      keys(y, ["h", "p", "list"], `${path}.`);
      checkText(code, s.h.en, y.h, `${path}.h`, fail, s.h.zh);
      for (const k of ["p", "list"]) {
        const src = s[k] || [];
        // 原文这一段没有 p 或 list 的:译文不写,或者写空列表
        if (y[k] === undefined && !src.length) continue;
        list(`${path}.${k}`, src, y[k], (a, b, q) => checkText(code, a.en, b, q, fail, a.zh));
      }
    });
  }
  if (O.faq !== undefined) {
    list("faq", T.faq || [], O.faq, (x, y, path) => {
      if (!isObj(y)) fail(`${path} 要是 { q, a }`);
      keys(y, ["q", "a"], `${path}.`);
      checkText(code, x.q.en, y.q, `${path}.q`, fail, x.q.zh);
      checkText(code, x.a.en, y.a, `${path}.a`, fail, x.a.zh);
    });
  }
  if (O.sources !== undefined) list("sources", T.sources, O.sources, (s, y, path) => checkText(code, s.label.en, y, path, fail, s.label.zh));
  return O;
}

// T.partialHead:标题、一句话有没翻的(专题列表上看得到);T.partial:整篇有没翻的
export function applyTopic(T, code, O = {}) {
  const head = filler(code, () => { flag(T, "partialHead", code)(); flag(T, "partial", code)(); });
  const fill = filler(code, flag(T, "partial", code));
  for (const k of ["title", "summary"]) T[k][code] = head(T[k], O[k]);
  T.sections.forEach((s, i) => {
    const y = O.sections?.[i] || {};
    s.h[code] = fill(s.h, y.h);
    for (const k of ["p", "list"]) (s[k] || []).forEach((x, j) => { x[code] = fill(x, y[k]?.[j]); });
  });
  (T.faq || []).forEach((x, i) => { x.q[code] = fill(x.q, O.faq?.[i]?.q); x.a[code] = fill(x.a, O.faq?.[i]?.a); });
  T.sources.forEach((s, i) => { s.label[code] = fill(s.label, O.sources?.[i]); });
  return T;
}

// 读 data/i18n/:只放登记过的新语言,每种语言下只有 deadlines.json 和 topics/<slug>.json。回 { 编号: { deadlines, topics: { slug: 译文 } } }
export function readDataOverlays(root, D, topics, checks) {
  const dir = join(root, "data", "i18n");
  const out = {};
  if (!existsSync(dir)) return out;
  for (const code of readdirSync(dir)) {
    const base = join(dir, code);
    if (!EXTRA.includes(code) || !statSync(base).isDirectory()) throw new Error(`${rel(root, base)}: data/i18n 下面只放登记过的新语言(${EXTRA.join("、")})的目录`);
    const o = (out[code] = { deadlines: null, topics: {} });
    for (const f of readdirSync(base)) {
      const p = join(base, f);
      if (f === "deadlines.json") o.deadlines = checkDeadlineOverlay(code, readJSON(p, root), D, rel(root, p), checks);
      else if (f === "topics" && statSync(p).isDirectory()) {
        for (const g of readdirSync(p)) {
          const q = join(p, g), T = topics.find((x) => `${x.slug}.json` === g);
          if (!T) throw new Error(`${rel(root, q)}: data/topics 里没有这篇专题(文件名要和专题的 slug 一样)`);
          o.topics[T.slug] = checkTopicOverlay(code, readJSON(q, root), T, rel(root, q), checks);
        }
      } else throw new Error(`${rel(root, p)}: data/i18n/${code}/ 下面只放 deadlines.json 和 topics/<slug>.json`);
    }
  }
  return out;
}

function readJSON(file, root) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${rel(root, file)}: 不是合法的 JSON(${e.message})`);
  }
}

// ---------- 指南:recipes/<id>/i18n/<编号>.json ----------

// 和 en.json 结构一模一样:同样的字段、同样的条数,每一处文字都翻了、不能改的都留着(截图文件名、网址照英文版)。
// 翻好以后还要过 localize(和英文版同一套检查),见 scripts/build.mjs
export function checkRecipeOverlay(code, o, en, file) {
  const fail = (m) => { throw new Error(`${file}: ${m}`); };
  const walk = (a, b, path) => {
    const at = path || "(整个文件)";
    if (typeof a === "string") return checkText(code, a, b, at, fail, null, guideKind(path));
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || b.length !== a.length) fail(`${at} 要是 ${a.length} 条的列表(和 en.json 一样)`);
      return a.forEach((x, i) => walk(x, b[i], `${path}[${i}]`));
    }
    if (isObj(a)) {
      if (!isObj(b)) fail(`${at} 要和 en.json 一样是 { … }`);
      for (const k of Object.keys(b)) if (!(k in a)) fail(`${path ? `${path}.` : ""}${k} 是 en.json 里没有的字段`);
      for (const k of Object.keys(a)) {
        if (!(k in b)) fail(`缺 ${path ? `${path}.` : ""}${k}(en.json 里有)`);
        walk(a[k], b[k], path ? `${path}.${k}` : k);
      }
      return;
    }
    if (a !== b) fail(`${at} 要和 en.json 一样:${JSON.stringify(a)}`);
  };
  walk(en, o, "");
  return o;
}

// 翻好的配方里还剩没换掉的中文:整份按语言查一遍(见 chineseIn);日文另外找和中文原文一模一样的长句
export function recipeLeftover(code, L, r) {
  let hit = null;
  const walk = (a, b) => {
    if (hit) return;
    if (typeof a === "string") hit = chineseIn(code, a, typeof b === "string" ? b : null);
    else if (a && typeof a === "object") for (const k of Object.keys(a)) walk(a[k], b?.[k]);
  };
  if (code === "ja") walk(L, r);
  return hit || chineseIn(code, JSON.stringify(L));
}

// 这份配方有哪几种语言的译文:i18n/ 下面只放 en.json 和登记过的新语言
export function recipeLangs(root, id) {
  const dir = join(root, "recipes", id, "i18n");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f !== "en.json").map((f) => {
    const code = f.replace(/\.json$/, "");
    if (!f.endsWith(".json") || !EXTRA.includes(code)) throw new Error(`recipes/${id}/i18n/${f}: 这里只放 en.json 和登记过的新语言(${EXTRA.map((c) => `${c}.json`).join("、")});中文是 recipe.json 本身`);
    return code;
  });
}

export const readRecipeOverlay = (root, id, code) => readJSON(join(root, "recipes", id, "i18n", `${code}.json`), root);
export { langInfo };
