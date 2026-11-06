// 截止提醒(体检结果页最上面):有的链要关停、有的项目要关掉某条取回的路(比如 Sophon 链停止提现、Abstract 链关停、
// opBNB 上的 CAKE 要在截止前跨回去),体检查到的东西正好在上面,就一个事件一张卡说清楚:哪天前要做什么(转出来、换新币、赎回、拿往期奖励)、还剩多少时间、该怎么办,
// 链到官方页面和本站的截止日历(/deadlines/#编号)。
// 数据是 data/deadlines.json(截止日历页用的同一份),构建时按页面语言嵌进体检结果页(#due),不另外发请求;
// 拿来对的都是页面上已经查到的东西,地址不出浏览器,也不多问任何接口。
// 怎么对(大小写、空格、横线都不算;data 里的键写小写短名,比如 sophon、opbnb、pancakeswap、cake):
//   链:Zerion 的链编号(relationships.chain.data.id,经 /api/assets 传来的 cid,比如 abstract、binance-smart-chain)、
//       链的显示名(Abstract、BNB Chain)、本站的链名(lib/chains.js 的 chainKey,比如 bnb、xlayer),任一个对上 chainKeys 就算;
//       chainKey 把 BNB Chain 叫 bnb(图标的文件名),截止日历写的是 bsc:对的时候两个都认;
//       我们自己查的配方仓位用配方的 chain(hyperliquid、arbitrum、xlayer)。
//   项目:Zerion 给的项目名(application_metadata.name,没有就用 protocol;就是 /api/assets 传来的 app,比如 PancakeSwap V3),
//       我们自己查的用配方的协议名和编号(WOOFi、woofi)。和键一样、或者以「键-」开头就算:pancakeswap 对得上 PancakeSwap V3,对不上 PancakeSwapX。
//       Zerion 自己的项目编号(relationships.dapp)本站接口没传,不用它。
//   币:只按「链 + 合约地址」对,不按符号——空投来的仿冒币常和真币同名(BNB Chain 上随便一个叫 DUSD 的币不是 StandX 的 DUSD)。
//       data 的 tokenContracts 写的是从项目官方页面抄来、核对过的合约 { chain, token, address, source }:币在这条链上(链的认法同上)、
//       合约地址(/api/assets 传来的 addr,小写)一样才算。钱包里每条链列出来的是最值钱的 8 种,排在后面的接口只传符号和地址(rest),照样拿来对;
//       原生币没有合约地址,对不上;没核对到地址的链和币(Stellar、Solana 这类非 EVM 链上的)不提醒。
// 哪些算「有关」,每个事件自己写明(matchBy),不靠猜——宁可不提醒,也不提醒错:
//   chain:chainKeys 那几条链上的东西都算(钱包里的、项目里的),比如整条链关停;
//   protocol:protocolKeys 里那些项目的仓位,写了 chainKeys 就只算那几条链上的。只关一个版本的,键写成带版本的
//     (stargate-v1 对得上 Stargate V1,对不上 Stargate、Stargate V2:Zerion 没写版本的就不提醒);
//   token:钱包里、仓位里合约对上 tokenContracts 的币(PancakeSwap 的 USDT/WBNB 池子不算 CAKE,同名的假 CAKE 也不算);
//     仓位里借来的(Zerion 的 loan)不算拿着这个币(在 Aave 借了 STG 不等于要拿 STG 去换 ZRO),事件写了 matchLoans 的才算(比如铸了 VAI 要还);
//     卡片标题说出对上的是哪个币(「你在 opBNB 上有 CAKE」),不说「还有资产」,免得像是这条链上的东西都得搬走;
//   null:对不准(新旧币同名、只有一部分市场受影响、一个合约地址都核对不了…),体检不提醒,截止日历页上照样列着。
// 只提醒还没过的和还没定日子的(deadline 是 null);过了的不提。截止那一刻按 lib/deadline.js 算:写了 deadlineAt 按那个时间,只写了日子的按那一天(UTC)结束。
// 卡上的倒数也按它写,只往少里说:只写了日子的算到那一天 00:00(UTC),到了那一天写「按 UTC 算,今天是截止日」;不说没带 UTC 的「今天」「明天」。
// 页面开着不动时,体检结果页每分钟重算一遍(check.js),过了的卡跟着去掉。
import { el, icon } from "./ui.js";
import { chainKey } from "./chains.js";
import { prefix } from "./i18n.js";
import { listSep } from "./langs.js";
import { daysLeft, timeLeft, nextMilestone } from "./deadline.js";

