// Hyperliquid 检测器:只读公开接口 api.hyperliquid.xyz/info,算出能提回多少、要做哪几步。
// diagnose() 再查挂单、成交、提现记录和 Arbitrum 上的到账,判断用户实际做到了哪一步。
// 给用户看的话都在 hyperliquid.text.js(中英两套),这里只管算。
import { postJSON, shortAddr, floorTo, fmt } from "../lib/net.js";
import { TEXT } from "./hyperliquid.text.js";

const API = "https://api.hyperliquid.xyz/info";
const ARB_RPC = "https://arb1.arbitrum.io/rpc";
const ARB_USDC = "0xaf88d065e77c8cc2239327c5edb3a432268e5831"; // Arbitrum 原生 USDC
const BRIDGE = "0x2df1c51e09aecf9cacb7bc98cb1742757f163df7";   // Hyperliquid 官方桥,到账转账的发出方
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"; // ERC-20 Transfer 事件
const USDH_PAIR = "@230";      // 现货 USDH/USDC
const FLOOR_PRICE = 0.995;     // 指南让用户填的限价(保底价)
const TAKER_FEE = 0.00014;     // 稳定币对现货吃单费,约 0.014%(2025-12 实测 0.0134%)
const WITHDRAW_FEE = 1;        // 提现手续费 1 USDC(官方提现面板原文)
const MIN_ORDER_USD = 10;      // 官方前端会拒绝太小的订单,社区口径约 10 美元
const SPLIT = ["default"];                             // 分开账户:现货、合约两本账
const UNIFIED = ["unifiedAccount", "portfolioMargin"]; // 统一账户:余额都在现货那本账里
const MIN = 60000, DAY = 86400000;

const text = (lang) => TEXT[lang] || TEXT.zh;
const info = (body) => postJSON(API, body);
const num = (x) => Number(x || 0);
// 接口返回的数字字符串要显示给用户、甚至让用户照着填进官网:只认纯数字,别的一律不用
const plain = (x) => typeof x === "string" && /^\d{1,12}(\.\d{1,12})?$/.test(x);
const shown = (x) => (plain(x) ? x : "?");

// 按买盘逐档算:价格不低于 floor 的买单一共能吃下多少、换回多少 USDC(未扣手续费)
export function fillable(bids, amount, floor = FLOOR_PRICE) {
  let qty = 0, usdc = 0;
  for (const l of bids || []) {
    const px = num(l.px), sz = num(l.sz);
    if (px < floor || qty >= amount) break;
    const take = Math.min(sz, amount - qty);
    qty += take;
    usdc += take * px;
  }
  return { qty, usdc };
}

// 按现价卖时的保底价:从买一往下数,攒够 amount 的那一档(按这个价挂,现在的买盘能全部吃下)。不够就返回 null
export function floorFor(bids, amount) {
  let qty = 0;
  for (const l of bids || []) {
    if (!plain(l.px)) return null;
    qty += num(l.sz);
    if (qty >= amount) return l.px;
  }
  return null;
}

// "12.345678" → 12345678n(USDC 6 位小数,按字符串换算,不经过浮点)
export function micro(s) {
  const [i, f = ""] = String(s).split(".");
  return BigInt(i || 0) * 1000000n + BigInt((f + "000000").slice(0, 6));
}

// 读账户 + 必要时读 USDH 盘口,算出所有要用的数
async function load(user, T) {
  // 账户模式查不到就整体报错,不按「分开账户」去猜:猜错会把同一笔钱算两遍
  const [ch, spot, mode] = await Promise.all([
    info({ type: "clearinghouseState", user }),
    info({ type: "spotClearinghouseState", user }),
    info({ type: "userAbstraction", user }),
  ]);
  const total = {}, held = {};
  for (const b of spot.balances || []) {
    total[b.coin] = num(b.total);
    held[b.coin] = num(b.hold); // hold:挂单冻结的数量
  }
  const free = (c) => Math.max((total[c] || 0) - (held[c] || 0), 0);
  const positions = (ch.assetPositions || []).length;
  const perpRaw = num(ch.withdrawable);
  const anything = positions > 0 || perpRaw > 0 || Object.values(total).some((v) => v > 0);
  const unified = UNIFIED.includes(mode);
  // 接口给的模式名原样显示前先过一遍:只认短的英文单词
  if (anything && !unified && !SPLIT.includes(mode)) throw new Error(T.unknownMode(/^[A-Za-z]{1,32}$/.test(String(mode)) ? mode : "?"));

  const usdhSell = floorTo(free("USDH"), 2);
  const usdhHeld = held.USDH || 0;
  // 有没卖的、或者挂着没成交的 USDH,才要看盘口
  const bids = usdhSell >= 0.01 || usdhHeld >= 0.01 ? (await info({ type: "l2Book", coin: USDH_PAIR }))?.levels?.[0] || [] : [];
  const bid = num(bids[0]?.px) || null;
  const canSell = usdhSell >= 0.01 && bid !== null && bid >= FLOOR_PRICE && usdhSell * bid >= MIN_ORDER_USD;
  // 只算 0.995 以上的买单真能吃下的部分;吃不下的会挂着等,不算进预计到账
  const fill = canSell ? fillable(bids, usdhSell) : { qty: 0, usdc: 0 };
  // 已经挂着的卖单按保底价算(成交了才会到手)
  const proceeds = (fill.usdc + usdhHeld * FLOOR_PRICE) * (1 - TAKER_FEE);
  const spotUsdc = free("USDC");
  // 统一账户的余额都在现货里;分开账户要加上合约账户可提的部分
  const perp = unified ? 0 : perpRaw;
  return {
    unified, positions, perp, spotUsdc, bids, bid, canSell, fill, usdhSell, usdhHeld,
    usdhAll: total.USDH || 0,
    others: Object.keys(total).filter((c) => !["USDC", "USDH"].includes(c) && total[c] > 0).length,
    spotAfter: spotUsdc + proceeds,
    withdrawAmt: perp + spotUsdc + proceeds,
    now: perp + spotUsdc, // 现在就能提的(不算没卖的 USDH)
  };
}

