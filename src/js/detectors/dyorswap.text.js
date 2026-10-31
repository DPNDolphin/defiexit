// DYORSwap 检测器给用户看的话,中英两套。数字由 dyorswap.js 算好、格式化好再传进来。
// 英文按英文习惯写,不逐字对译;两边的意思(尤其是滑点、手续费这类提醒)必须一致。
export const TEXT = {
  zh: {
    row: {
      usdt: "能撤回的 USDT",
      okb: "能撤回的 OKB",
      about: (usd) => `约 $${usd}`,
      noPrice: "美元价暂时查不到",
    },
    total: "能取回约",
    line: {
      lp: (x) => `DYORSwap USDT/OKB 池子里能撤回:${x}`,
      none: "DYORSwap USDT/OKB 池子里:这个地址没有 LP",
      approval: "当初加流动性时给 DYORSwap 路由的 USDT 授权还在",
      gas: (x) => `钱包 X Layer 上的 OKB(付手续费用):${x}`,
    },
    warn: {
      slip: (x) => `这个池子现在真实能拿回的比网页算的少 ${x}%,这份指南里的 1% 滑点可能不够,撤出会失败。钱不会丢:先别照做,点右上角「遇到问题」把卡点报告发给我们`,
      lowGas: (x) => `钱包 X Layer 上的 OKB 只有 ${x},可能不够付手续费。先往这个地址的 X Layer 转一点 OKB(0.001 就够)`,
    },
    // 现场诊断:head 是一句话结论,say 是详细说明
    head: {
      "in-pool": "钱包里还有这个池子的 LP",
      partial: "已经撤出一部分",
      "need-slip": "先别照做",
      "low-gas": "先补一点 OKB 付手续费",
      arrived: "钱已经到账了",
      "no-lp": "现在没有这个池子的 LP 了",
      "old-approval": "还有一笔旧授权可以取消",
      nothing: "没查到这个池子的 LP",
    },
    say: {
      inPool: (x) => `钱包里还有这个池子的 LP,现在能撤回 ${x}。链上看不出你做到了哪一步:没做完的接着照指南走;刚点了确认的先等 1 分钟,别重复点;点 Confirm 时页面报错的,看下面的常见情况。`,
      partial: (done, left) => `最近几分钟撤出过一笔,到账 ${done}。钱包里还有 LP,现在能撤回 ${left}。要全部撤完就再走一遍;不撤也行,钱还是你的。`,
      lowGas: (x) => `钱包 X Layer 上的 OKB 只有 ${x}。撤出要付一点手续费(不到 0.01 美元),先往这个地址的 X Layer 转一点 OKB(0.001 就够),再回来。`,
      arrived: (list) => `已经到账:${list}。这个池子里你的 LP 已经撤完了。`,
      noLp: "这个地址现在没有这个池子的 LP,以前用签名撤过。到账情况这次没查到(我们只查得到最近几分钟的撤出记录):去 OKX App 钱包首页 → 币种 → OKB 或 USDT → 交易历史 看。",
      approval: "当初加流动性时给 DYORSwap 路由 0x1E69…6036 的 USDT 授权还在。留着没用,在钱包首页的「授权」里取消(要一点手续费);不取消钱也不会少。",
      nothing: "这个地址在 DYORSwap 的 USDT/OKB 池子里没有 LP。看看是不是换了账户:OKX 钱包里可能有好几个账户。放在别的池子里的,这份指南没有核对过。",
    },
    arr: {
      list: (items) => items.map((x) => `${x.amount} ${x.sym}`).join("、"),
      item: (x, sym) => `${x} ${sym} 来自 DYORSwap 路由合约 0x1E69…6036`,
    },
  },

  en: {
    row: {
      usdt: "USDT you can withdraw",
      okb: "OKB you can withdraw",
      about: (usd) => `about $${usd}`,
      noPrice: "USD price unavailable right now",
    },
    total: "You can get back about",
    line: {
      lp: (x) => `In DYORSwap's USDT/OKB pool, you can withdraw: ${x}`,
      none: "DYORSwap USDT/OKB pool: no LP at this address",
      approval: "The USDT approval you gave DYORSwap's router when adding liquidity is still active",
      gas: (x) => `OKB in the wallet on X Layer (for fees): ${x}`,
    },
    warn: {
      slip: (x) => `This pool currently pays out ${x}% less than the site estimates, so the 1% slippage in this guide may not be enough and the withdrawal would fail. Your money is safe: don't follow the guide for now. Tap Stuck? at the top right and send us the report`,
      lowGas: (x) => `There's only ${x} OKB on X Layer in this wallet, which may not cover the fee. Send a little OKB to this address on X Layer first (0.001 is plenty)`,
    },
    head: {
      "in-pool": "You still hold LP in this pool",
      partial: "Part of it is out",
      "need-slip": "Don't follow the guide for now",
      "low-gas": "Top up a little OKB for the fee first",
      arrived: "It's arrived",
      "no-lp": "No LP in this pool right now",
      "old-approval": "There's an old approval you can cancel",
      nothing: "No LP found in this pool",
    },
    say: {
      inPool: (x) => `You still hold LP in this pool, and you can withdraw ${x} right now. The chain can't show how far you got: if you haven't finished, keep following the guide; if you just confirmed, wait a minute and don't tap again; if the page showed an error at Confirm, see the common situations below.`,
      partial: (done, left) => `A withdrawal went through in the last few minutes: ${done} arrived. You still hold LP and can withdraw ${left} right now. To take it all out, go through the guide again; or leave it, it's still yours.`,
      lowGas: (x) => `There's only ${x} OKB on X Layer in this wallet. Withdrawing needs a small fee (under $0.01), so send a little OKB to this address on X Layer first (0.001 is plenty), then come back.`,
      arrived: (list) => `Arrived: ${list}. Your LP in this pool is fully withdrawn.`,
      noLp: "This address has no LP in this pool right now, and it has withdrawn with a signature before. We couldn't confirm what arrived (we can only see withdrawals from the last few minutes): in the OKX app, open OKB or USDT in your wallet and look in its transaction history.",
      approval: "The USDT approval you gave DYORSwap's router 0x1E69…6036 when adding liquidity is still active. You don't need it any more: cancel it under the approvals tab on your wallet home (it costs a small fee). Your money is safe either way.",
      nothing: "This address has no LP in DYORSwap's USDT/OKB pool. Check you're on the right account: an OKX wallet can hold several. This guide hasn't been checked for other pools.",
    },
    arr: {
      list: (items) => items.map((x) => `${x.amount} ${x.sym}`).join(", "),
      item: (x, sym) => `${x} ${sym} from DYORSwap's router contract 0x1E69…6036`,
    },
  },
};
