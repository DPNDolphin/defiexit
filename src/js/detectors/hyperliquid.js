// Hyperliquid 检测器:只读公开接口 api.hyperliquid.xyz/info,算出能提回多少、要做哪几步。
import { postJSON, shortAddr, floorTo, fmt } from "../lib/net.js";

const API = "https://api.hyperliquid.xyz/info";
const USDH_PAIR = "@230";      // 现货 USDH/USDC
const FLOOR_PRICE = 0.995;     // 指南让用户填的限价(保底价)
const TAKER_FEE = 0.00014;     // 稳定币对现货吃单费,约 0.014%(2025-12 实测 0.0134%)
const WITHDRAW_FEE = 1;        // 提现手续费 1 USDC(官方提现面板原文)
const MIN_ORDER_USD = 10;      // 官方前端会拒绝太小的订单,社区口径约 10 美元

const info = (body) => postJSON(API, body);
const num = (x) => Number(x || 0);

export async function detect(address) {
  const user = address;
  const [ch, spot, mode] = await Promise.all([
    info({ type: "clearinghouseState", user }),
    info({ type: "spotClearinghouseState", user }),
    info({ type: "userAbstraction", user }).catch(() => null),
  ]);
  const unified = mode === "unifiedAccount" || mode === "portfolioMargin";
  const bal = {};
  for (const b of spot.balances || []) bal[b.coin] = num(b.total) - num(b.hold);
  const spotUsdc = bal.USDC || 0;
  const usdh = bal.USDH || 0;
  // 统一账户的余额都在现货里;分开账户要加上合约账户可提的部分
  const perp = unified ? 0 : num(ch.withdrawable);
  const positions = (ch.assetPositions || []).length;
  const others = Object.entries(bal).filter(([c, v]) => !["USDC", "USDH"].includes(c) && v > 0).map(([c]) => c);

  let bid = null;
  if (usdh >= 0.01) {
    const book = await info({ type: "l2Book", coin: USDH_PAIR });
    bid = num(book?.levels?.[0]?.[0]?.px) || null;
  }
  const usdhSell = floorTo(usdh, 2);
  const usdhValue = usdhSell * (bid || 1);
  const canSell = usdhSell >= 0.01 && usdhValue >= MIN_ORDER_USD && bid !== null && bid >= FLOOR_PRICE;
  const proceeds = canSell ? usdhSell * bid * (1 - TAKER_FEE) : 0;
  const spotAfter = spotUsdc + proceeds;
  const withdrawAmt = perp + spotAfter;
  const arrive = withdrawAmt - WITHDRAW_FEE;

  const warnings = [];
  if (positions) warnings.push(`你还有 ${positions} 个持仓:先在官网平仓,这份指南不包括平仓`);
  if (usdhSell >= 0.01 && usdhValue < MIN_ORDER_USD) warnings.push("USDH 不到 10 美元,可能低于最小下单额,卖不出去");
  if (usdhSell >= 0.01 && bid !== null && bid < FLOOR_PRICE) warnings.push(`USDH 现在的买价 ${bid} 低于 0.995:先别卖,停下来问我们`);
  if (others.length) warnings.push(`现货里还有 ${others.join("、")},这份指南没写怎么卖`);

  const lines = [];
  if (perp >= 0.01) lines.push(`合约账户 ${fmt(perp)} USDC`);
  if (spotUsdc >= 0.01) lines.push(`${unified ? "账户" : "现货"} ${fmt(spotUsdc)} USDC`);
  if (usdh >= 0.01) lines.push(`现货 ${fmt(usdh)} USDH${bid ? `(买价约 ${bid})` : ""}`);

  const status = arrive >= 0.2 ? "found" : (withdrawAmt > 0.01 || usdh >= 0.01) ? "dust" : "empty";
  return {
    status,
    usd: Math.max(arrive, 0),
    lines,
    warnings,
    note: status === "dust" ? "有余额,但不够付 1 USDC 提现手续费" : unified ? "统一账户:不用划转,卖完直接提" : "分开账户:卖完要先把现货 USDC 划到合约账户",
    flags: { needsSell: canSell, needsTransfer: !unified && spotAfter >= 0.01 },
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
