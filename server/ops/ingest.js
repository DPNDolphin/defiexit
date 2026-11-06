// 签名投递:Claude 主窗口把看板数据、待发草稿、评论分析送进运营台。主窗口那台电脑没有后台账号,也没有数据库凭证,
// 只有 Ed25519 私钥(正式、预览各一把,不进任何仓库);公钥写在 wrangler.toml 的 INGEST_PUBKEYS(公开的,没关系;
// 写几把就认几把,换钥匙 = 加新的、删旧的、重新发布)。
// 签的是「dx-ingest-v1 / 环境 / 方法 / 路径 / 原始请求体」,所以预览的包投不进正式库,换了路径也不认。
// 请求体带 ts(毫秒,按服务器时钟 ±10 分钟)和 nonce;ts 还必须比上一次收下的大(旧包不能盖新数据);nonce 和数据同一个事务写入。
// 投递只能:替换看板的几份 JSON;新建待发、收件,或者改它们 Claude 写的部分(mine)。永远不碰管理员点的状态、决定、备注、改过的草稿;
// 待发一旦被管理员点过「已发 / 跳过」,草稿和目标帖子就不能再改;目标帖子的编号建好以后不能换;回帖和自己发的帖子建好以后不能互换;
// 项目帖引用的原帖建好以后不能换、不能去掉(原来没有的,管理员没改过草稿才能补上)。
// 问题记录(problems,见 cleanProblem):按帖子编号新建或更新(库里只存编号的哈希),分类以最新送来的为准;replied 只会从 false 变 true;
// 到期删过的不再写回链接和账号。
// 按要求删过的(gone 里有它的 goneKey,见 db.js):那条帖子收件、待发、问题记录都不收,哪个字段带着它都不收
// (收件的编号、链接、要回的那条;待发的目标帖子、引用的原帖、回复链接),删过的那张待发卡片也不收;收件评论到期删过的,收件不收。
// 查 gone 和写是同一句(和管理员点「删除」同时来也写不回去);没写进去的,回执里写明为什么。一包待发、收件、问题记录各最多 50 条。
// 草稿入库前检查:不许出现私信、客服、加群、转账、授权、助记词、私钥、找回、领取、recover、claim、返佣等词;链接分三种(回复写法 11-05):
//   对人的首回(待发里回别人的)一个链接、域名都不许带,连 defiexit.com 也不带(对方接着问了,续答再给);
//   项目帖只许 defiexit.com(引用的原帖另放 quote);收件里的续答许 defiexit.com,加上运营规则(rules.officialHosts)列的官方网址。
// 只查送进来的草稿,库里原有的不回头查(照常显示)。不合格的那一条不入库,回执里写明哪条为什么;回执不含任何库里的数据。
// 宣传卡片(outreach,见 cleanReach):新建,或者改管理员还没点过的;点过「已发 / 跳过」的不再改。标题、邮件标题、正文的链接照收件续答的规矩查
// (长得像的写法;只许 defiexit.com 和 rules.officialHosts,另外放行我们自己的 GitHub 仓库),敏感词另用一份(REACH_WORDS:安全说明里的
// 私钥、助记词、授权照常能写,只拦招揽和骗局的说法;标题、邮件标题另外避开找回、领取、recover、claim,见 TITLE_WORDS)。
// 这张卡片、它的收件邮箱按要求删过的不收(查和写同一句)。
// 一包最多 50 张,稿子加起来最多 10 万字(REACH_MAX.pack)。

import { iso, plusDays, KEEP_DAYS, DOC_KEYS, docStmt, getKv, getDoc, getDocs, existing, goneKey, expKey, NOT_GONE, goneArg, outKeys, inKeys, sameRefs, sameInRefs, bjDay, problemKey, PROBLEM_TYPES, PROBLEM_SOURCES, reachKeys, reachCardKey, reachToKey } from "./db.js";
import { unb64u, sha256 } from "./auth.js";
import { ASCII_HOST, IPV4, UNICODE_HOST, DOTS, TLD_GLUED, NAME_RULE, RISK_RULE, plainName, softName } from "./names.js";

export const SKEW_MS = 10 * 60 * 1000;
export const MAX = { draft: 1000, short: 300, doc: 200 * 1024, items: 50, perDay: 200, body: 512 * 1024 };

export const signedText = (envName, method, path, raw) => `dx-ingest-v1\n${envName}\n${method}\n${path}\n${raw}`;
// 回执里没收的几种说法:按要求删过的;管理员点过「已发 / 跳过」的待发(宣传卡片也一样);没人点过、30 天到了自己删过的待发;
// 写给按要求删过的收件邮箱的宣传卡片
const GONE_WHY = "管理员按要求删过,不再收", HANDLED_WHY = "管理员已经处理过,草稿不再改", EXPIRED_OUT_WHY = "30 天到期删过,不再改";
const REACH_TO_WHY = "这个收件邮箱按要求删过,不再收";

export async function verify(text, sigB64u, pubList) {
  if (!sigB64u) return false;
  const keys = String(pubList || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const k of keys) {
    try {
      const key = await crypto.subtle.importKey("raw", unb64u(k), { name: "Ed25519" }, false, ["verify"]);
      if (await crypto.subtle.verify({ name: "Ed25519" }, key, unb64u(sigB64u), new TextEncoder().encode(text))) return true;
    } catch { /* 下一把 */ }
  }
  return false;
}