function balanceLines(a, T) {
  const lines = [];
  if (a.perp >= 0.01) lines.push(T.line.perp(fmt(a.perp)));
  if (a.spotUsdc >= 0.01) lines.push(T.line.spot(a.unified, fmt(a.spotUsdc)));
  if (a.usdhAll >= 0.01) lines.push(T.line.usdh(fmt(a.usdhAll), a.usdhHeld >= 0.01 ? fmt(a.usdhHeld) : null, a.bid));
  return lines;
}

// 结果页的明细表:一行一个数
function balanceRows(a, T) {
  const rows = [];
  if (a.perp >= 0.01) rows.push({ label: T.row.perp, value: fmt(a.perp) });
  if (a.spotUsdc >= 0.01) rows.push({ label: T.row.spot(a.unified), value: fmt(a.spotUsdc) });
  if (a.usdhAll >= 0.01) {
    const hint = [a.usdhHeld >= 0.01 ? T.row.held(fmt(a.usdhHeld)) : null, a.bid ? T.row.bid(a.bid) : null].filter(Boolean).join(" · ");
    rows.push({ label: T.row.usdh, value: fmt(a.usdhAll), hint: hint || null });
  }
  return rows;
}

// 买价低于 0.995 时,「按现价卖」amount 个 USDH 要用的数
function sellNow(a, amount) {
  const floorPx = floorFor(a.bids, amount);
  if (floorPx === null) return null;
  const expect = fillable(a.bids, amount, 0).usdc * (1 - TAKER_FEE);
  const min = amount * num(floorPx) * (1 - TAKER_FEE);
  return { floorPx, expect, min, loss: amount - expect };
}

export async function detect(address, lang = "zh") {
  const T = text(lang);
  const a = await load(address, T);
  const arrive = a.withdrawAmt - WITHDRAW_FEE;
  const warnings = [];
  if (a.positions) warnings.push(T.warn.positions(a.positions));
  if (a.usdhHeld >= 0.01) warnings.push(T.warn.held(fmt(a.usdhHeld)));
  if (a.usdhSell >= 0.01 && a.bid !== null && a.usdhSell * a.bid < MIN_ORDER_USD) warnings.push(T.warn.tooSmall);
  if (a.usdhSell >= 0.01 && a.bid !== null && a.bid < FLOOR_PRICE && a.usdhSell * a.bid >= MIN_ORDER_USD) {
    const s = sellNow(a, a.usdhSell);
    warnings.push(T.warn.lowBid(a.bid, T.warn.atBid(s && { expect: fmt(s.expect), loss: fmt(s.loss) })));
  }
  if (a.usdhSell >= 0.01 && a.bid === null) warnings.push(T.warn.noBids);
  if (a.canSell && a.fill.qty < a.usdhSell - 0.005) warnings.push(T.warn.thin(fmt(a.fill.qty)));
  // 代币名是任何人都能起的,不原样显示(可能是骂人的话,也可能是冒充的提示语),只报数量
  if (a.others) warnings.push(T.warn.others(a.others));

  const status = arrive >= 0.2 ? "found" : (a.withdrawAmt > 0.01 || a.usdhAll >= 0.01) ? "dust" : "empty";
  return {
    status,
    usd: Math.max(arrive, 0),
    lines: balanceLines(a, T),
    rows: balanceRows(a, T),
    warnings,
    note: status === "dust" ? T.note.dust : a.unified ? T.note.unified : T.note.split,
    // 有挂着的卖单时,卖出那几步照样显示:「下单卖出」那一步写了挂单没成交怎么办
    flags: { needsSell: a.canSell || a.usdhHeld >= 0.01, needsTransfer: !a.unified && a.spotAfter >= 0.01 },
    vars: {
      addrShort: shortAddr(address),
      floorPx: String(FLOOR_PRICE),
      usdhSell: a.usdhSell.toFixed(2),
      orderMin: fmt(a.usdhSell * FLOOR_PRICE),
      spotAfter: fmt(a.spotAfter),
      withdrawAmt: fmt(a.withdrawAmt),
      arrive: fmt(Math.max(arrive, 0)),
    },
  };
}