// 还没过的和还没定日子的(now 是现在的时间;0 就是最后一天)
const leftOf = (e, now) => (e.deadline == null ? null : daysLeft(e.deadline, now, e.deadlineAt));
export const upcoming = (events, now = new Date()) => events.filter((e) => e.deadline == null || leftOf(e, now) >= 0);

// 比较用:小写,别的字符换成一条横线(PancakeSwap V3 → pancakeswap-v3);flat 再去掉横线(X Layer、x-layer、xlayer 都是 xlayer)
const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const flat = (s) => slug(s).replace(/-/g, "");
const sameApp = (key, name) => flat(name) === flat(key) || slug(name).startsWith(`${slug(key)}-`);
// 本站的链名和截止日历的写法不一样的:截止日历把 BNB Chain 写成 bsc
const ALIAS = { bnb: "bsc" };

// 币的样子:{ sym, addr, loan }。addr 是小写的合约地址,原生币、认不出来的是 null(10 分钟内的旧缓存里 rest 只有符号,也当没有地址);
// loan:仓位里借来的(Zerion 的仓位类型 loan)
const coin = (x) => (typeof x === "string" ? { sym: x, addr: null, loan: false } : { sym: String(x?.sym ?? ""), addr: /^0x[0-9a-f]{40}$/i.test(x?.addr ?? "") ? x.addr.toLowerCase() : null, loan: x?.type === "loan" });

// 页面上查到的东西 → 统一的样子:{ chains: 这条链的几种叫法, chain: 显示名, app: 项目名(钱包里的是 null), apps: 项目的几种叫法, coins: 币 }
//   found:我们自己查到的配方仓位 [{ r }](r 是 #recipes 里的一条);defi:Zerion 和 X Layer 上查到的项目仓位;wallet:钱包余额,一条链一组
export function holdings({ found = [], defi = [], wallet = [] }) {
  const names = (cid, name) => {
    const k = chainKey(cid, name);
    return [...new Set([cid, name, k, ALIAS[k]].filter(Boolean).map(flat))];
  };
  return [
    ...found.map(({ r }) => ({ chains: names(r.chain), chain: r.chain, app: r.protocol, apps: [r.protocol, r.id], coins: [] })),
    ...defi.map((g) => ({ chains: names(g.cid, g.chain), chain: g.chain, app: g.app, apps: [g.app, g.how].filter(Boolean), coins: (g.items || []).map(coin) })),
    ...wallet.map((g) => ({ chains: names(g.cid, g.chain), chain: g.chain, app: null, apps: [], coins: [...(g.tokens || []), ...(Array.isArray(g.rest) ? g.rest : [])].map(coin) })),
  ];
}