// ---------- 草稿检查 ----------
const BANNED = ["私信", "私聊", "客服", "加群", "进群", "电报", "转账", "汇款", "授权", "助记词", "私钥", "密码", "找回", "领取", "返佣", "recover", "claim", "rebate", "telegram", "whatsapp", "dm me", "seed phrase", "private key"];
const ALLOWED_HOSTS = ["defiexit.com", "www.defiexit.com"];
// 待发的草稿许带哪些网址:项目帖只许本站;回别人的(对人的首回)一个都不许
export const outHosts = (mine) => (mine && mine.kind === "post" ? ALLOWED_HOSTS : []);
// 收件续答许带的网址:本站,加上运营规则里列的官方网址(入库时已经查过格式)
const inHosts = (rules) => [...ALLOWED_HOSTS, ...(rules && Array.isArray(rules.officialHosts) ? rules.officialHosts : [])];
// 链接的几种写法:带协议的(任何 xxx://)、英文域名(含 xn-- 编码的)、IP 地址、中文域名(汉字之间夹着英文句点);
// 后几种和「长得像句点的」(DOTS)、「最后一段紧跟着别的文字」(TLD_GLUED)在 names.js,协议、链的名字检查也用。
// 带协议的链接到哪儿为止:空白,和包着链接的符号(括号、尖括号、引号、反引号、反斜杠、中文的书名号引号、句号顿号)都不算链接;
// 末尾的标点(. , ; : ! ? 和 markdown 的 ] * _ ~)也不算(TRAIL)。所以 [x](https://defiexit.com)、<https://defiexit.com>、
// (see https://defiexit.com/deadlines/). 都读成 defiexit.com;括号后面紧跟着的字照普通文字再查一遍(…com/x)evil.com 里的 evil.com 照样拦)
const SCHEME = /[a-z][a-z0-9+.-]{1,20}:\/\/[^\s<>"'`(){}|\\^「」『』【】《》〈〉“”‘’。、]*/gi;
const TRAIL = /[.,;:!?\]*_~]+$/;
// 英文域名前后紧挨着字母、数字(哪种文字都算)、附加符号、连字号或下划线:真正的主机名比找到的长(éblast.io 其实是 xn--blast-9ra.io),当可疑网址
const GLUED_BEFORE = /[\p{L}\p{N}\p{M}_-]$/u, GLUED_AFTER = /^[\p{L}\p{N}\p{M}_-]/u;
function hostOf(s) {
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : "http://" + s).hostname.toLowerCase().replace(/\.$/, ""); } catch { return null; }
}
// 敏感词默认的找法:BANNED 按字面找,不分大小写(对人的回复、项目帖、收件续答都用它;宣传稿换成 reachWord,见下面「宣传卡片」)
const bannedWord = (t) => { const low = t.toLowerCase(); return BANNED.find((w) => low.includes(w)) || null; };
// 「主机名 + 路径开头」放行的带协议链接(宣传稿放行我们自己的 GitHub 仓库,见 REACH_PATHS):https、不带账号密码和端口、主机名一模一样,
// 路径(按 URL 的标准写法,../ 先算掉;不分大小写)正好是这一段或者在它下面:/DPNDolphin/defiexit-x、/DPNDolphin 都不算
function onPath(link, p) {
  try {
    const u = new URL(link);
    if (u.protocol !== "https:" || u.username || u.password || u.port || u.hostname !== p.host) return false;
    const path = u.pathname.toLowerCase(), pre = p.prefix.toLowerCase();
    return path === pre || path.startsWith(pre + "/");
  } catch { return false; }
}

// hosts:这份草稿许带的网址,主机名一模一样才算(blast.io 不放行 xblast.io、blast.io.evil.com),带协议的只认 https;
// 给空的 = 一个链接、域名都不许带(对人的首回)。
// 另外两项只有宣传稿换:words 敏感词的找法(给回不许用的那个词,没有回 null),paths 另外放行的「主机名 + 路径开头」(只认带 https:// 的写法)
export function checkText(s, max = MAX.draft, hosts = ALLOWED_HOSTS, { words = bannedWord, paths = [] } = {}) {
  if (typeof s !== "string") return "不是文字";
  const t = s.trim();
  if (!t) return "是空的";
  if (t.length > max) return `超过 ${max} 字`;
  const word = words(t);
  if (word) return `含不许用的词「${word}」`;
  const off = (h) => (hosts.length ? `含站外链接「${h}」` : `含链接或域名「${h}」(对人的首回一个都不带,连 defiexit.com 也不带)`);
  // 先统一写法再找网址(三种规矩都一样):全角字母、全角的点换成半角(NFKC),英文之间的「。」换成点,长得像的绕不过去。敏感词照旧查原文
  const u = t.normalize("NFKC").replace(DOTS, ".");
  for (const m of u.matchAll(SCHEME)) {
    const link = m[0].replace(TRAIL, "");
    const host = hostOf(link);
    if (host && /^https:\/\//i.test(link) && (hosts.includes(host) || paths.some((p) => onPath(link, p)))) continue;
    return off(host || link.slice(0, 30));
  }
  const rest = u.replace(SCHEME, " ");
  for (const m of rest.matchAll(ASCII_HOST)) {
    const host = hostOf(m[0]);
    if (!host || !hosts.includes(host)) return off(host || m[0]);
    if (GLUED_BEFORE.test(rest.slice(0, m.index)) || GLUED_AFTER.test(rest.slice(m.index + m[0].length))) return `含可疑网址「${host}」(紧挨着别的字母或汉字,真正的网址比它长;前后空一格)`;
  }
  if (IPV4.test(u)) return "含 IP 地址";
  if (UNICODE_HOST.test(u) || TLD_GLUED.test(u)) return "含中文域名或可疑网址(汉字之间别用英文句点)";
  return null;
}

const str = (v, max = MAX.short) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);
// 先看类型再转成文字:只转文字和数字,别的(对象、数组、true / false)一律当没写。不拿对象当文字转({"toString": null} 一转就报错,连累整包)
const txt = (v) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const tweetId = (v) => (/^\d{1,25}$/.test(txt(v)) ? txt(v) : undefined);
const xUrl = (v) => (/^https:\/\/(x|twitter)\.com\/[A-Za-z0-9_]{1,15}\/status\/\d{1,25}$/.test(txt(v)) ? txt(v) : undefined);
const handle = (v) => (/^[A-Za-z0-9_]{1,15}$/.test(txt(v)) ? txt(v) : undefined);
const when = (v) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? v : undefined);
const itemId = (v) => (/^[a-z0-9][a-z0-9-]{2,63}$/.test(txt(v)) ? txt(v) : undefined);
const drop = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
const isBox = (v) => v !== null && typeof v === "object";
// 该是一个值(文字、数字、true / false)的字段送来了对象或数组:回字段名,这一条整条不收(同一包里别的照收)
const oddField = (o, keys, pre = "") => { const k = keys.find((f) => isBox(o[f])); return k ? pre + k : null; };
const ODD = " 格式不对(不能是对象或数组)";

