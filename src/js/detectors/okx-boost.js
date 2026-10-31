// OKX Boost「Plasma X Launch」检测器:只读 X Layer 公共节点,查这个地址在锁仓合约里锁着的 OKB、USDT0、USDG。
// diagnose() 判断做到了哪一步:还锁着 → 去「解除质押」;数量清零了、锁仓记录还在 → 已经取出来了
// (合约的 unlock 只把数量清零、开始时间留着;只有本人能取,一次取全部,钱只打回本人)。
// 刚取完的数:这一页之前查到过就用那个数(取出的就是锁着的全部);页面是新打开的,再查最近几分钟的解除质押事件。
// 事件可能被公共节点限速、查不全:查不到数时只说「已经取出来了」,不说是什么时候取的。
// 合约、函数、事件 2026-10-30 对着已验证源码和链上数据核对过(见 lib/xlayer.js);给用户看的话在 okx-boost.text.js。
import { shortAddr, floorTo, fmt } from "../lib/net.js";
import { readBoost, boostUnlocked, prices } from "../lib/xlayer.js";
import { TEXT } from "./okx-boost.text.js";

const MIN_GAS = 0.00001; // 一笔解除质押实测约 0.0000008 OKB(gas 4.5 万 × 0.02 gwei),留十几倍余量
const text = (lang) => TEXT[lang] || TEXT.zh;
const money = (x) => floorTo(x, 2).toFixed(2);
const qty = (x) => String(+x.toFixed(6)); // 0.5、200:不带多余的 0
const okb = (x) => fmt(x, 8).replace(/\.?0+$/, ""); // 钱包里的 OKB:0、0.1169、0.00000012(不写成 0.00000000,也不用科学计数法)
const when = (sec, lang) => new Date(sec * 1000).toLocaleString(lang === "en" ? "en-US" : "zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
const got = (held, lang) => held.map((x) => `${qty(x.qty)} ${x.sym}`).join(lang === "en" ? " + " : " 和 ");

// 这一页里查到过的锁仓(地址 → 锁着的那几样):用户取完回来,链上已经是 0,用它报准确的到账数
const seen = new Map();

async function load(address) {
  const { gas, locks } = await readBoost(address);
  const held = locks.filter((x) => x.qty > 0);
  const px = await prices([...new Set(held.map((x) => x.px))]);
  const usdOf = (x) => (px.get(x.px.toLowerCase()) == null ? null : x.qty * px.get(x.px.toLowerCase()));
  if (held.length) seen.set(address.toLowerCase(), held.map((x) => ({ sym: x.sym, qty: x.qty })));
  return {
    gas,
    held: held.map((x) => ({ ...x, usd: usdOf(x) })),
    // 锁过、现在是 0:已经取出来了(开始时间还留着)
    done: locks.filter((x) => x.qty === 0 && x.start > 0),
  };
}

function lines(a, T, lang) {
  const out = [];
  if (a.held.length) {
    out.push(T.line.lock(a.held.map((x) => `${qty(x.qty)} ${x.sym}`).join(lang === "en" ? ", " : "、")));
    const end = Math.max(...a.held.map((x) => x.end));
    out.push(T.line.end(when(end, lang), Date.now() / 1000 >= end));
  } else {
    out.push(T.line.none);
  }
  if (a.done.length) out.push(T.line.done(a.done.map((x) => x.sym).join("/")));
  out.push(T.line.gas(okb(a.gas)));
  return out;
}

export async function detect(address, lang = "zh") {
  const T = text(lang);
  const a = await load(address);
  const { held } = a;
  const usd = held.reduce((s, x) => s + (x.usd || 0), 0);
  const end = held.length ? Math.max(...held.map((x) => x.end)) : 0;
  const ready = Date.now() / 1000 >= end;
  const warnings = [];
  if (held.length && !ready) warnings.push(T.warn.notYet(when(end, lang)));
  if (held.length && a.gas < MIN_GAS) warnings.push(T.warn.lowGas(okb(a.gas)));
  const rows = held.map((x) => ({ label: T.row.locked(x.sym), value: `${qty(x.qty)} ${x.sym}`, hint: x.usd === null ? T.row.noPrice : T.row.about(money(x.usd)) }));
  if (held.length) rows.push({ label: T.row.end, value: when(end, lang), hint: ready ? T.row.ready : T.row.wait });
  const unpriced = held.filter((x) => x.usd === null).map((x) => ` + ${qty(x.qty)} ${x.sym}`).join("");
  return {
    status: held.length ? "found" : "empty",
    usd,
    rows,
    total: { label: T.total, value: `$${money(usd)}${unpriced}` },
    lines: lines(a, T, lang),
    warnings,
    note: null,
    badge: null,
    flags: {},
    // 账户空了就不填「你锁的币」,页面上留着说明文字
    vars: held.length ? { addrShort: shortAddr(address), got: got(held, lang), sym: held.map((x) => x.sym).join("/") } : { addrShort: shortAddr(address) },
  };
}

// 现场诊断:还锁着就去解除质押;取完了就核对到账
export async function diagnose(address, now = Date.now(), lang = "zh") {
  const T = text(lang);
  const before = seen.get(address.toLowerCase());
  const a = await load(address);
  const facts = lines(a, T, lang);
  const findings = [];
  const say = (code, level, msg) => findings.push({ code, level, head: T.head[code], text: msg });
  let step = null, arrival = null;

  if (a.held.length) {
    const end = Math.max(...a.held.map((x) => x.end));
    if (now / 1000 < end) say("not-yet", "wait", T.say.notYet(when(end, lang)));
    else {
      step = "unstake";
      say("can-unstake", "ok", T.say.unstake(got(a.held, lang)));
    }
    if (a.gas < MIN_GAS) say("low-gas", "stop", T.say.lowGas(okb(a.gas)));
  } else if (a.done.length) {
    step = "arrive";
    // 准确的数:这一页之前查到过的锁仓(取出的就是全部);没有就查最近几分钟的解除质押事件
    const doneSyms = new Set(a.done.map((x) => x.sym));
    let items = (before || []).filter((x) => doneSyms.has(x.sym));
    if (!items.length) items = (await boostUnlocked(address)) || [];
    if (items.length) {
      const arr = items.map((x) => ({ sym: x.sym, amount: qty(x.qty), text: T.arr.item(qty(x.qty), x.sym) }));
      say("arrived", "done", T.say.arrived(T.arr.list(arr)));
      arrival = { state: "arrived", items: arr };
    } else {
      say("withdrawn", "done", T.say.withdrawn([...doneSyms].join("/")));
    }
  } else {
    say("nothing", "info", T.say.nothing);
  }
  return { at: now, step, facts, findings, choice: null, arrival };
}