// 一个事件对上了哪几样(按事件的 matchBy)。对上的每一样记下卡片标题里怎么说:按链、按币对上的说链(用 data 里的写法,比如 opBNB),按项目对上的说项目;
// 按币对上的另记下是哪几个币(tokens:{ sym, loan })。币名用 data 里核对过的那个合约写的(symbol),不用接口传来的符号——
// 接口的符号谁都能起(真 DUSD 的合约,接口写成 USDT,标题也得说 DUSD);对上的合约没写币名的,unnamed,标题说得中性;借来的标出来
function hitsOf(e, list) {
  const ck = (e.chainKeys || []).map(flat), pk = e.protocolKeys || [];
  const tc = (e.tokenContracts || []).map((c) => ({ chain: flat(c.chain), addr: String(c.address || "").toLowerCase(), symbol: typeof c.symbol === "string" ? c.symbol : "" }));
  const out = [], tokens = new Map();
  let unnamed = false;
  for (const h of list) {
    const i = ck.findIndex((k) => h.chains.includes(k));
    if (ck.length && i < 0) continue; // 写了链,就只算这几条链上的
    const chain = (i >= 0 && (e.chains?.length === ck.length ? e.chains[i] : e.chains?.length === 1 ? e.chains[0] : "")) || h.chain;
    if (e.matchBy === "chain" && i >= 0) out.push(chain);
    else if (e.matchBy === "protocol" && h.app && pk.some((k) => h.apps.some((a) => sameApp(k, a)))) out.push(e.protocol || h.app);
    else if (e.matchBy === "token") {
      const mine = h.coins.flatMap((c) => {
        const x = c.addr && (!c.loan || e.matchLoans) ? tc.find((y) => y.addr === c.addr && h.chains.includes(y.chain)) : null;
        return x ? [{ sym: x.symbol, loan: c.loan }] : [];
      });
      if (!mine.length) continue;
      out.push(chain);
      for (const m of mine) {
        if (m.sym) tokens.set(`${m.sym.toLowerCase()} ${m.loan}`, m);
        else unnamed = true;
      }
    }
  }
  return { where: [...new Set(out)], tokens: [...tokens.values()], unnamed };
}

// 要提醒的事件:还没过、对上了查到的东西;最急的在前(分几步截止的按下一步算),没定日子的放最后
export function matchDue(events, list, now = new Date()) {
  const soonest = (m) => {
    const s = nextMilestone(m.e, now);
    return Math.min(s ? daysLeft(s.date, now, s.deadlineAt) : 1e9, m.left ?? 1e9);
  };
  return upcoming(events, now)
    .map((e) => ({ e, ...hitsOf(e, list), left: leftOf(e, now) }))
    .filter((m) => m.where.length)
    .sort((a, b) => soonest(a) - soonest(b));
}

// 顶上的卡要不要重画(体检结果页每查完一路、页面开着每分钟算一次):卡上跟着时间变的都算进来——对上了哪些、哪几个币、截止的倒数、
// 下一步是哪一步和它的倒数、日子写不写年份。没变就不重画(重查时不闪、读屏不重念);下一步换了、截止过了(卡要去掉)就重画
export function dueKey(list, now = new Date()) {
  const left = (iso, at) => (iso == null ? null : timeLeft(iso, now, at));
  return JSON.stringify([now.getUTCFullYear(), ...list.map(({ e, where, tokens }) => {
    const s = nextMilestone(e, now);
    return [e.id, where, tokens || [], left(e.deadline, e.deadlineAt), s && [s.date, left(s.date, s.deadlineAt)]];
  })]);
}

// 体检结果页顶上那几张卡这一次怎么画(check.js 每查完一路、页面开着每分钟、切回来时调):
//   held 是这一次查到的东西(holdings 的结果),done 是三路都查完了没有;last 是上一次查完一整轮时的 held。
//   查完一轮才换成新的;重查还没查完(done 是 false)时接着按上一轮的算——卡不闪,可截止过了的照样去掉(过期优先于不闪)。
//   一轮都还没查完、也没对上的,先不动(skip)。回 { list, key, last }:key 和正显示的一样就不用重画;last 留给下一次
export function dueView(events, held, done, last = null, now = new Date()) {
  const use = done || !last ? held : last;
  const list = matchDue(events, use, now);
  return { list, key: dueKey(list, now), last: done ? held : last, skip: !done && !last && !list.length };
}

// 官方链接只认 https:// 的,回域名(卡片上写出来让人核对);别的回空串。构建时也拿它查 data。
// 网址里带用户名的也不认(https://defiexit.com@别的网站/ 看着像本站,其实去的是 @ 后面那个)
export function httpsHost(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password ? u.hostname : "";
  } catch {
    return "";
  }
}