// 待发有两种:回别人的帖子(要目标帖子),或者自己发一条新帖(kind: "post",没有目标帖子,topic 是一句话的题目,quote 可选:引用的官方原帖)
export function cleanOut(x) {
  const id = itemId(x?.id);
  if (!id) return { error: "id 不合格" };
  // 卡片编号和帖子编号的按要求删标记是同一种算法(goneKey):全是数字的卡片编号会和帖子编号撞在一起(删这张卡片会挡住同号的帖子),不收。
  // 这一版上线时核过正式库:47 张卡片没有全是数字的(11-06 导出),旧数据不用另外处理
  if (/^\d+$/.test(id)) return { id, error: "id 不能全是数字(会和帖子编号混在一起),写成 r-xxx、p-xxx 这种" };
  const odd = oddField(x, ["kind", "quote", "draft", "why", "topic", "replyUrl"])
    || (isBox(x.target) ? oddField(x.target, ["id", "handle", "url", "postedAt", "protocol", "chain", "type", "summary"], "target.") : null);
  if (odd) return { id, error: odd + ODD };
  const post = x.kind === "post";
  if (!post && x.kind !== undefined) return { id, error: "kind 只能不写(回帖)或写 post(自己发的帖子)" };
  let target;
  const notes = []; // 卡片照收、只是某一项没存的,回执里各写一句
  if (!post) {
    const t = x.target || {};
    // 协议、链到期也留着:按 names.js 的 softName 统一写法(「Blast L2 → 以太坊」存成「Blast L2 - 以太坊」),
    // 能认出人、帖子、钱包的这一项不存,卡片照收
    const protocol = softName(t.protocol, 60), chain = softName(t.chain, 40);
    for (const [f, v] of [["protocol", protocol], ["chain", chain]]) if (v === null) notes.push(`target.${f} 没存(${RISK_RULE}),这张卡片照收`);
    target = drop({ id: tweetId(t.id), handle: handle(t.handle), url: xUrl(t.url), postedAt: when(t.postedAt), protocol: protocol || undefined, chain: chain || undefined, type: str(t.type, 40), summary: str(t.summary, 200) });
    if (!target.id || !target.url || !target.url.endsWith("/status/" + target.id)) return { id, error: "目标帖子的编号或链接不合格(两者要对得上)" };
  }
  // 项目帖可以引用一条官方在 X 上的原帖(quote):发出去下面带着原帖的卡片;链接不写进草稿,草稿照样只许 defiexit.com
  const quote = x.quote == null ? undefined : xUrl(x.quote);
  if (x.quote != null && (!post || !quote)) return { id, error: post ? "引用的原帖链接不合格(要 https://x.com/账号/status/编号)" : "回帖不能带引用" };
  const bad = checkText(x.draft, MAX.draft, outHosts(x));
  if (bad) return { id, error: "草稿" + bad };
  const mine = post ? drop({ kind: "post", topic: str(x.topic, 40), quote, why: str(x.why), draft: x.draft.trim() }) : drop({ target, why: str(x.why), draft: x.draft.trim() });
  return { id, mine, replyUrl: xUrl(x.replyUrl), notes };
}

// hosts:续答许带的网址(本站 + 运营规则里的官方网址)
export function cleanIn(x, hosts = ALLOWED_HOSTS) {
  const id = tweetId(x?.id);
  if (!id) return { error: "id 要是评论的帖子编号" };
  const odd = oddField(x, ["source", "url", "author", "at", "type", "need", "suggestion", "suggestionWhy", "draft", "replyToId", "yourReply", "text", "replied", "repliedAt"]);
  if (odd) return { id, error: odd + ODD };
  if (x.draft != null) {
    const bad = checkText(x.draft, MAX.draft, hosts);
    if (bad) return { id, error: "草稿" + bad };
  }
  const mine = drop({
    source: str(x.source, 40), url: xUrl(x.url), author: handle(x.author), at: when(x.at), type: str(x.type, 60), need: str(x.need),
    suggestion: ["采纳", "以后再说", "不采纳"].includes(x.suggestion) ? x.suggestion : undefined,
    suggestionWhy: str(x.suggestionWhy), draft: typeof x.draft === "string" ? x.draft.trim() : undefined, replyToId: tweetId(x.replyToId), yourReply: str(x.yourReply, MAX.draft),
  });
  return { id, mine, text: str(x.text, 2000), replied: x.replied === true, repliedAt: when(x.repliedAt) };
}

// 问题记录:X 上说自己钱卡住的一条帖子(source:机器人找到的 bot、官方公告底下的评论 announcement、我们帖子底下的评论 comment)。
// 编号要写成字符串(帖子编号比 JSON 数字能准确表示的大,写成数字会悄悄变成别的编号);种类、来源只认那几个;
// day 是帖子发的那天(北京时间),不能晚于今天;链接要和编号对得上,账号不带 @;协议、链太长截掉。chain、url、handle 可以不写。
// 每个字段先看类型再用(不拿别的东西当文字转),格式不对的只拒这一条,不连累同一包里别的
const ymd = (v) => { const t = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? Date.parse(v + "T00:00:00Z") : NaN; return Number.isFinite(t) && iso(t).slice(0, 10) === v ? v : undefined; };
// 协议、链只收名字(names.js 的 plainName,规则见 NAME_RULE):这两样到期也不删,能认出人、帖子、钱包的整条不收
export function cleanProblem(x, now) {
  const id = typeof x?.id === "string" ? tweetId(x.id) : undefined;
  if (!id) return { error: "id 要是帖子编号(写成字符串)" };
  if (!PROBLEM_TYPES.includes(x.type)) return { id, error: "type 只能是 " + PROBLEM_TYPES.join("、") };
  if (!PROBLEM_SOURCES.includes(x.source)) return { id, error: "source 只能是 " + PROBLEM_SOURCES.join("、") };
  const protocol = plainName(x.protocol, 60), chain = plainName(x.chain, 40);
  if (protocol === undefined) return { id, error: "缺 protocol(协议名,文字)" };
  if (protocol === null) return { id, error: "protocol " + NAME_RULE };
  if (x.chain != null && typeof x.chain !== "string") return { id, error: "chain 要是文字" };
  if (chain === null) return { id, error: "chain " + NAME_RULE };
  const day = ymd(x.day);
  if (!day || day > bjDay(+now + SKEW_MS)) return { id, error: "day 要是帖子发的那天(北京时间,写成 2026-11-05),不能晚于今天" };
  if (x.replied != null && typeof x.replied !== "boolean") return { id, error: "replied 只能是 true 或 false" };
  const url = typeof x.url === "string" ? xUrl(x.url) : undefined;
  if (x.url != null && (!url || !url.endsWith("/status/" + id))) return { id, error: "链接不合格(要 https://x.com/账号/status/编号,编号和 id 一样)" };
  const who = typeof x.handle === "string" ? handle(x.handle) : undefined;
  if (x.handle != null && !who) return { id, error: "handle 不合格(X 账号名,不带 @)" };
  return { id, protocol, chain, type: x.type, source: x.source, day, replied: x.replied === true, url, handle: who };
}