// 这笔提现到没到:Arbitrum 上那笔交易里,要有「官方桥 → 用户完整地址、Arbitrum 原生 USDC、金额等于到账净额」的转账
async function arrivalOf(w, user, T) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(w.hash || "") || !plain(w.delta?.usdc)) return { state: "mismatch" };
  const r = await postJSON(ARB_RPC, { jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [w.hash] });
  if (r.error) throw new Error(T.rpcError);
  const rc = r.result;
  if (!rc) return { state: "pending" };
  const pad = (a) => "0x" + a.slice(2).toLowerCase().padStart(64, "0");
  const want = micro(w.delta.usdc);
  const ok = rc.status === "0x1" && (rc.logs || []).some((l) =>
    String(l.address).toLowerCase() === ARB_USDC && l.topics?.[0] === TRANSFER &&
    String(l.topics[1]).toLowerCase() === pad(BRIDGE) && String(l.topics[2]).toLowerCase() === pad(user) &&
    BigInt(l.data) === want);
  return { state: ok ? "arrived" : "mismatch", block: parseInt(rc.blockNumber, 16) };
}

const two = (n) => String(n).padStart(2, "0");
const when = (t) => { const d = new Date(t); return `${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`; };
const ago = (t, now) => Math.max(0, Math.round((now - t) / MIN));

