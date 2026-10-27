// Hyperliquid 检测器:只读公开接口 api.hyperliquid.xyz/info,算出能提回多少、要做哪几步。
// diagnose() 再查挂单、成交、提现记录和 Arbitrum 上的到账,判断用户实际做到了哪一步。
import { postJSON, shortAddr, floorTo, fmt } from "../lib/net.js";

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

// "92.21616" → 92216160n(USDC 6 位小数,按字符串换算,不经过浮点)
export function micro(s) {
  const [i, f = ""] = String(s).split(".");
  return BigInt(i || 0) * 1000000n + BigInt((f + "000000").slice(0, 6));
}

// 读账户 + 必要时读 USDH 盘口,算出所有要用的数
async function load(user) {
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
  if (anything && !unified && !SPLIT.includes(mode)) throw new Error(`没认出账户模式(${mode}),先别照指南操作,稍后再试`);

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

function balanceLines(a) {
  const lines = [];
  if (a.perp >= 0.01) lines.push(`合约账户 ${fmt(a.perp)} USDC`);
  if (a.spotUsdc >= 0.01) lines.push(`${a.unified ? "账户" : "现货"} ${fmt(a.spotUsdc)} USDC`);
  if (a.usdhAll >= 0.01) lines.push(`现货 ${fmt(a.usdhAll)} USDH${a.usdhHeld >= 0.01 ? `(其中 ${fmt(a.usdhHeld)} 挂在卖单里)` : ""}${a.bid ? `(买价约 ${a.bid})` : ""}`);
  return lines;
}

// 买价低于 0.995 时,「按现价卖」amount 个 USDH 要用的数
function sellNow(a, amount) {
  const floorPx = floorFor(a.bids, amount);
  if (floorPx === null) return null;
  const expect = fillable(a.bids, amount, 0).usdc * (1 - TAKER_FEE);
  const min = amount * num(floorPx) * (1 - TAKER_FEE);
  return { floorPx, expect, min, loss: amount - expect };
}

export async function detect(address) {
  const a = await load(address);
  const arrive = a.withdrawAmt - WITHDRAW_FEE;
  const warnings = [];
  if (a.positions) warnings.push(`你还有 ${a.positions} 个持仓:先在官网平仓,这份指南不包括平仓`);
  if (a.usdhHeld >= 0.01) warnings.push(`有 ${fmt(a.usdhHeld)} USDH 挂在卖单里还没成交:多半是买价低于你填的价格。别重复下单;预计到账是按它以 0.995 成交算的`);
  if (a.usdhSell >= 0.01 && a.bid !== null && a.usdhSell * a.bid < MIN_ORDER_USD) warnings.push("USDH 不到 10 美元,可能低于最小下单额,卖不出去");
  if (a.usdhSell >= 0.01 && a.bid !== null && a.bid < FLOOR_PRICE && a.usdhSell * a.bid >= MIN_ORDER_USD) {
    const s = sellNow(a, a.usdhSell);
    const atBid = s ? `按现在的买盘全部卖掉约得 ${fmt(s.expect)} USDC,比 1:1 少约 ${fmt(s.loss)}` : "现在的买盘不够把它全部卖掉";
    warnings.push(`USDH 现在的买价 ${a.bid} 低于指南的保底价 0.995,先别卖。${atBid}。另一条官方路:Hyperliquid 官网写明,USDH 发行方 Bridge 在 redeem.bridge.xyz 维持 1:1 赎回(要在 Bridge 注册开户)。打开指南,点「我卡在这一步」可以选怎么办。预计到账没算 USDH`);
  }
  if (a.usdhSell >= 0.01 && a.bid === null) warnings.push("USDH 现在没有买单,卖不出去;预计到账没算 USDH");
  if (a.canSell && a.fill.qty < a.usdhSell - 0.005) warnings.push(`0.995 以上的买单现在只够卖 ${fmt(a.fill.qty)} 个;剩下的会按 0.995 挂着等成交,预计到账只算了能卖掉的部分`);
  // 代币名是任何人都能起的,不原样显示(可能是骂人的话,也可能是冒充的提示语),只报数量
  if (a.others) warnings.push(`现货里还有 ${a.others} 种别的币,这份指南没写怎么卖`);

  const status = arrive >= 0.2 ? "found" : (a.withdrawAmt > 0.01 || a.usdhAll >= 0.01) ? "dust" : "empty";
  return {
    status,
    usd: Math.max(arrive, 0),
    lines: balanceLines(a),
    warnings,
    note: status === "dust" ? "有余额,但不够付 1 USDC 提现手续费" : a.unified ? "统一账户:不用划转,卖完直接提" : "分开账户:卖完要先把现货 USDC 划到合约账户",
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
async function arrivalOf(w, user) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(w.hash || "") || !plain(w.delta?.usdc)) return { state: "mismatch" };
  const r = await postJSON(ARB_RPC, { jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [w.hash] });
  if (r.error) throw new Error("Arbitrum 节点返回错误");
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
// 返回 step(应该在的步骤 id,null 表示别往下做)、facts(查到的原始情况)、findings(结论,带代码,卡点报告里只用代码)、choice(要用户自己选的)
export async function diagnose(address, now = Date.now()) {
  const user = address;
  const [a, orders, fills, ledger] = await Promise.all([
    load(user),
    info({ type: "frontendOpenOrders", user }),
    info({ type: "userFills", user }),
    info({ type: "userNonFundingLedgerUpdates", user, startTime: now - 7 * DAY }),
  ]);
  const facts = [...balanceLines(a), a.unified ? "账户模式:统一账户" : "账户模式:分开账户"];
  const findings = [];
  const say = (code, level, text) => findings.push({ code, level, text });
  let step = null, choice = null;

  const sells = (orders || []).filter((o) => o.coin === USDH_PAIR && o.side === "A");
  for (const o of sells) facts.push(`挂着的卖单:${fmt(num(o.sz))} USDH,价格 ${shown(o.limitPx)},挂了 ${ago(o.timestamp, now)} 分钟`);
  if (a.bid) facts.push(`USDH 现在的买一价:${a.bid}`);
  const sold = (fills || []).filter((f) => f.coin === USDH_PAIR && f.dir === "Sell" && now - f.time < DAY);
  if (sold.length) {
    const qty = sold.reduce((s, f) => s + num(f.sz), 0), usdc = sold.reduce((s, f) => s + num(f.sz) * num(f.px), 0);
    facts.push(`24 小时内卖出成交 ${sold.length} 笔,共 ${fmt(qty)} USDH,均价 ${(usdc / qty).toFixed(5)}`);
  }
  const withdraws = (ledger || []).filter((u) => u.delta?.type === "withdraw").sort((x, y) => y.time - x.time);
  const last = withdraws[0] || null;
  const arrival = last && now - last.time < DAY ? await arrivalOf(last, user) : null;
  if (last) {
    const tail = !arrival ? "" : arrival.state === "arrived" ? `,已在 Arbitrum 上到账(区块 ${arrival.block})` : arrival.state === "pending" ? ",Arbitrum 上还没查到到账交易" : ",查到链上交易,但没对上你的到账转账";
    facts.push(`最近一次提现:${when(last.time)} 提交,到账金额 ${shown(last.delta.usdc)} USDC(手续费 ${shown(last.delta.fee)})${tail}`);
  }

  // 要卖的数量:没挂单的 + 挂着没成交的(改价要先撤掉原来那一单)
  const lowBid = (cancelFirst) => {
    const amount = floorTo(a.usdhSell + a.usdhHeld, 2);
    const s = sellNow(a, amount);
    choice = {
      kind: "lowBid", bid: a.bid, amount: amount.toFixed(2), cancelFirst,
      sell: s && {
        floorPx: s.floorPx, min: fmt(s.min), expect: fmt(s.expect), loss: fmt(s.loss),
        vars: {
          floorPx: s.floorPx, usdhSell: amount.toFixed(2), orderMin: fmt(amount * num(s.floorPx)),
          spotAfter: fmt(a.spotUsdc + s.expect), withdrawAmt: fmt(a.now + s.expect), arrive: fmt(Math.max(a.now + s.expect - WITHDRAW_FEE, 0)),
        },
      },
    };
  };

  // 按指南的顺序,找第一件还没做完的事
  if (a.positions) {
    say("positions", "stop", `你还有 ${a.positions} 个持仓:先在官网平仓。这份指南不包括平仓,平完再回来。`);
  } else if (sells.length || a.usdhHeld >= 0.01) {
    step = "order";
    const px = sells[0] ? num(sells[0].limitPx) : null;
    if (!sells.length) say("usdh-held", "stop", `有 ${fmt(a.usdhHeld)} USDH 被冻结,但没查到挂着的卖单。先别操作,过一分钟点「再查一次」。`);
    else if (a.bid !== null && px !== null && a.bid < px) {
      say("order-resting", "wait", `你的卖单还挂着没成交:你挂的价格是 ${shown(sells[0].limitPx)},现在的买一价 ${a.bid} 比它低。别重复下单。`);
      if (a.bid < FLOOR_PRICE) lowBid(true);
    } else say("order-resting", "wait", "你的卖单还挂着,正在等成交。别重复下单,过一会儿点「再查一次」。");
  } else if (a.usdhSell >= 0.01 && a.bid !== null && a.usdhSell * a.bid < MIN_ORDER_USD) {
    say("usdh-dust", "info", `还剩 ${fmt(a.usdhSell)} USDH,不到 10 美元,卖不掉,可以不管它。`);
  } else if (a.usdhSell >= 0.01 && a.bid === null) {
    say("no-bids", "stop", "USDH 现在没有买单,卖不出去。先别卖;另一条官方路是去发行方 Bridge 1:1 赎回(见下面)。");
    choice = { kind: "lowBid", bid: null, amount: a.usdhSell.toFixed(2), cancelFirst: false, sell: null };
  } else if (a.usdhSell >= 0.01 && a.bid < FLOOR_PRICE) {
    step = "fill";
    say("low-bid", "stop", `你还有 ${fmt(a.usdhSell)} USDH 没卖,但现在的买一价 ${a.bid} 低于指南的保底价 0.995,按 0.995 挂单不会成交。下面三条路,你自己选。`);
    lowBid(false);
  } else if (a.usdhSell >= 0.01) {
    step = "search";
    say("unsold", "ok", `你还有 ${fmt(a.usdhSell)} USDH 没卖。现在的买一价 ${a.bid},按 0.995 挂单会马上成交${a.fill.qty < a.usdhSell - 0.005 ? `(不过 0.995 以上的买单只够卖 ${fmt(a.fill.qty)} 个)` : ""}。`);
  }

  if (!step && !a.positions && !findings.some((f) => f.level === "stop")) {
    if (!a.unified && a.spotUsdc >= 0.01) {
      step = "transfer";
      say("needs-transfer", "ok", `现货里有 ${fmt(a.spotUsdc)} USDC,还没划到合约账户。划过去才能提现。`);
    } else if (a.now >= WITHDRAW_FEE + 0.01) {
      step = "withdraw";
      say("can-withdraw", "ok", `可以提现了:约 ${fmt(a.now)} USDC,扣 1 USDC 手续费,到账约 ${fmt(a.now - WITHDRAW_FEE)}。`);
    } else if (a.now >= 0.01) {
      say("too-small", "info", `账户里还有 ${fmt(a.now)} USDC,不够付 1 USDC 提现手续费,提不了。`);
    }
  }

  if (arrival) {
    const mins = ago(last.time, now);
    if (arrival.state === "arrived") {
      if (!step) step = "arrive";
      say("withdraw-arrived", "ok", `${when(last.time)} 那笔提现已经到账:${shown(last.delta.usdc)} USDC。在钱包里看 Arbitrum 网络下的 USDC。`);
    } else if (arrival.state === "mismatch") {
      step = null;
      say("withdraw-mismatch", "stop", "查到了这笔提现的链上交易,但没对上你的到账转账。先别做任何操作,带上截图去 Hyperliquid 官方支持(见下面)。");
    } else if (mins < 30) {
      if (!step) step = "arrive";
      say("withdraw-pending", "wait", `提现在路上:${mins} 分钟前提交。官方说 5 分钟内到账。别重复提现,过几分钟点「再查一次」。`);
    } else {
      if (!step) step = "arrive";
      say("withdraw-late", "stop", `提现已经提交 ${mins} 分钟,Arbitrum 上还没查到到账交易。别重复提现,带上截图去 Hyperliquid 官方支持(见下面)。`);
    }
  }
  if (!findings.length) say("nothing", "info", "账户里没查到能提的钱,也没有 24 小时内的提现记录。");
  return { at: now, step, facts, findings, choice };
}
