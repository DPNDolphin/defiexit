// X Layer 上两类我们核对过的项目仓位:取回弹层里的专门取法(中英两套)。
// 网址、按钮名字、合约地址、弹窗里该看到的东西,2026-10-30 对着官网页面、前端代码和链上合约核对过;
// 手机钱包里的界面还没逐屏看过,所以是文字版,一步一图的版本另做。
// 参数 v:{ ready 到没到期, date 到期时间(已按用户所在时区排好), got 预计到账(如「0.5 OKB」) }
export const HOW = {
  zh: {
    "okx-boost": (v) => ({
      title: "取回 OKX Boost 里锁着的币",
      note: `Plasma X Launch 活动时锁的 · ${v.date} ${v.ready ? "已到期" : "到期"}`,
      status: v.ready ? { ok: true, head: `${v.date} 已到期,现在就能取`, text: "过期多久都能取,合约没有截止日期。" }
        : { ok: false, head: `还要等到 ${v.date}`, text: "到期前点了也取不出来。" },
      lead: "参加 OKX Boost「Plasma X Launch」活动时,要在 X Layer 上锁一笔币,锁 2 天。到期后不会自动退回,要自己点「解除质押」。锁仓合约的源码在 OKX 浏览器上验证过,没有管理员,钱只能回到你自己的地址。",
      steps: [
        { text: "用连着这个地址的钱包,打开 OKX Boost 的活动页。也可以在 Boost「奖励中心」→「X Launch 奖励」里找到「Plasma X Launch」,点「查看详情」。", copy: "https://web3.okx.com/zh-hans/boost/x-launch/plasma" },
        "连接钱包,页面往下找到「质押详情」,点右边的「解除质押」。",
        "钱包弹出确认,核对:交互的合约是 0xDA63…FD2b(OKX Boost);转出金额是 0 OKB;不需要授权。对不上就点拒绝。",
        `到账:钱包里 X Layer 上多出 ${v.got}(取回的是 OKB 本身,不是 WOKB)。回到这里点「重新查一遍」。`,
      ],
    }),
    dyorswap: (v) => ({
      title: "取回 DYORSwap 里的流动性",
      note: "USDT_Bridged / WOKB 池子 · LP 在你钱包里",
      warn: "DYORSwap 在 2026 年 9 月误接了一条假冒的链,有人经假跨链桥被骗(它自己的合约没被攻击)。只用 dyorswap.finance,网络选 X Layer,不要点 Bridge。",
      lead: "这是你在 DYORSwap(PancakeSwap 的分叉)USDT_Bridged / WOKB 池子里放的流动性。撤出要在钱包里确认两次:先签一次名,授权这一次要撤的 LP;再发一笔交易。",
      steps: [
        { text: "用连着这个地址的钱包打开下面的网址,连接钱包,网络选 X Layer。", copy: "https://dyorswap.finance/liquidity/?chainId=196" },
        "在「Your Liquidity」里找到 USDT/OKB,展开,点「Remove」。",
        "点「Max」。收币保持默认:USDT 和 OKB 两种都收,不要切成只收一种。",
        "点「Enable」:钱包弹出签名(Permit),核对:合约是 DYOR LPs(0x35c1…cD25),授权给 0x1E69…6036(DYORSwap 的路由),数量就是这次要撤的 LP。",
        `点「Remove」:钱包弹出交易,核对:发给 0x1E69…6036,转出金额是 0 OKB。到账约 ${v.got},以弹窗里的为准。`,
        "收尾:到钱包的授权管理里,把当初加流动性时给 0x1E69…6036 的 USDT 授权取消。",
      ],
      after: "撤出来的 USDT_Bridged 是 X Layer 上的旧版 USDT,OKX 在逐步淘汰;想换成新的 USDT0,可以充到 OKX 交易所再提出来。",
    }),
    foot: "这份取法对着官网页面和合约核对过,是文字版;手机上一步一图的版本在做。",
  },
  en: {
    "okx-boost": (v) => ({
      title: "Get your locked tokens out of OKX Boost",
      note: `Locked for Plasma X Launch · ${v.ready ? "unlocked since" : "unlocks"} ${v.date}`,
      status: v.ready ? { ok: true, head: `Unlocked since ${v.date}, ready to withdraw`, text: "There's no deadline: it can be withdrawn any time after unlocking." }
        : { ok: false, head: `Unlocks on ${v.date}`, text: "Nothing comes out before then." },
      lead: "To join OKX Boost's Plasma X Launch you had to lock tokens on X Layer for 2 days. They don't come back on their own: you have to tap Unstake. The lock contract's source is verified on the OKX explorer, it has no admin, and funds can only go back to your own address.",
      steps: [
        { text: "Open the OKX Boost campaign page in the wallet that holds this address. You can also find Plasma X Launch under Boost > Rewards center > X Launch rewards and tap View details.", copy: "https://web3.okx.com/boost/x-launch/plasma" },
        "Connect your wallet, scroll down to Staking details and tap Unstake on the right.",
        "When your wallet asks you to confirm, check: the contract is 0xDA63…FD2b (OKX Boost), the amount sent is 0 OKB, and no approval is needed. If anything doesn't match, reject it.",
        `Arrival: ${v.got} shows up in your wallet on X Layer (as OKB itself, not WOKB). Come back here and tap Check again.`,
      ],
    }),
    dyorswap: (v) => ({
      title: "Get your liquidity out of DYORSwap",
      note: "USDT_Bridged / WOKB pool · LP tokens in your wallet",
      warn: "In September 2026 DYORSwap mistakenly listed a fake chain and users lost funds through a fake bridge (DYORSwap's own contracts weren't hacked). Only use dyorswap.finance, pick the X Layer network, and don't tap Bridge.",
      lead: "This is liquidity you added to the USDT_Bridged / WOKB pool on DYORSwap (a PancakeSwap fork). Withdrawing takes two confirmations in your wallet: first a signature that approves just the LP you're withdrawing, then a transaction.",
      steps: [
        { text: "Open this link in the wallet that holds your address, connect, and pick the X Layer network.", copy: "https://dyorswap.finance/liquidity/?chainId=196" },
        "Under Your Liquidity, find USDT/OKB, expand it and tap Remove.",
        "Tap Max. Keep the default of receiving both USDT and OKB; don't switch to a single token.",
        "Tap Enable. Your wallet asks for a signature (Permit). Check: the contract is DYOR LPs (0x35c1…cD25), the spender is 0x1E69…6036 (the DYORSwap router), and the amount is the LP you're withdrawing.",
        `Tap Remove. Your wallet asks you to confirm a transaction. Check: it goes to 0x1E69…6036 and sends 0 OKB. You should get about ${v.got}; the popup has the exact numbers.`,
        "To finish, open your wallet's approval manager and revoke the USDT approval you gave 0x1E69…6036 when you added liquidity.",
      ],
      after: "The USDT_Bridged you get back is X Layer's old USDT, which OKX is phasing out. To switch to the new USDT0, deposit it to the OKX exchange and withdraw it again.",
    }),
    foot: "These steps were checked against the official site and the contracts. This is the text version; a step-by-step version with phone screenshots is in progress.",
  },
};