// 现场诊断:用户实际做到了哪一步、卡在哪。
// 返回 step(应该在的步骤 id,null 表示别往下做)、facts(查到的原始情况)、
// findings(结论,带代码;卡点报告里只用代码)、choice(要用户自己选的)、arrival(24 小时内那笔提现的到账情况)
export async function diagnose(address, now = Date.now(), lang = "zh") {
  const T = text(lang);
  const user = address;
  const [a, orders, fills, ledger] = await Promise.all([
    load(user, T),
    info({ type: "frontendOpenOrders", user }),
    info({ type: "userFills", user }),
    info({ type: "userNonFundingLedgerUpdates", user, startTime: now - 7 * DAY }),
  ]);
  const facts = [...balanceLines(a, T), T.fact.mode(a.unified)];
  const findings = [];
  const say = (code, level, msg) => findings.push({ code, level, head: T.head[code], text: msg });
  let step = null, choice = null;

  const sells = (orders || []).filter((o) => o.coin === USDH_PAIR && o.side === "A");
  for (const o of sells) facts.push(T.fact.order(fmt(num(o.sz)), shown(o.limitPx), ago(o.timestamp, now)));
  if (a.bid) facts.push(T.fact.bid(a.bid));
  const sold = (fills || []).filter((f) => f.coin === USDH_PAIR && f.dir === "Sell" && now - f.time < DAY);
  if (sold.length) {
    const qty = sold.reduce((s, f) => s + num(f.sz), 0), usdc = sold.reduce((s, f) => s + num(f.sz) * num(f.px), 0);
    facts.push(T.fact.fills(sold.length, fmt(qty), (usdc / qty).toFixed(5)));
  }
  const withdraws = (ledger || []).filter((u) => u.delta?.type === "withdraw").sort((x, y) => y.time - x.time);
  const last = withdraws[0] || null;
  const arrival = last && now - last.time < DAY ? await arrivalOf(last, user, T) : null;
  if (last) {
    const tail = !arrival ? "" : arrival.state === "arrived" ? T.fact.arrived(arrival.block) : arrival.state === "pending" ? T.fact.pending : T.fact.mismatch;
    facts.push(T.fact.withdraw(when(last.time), shown(last.delta.usdc), shown(last.delta.fee), tail));
  }

  // 要卖的数量:没挂单的 + 挂着没成交的(改价要先撤掉原来那一单)
  const lowBid = (cancelFirst) => {
    const amount = floorTo(a.usdhSell + a.usdhHeld, 2);
    const s = sellNow(a, amount);
    const sell = s && {
      floorPx: s.floorPx, min: fmt(s.min), expect: fmt(s.expect), loss: fmt(s.loss),
      vars: {
        floorPx: s.floorPx, usdhSell: amount.toFixed(2), orderMin: fmt(amount * num(s.floorPx)),
        spotAfter: fmt(a.spotUsdc + s.expect), withdrawAmt: fmt(a.now + s.expect), arrive: fmt(Math.max(a.now + s.expect - WITHDRAW_FEE, 0)),
      },
    };
    choice = { kind: "lowBid", bid: a.bid, amount: amount.toFixed(2), cancelFirst, sell, options: options(T, amount.toFixed(2), cancelFirst, sell) };
  };

  // 按指南的顺序,找第一件还没做完的事
  if (a.positions) {
    say("positions", "stop", T.say.positions(a.positions));
  } else if (sells.length || a.usdhHeld >= 0.01) {
    step = "order";
    const px = sells[0] ? num(sells[0].limitPx) : null;
    if (!sells.length) say("usdh-held", "stop", T.say.held(fmt(a.usdhHeld)));
    else if (a.bid !== null && px !== null && a.bid < px) {
      say("order-resting", "wait", T.say.restingLow(shown(sells[0].limitPx), a.bid));
      if (a.bid < FLOOR_PRICE) lowBid(true);
    } else say("order-resting", "wait", T.say.resting);
  } else if (a.usdhSell >= 0.01 && a.bid !== null && a.usdhSell * a.bid < MIN_ORDER_USD) {
    say("usdh-dust", "info", T.say.dust(fmt(a.usdhSell)));
  } else if (a.usdhSell >= 0.01 && a.bid === null) {
    say("no-bids", "stop", T.say.noBids);
    choice = { kind: "lowBid", bid: null, amount: a.usdhSell.toFixed(2), cancelFirst: false, sell: null, options: options(T, a.usdhSell.toFixed(2), false, null) };
  } else if (a.usdhSell >= 0.01 && a.bid < FLOOR_PRICE) {
    step = "fill";
    say("low-bid", "stop", T.say.lowBid(fmt(a.usdhSell), a.bid));
    lowBid(false);
  } else if (a.usdhSell >= 0.01) {
    step = "search";
    say("unsold", "ok", T.say.unsold(fmt(a.usdhSell), a.bid, a.fill.qty < a.usdhSell - 0.005 ? fmt(a.fill.qty) : null));
  }

  if (!step && !a.positions && !findings.some((f) => f.level === "stop")) {
    if (!a.unified && a.spotUsdc >= 0.01) {
      step = "transfer";
      say("needs-transfer", "ok", T.say.transfer(fmt(a.spotUsdc)));
    } else if (a.now >= WITHDRAW_FEE + 0.01) {
      step = "withdraw";
      say("can-withdraw", "ok", T.say.withdraw(fmt(a.now), fmt(a.now - WITHDRAW_FEE)));
    } else if (a.now >= 0.01) {
      say("too-small", "info", T.say.tooSmall(fmt(a.now)));
    }
  }

  if (arrival) {
    const mins = ago(last.time, now);
    if (arrival.state === "arrived") {
      if (!step) step = "arrive";
      // 绿色只给「已经完成」的事:逐笔对上了的到账
      say("withdraw-arrived", "done", T.say.arrived(when(last.time), shown(last.delta.usdc)));
    } else if (arrival.state === "mismatch") {
      step = null;
      say("withdraw-mismatch", "stop", T.say.mismatch);
    } else if (mins < 30) {
      if (!step) step = "arrive";
      say("withdraw-pending", "wait", T.say.pending(mins));
    } else {
      if (!step) step = "arrive";
      say("withdraw-late", "stop", T.say.late(mins));
    }
  }
  if (!findings.length) say("nothing", "info", T.say.nothing);
  // 到账页要用的核对结果:只有逐笔对上了才算 arrived
  const arrivalInfo = arrival && { state: arrival.state, time: last.time, usdc: shown(last.delta.usdc), fee: shown(last.delta.fee), block: arrival.block ?? null };
  return { at: now, step, facts, findings, choice, arrival: arrivalInfo };
}

// 买价跌破保底价时给用户的三条路。apply 告诉页面:选了以后指南里的数和步骤怎么变
function options(T, amount, cancelFirst, sell) {
  const C = T.choice;
  const out = [];
  if (sell) {
    out.push({
      head: C.sellHead(sell.floorPx), body: C.sellBody(amount, sell), warn: cancelFirst ? C.cancelFirst : null, pick: C.sellPick,
      apply: { vars: sell.vars, flags: { needsSell: true }, goto: "fill", toast: C.sellToast(cancelFirst, sell.floorPx) },
    });
  } else {
    out.push({ head: C.noDepthHead, body: C.noDepthBody });
  }
  out.push({
    head: C.redeemHead, body: C.redeemBody, pick: C.redeemPick,
    apply: { resetVars: true, flags: { needsSell: false }, goto: null, toast: C.redeemToast },
  });
  out.push({ head: C.waitHead, body: C.waitBody });
  return { title: C.title, list: out };
}