// 卡片标题怎么说,按事件的类型(data/deadlines.json 的 type)分四类;别的类型(other)说得中性。没定日子的标题也说得中性,见 i18n 的 dueTitle
const KIND = {
  "chain-shutdown": "move", "withdraw-only": "move", "frontend-down": "move", "bridge-route-end": "move",
  "token-migration": "swap", "stablecoin-redemption": "redeem", "rewards-deadline": "rewards",
};
export const dueKind = (type) => KIND[type] || "other";
// 按币对上的,标题说出币和要做的事:跨链路线停用的说「桥出来」;别的同上。按类型说得不对的,事件自己写 dueKind
// (StandX 的 DUSD 是赎回;pFIL 池子暂停中、只是网站 1 月 31 日下线,说得中性)
export const DUE_KINDS = ["move", "bridge", "swap", "redeem", "rewards", "other"];
export const titleKind = (e) => e.dueKind || (e.matchBy === "token" && e.type === "bridge-route-end" ? "bridge" : dueKind(e.type));
// 截止在那一天开头(写的 deadlineAt 是 00:00,或者只写了日子:当成那一天一开始就截止,宁早勿晚)的,英文说 before;截止在那一天里的说 by
const startOfDay = (e) => !e.deadlineAt || /T00:00(:00)?(Z|[+-]\d{2}:\d{2})$/.test(e.deadlineAt);

// 一张提醒卡:标题按事件类型说你要做什么、哪天前(分几步截止的,标题说最后一天,下面一行说下一步);还剩多少时间、这是什么事;
// 截止的说明、该怎么办、提醒;官方页面(新窗口,写出域名让人核对)、本站的截止日历。倒数按 now 现算(见 lib/deadline.js 的 timeLeft)
export function dueCard({ e, where, tokens = [], unnamed = false }, t, lang, now = new Date()) {
  const day = (iso) => {
    const [y, m, d] = String(iso).split("-").map(Number);
    return t("dueDate", y, m, d, y === now.getUTCFullYear());
  };
  const date = e.deadline ? day(e.deadline) : "";
  const left = e.deadline ? timeLeft(e.deadline, now, e.deadlineAt) : null;
  const step = nextMilestone(e, now);
  const links = (e.official || []).flatMap((o) => {
    const host = httpsHost(o.url);
    return host ? [el("a", { class: "btn small", href: o.url, rel: "noopener noreferrer", target: "_blank" }, o.label || host, " ", el("span", { class: "mono" }, host))] : [];
  });
  // 按币对上的,说不出是哪个币(合约没写币名)就说得中性,不退回「还有资产」那种说法
  const title = e.matchBy === "token" && (unnamed || !tokens.length) ? t("dueTitle", "other", "", "")
    : t("dueTitle", titleKind(e), where.join(listSep(lang)), date, { tokens: tokens.map((x) => t("dueToken", x.sym, x.loan)), before: startOfDay(e) });
  return el("article", { class: "due", "data-due": e.id },
    el("div", { class: "due-h" }, icon("alert"), el("h2", {}, title)),
    el("p", { class: "due-when" }, el("b", {}, left === null ? t("dueNoDate") : t("dueLeft", left)), e.name ? el("span", {}, e.name) : null),
    step ? el("p", { class: "due-next" }, icon("clock"), el("span", {}, t("dueNext", day(step.date), timeLeft(step.date, now, step.deadlineAt), step.note))) : null,
    e.note ? el("p", {}, e.note) : null,
    e.todo ? el("p", {}, e.todo) : null,
    e.caution ? el("p", { class: "sub" }, e.caution) : null,
    el("div", { class: "due-acts" }, ...links, el("a", { class: "btn small", href: `${prefix(lang)}/deadlines/#${e.id}` }, t("dueCal"))));
}