// 看板 JSON:逐项查形状(页面渲染时还会再兜一层);数字不许是负数或特别大
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const okStr = (v, n = 300) => v === undefined || (typeof v === "string" && v.length <= n);
const okNum = (v, nullable) => (nullable && v === null) || v === undefined || (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1e9);
const okArr = (v, n, each) => Array.isArray(v) && v.length <= n && v.every((x) => isObj(x) && each(x));
const HOST = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const okHost = (h) => typeof h === "string" && HOST.test(h) && !h.split(".").some((l) => l.startsWith("xn--"));
const SHAPES = {
  summary: (v) => okStr(v.updatedAt, 40) && (v.asks === undefined || okArr(v.asks, 12, (a) => typeof a.text === "string" && a.text.length <= 200 && okStr(a.when, 10) && (a.href === undefined || /^#[a-z]+$/.test(a.href)))),
  x_posts: (v) => okArr(v.posts, 10, (p) => /^\d{1,25}$/.test(String(p.id)) && okStr(p.name, 40) && okStr(p.url, 120) && (p.points === undefined || okArr(p.points, 300, (r) => typeof r.at === "string" && ["views", "likes", "replies", "reposts", "bookmarks"].every((f) => okNum(r[f], true)))))
    && (v.square === undefined || okArr(v.square, 10, (r) => okStr(r.name, 60) && okNum(r.views, true) && okNum(r.comments, true))) && okStr(v.squareNote, 300) && okStr(v.source, 200),
  goal_1215: (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v.deadline)) && okArr(v.items, 8, (it) => typeof it.label === "string" && okNum(it.value, true) && okNum(it.goal) && okStr(it.unit, 10) && okStr(it.note, 300)) && okStr(v.source, 200),
  funnel: (v) => okNum(v.target) && okArr(v.stages, 8, (s) => typeof s.key === "string" && typeof s.label === "string" && okNum(s.value)) && okStr(v.note, 300),
  protocols: (v) => okArr(v.rows, 50, (r) => typeof r.protocol === "string" && okStr(r.chain, 40) && okNum(r.posts) && okNum(r.people)) && okStr(v.note, 300),
  clocks: (v) => okArr(v.rows, 20, (r) => typeof r.name === "string" && okStr(r.short, 20) && okStr(r.due, 10) && okStr(r.status, 20) && okStr(r.reading, 1000)) && okStr(v.source, 200),
  bot: (v) => (v.rows === undefined || okArr(v.rows, 50, (r) => okNum(r.n) && typeof r.title === "string" && okStr(r.state, 20) && okNum(r.comments))) && okStr(v.note, 300) && okStr(v.source, 200) && okStr(v.error, 300),
  // 运营规则:dailyReplyCap 每天(北京时间)最多放出几条对人的首回,整数 1–50,没写按 15(运营台页面按它数今天放几条);
  // officialHosts 收件续答能带的官方网址,只写主机名(小写、不带 https:// 和路径,不收 xn-- 编码的),一模一样才放行,子域名要另写一条
  rules: (v) => (v.dailyReplyCap === undefined || (Number.isInteger(v.dailyReplyCap) && v.dailyReplyCap >= 1 && v.dailyReplyCap <= 50))
    && (v.officialHosts === undefined || (Array.isArray(v.officialHosts) && v.officialHosts.length <= 200 && v.officialHosts.every(okHost))) && okStr(v.note, 300) && okStr(v.updatedAt, 40),
};
function cleanDoc(k, v) {
  if (!DOC_KEYS.includes(k) || !isObj(v)) return "不认识的看板项";
  if (JSON.stringify(v).length > MAX.doc) return "太大";
  // 形状检查里有把值当文字转的地方:该是文字的地方送来 {"toString": null} 这种,一转就报错,只算这一项格式不对
  try { return SHAPES[k](v) ? null : "格式不对"; } catch { return "格式不对"; }
}

// ---------- 宣传卡片 ----------
// 我写好、管理员自己发出去的四种稿子(channel):媒体投稿 media、给项目团队的邮件 project、安全资源清单的提交 list
// (GitHub 上的 awesome 清单、安全手册:提 PR 或 issue)、技术社区的帖子 community(Hacker News、Reddit)
export const REACH_CHANNELS = ["media", "project", "list", "community"];
// pack:一包里宣传稿的邮件标题、标题、正文加起来最多几个字。每个字都要过一遍链接、敏感词检查,免费计划一次请求的 CPU 时间很少
// (实测 2 万字的正文查一遍约 1 毫秒),一包十几篇长稿可能超时、整包写不进去;超了的从那一张起不收,回执里写明,下一包再送
export const REACH_MAX = { target: 100, title: 200, body: 20000, why: 500, url: 500, pack: 100000 };
// 网址(投稿页、仓库、发帖页;管理员记下的回音链接也用它):只收 https、普通的英文主机名(不收 IP、xn-- 编码的、带账号密码的、另写端口的),
// 存 URL 的标准写法(打开的就是查过的那个),最长 500 字。不合格回 null
export function webUrl(v) {
  if (typeof v !== "string" || !v.trim() || v.length > REACH_MAX.url) return null;
  let u;
  try { u = new URL(v.trim()); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port || !okHost(u.hostname)) return null;
  return u.href.length <= REACH_MAX.url ? u.href : null;
}
// 收件邮箱:只收一个普通地址(不带名字、尖括号、引号、逗号、问号、百分号:写邮件的链接里多不出别的收件人、别的栏),
// 域名照网址的规矩(不收 IP、xn-- 编码的),统一成小写。不合格回 null
const MAIL_LOCAL = /^[A-Za-z0-9](?:[A-Za-z0-9._+-]{0,62}[A-Za-z0-9_+-])?$/;
export function mailAddr(v) {
  if (typeof v !== "string") return null;
  const s = v.trim(), at = s.indexOf("@");
  if (s.length > 254 || at < 1 || s.lastIndexOf("@") !== at) return null;
  const local = s.slice(0, at), domain = s.slice(at + 1).toLowerCase();
  return MAIL_LOCAL.test(local) && !local.includes("..") && okHost(domain) ? local + "@" + domain : null;
}
// 宣传稿的敏感词另用一份。BANNED 是给对陌生人的短回复定的;长文里「我们从不要你的私钥、助记词」「撤销授权」「seed phrase」「private key」
// 「recovery phrase」这些安全说明照常要写,所以宣传稿只拦自己招揽、骗局常用的说法:叫人私下来找、拉人进群、找客服、返佣、领空投。
// 中文按字面找;英文按整个词找(不分大小写,词中间几个空白都算):Disclaimer、reclaim 不算 claim,ADMIN me 不算 dm me
export const REACH_WORDS = {
  zh: ["私信我", "私聊我", "加我微信", "加我好友", "加群", "进群", "入群", "联系客服", "返佣", "领取空投", "空投领取", "转账给我"],
  en: ["dm me", "pm me", "message me", "inbox me", "whatsapp me", "telegram me", "join our telegram", "join our whatsapp", "join our discord", "contact our support",
    "rebate", "rebates", "airdrop claim", "claim airdrop", "claim your airdrop", "claim the airdrop"],
};
const REACH_EN = REACH_WORDS.en.map((w) => [w, new RegExp("(?<![\\p{L}\\p{N}])" + w.split(" ").join("\\s+") + "(?![\\p{L}\\p{N}])", "iu")]);
export function reachWord(t) {
  const s = t.normalize("NFKC");
  return REACH_WORDS.zh.find((w) => s.includes(w)) || (REACH_EN.find(([, re]) => re.test(s)) || [])[0] || null;
}
// 诊所的第 8 条硬规矩:对外的标题避开「找回 / 领取 / recover / claim」。宣传稿的标题、邮件标题在上面那份之外再照这条查(正文不查):
// 中文按字面找;英文看词头(前面不挨着字母、数字):recover、recovered、recovering、recovery,claim、claims、claimed、claiming 都算,
// Disclaimer、reclaim 不算
export const TITLE_WORDS = { zh: ["找回", "领取"], en: ["recover", "claim"] };
const TITLE_EN = TITLE_WORDS.en.map((w) => [w, new RegExp("(?<![\\p{L}\\p{N}])" + w, "iu")]);
export function titleWord(t) {
  const hit = reachWord(t);
  if (hit) return hit;
  const s = t.normalize("NFKC");
  return TITLE_WORDS.zh.find((w) => s.includes(w)) || (TITLE_EN.find(([, re]) => re.test(s)) || [])[0] || null;
}
const TITLE_WHY = "(标题、邮件标题避开找回、领取、recover、claim,正文可以写)";
// 宣传稿另外放行的链接:我们自己的开源仓库(https://github.com/DPNDolphin/defiexit 和它下面的页面);别的 GitHub 链接照样不收,
// github.com 也不进运营规则的官方网址(收件续答不放行)
export const REACH_PATHS = [{ host: "github.com", prefix: "/DPNDolphin/defiexit" }];
const REACH_OFF = "(宣传稿只许带 defiexit.com、运营规则 officialHosts 里列的官方网址,和我们自己的仓库 https://github.com/DPNDolphin/defiexit)";
const LANG = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/;
const REACH_TEXT = ["channel", "target", "lang", "url", "to", "subject", "title", "body", "why"];
const blank = (v) => v == null || (typeof v === "string" && !v.trim());
// 一张宣传卡片:id(o-panews-1106 这种,不能全是数字)、channel、target(写给谁:「PANews 投稿」「Sophon 团队」)、lang(zh、en……)、
// url(写邮件的可以不写,别的必须有)、to(写邮件才有)、subject(邮件标题)、title(标题)、body(正文,可以是 markdown,最长 2 万字)、why(我给管理员的说明)。
// 标题、邮件标题、正文的链接和收件续答一样查(hosts:本站 + 运营规则里的官方网址,另加我们自己的仓库 REACH_PATHS),长得像的写法绕不过去;
// 敏感词用宣传稿那一份(REACH_WORDS),标题、邮件标题再加诊所第 8 条(TITLE_WORDS)。写了的字段都得是文字(数字、true / false、对象、数组都不收),太长的不截、整条不收;不合格的只拒这一条
export function cleanReach(x, hosts = ALLOWED_HOSTS) {
  const id = itemId(x?.id);
  if (!id) return { error: "id 不合格" };
  if (/^\d+$/.test(id)) return { id, error: "id 不能全是数字(会和帖子编号混在一起),写成 o-panews-1106 这种" };
  const odd = oddField(x, REACH_TEXT);
  if (odd) return { id, error: odd + ODD };
  const notText = REACH_TEXT.find((f) => x[f] != null && typeof x[f] !== "string");
  if (notText) return { id, error: notText + " 要是文字" };
  if (!REACH_CHANNELS.includes(x.channel)) return { id, error: "channel 只能是 " + REACH_CHANNELS.join("、") };
  const target = (x.target || "").trim();
  if (!target) return { id, error: "缺 target(写给谁,比如「PANews 投稿」「Sophon 团队」)" };
  if (target.length > REACH_MAX.target) return { id, error: `target 超过 ${REACH_MAX.target} 字` };
  if (!LANG.test(x.lang || "")) return { id, error: "lang 要写语言代码(zh、en、ja 这种)" };
  const to = blank(x.to) ? undefined : mailAddr(x.to);
  if (to === null) return { id, error: "to 不合格(写一个普通的邮箱地址,比如 team@example.org;不带名字、尖括号、逗号、问号)" };
  const url = blank(x.url) ? undefined : webUrl(x.url);
  if (url === null) return { id, error: "url 不合格(要 https:// 开头的网址,不带账号密码、IP 地址、端口,最长 500 字)" };
  if (!url && !to) return { id, error: "缺 url(投稿页、仓库或发帖页的网址;只有写邮件的(带 to)可以不写)" };
  if (blank(x.body)) return { id, error: "缺 body(正文)" };
  const text = {};
  for (const [f, name, max, words] of [["subject", "邮件标题", REACH_MAX.title, titleWord], ["title", "标题", REACH_MAX.title, titleWord], ["body", "正文", REACH_MAX.body, reachWord]]) {
    if (blank(x[f])) continue;
    const bad = checkText(x[f], max, hosts, { words, paths: REACH_PATHS });
    const rule8 = words === titleWord && [...TITLE_WORDS.zh, ...TITLE_WORDS.en].some((w) => bad === `含不许用的词「${w}」`);
    if (bad) return { id, error: name + bad + (bad.startsWith("含站外链接") ? REACH_OFF : rule8 ? TITLE_WHY : "") };
    text[f] = x[f].trim();
  }
  const why = blank(x.why) ? undefined : x.why.trim();
  if (why && why.length > REACH_MAX.why) return { id, error: `why 超过 ${REACH_MAX.why} 字` };
  return { id, mine: drop({ channel: x.channel, target, lang: x.lang, url, to, subject: text.subject, title: text.title, body: text.body, why }) };
}

// x_posts 有两个写的人:管理员点「刷新」时服务器追加读数,Claude 投递时带来本地记的读数。按帖子、按时间合并,谁的都不丢
export function mergeReadings(old, incoming) {
  const before = new Map(((old && old.posts) || []).map((p) => [String(p.id), p.points || []]));
  const posts = (incoming.posts || []).map((p) => {
    const byAt = new Map();
    for (const pt of [...(before.get(String(p.id)) || []), ...(p.points || [])]) if (pt && typeof pt.at === "string") byAt.set(pt.at, pt);
    return { ...p, points: [...byAt.values()].sort((a, b) => a.at.localeCompare(b.at)).slice(-300) };
  });
  return { ...incoming, posts };
}

// 验签、查时间和 nonce、校验、写入(nonce、ts 记录和数据同一批写,要么都成要么都不成)。
// 返回 { status, body }:200 收下(可能有部分条目被拒),4xx 整包不收
export async function ingest(db, { raw, sig, envName, method, path, pubkeys }, now) {
  if (raw.length > MAX.body) return { status: 413, body: { error: "big" } };
  if (!(await verify(signedText(envName, method, path, raw), sig, pubkeys))) return { status: 401, body: { error: "sig" } };
  let body;
  try { body = JSON.parse(raw); } catch { return { status: 400, body: { error: "bad" } }; }
  if (!body || typeof body !== "object" || body.v !== 1) return { status: 400, body: { error: "bad" } };
  if (typeof body.ts !== "number" || Math.abs(+now - body.ts) > SKEW_MS) return { status: 401, body: { error: "stale" } };
  if (isBox(body.nonce) || !/^[A-Za-z0-9_-]{16,64}$/.test(String(body.nonce || ""))) return { status: 400, body: { error: "nonce" } };
  // 一次只处理一包(两包同时到,后到的回 busy):「比上一包新」的检查和写入之间不会被别的包插进来。锁 60 秒没放就算失效
  const lock = await db.prepare("INSERT INTO kv (k, v) VALUES ('ingest_lock', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v WHERE CAST(kv.v AS INTEGER) < ?").bind(String(+now), +now - 60000).run();
  if (!lock.meta || lock.meta.changes !== 1) return { status: 409, body: { error: "busy" } };
  try {
    return await locked(db, raw, body, now);
  } finally {
    await db.prepare("DELETE FROM kv WHERE k = 'ingest_lock' AND v = ?").bind(String(+now)).run();
  }
}

async function locked(db, raw, body, now) {
  const lastTs = Number((await getKv(db, "ingest_ts")) || 0);
  if (body.ts <= lastTs) return { status: 409, body: { error: "old" } };
  if (await db.prepare("SELECT 1 FROM nonces WHERE n = ?").bind(body.nonce).first()) return { status: 409, body: { error: "replay" } };
  const day = iso(now).slice(0, 10);
  const used = Number((await getKv(db, "ingest_day:" + day)) || 0);
  if (used >= MAX.perDay) return { status: 429, body: { error: "day" } };

  const t = iso(now);
  const rejected = [];
  const stmts = [
    db.prepare("INSERT INTO nonces (n, at) VALUES (?, ?)").bind(body.nonce, t),
    db.prepare("INSERT INTO kv (k, v) VALUES ('ingest_ts', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(body.ts)),
    db.prepare("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind("ingest_day:" + day, String(used + 1)),
  ];
  let docs = 0, setup = false;
  // 一次性设置链接:我在本机生成一串随机码,只把它的 SHA-256 送进来;还没有管理员时才收,最多 48 小时有效
  if (body.setup !== undefined) {
    const s = body.setup;
    const hasAdmin = await db.prepare("SELECT 1 FROM admin WHERE id = 1").first();
    if (hasAdmin) rejected.push({ kind: "setup", id: "setup", why: "已经有管理员了" });
    else if (!s || isBox(s.hash) || isBox(s.hours) || !/^[0-9a-f]{64}$/.test(String(s.hash)) || !(s.hours > 0 && s.hours <= 48)) rejected.push({ kind: "setup", id: "setup", why: "格式不对" });
    else {
      stmts.push(db.prepare("INSERT INTO kv (k, v) VALUES ('setup_hash', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(s.hash));
      stmts.push(db.prepare("INSERT INTO kv (k, v) VALUES ('setup_exp', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(+now + s.hours * 3600e3)));
      setup = true;
    }
  }
  const current = body.docs && body.docs.x_posts ? await getDocs(db) : {};
  let rules = null; // 这一包带了合格的运营规则,收件就按这一包的查;没带(或不合格)按库里的
  for (const [k, v0] of Object.entries(body.docs || {})) {
    const bad = cleanDoc(k, v0);
    if (bad) { rejected.push({ kind: "doc", id: k, why: bad }); continue; }
    const v = k === "x_posts" ? mergeReadings(current.x_posts, v0) : v0;
    if (k === "rules") rules = v;
    stmts.push(docStmt(db, k, v, now));
    docs++;
  }

  // 待发、收件、问题记录、宣传卡片一包各最多 MAX.items 条,多的不收,回执里写明(下一包再送)
  const cap = (kind, list) => {
    if (!Array.isArray(list)) return [];
    if (list.length > MAX.items) rejected.push({ kind, id: "?", why: `一包最多 ${MAX.items} 条:第 ${MAX.items + 1} 条起的 ${list.length - MAX.items} 条没收,下一包再送` });
    return list.slice(0, MAX.items);
  };
  const outs = cap("outbox", body.outbox), ins = cap("inbox", body.inbox), probIn = cap("problems", body.problems), reach = cap("outreach", body.outreach);
  const ids = outs.map((x) => itemId(x?.id)).filter(Boolean);
  const have = new Map();
  if (ids.length) {
    const { results } = await db.prepare(`SELECT id, mine, status, purged, draft_admin, reply_url, sent_target FROM outbox WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
    for (const r of results) have.set(r.id, r);
  }
  // 待发、收件、问题记录每写一句记一笔 { at: 在 stmts 里的位置, kind, id, how: 新建 / 改 / 补链接, gone: 挡它的 goneKey, exp: 收件到期的标记, notes }:
  // 按要求删过的、到期删过的不先查,直接写在语句的条件里(查和写同一句);写完看改了几行,0 行的就是被挡住了,回执里写明为什么。
  // 改已有的一行(待发改草稿、补链接,收件补分析):查的是改完以后这一行还带着的帖子,没写的那几样用读到的、在语句里核对没变过(见 db.js 的 sameRefs)
  const writes = [];
  const added = new Set(); // 这一包新建的待发:同一张新卡片送了两遍,第二遍不收(两句新建撞在一起,整包都写不进去)
  for (const x of outs) {
    const c = cleanOut(x);
    if (c.error) { rejected.push({ kind: "outbox", id: c.id || "?", why: c.error }); continue; }
    const old = have.get(c.id);
    if (!old && added.has(c.id)) { rejected.push({ kind: "outbox", id: c.id, why: "同一包里重复了,只收第一条" }); continue; }
    if (!old) {
      // 新建:这张卡片,和它带着的每条帖子(要回的帖子、引用的原帖、这次送来的回复链接),按要求删过的都不收
      const gone = await outKeys(c.id, c.mine, c.replyUrl, null);
      added.add(c.id);
      writes.push({ kind: "outbox", id: c.id, gone, notes: c.notes, at: stmts.length, how: "new" });
      stmts.push(db.prepare(`INSERT INTO outbox (id, mine, reply_url, created_at, updated_at, purge_after) SELECT ?, ?, ?, ?, ?, ? WHERE ${NOT_GONE}`).bind(c.id, JSON.stringify(c.mine), c.replyUrl ?? null, t, t, plusDays(now, KEEP_DAYS), goneArg(gone)));
    } else {
      const oldMine = (() => { try { return JSON.parse(old.mine) || {}; } catch { return {}; } })();
      if ((oldMine.kind || "reply") !== (c.mine.kind || "reply")) { rejected.push({ kind: "outbox", id: c.id, why: "回帖和自己发的帖子不能互换" }); continue; }
      const oldTarget = oldMine.target?.id;
      if (oldTarget && oldTarget !== c.mine.target?.id) { rejected.push({ kind: "outbox", id: c.id, why: "目标帖子不能换" }); continue; }
      if (old.purged || old.status !== "待发") {
        // 管理员点过了(或已到期删过):只许给「已发」且没到期删过的补他那条回复的链接。
        // 改完以后还带着库里的 mine(目标帖子、引用的原帖)和点「已发」记下的目标:语句里核对它们没变,和新链接一起查 gone
        if (c.replyUrl && !old.purged && old.status === "已发") {
          const gone = await outKeys(c.id, oldMine, c.replyUrl, old.sent_target);
          const [same, sameArgs] = sameRefs(oldMine);
          writes.push({ kind: "outbox", id: c.id, gone, notes: [], at: stmts.length, how: "link" });
          stmts.push(db.prepare(`UPDATE outbox SET reply_url = ?, updated_at = ? WHERE id = ? AND status = '已发' AND purged = 0 AND ${same} AND sent_target IS ? AND ${NOT_GONE}`).bind(c.replyUrl, t, c.id, ...sameArgs, old.sent_target ?? null, goneArg(gone)));
        } else rejected.push({ kind: "outbox", id: c.id, why: old.purged ? EXPIRED_OUT_WHY : HANDLED_WHY }); // 到期删过的先说到期(点过「已发」的也一样)
      } else {
        // 引用的原帖建好以后不能换、不能去掉(老板可能已经照着它改了草稿);原来没有的,老板没改过草稿才能补上
        const oldQuote = oldMine.quote || null, newQuote = c.mine.quote || null;
        if (oldQuote !== newQuote && (oldQuote || old.draft_admin != null)) { rejected.push({ kind: "outbox", id: c.id, why: "引用的原帖建好以后不能换" }); continue; }
        // 条件写在语句里:读和写之间管理员点了「已发 / 跳过」(补引用时还有:改了草稿),这条就不改。
        // 这次没送回复链接的,留着库里那条(和点「已发」记下的目标一样,语句里核对没变),一起查 gone
        const gone = await outKeys(c.id, c.mine, c.replyUrl || old.reply_url, old.sent_target);
        writes.push({ kind: "outbox", id: c.id, gone, notes: c.notes, at: stmts.length, how: "edit" });
        stmts.push(db.prepare("UPDATE outbox SET mine = ?, " + (c.replyUrl ? "reply_url = ?, " : "") + "updated_at = ? WHERE id = ? AND status = '待发' AND purged = 0" + (oldQuote !== newQuote ? " AND draft_admin IS NULL" : "") +
          " AND sent_target IS ?" + (c.replyUrl ? "" : " AND reply_url IS ?") + ` AND ${NOT_GONE}`)
          .bind(JSON.stringify(c.mine), ...(c.replyUrl ? [c.replyUrl] : []), t, c.id, old.sent_target ?? null, ...(c.replyUrl ? [] : [old.reply_url ?? null]), goneArg(gone)));
      }
    }
  }

  // 收件续答、宣传卡片许带的网址一样:本站加运营规则里的官方网址
  if (!rules && (ins.some((x) => x && x.draft != null) || reach.length)) rules = await getDoc(db, "rules");
  const hosts = inHosts(rules);
  // 收件里已经有的:改完以后还带着库里的链接、要回的那条(这次没送的就留着),先读出来
  const inIds = ins.map((x) => tweetId(x?.id)).filter(Boolean);
  const inHave = new Map(inIds.length ? (await db.prepare("SELECT id, mine FROM inbox WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(inIds)).all()).results.map((r) => [r.id, r]) : []);
  for (const x of ins) {
    const c = cleanIn(x, hosts);
    if (c.error) { rejected.push({ kind: "inbox", id: c.id || "?", why: c.error }); continue; }
    // 原文只在新建时写;到期删过的不再补回;回复保留期从第一次入库算,更新不重置;replied 只会从 0 变 1。
    // 这条评论和它改完以后带着的帖子(链接里的、要回的那条:这次送的,没送的用库里的)按要求删过的、这条评论 30 天到期删过的(expKey),都不写;
    // 库里那两样在语句里核对没变过
    const om = (() => { try { return inHave.has(c.id) ? JSON.parse(inHave.get(c.id).mine) || {} : null; } catch { return {}; } })();
    const after = { url: c.mine.url ?? om?.url, replyToId: c.mine.replyToId ?? om?.replyToId };
    const k = await goneKey(c.id);
    const gone = await inKeys(c.id, after);
    const [same, sameArgs] = om ? sameInRefs(om, "inbox.mine") : ["1", []];
    writes.push({ kind: "inbox", id: c.id, gone, exp: expKey(k), at: stmts.length, how: "put" });
    stmts.push(db.prepare(
      `INSERT INTO inbox (id, mine, text, replied, replied_at, created_at, updated_at, purge_after) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${NOT_GONE} ` +
      "ON CONFLICT(id) DO UPDATE SET mine = CASE WHEN inbox.purged = 1 THEN inbox.mine ELSE json_patch(inbox.mine, excluded.mine) END, " +
      `replied = MAX(inbox.replied, excluded.replied), replied_at = COALESCE(inbox.replied_at, excluded.replied_at), updated_at = excluded.updated_at WHERE ${same}`,
    ).bind(c.id, JSON.stringify(c.mine), c.text ?? null, c.replied ? 1 : 0, c.repliedAt ?? null, t, t, plusDays(now, KEEP_DAYS), goneArg([...gone, expKey(k)]), ...sameArgs));
  }

  // 问题记录:每条一句,和别的同一批写(库里的编号是哈希,见 db.js 的 problemKey):
  // 按要求删过的(gone 里有那条帖子的 goneKey)不写;收件评论到期删过的照样能改;到期删过的问题记录只改分类和回没回,链接、账号不再写回;
  // 保留期从第一次入库算,更新不重置;chain、url、handle 这次没写就留原来的
  for (const x of probIn) {
    const c = cleanProblem(x, now);
    if (c.error) { rejected.push({ kind: "problems", id: c.id || "?", why: c.error }); continue; }
    const key = await problemKey(c.id), gk = await goneKey(c.id);
    writes.push({ kind: "problems", id: c.id, gone: [gk], at: stmts.length, how: "put" });
    stmts.push(db.prepare(
      `INSERT INTO problems (id, protocol, chain, type, source, day, replied, url, handle, created_at, updated_at, purge_after) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${NOT_GONE} ` +
      "ON CONFLICT(id) DO UPDATE SET protocol = excluded.protocol, chain = COALESCE(excluded.chain, problems.chain), type = excluded.type, source = excluded.source, day = excluded.day, replied = MAX(problems.replied, excluded.replied), " +
      "url = CASE WHEN problems.purged = 1 THEN NULL ELSE COALESCE(excluded.url, problems.url) END, handle = CASE WHEN problems.purged = 1 THEN NULL ELSE COALESCE(excluded.handle, problems.handle) END, updated_at = excluded.updated_at",
    ).bind(key, c.protocol, c.chain ?? null, c.type, c.source, c.day, c.replied ? 1 : 0, c.url ?? null, c.handle ?? null, t, t, plusDays(now, KEEP_DAYS), goneArg([gk])));
  }

  // 宣传卡片:没有的新建;有的、管理员还没点过的,整份换成这次送来的;点过「已发 / 跳过」的不改。
  // 条件写在语句里:读和写之间管理员点了,就不改;这张卡片、改完以后的收件邮箱按要求删过的(reachKeys),都不写
  const reachIds = reach.map((x) => itemId(x?.id)).filter(Boolean);
  const reachHave = new Map(reachIds.length ? (await db.prepare("SELECT id, status FROM outreach WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(reachIds)).all()).results.map((r) => [r.id, r]) : []);
  const reachSeen = new Set(); // 同一包里同一张卡片送了两遍:只收第一遍
  let packChars = 0; // 这一包到这一张为止,宣传稿的字数(见 REACH_MAX.pack)
  for (const x of reach) {
    packChars += ["subject", "title", "body"].reduce((n, f) => n + (typeof x?.[f] === "string" ? x[f].length : 0), 0);
    if (packChars > REACH_MAX.pack) { rejected.push({ kind: "outreach", id: itemId(x?.id) || "?", why: `这一包的宣传稿加起来超过 ${REACH_MAX.pack} 字:从这一张起没收,下一包再送` }); continue; }
    const c = cleanReach(x, hosts);
    if (c.error) { rejected.push({ kind: "outreach", id: c.id || "?", why: c.error }); continue; }
    if (reachSeen.has(c.id)) { rejected.push({ kind: "outreach", id: c.id, why: "同一包里重复了,只收第一条" }); continue; }
    reachSeen.add(c.id);
    const old = reachHave.get(c.id);
    if (old && old.status !== "待发") { rejected.push({ kind: "outreach", id: c.id, why: HANDLED_WHY }); continue; }
    const gone = await reachKeys(c.id, c.mine);
    writes.push({ kind: "outreach", id: c.id, gone, card: await reachCardKey(c.id), toKey: c.mine.to ? await reachToKey(c.mine.to) : null, at: stmts.length, how: old ? "edit" : "new" });
    stmts.push(old
      ? db.prepare(`UPDATE outreach SET mine = ?, updated_at = ? WHERE id = ? AND status = '待发' AND ${NOT_GONE}`).bind(JSON.stringify(c.mine), t, c.id, goneArg(gone))
      : db.prepare(`INSERT INTO outreach (id, mine, created_at, updated_at) SELECT ?, ?, ?, ? WHERE ${NOT_GONE} ON CONFLICT(id) DO NOTHING`).bind(c.id, JSON.stringify(c.mine), t, t, goneArg(gone)));
  }

  let res;
  try {
    res = await db.batch(stmts);
  } catch (e) {
    // 同一个 nonce 同时投两次:后到的那批整个回滚
    if (/UNIQUE|constraint/i.test(String(e && e.message))) return { status: 409, body: { error: "replay" } };
    throw e;
  }
  // 改了几行:0 行的是写的时候被挡住了。查一次 gone 看是哪种:按要求删过的(宣传卡片分卡片本身、收件邮箱)、收件到期删过的;
  // 都不是的(只有待发的「改」「补链接」、宣传卡片的「改」会这样),再看一眼那几行现在的样子:读和写之间到期删了(就说到期删过,补链接的也一样),
  // 还是管理员点了「已发 / 跳过」、改了草稿(宣传卡片按要求删的先记卡片编号,所以没了的一定在 gone 里;剩下的就是管理员刚点过)。
  // 写上了、只是某一项没存的(协议、链),也写进回执
  const changed = (w) => Number((res && res[w.at] && res[w.at].meta && res[w.at].meta.changes) || 0) > 0;
  const missed = writes.filter((w) => !changed(w));
  const hit = missed.length ? await existing(db, "gone", missed.flatMap((w) => (w.exp ? [...w.gone, w.exp] : w.gone))) : new Set();
  const late = missed.filter((w) => w.kind === "outbox" && w.how !== "new" && !w.gone.some((k) => hit.has(k))).map((w) => w.id);
  const rowNow = new Map(late.length ? (await db.prepare("SELECT id, status, purged FROM outbox WHERE id IN (SELECT value FROM json_each(?))").bind(JSON.stringify(late)).all()).results.map((r) => [r.id, r]) : []);
  const count = { outbox: 0, inbox: 0, problems: 0, outreach: 0 };
  for (const w of writes) {
    if (changed(w)) {
      count[w.kind]++;
      for (const n of w.notes || []) rejected.push({ kind: w.kind, id: w.id, why: n });
      continue;
    }
    const r = w.kind === "outbox" ? rowNow.get(w.id) : null;
    const why = w.toKey && hit.has(w.toKey) && !hit.has(w.card) ? REACH_TO_WHY
      : w.gone.some((k) => hit.has(k)) ? GONE_WHY
      : w.exp && hit.has(w.exp) ? "30 天到期删过,不再收"
      : w.kind === "outbox" && w.how !== "new" ? (!r ? GONE_WHY : r.purged ? EXPIRED_OUT_WHY : "管理员刚处理过这条(点了「已发 / 跳过」或改了草稿),这次没改")
      : w.kind === "outreach" && w.how === "edit" ? "管理员刚处理过这条(点了「已发 / 跳过」),这次没改"
      : "这次没写进去,下一包再送";
    rejected.push({ kind: w.kind, id: w.id, why });
  }
  return { status: 200, body: { ok: true, receipt: (await sha256(raw)).slice(0, 16), docs, outbox: count.outbox, inbox: count.inbox, problems: count.problems, outreach: count.outreach, setup, rejected } };
}
