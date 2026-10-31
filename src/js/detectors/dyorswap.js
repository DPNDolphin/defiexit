// DYORSwap 检测器:只读 X Layer 公共节点,查这个地址在 USDT_Bridged / WOKB 池子里的 LP,按撤出时真实能拿回的数算。
// 这个池子撤出时要先给协议补铸手续费 LP,真实能拿回的比网页估的少一点。少得超过滑点,交易就会失败(路由报 INSUFFICIENT_A_AMOUNT):
// 2026-10-31 链上模拟:少 0.55%,网页默认 0.5% 失败,1% 成功。所以指南先把滑点改成 1%;差得接近 1% 就超出核对过的范围了,这里让用户先停下。
// diagnose() 判断做到了哪一步:到账只认链上最近几分钟的撤出记录(lib/xlayer.js 的 dyorRemoved)。LP 可以转给别人,清零不等于撤出来了;
// 有 LP 也不等于没撤过(可能撤了一部分)。查不到记录时只说现在的情况,不编数,也不说「没动过」。
// 合约、函数 2026-10-30 对着已验证源码核对过(见 lib/xlayer.js);给用户看的话在 dyorswap.text.js。
import { shortAddr, floorTo, fmt } from "../lib/net.js";
import { readDyor, dyorRemoved, prices } from "../lib/xlayer.js";
import { TEXT } from "./dyorswap.text.js";

const MIN_GAS = 0.00002; // 撤出的 gas 上限约 33 万 × 0.023 gwei ≈ 0.0000076 OKB,留两倍多余量
const SLIP = 1; // 指南里让用户设的滑点(%)
const text = (lang) => TEXT[lang] || TEXT.zh;
const money = (x) => floorTo(x, 2).toFixed(2);
const qty = (x) => String(+x.toPrecision(6)); // 12.5、0.0312:不带多余的 0
const okb = (x) => fmt(x, 8).replace(/\.?0+$/, ""); // 钱包里的 OKB:0、0.1169、0.00000012(不写成 0.00000000,也不用科学计数法)
const got = (a, lang) => `${qty(a.usdt)} USDT${lang === "en" ? " + " : " 和 "}${qty(a.wokb)} OKB`;

async function load(address) {
  const a = await readDyor(address);
  const held = a.lp > 0n;
  const px = held ? await prices([a.px.usdt, a.px.okb]) : new Map();
  const price = (k) => (px.get(k.toLowerCase()) == null ? null : px.get(k.toLowerCase()));
  const usdOf = (x, k) => (price(k) === null ? null : x * price(k));
  return {
    ...a, held,
    usdtUsd: usdOf(a.usdt, a.px.usdt), okbUsd: usdOf(a.wokb, a.px.okb),
    // 真实能拿回的比网页估的少百分之几:滑点要大过它
    short: a.pageUsdt > 0 ? (1 - a.usdt / a.pageUsdt) * 100 : 0,
  };
}

// 留一点余量:正好卡在滑点上的话,再有一笔手续费进来就失败了
const slipTooLow = (a) => a.short + 0.1 >= SLIP;

function lines(a, T, lang) {
  const out = [a.held ? T.line.lp(got(a, lang)) : T.line.none];
  if (a.allowance > 0n) out.push(T.line.approval);
  out.push(T.line.gas(okb(a.gas)));
  return out;
}

export async function detect(address, lang = "zh") {
  const T = text(lang);
  const a = await load(address);
  const usd = (a.usdtUsd || 0) + (a.okbUsd || 0);
  const warnings = [];
  if (a.held && slipTooLow(a)) warnings.push(T.warn.slip(a.short.toFixed(2)));
  if (a.held && a.gas < MIN_GAS) warnings.push(T.warn.lowGas(okb(a.gas)));
  const row = (label, x, sym, v) => ({ label, value: `${qty(x)} ${sym}`, hint: v === null ? T.row.noPrice : T.row.about(money(v)) });
  const unpriced = [[a.usdt, "USDT", a.usdtUsd], [a.wokb, "OKB", a.okbUsd]].filter((x) => x[2] === null).map((x) => ` + ${qty(x[0])} ${x[1]}`).join("");
  return {
    status: a.held ? "found" : "empty",
    usd,
    rows: a.held ? [row(T.row.usdt, a.usdt, "USDT", a.usdtUsd), row(T.row.okb, a.wokb, "OKB", a.okbUsd)] : [],
    total: { label: T.total, value: `$${money(usd)}${unpriced}` },
    lines: lines(a, T, lang),
    warnings,
    note: null,
    badge: null,
    flags: {},
    hold: a.held && slipTooLow(a), // 让用户先停下:指南页停在概况,看得到这条提醒
    // 账户空了就不填「你能撤回的币」,页面上留着说明文字
    vars: a.held ? { addrShort: shortAddr(address), got: got(a, lang) } : { addrShort: shortAddr(address) },
  };
}

// 现场诊断:有撤出记录就报到账;LP 还在的,到了哪一步链上看不出来,不指路,看弹层里这一步的常见情况
export async function diagnose(address, now = Date.now(), lang = "zh") {
  const T = text(lang);
  const a = await load(address);
  const removed = await dyorRemoved(address);
  const back = removed?.length ? { usdt: removed.reduce((s, x) => s + x.usdt, 0), wokb: removed.reduce((s, x) => s + x.okb, 0) } : null;
  const findings = [];
  const say = (code, level, msg) => findings.push({ code, level, head: T.head[code], text: msg });
  let step = null, arrival = null;

  if (a.held) {
    if (back) say("partial", "info", T.say.partial(got(back, lang), got(a, lang)));
    else say("in-pool", "ok", T.say.inPool(got(a, lang)));
    if (slipTooLow(a)) say("need-slip", "stop", T.warn.slip(a.short.toFixed(2)));
    if (a.gas < MIN_GAS) say("low-gas", "stop", T.say.lowGas(okb(a.gas)));
  } else if (back) {
    step = "arrive";
    const items = [{ sym: "USDT", amount: qty(back.usdt) }, { sym: "OKB", amount: qty(back.wokb) }].map((x) => ({ ...x, text: T.arr.item(x.amount, x.sym) }));
    say("arrived", "done", T.say.arrived(T.arr.list(items)));
    arrival = { state: "arrived", items };
  } else if (a.nonce > 0n) {
    step = "arrive"; // 用签名撤过,但这次没查到记录(撤了有一会儿了,或者节点限速):不编数
    say("no-lp", "info", T.say.noLp);
  } else {
    say("nothing", "info", T.say.nothing);
  }
  if (!a.held && a.allowance > 0n) say("old-approval", "info", T.say.approval);
  return { at: now, step, facts: lines(a, T, lang), findings, choice: null, arrival };
}
