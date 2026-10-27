// Hyperliquid 检测器:只读公开接口 api.hyperliquid.xyz/info,算出能提回多少、要做哪几步。
import { postJSON, shortAddr, floorTo, fmt } from "../lib/net.js";

const API = "https://api.hyperliquid.xyz/info";
const USDH_PAIR = "@230";      // 现货 USDH/USDC
const FLOOR_PRICE = 0.995;     // 指南让用户填的限价(保底价)
const TAKER_FEE = 0.00014;     // 稳定币对现货吃单费,约 0.014%(2025-12 实测 0.0134%)
const WITHDRAW_FEE = 1;        // 提现手续费 1 USDC(官方提现面板原文)
const MIN_ORDER_USD = 10;      // 官方前端会拒绝太小的订单,社区口径约 10 美元
const SPLIT = ["default"];                             // 分开账户:现货、合约两本账
const UNIFIED = ["unifiedAccount", "portfolioMargin"]; // 统一账户:余额都在现货那本账里

const info = (body) => postJSON(API, body);
const num = (x) => Number(x || 0);

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

export async function detect(address) {
  const user = address;
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

  const spotUsdc = free("USDC");
  const usdhAll = total.USDH || 0;
  const usdhHeld = held.USDH || 0;
  const usdh = free("USDH");
  // 统一账户的余额都在现货里;分开账户要加上合约账户可提的部分
  const perp = unified ? 0 : perpRaw;
  const others = Object.keys(total).filter((c) => !["USDC", "USDH"].includes(c) && total[c] > 0);

  const usdhSell = floorTo(usdh, 2);
  let bids = [];
  if (usdhSell >= 0.01) {
    const book = await info({ type: "l2Book", coin: USDH_PAIR });
    bids = book?.levels?.[0] || [];
  }
  const bid = num(bids[0]?.px) || null;
  const canSell = usdhSell >= 0.01 && bid !== null && bid >= FLOOR_PRICE && usdhSell * bid >= MIN_ORDER_USD;
  // 只算 0.995 以上的买单真能吃下的部分;吃不下的会挂着等,不算进预计到账
  const fill = canSell ? fillable(bids, usdhSell) : { qty: 0, usdc: 0 };
  // 已经挂着的卖单按保底价算(成交了才会到手)
  const pending = usdhHeld * FLOOR_PRICE;
  const proceeds = (fill.usdc + pending) * (1 - TAKER_FEE);
  const spotAfter = spotUsdc + proceeds;
  const withdrawAmt = perp + spotAfter;
  const arrive = withdrawAmt - WITHDRAW_FEE;

  const warnings = [];
  if (positions) warnings.push(`你还有 ${positions} 个持仓:先在官网平仓,这份指南不包括平仓`);
  if (usdhHeld >= 0.01) warnings.push(`有 ${fmt(usdhHeld)} USDH 挂在卖单里还没成交:多半是买价低于你填的价格。别重复下单;预计到账是按它以 0.995 成交算的`);
  if (usdhSell >= 0.01 && bid !== null && usdhSell * bid < MIN_ORDER_USD) warnings.push("USDH 不到 10 美元,可能低于最小下单额,卖不出去");
  if (usdhSell >= 0.01 && bid !== null && bid < FLOOR_PRICE && usdhSell * bid >= MIN_ORDER_USD) {
    const all = fillable(bids, usdhSell, 0);
    const now = all.usdc * (1 - TAKER_FEE);
    const atBid = all.qty >= usdhSell - 0.005
      ? `按现在的买盘全部卖掉约得 ${fmt(now)} USDC,比 1:1 少约 ${fmt(usdhSell - now)}`
      : `现在的买盘一共只能吃下 ${fmt(all.qty)} 个`;
    warnings.push(`USDH 现在的买价 ${bid} 低于指南的保底价 0.995,先别卖。${atBid}。另一条官方路:Hyperliquid 官网写明,USDH 发行方 Bridge 在 redeem.bridge.xyz 维持 1:1 赎回(要在 Bridge 注册开户)。预计到账没算 USDH`);
  }
  if (usdhSell >= 0.01 && bid === null) warnings.push("USDH 现在没有买单,卖不出去;预计到账没算 USDH");
  if (canSell && fill.qty < usdhSell - 0.005) warnings.push(`0.995 以上的买单现在只够卖 ${fmt(fill.qty)} 个;剩下的会按 0.995 挂着等成交,预计到账只算了能卖掉的部分`);
  // 代币名是任何人都能起的,不原样显示(可能是骂人的话,也可能是冒充的提示语),只报数量
  if (others.length) warnings.push(`现货里还有 ${others.length} 种别的币,这份指南没写怎么卖`);

  const lines = [];
  if (perp >= 0.01) lines.push(`合约账户 ${fmt(perp)} USDC`);
  if (spotUsdc >= 0.01) lines.push(`${unified ? "账户" : "现货"} ${fmt(spotUsdc)} USDC`);
  if (usdhAll >= 0.01) lines.push(`现货 ${fmt(usdhAll)} USDH${usdhHeld >= 0.01 ? `(其中 ${fmt(usdhHeld)} 挂在卖单里)` : ""}${bid ? `(买价约 ${bid})` : ""}`);

  const status = arrive >= 0.2 ? "found" : (withdrawAmt > 0.01 || usdhAll >= 0.01) ? "dust" : "empty";
  return {
    status,
    usd: Math.max(arrive, 0),
    lines,
    warnings,
    note: status === "dust" ? "有余额,但不够付 1 USDC 提现手续费" : unified ? "统一账户:不用划转,卖完直接提" : "分开账户:卖完要先把现货 USDC 划到合约账户",
    // 有挂着的卖单时,卖出那几步照样显示:「下单卖出」那一步写了挂单没成交怎么办
    flags: { needsSell: canSell || usdhHeld >= 0.01, needsTransfer: !unified && spotAfter >= 0.01 },
    vars: {
      addrShort: shortAddr(address),
      usdhSell: usdhSell.toFixed(2),
      orderMin: fmt(usdhSell * FLOOR_PRICE),
      spotAfter: fmt(spotAfter),
      withdrawAmt: fmt(withdrawAmt),
      arrive: fmt(Math.max(arrive, 0)),
    },
  };
}
