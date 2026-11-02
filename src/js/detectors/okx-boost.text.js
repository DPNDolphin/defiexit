// OKX Boost 检测器给用户看的话,中英两套。数字由 okx-boost.js 算好、格式化好再传进来。
// 英文按英文习惯写,不逐字对译;两边的意思(尤其是「先补一点 OKB」这类提醒)必须一致。
export const TEXT = {
  zh: {
    row: {
      locked: (sym) => `锁着的 ${sym}`,
      end: "到期",
      ready: "已到期,现在就能取",
      wait: "还没到期,到期前取不出来",
      about: (usd) => `约 $${usd}`,
      noPrice: "美元价暂时查不到",
    },
    total: "能取回约",
    line: {
      lock: (list) => `OKX Boost 锁仓合约 0xDA63…FD2b(Plasma X Launch)里:${list}`,
      none: "OKX Boost 锁仓合约 0xDA63…FD2b(Plasma X Launch)里:没有锁着的币",
      done: (syms) => `锁过 ${syms},现在已经是 0(取出来了)`,
      end: (d, ready) => `到期:${d}${ready ? "(已到期)" : "(还没到期)"}`,
      gas: (x) => `钱包 X Layer 上的 OKB(付手续费用):${x}`,
    },
    warn: {
      notYet: (d) => `还没到期:${d} 之后才能取`,
      lowGas: (x) => `钱包 X Layer 上的 OKB 只有 ${x},可能不够付手续费。先往这个地址的 X Layer 转一点 OKB(0.001 就够)`,
    },
    // 现场诊断:head 是一句话结论,say 是详细说明
    head: {
      "can-unstake": "币还锁在 OKX Boost 里",
      "not-yet": "还没到期",
      "low-gas": "先补一点 OKB 付手续费",
      arrived: "钱已经到账了",
      withdrawn: "已经取出来了",
      nothing: "没查到锁着的币",
    },
    say: {
      unstake: (x) => `还有 ${x} 锁在 OKX Boost 的锁仓合约里,已经到期。在 OKX App 的活动页往下滑到「质押详情」,点「解除质押」。`,
      notYet: (d) => `锁着的币要到 ${d} 才到期,到期前点了也取不出来。`,
      lowGas: (x) => `钱包 X Layer 上的 OKB 只有 ${x}。解除质押要付一点手续费(不到 0.01 美元),先往这个地址的 X Layer 转一点 OKB(0.001 就够),再回来。`,
      arrived: (list) => `已经到账:${list}。OKX Boost 里能取的都取完了。`,
      withdrawn: (syms) => `锁仓合约里你的 ${syms} 已经是 0,而且锁仓记录还在:说明已经解除质押取走了(只有你自己能取,钱只会回到你自己的地址)。具体数量和时间这次没查到;去 OKX App 钱包首页 → 币种 → ${syms} → 交易历史,找「解除质押 · OKX Boost」。`,
      nothing: "这个地址在 OKX Boost「Plasma X Launch」里没有锁过币。看看是不是换了账户:OKX 钱包里可能有好几个账户。",
    },
    arr: {
      list: (items) => items.map((x) => `${x.amount} ${x.sym}`).join("、"),
      item: (x, sym) => `${x} ${sym} 来自 OKX Boost 锁仓合约 0xDA63…FD2b`,
    },
  },

  en: {
    row: {
      locked: (sym) => `Locked ${sym}`,
      end: "Unlocks",
      ready: "Unlocked, ready to withdraw",
      wait: "Still locked, nothing comes out before then",
      about: (usd) => `about $${usd}`,
      noPrice: "USD price unavailable right now",
    },
    total: "You can get back about",
    line: {
      lock: (list) => `OKX Boost lock contract 0xDA63…FD2b (Plasma X Launch): ${list}`,
      none: "OKX Boost lock contract 0xDA63…FD2b (Plasma X Launch): nothing locked",
      done: (syms) => `Had ${syms} locked, now 0 (withdrawn)`,
      end: (d, ready) => `Unlocks: ${d}${ready ? " (unlocked)" : " (still locked)"}`,
      gas: (x) => `OKB in the wallet on X Layer (for fees): ${x}`,
    },
    warn: {
      notYet: (d) => `Still locked: it can be withdrawn after ${d}`,
      lowGas: (x) => `There's only ${x} OKB on X Layer in this wallet, which may not cover the fee. Send a little OKB to this address on X Layer first (0.001 is plenty)`,
    },
    head: {
      "can-unstake": "Your tokens are still locked in OKX Boost",
      "not-yet": "Not unlocked yet",
      "low-gas": "Top up a little OKB for the fee first",
      arrived: "It's arrived",
      withdrawn: "Already withdrawn",
      nothing: "Nothing locked here",
    },
    say: {
      unstake: (x) => `${x} is still in OKX Boost's lock contract, and it has unlocked. In the OKX app, open the campaign page, scroll down to the staking details and tap the unstake button.`,
      notYet: (d) => `Your tokens unlock on ${d}. Tapping Unstake before then gets nothing out.`,
      lowGas: (x) => `There's only ${x} OKB on X Layer in this wallet. Unstaking needs a small fee (under $0.01), so send a little OKB to this address on X Layer first (0.001 is plenty), then come back.`,
      arrived: (list) => `Arrived: ${list}. Everything you had in OKX Boost is out.`,
      withdrawn: (syms) => `Your ${syms} in the lock contract is now 0 and the lock record is still there, so it was unstaked (only you can do that, and the money only goes back to your own address). The exact amount and time weren't found this time: in the OKX app, open ${syms} in your wallet and look in its transaction history for the unstake from OKX Boost.`,
      nothing: "This address has nothing locked in OKX Boost's Plasma X Launch. Check you're on the right account: an OKX wallet can hold several.",
    },
    arr: {
      list: (items) => items.map((x) => `${x.amount} ${x.sym}`).join(", "),
      item: (x, sym) => `${x} ${sym} from OKX Boost's lock contract 0xDA63…FD2b`,
    },
  },
};
