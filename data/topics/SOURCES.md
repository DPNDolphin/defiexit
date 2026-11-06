# 专题出处表

查于 2026-11-05。每条说法后面是它的官方出处。

- X 帖：都用 api.fxtwitter.com/2/status/<编号>（线程用 /2/conversation/<编号>）读过，核对了作者账号和发帖时间（UTC）。
- 网页：当天打开读过原文。docs.scroll.io 本机连不上（超时），docs.eigencloud.xyz 对程序返回 403，这两家改读官方 GitHub 上的文档源文件，出处给的是 GitHub 链接。
- 只收官方出处：项目自己的文档、博客、X 账号、帮助中心；骗局专题另收 MetaMask 帮助中心、以太坊官网、美国 FBI 的 IC3 公告。
- 页面里没有钱包地址，也没有合约地址。

## 1. l2-withdrawal-wait · 从 L2 提回以太坊为什么要等

- OP Mainnet 标准桥提款要等 7 天挑战期，之后才能在以太坊上领 → <https://docs.optimism.io/op-mainnet/network-information/transaction-finality>（原文："Withdrawals of ETH and ERC-20 tokens through the Standard Bridge wait a 7-day challenge period before the funds can be claimed on Ethereum."）
- OP 三步：L2 发起、L1 证明、挑战期后 L1 完成；等待期从你的证明交易起算；重新证明会重新计时 → <https://docs.optimism.io/op-stack/bridging/withdrawal-flow>（"the proof maturity delay still runs from your prove transaction"；"re-proving resets the proof timer"；"7 days on mainnet"）
- 等待无法绕过；以太坊上的证明和完成两笔通常比 L2 发起那笔贵得多；挑战期是留给 fault proof 挑错的时间 → <https://docs.optimism.io/app-developers/guides/bridging/messaging>（"This waiting period is a core part of the security model of the OP Stack and cannot be circumvented."）
- Base：单证明 5 天，TEE + ZK 双证明 1 天；状态提交到以太坊通常还要 20–60 分钟；三步流程；重新证明会重置时间；第三方快速桥不缩短官方窗口 → <https://docs.base.org/specifications/base-protocol/bridging/withdrawals>
- Base：单证明窗口由 7 天改为 5 天（Beryl 升级） → <https://docs.base.org/upgrades/beryl/reducing-canonical-withdrawal-delay>
- Beryl 在 Base 主网 2026-06-25 生效 → <https://docs.base.org/upgrades/overview>
- Arbitrum：至少 7 天；倒计时显示 7–8 天；点右上角头像 → Transactions 里 Claim → <https://docs.arbitrum.io/arbitrum-bridge/quickstart>
- Arbitrum：官方桥约一周；挑战期 45818 个区块约 6.4 天，前后还有处理时间；有争议会延长；提款发起后不能取消；合约钱包的提款可能不出现在记录里，可按交易哈希搜 → <https://docs.arbitrum.io/arbitrum-bridge/troubleshooting>
- Arbitrum：确认后只是可以领取，Claim 不会自动执行，可以一直放着；BoLD 下诚实的提款最多再多等一个挑战期；L3 提回以太坊是两段，默认设置最慢约两周 → <https://docs.arbitrum.io/arbitrum-bridge/withdrawal-monitoring>
- zkSync：时间锁由 21 小时降到最少 3 小时（ZIP-4）；不保证 3 小时，忙时多 1–2 小时；提款到账在 Etherscan 的 Internal Transactions 里 → <https://docs.zksync.io/zksync-protocol/security/withdrawal-delay>
- zkSync：提款在 L1 上可由任何人完成（finalizeWithdrawal）；测试网不会自动完成；主网是否自动完成，文档没写 → <https://docs.zksync.io/zksync-protocol/rollup/bridging-assets>
- zkSync：证明约 1 小时，整体约 3 小时 → <https://docs.zksync.io/zksync-protocol/rollup/finality>
- Linea：ETH 和 ERC-20 从 L2 回 L1 约 2–12 小时；L2 → L1 必须手动 Claim；交易记录标「Ready to claim」；防 DDoS 费 0.001 ETH；超过 90 天不再显示在官方桥 → <https://docs.linea.build/network/how-to/bridge>
- Linea：ZK 证明在以太坊上验证 → <https://docs.linea.build/network/overview/transaction-finality>
- Scroll：L2 → L1 要在以太坊上提交「Execute Withdrawal」交易（relayMessageWithProof），先等批次完成确认 → <https://github.com/scroll-tech/scroll-documentation/blob/develop/src/content/docs/en/developers/l1-and-l2-bridging/the-scroll-messenger.mdx>（站点地址 <https://docs.scroll.io/en/developers/l1-and-l2-bridging/the-scroll-messenger/>）
- Scroll：有效性证明在以太坊上验证 → <https://github.com/scroll-tech/scroll-documentation/blob/develop/src/content/docs/en/technology/index.mdx>
- Sophon：官方通道提款不是即时的，时间会变，以门户状态为准，最后在以太坊上提交 Claim → <https://docs.sophon.xyz/discover/bridging/withdrawal-delay>
- Sophon：门户通过 Jumper 给出可选路线 → <https://docs.sophon.xyz/discover/bridging/bridging-faqs>
- Sophon：11-25 提款截止，11-30 主网最终关停 → <https://x.com/Sophon/status/2112253259561730145>（@Sophon，2026-10-19 18:43 UTC）
- Lisk："A withdrawal isn't complete until it's claimed." → <https://x.com/Lisk/status/2116893926560833904>（@Lisk，2026-11-01 14:03 UTC）
- Lisk：关链时在途的提款会记到以太坊上的目标地址 → <https://x.com/Lisk/status/2117570140808106069>（@Lisk，2026-11-03 10:50 UTC）
- Blast 取回站包括「没走完的提款」 → <https://blast.io/>
- Horizen：11-04 前通过官方桥发起的 ETH 提款由官方替你完成，约两周后到 Base → <https://blog.horizen.io/changes-for-horizen>（2026-10-23）

查到但没写进去的：

- Scroll 旧版用户指南写「最多四小时」再点 Claim：这一节已在 2025-10-22 从官方文档删除（commit 54611a06「Removing sections」），不算现行官方说法，页面写「现行官方文档没写要等多久」。
- zkSync 主网是否由官方自动完成最后一步：只找到 storj 论坛转贴的 Discord 公告（「3 月 31 日后 Matter Labs 不再代付 Claim 费用」），年份不明，不是官方页面，没用；页面写「官方文档没写」。
- OP Mainnet 发起后多久能证明：OP 文档只说要等这一段提交到以太坊，没给时长，所以没写数字（20–60 分钟是 Base 官方给的数）。
- Scroll 转许可制网络的提案（forum.scroll.io/t/1513，2026-11-03）：还没投票，和等待时间无关，没写。
- 搜索结果里「zkSync 约 24 小时」「zkSync 要 7 天」等说法：过时或不是官方，没用。
- 任务说明里写的「Base 约 7 天」：Base 官方文档已改为 5 天（或 1 天），页面按新数写。

## 2. chain-shutdown · 链要关停了，钱怎么取

- Sophon：11-30 主网最终关停 → <https://x.com/Sophon/status/2112253258030882831>（1/4，@Sophon，2026-10-19 18:43 UTC）
- Sophon：11-25 提款截止；之后关键基础设施和相关网站开始关闭；截止后留在链上的资产有永久无法访问的风险 → <https://x.com/Sophon/status/2112253259561730145>（2/4）
- Sophon：用 claim.sophon.com 提走 SOPH、ETH、USDC；领没领的质押和 Guardian 奖励；Farm 资产也要取出 → <https://x.com/Sophon/status/2112253261940203629>（3/4）
- Sophon："Nov 25 is the date to act, not Nov 30." 和 "use only official Sophon links and be careful of fake migration sites." → <https://x.com/Sophon/status/2112253264179998909>（4/4）
- Sophon："Sophon isn't shutting down. $SOPH remains." → <https://x.com/Sophon/status/2117352374679244928>（@Sophon，2026-11-02 20:25 UTC）
- Sophon：SOPH 原生在以太坊；Guardian NFT、vSOPH、已质押 SOPH 自动转到以太坊；2026-06-25 起停止新的存入 → <https://docs.sophon.xyz/migration>
- Abstract：2026-12-15 关停，没跨走的资金 "will be inaccessible"；迁移页 migrate.abs.xyz、原生桥 native-bridge.abs.xyz（约 3 小时延迟）；提醒冒充、假迁移网站和私信；只用官方链接并到 Discord 等渠道交叉核对 → <https://x.com/AbstractChain/status/2107554632675340420>（X 文章，@AbstractChain，2026-10-06 19:32 UTC）
- Horizen：11-04 13:00 UTC 桥关闭并拍快照；截止定在硬关停前一天，让快照干净、没有在途转账；先取出质押再领奖励；缺 gas 从 Base 存最小量的 ETH；0.001 ETH 以下不退；USDC.e 由 Stargate 运营，不在 DAO 退还范围；合约钱包写信给官方安全邮箱；DAO 在快照公开审查一周后，把 ZEN（含没领的质押奖励）和超过 0.001 的 ETH 发回 Base 上的同一地址，预计 11 月下半月 → <https://blog.horizen.io/changes-for-horizen>（2026-10-23）
- Horizen：11-04 当天提醒 13:00 UTC 桥关闭，USDC.e 不在 DAO 退还范围 → <https://x.com/horizenglobal/status/2117915509706653895>（@horizenglobal，2026-11-04 09:43 UTC）
- Blast：L2 已关停；取回站 blast.io 开 12 个月，最后支持日 2027-11-04 → <https://x.com/blast/status/2117993462356197406>（@blast，2026-11-04 14:52 UTC）
- Blast：ETH、WETH、USDB 和没走完的提款在以太坊主网上领；Safe 等智能钱包的所有者可以替钱包领；Blast Mobile 用户把助记词导入 MetaMask 或 Rabby；"Only ever type your seed phrase into your wallet app, never into a website." → <https://blast.io/>
- Lisk：2026-11-02 关停，门户和桥关闭 → <https://lisk.com/blog/posts/lisk-chain-has-closed/>
- Lisk：计划 2027 年 1 月推出人工申领流程；以太坊或交易所上的 LSK 不受影响 → <https://support.lisk.com/faq/lisk-chain-claims>
- Lisk：正在做专门的智能合约；在途提款记到以太坊目标地址 → <https://x.com/Lisk/status/2117570140808106069>
- 恶意批准的典型手法包括截止日带来的时间压力 → <https://support.metamask.io/stay-safe/safety-in-web3/what-is-a-token-approval/>
- 让你点链接「验证」账户、制造紧迫感的消息是常见骗局 → <https://support.metamask.io/stay-safe/safety-in-web3/what-are-metamasks-official-support-channels/>
- OP Mainnet 一般要 7 天（FAQ 里引用） → <https://docs.optimism.io/op-mainnet/network-information/transaction-finality>

查到但没写进去的：

- Sophon 文档的迁移指南和 FAQ 还写着「没有固定关停日」：比 10-19 的官方 X 时间线旧，日期按 X 帖写。
- Sophon 的领取域名：另一窗口记录 10-22 的官方帖里出现过 claim.sophon.xyz；文档和 10-19、11-02 的帖子都是 claim.sophon.com，页面只写 .com。
- Lisk 原定 10-31 关链（KuCoin 快讯、早先的博客）：实际日期按 Lisk 官方博客和帮助中心写 11-02。
- Harmony「多签、LP、链上应用里的钱不能迁」：原 X 文章现在经 fxtwitter 读不到正文，没核实，没写。
- Silicon、Neon EVM、ZKsync Lite、Polygon zkEVM 等其他关停或取回安排：不在本次核实范围，没写。
- Abstract「先从应用撤出再跨链」：迁移页和 X 文章原文都没这一句（只出现在另一窗口的笔记里），没算作 Abstract 的说法。
- Lisk「不会主动联系你帮你取回」：没找到官方原文，没写。

## 3. unstake-wait · 解除质押要等多久

- EigenLayer：MIN_WITHDRAWAL_DELAY_BLOCKS 主网 100800 个区块（14 天）；完成时可能因罚没少拿；排队中的份额仍可被罚没 → <https://github.com/Layr-Labs/eigenlayer-contracts/blob/main/docs/core/DelegationManager.md>
- EigenLayer：Unstake → 托管期 → 在「Available to Withdraw」点 Withdraw → 签名；官方 App 是 app.eigenlayer.xyz → <https://github.com/Layr-Labs/eigencloud-docs/blob/main/docs/eigenlayer/restakers/restaking-guides/0-restaking-user-guide/liquid-restaking/withdraw-from-eigenlayer.md>
- EigenLayer：主网上流动性代币和原生再质押都是 14 天托管期 → <https://github.com/Layr-Labs/eigencloud-docs/blob/main/docs/eigenlayer/restakers/restaking-guides/testnet/README.md>
- EigenLayer：提款延迟是应对漏洞披露或异常的安全措施 → <https://github.com/Layr-Labs/eigencloud-docs/blob/main/docs/eigenlayer/security/withdrawal-delay.md>
- EigenLayer 原生再质押：退出队列通常不到 1 天，极端拥堵时没有上限；固定 256 个 epoch（约 27 小时）；轮询 0–9.1 天 → <https://github.com/Layr-Labs/eigencloud-docs/blob/main/docs/eigenlayer/restakers/concepts/native-restaking-withdrawal-delays.md>
- EigenLayer：App 有问题时可在 Etherscan 上调用委托合约手动完成；只适合熟悉合约的人；要付 gas；不满 14 天会失败 → <https://github.com/Layr-Labs/eigencloud-docs/blob/main/docs/eigenlayer/restakers/restaking-guides/withdraw-using-smart-contract.md>
- Lido：正常 1–5 天；提交后在 Claim 页看预计时间；影响因素有队列、Bunker 模式、信标链退出队列、需求 → <https://help.lido.fi/en/articles/7858315-how-long-does-an-ethereum-withdrawal-take>
- Lido：两步（Request、Claim）；可领的数可能因罚没和惩罚少于申请数 → <https://help.lido.fi/en/articles/7858292-faq-ethereum-withdrawals>
- Lido：1–5 天；不想等可以经去中心化交易所或聚合器即时换 → <https://help.lido.fi/en/articles/7858323-how-do-i-unstake-my-steth>
- Lido：提款 NFT 可以转让，转出后你就不能领 → <https://help.lido.fi/en/articles/7858352-how-do-lido-withdrawal-nfts-work>
- Ethena：冷却期 "dynamic (currently between 1 and 7 days)"，由治理设定 → <https://docs.ethena.fi/video-guides/how-to-stake-usde>
- Ethena：冷却期间 USDe 放在 USDeSilo 合约，结束后提取；冷却前如有外部市场可以卖 sUSDe，官方不建市场、不保证有 → <https://docs.ethena.fi/technical-design/staking-usde>
- Ethena：setCooldownDuration 上限 90 天 → <https://docs.ethena.fi/technical-design/staking-usde/staking-key-functions>
- ether.fi：赎回时间取决于协议流动性、以太坊验证者提款和网络状况 → <https://etherfi.gitbook.io/etherfi/products/staking/eeth>
- ether.fi：立即赎回（流动性够时，扣小额退出费）；排队提款（不收费，得到 WithdrawRequestNFT，处理完再领） → <https://etherfi.gitbook.io/etherfi/developers/contracts-and-integrations/integration-guide>
- ether.fi：二级市场有流动性，不保证 weETH 总按赎回价成交 → <https://etherfi.gitbook.io/etherfi/resources/ether.fi-whitepaper/ether.fi-staking>
- Rocket Pool：直接换回 ETH 只在存款池 ETH 够时可行；不够时去去中心化交易所，可能有小额溢价 → <https://docs.rocketpool.net/liquid-staking/overview>
- Rocket Pool：协议路线即时；流动性不足时显示「Insufficient liquidity」并自动改走第三方 CoW Swap → <https://docs.rocketpool.net/liquid-staking/via-rp>

查到但没写进去的：

- EigenLayer 原生再质押「总共 8–17 天」：官方这个估算按旧的 7 天托管期算，同页又写托管期已改为 14 天，所以页面只列各段，没写总数。
- ether.fi 一般要几天：官方没写数字，没写。
- Rocket Pool 是否有新的排队机制：官方流动性质押页面没提，没写。
- MetaMask 帮助中心说 Lido「几天到几周」：是钱包方的说法，不是 Lido 官方，没用。
- Ethena「只限允许的司法辖区」：和等待时间无关，没写。

## 4. scams-during-exits · 关停、迁移期间最常见的骗局

- Sophon："use only official Sophon links and be careful of fake migration sites." → <https://x.com/Sophon/status/2112253264179998909>(4/4,@Sophon,2026-10-19 18:43 UTC)
- Sophon 文档："Never follow an unsolicited claim, migration, or token-swap link." → <https://docs.sophon.xyz/discover/bridging/bridging-faqs>
- Abstract："Please beware of impersonation, fake migration sites, and DMs claiming to represent Abstract. Only use the official link and cross-check it with Discord and other official channels." → <https://x.com/AbstractChain/status/2107554632675340420>
- Horizen 安全提醒原文："Horizen team will never DM you first" / "We will never ask for private keys or seed phrases" / "We will never ask you to send your funds to us" / "If you need help, use our official Discord ticketing system"；官方渠道列表（含 X 账号） → <https://blog.horizen.io/changes-for-horizen>
- MetaMask：助记词和私钥不给任何人，包括 MetaMask 团队；只有创建钱包、恢复钱包时才输入助记词；代币批准可能被用来清空钱包 → <https://support.metamask.io/stay-safe/safety-in-web3/basic-safety-and-security-tips-for-metamask/>
- MetaMask：没有电话客服；"we will never DM you offering support"；不会在 X 上联系你的工单；假客服渠道清单（WhatsApp、Telegram、X 等）；「验证账户」类诈骗邮件 → <https://support.metamask.io/stay-safe/safety-in-web3/what-are-metamasks-official-support-channels/>
- MetaMask：批准是允许 dapp 动你的代币；permit 签名把批准和转账打包，批准本身不花 gas；先看清请求，能限额就限额；为领 NFT 空投要你 setApprovalForAll 的不要上当；恶意批准的特征含截止日带来的时间压力；批准弹窗顶部显示网站名称和网址；发现批错了尽快在 MetaMask Portfolio 撤销；钱包已被清空就很难挽回 → <https://support.metamask.io/stay-safe/safety-in-web3/what-is-a-token-approval/>
- MetaMask：空投骗局（去第三方网站「领取」时签的是让对方拿走代币的批准，或被骗输入助记词）；NFT 空投骗局，不要互动，隐藏它 → <https://support.metamask.io/stay-safe/safety-in-web3/scammers-and-phishers-rugpulls-and-airdrop-scams/>
- MetaMask：被盗后新建钱包、转走剩下的钱、停用旧钱包；怀疑有清扫脚本时别再往旧钱包转 gas；交易无法撤回 → <https://support.metamask.io/stay-safe/protect-yourself/ive-been-hacked-scammed-unauthorized-transactions-on-my-account/>
- 以太坊官网：没有任何正规服务、客服或网站会要助记词或私钥；客服骗局在公开频道找提问的人再私信；绝不让人远程访问电脑；只在机构指定的渠道沟通；空投骗局会让你连接钱包并「批准」交易 → <https://ethereum.org/security/>
- FBI：假「追回」公司会在社交媒体、私信、评论区和搜索结果里出现；先收费，然后失联，或给不完整、不准确的追踪报告再要钱；私人公司无权发扣押令；执法机构不向受害者收调查费；不要给陌生人钱和个人信息 → <https://www.ic3.gov/PSA/2023/psa230811>
- FBI：冒充律师事务所、政府机构的追回骗局 → <https://www.ic3.gov/PSA/2025/PSA250813>

查到但没写进去的：

- Lisk「不会主动联系你」：没找到官方原文，没写。
- 搜索「MetaMask 客服」时，结果里混着 sites.google.com、teachable 上的仿冒页：这是我们自己搜到的现象，不是官方出处，页面改用 FBI「骗局出现在搜索结果里」的说法。
- Blast 简介里的「官方只有 @blast」：只是账号简介，不是公告，没写。
- Cobo、Kelp 等项目的防冒充提醒：不在本次核实范围，没写。
- 专门讲「Permit 钓鱼」的官方说明：只找到 MetaMask 对 permit 的一般说明（签名就能完成批准、不花 gas），页面只写到这一层。

## 5. bridge-not-arrived · 跨链转账没到账怎么办

查于 2026-11-06。网页都用 curl（默认 User-Agent）打开读过原文；没登录、没连钱包，也没在任何查询页里输入地址或交易哈希。另一个 AI 交的线索（naki 回件 `exitclinic-20261106-0330`）只当线索，每条都回原文核过，和原文不一致的按原文写（见本节末尾）。

先认出是哪座桥：

- Relay：在别的应用或钱包里发起的，要用那个应用发出的地址去查；交易所或别的服务替你发出的，要找那家，因为发款钱包在他们手里 → <https://support.relay.link/en/articles/9260724-how-do-i-find-my-transaction>（"If you started the swap inside another app or wallet rather than on relay.link, search the address that app sent from."）；<https://support.relay.link/en/articles/15100985-how-to-withdraw-funds>（"If an exchange or another service sent the funds for you, contact that service's support: they control the sending wallet."）
- Wormhole：第三方应用或合约发起的 CCTP 转账，如果它留了领取权限（destination_caller 不是零地址），Portal 完成不了，只能回原应用 → <https://wormhole.com/docs/products/token-transfers/wrapped-token-transfers/portal/faqs/>（"it may have been initiated through a third-party app or smart contract that reserved the right to finalize it. In that case, Portal is unable to complete the redemption on your behalf. Only the original app can."）
- 「Interacted With (To)」一栏、网址看出是哪家：是通用的看法，不是哪家官方的说法，页面没挂出处。

去哪查状态、要等多久、要不要再操作一次、找谁（按桥）：

- Stargate：两种模式 Economy（Bus）和 Fast（Taxi）；可以在 Stargate 页面或 LayerZero Scan 查；Bus 要等车发出后 LayerZero 上才有记录 → <https://stargateprotocol.gitbook.io/stargate/v2-user-docs/stargate-features/transfer>（"Monitor via LayerZero Scan"；"The LayerZero transaction will become available only once the bus is dispatched."；Taxi "bypass the batching process for immediate transaction processing"）
- Stargate：车满或到最长等待时间才出发，页面显示预计等待 → <https://stargateprotocol.gitbook.io/stargate/v2-user-docs/faq>（"The estimated waiting time will be shown on UI."）
- LayerZero Scan 的网址 layerzeroscan.com → <https://docs.layerzero.network/v2/concepts/applications/stargate-finance>（"LayerZero Scan - Track transfers"）
- Stargate 官网页脚有 Support 一栏，里面的 Help Center（和 Latest updates）都链到官方 Discord 邀请；Community 一栏另列 Discord、Telegram、X；没核到单独的网页工单入口 → <https://stargate.finance/>（2026-11-06 复核网页源码："Support" → "Help Center" → discord.com/invite/…）
- Across：主网约 2 秒 → <https://docs.across.to/introduction/features>（"delivers funds on the destination chain in ~2 seconds on mainnet"；对比表里写 "Less than 2 seconds"）
- Across：过了 fillDeadline 没人接才退款；自动退回 refundAddress；"refunds can take several hours to arrive. Do not tell users to expect immediate refunds." → <https://docs.across.to/introduction/refunds>
- Across：拥堵时会更久；过期的自动退款，表头是 "Time after deposit"，从存款算起约 120–150 分钟，组成里已经包括约 90 分钟的成交期限（"Components: fill deadline (~90 min) + bundle processing (~30 min) + canonical bridge delay (~5-30 min)."），不是到期以后再等这么久；卡超过 3 小时找 Telegram、in-app support、Slack → <https://docs.across.to/introduction/faq>（"Most deposits fill in ~2 seconds, but it can take longer during congestion"；"Minimum ~120 minutes / Typical ~135 minutes / Maximum ~150 minutes"；"If stuck for >3 hours — reach out via Telegram, in-app support, or Slack"；in-app support 链到 across.to。这几段答案在页面的折叠里，网页源码里读到）
- Across：状态查询工具，按交易哈希或 Deposit ID → <https://docs.across.to/tools/status-tracker>
- Wormhole：Portal 菜单里的 Transactions 打开 Wormholescan；自动到账，不用在目标链手动 redeem → <https://wormhole.com/blog/the-portal-upgrade-is-now-live>（2024-10-03；"Selecting this option will take you to Wormholescan"；"without having to manually redeem it"）
- Wormhole（只限封装代币 WTT 路线，"WTT supports two modes of transfer"）：自动由中继提交，手动要用户或应用提交；手动的要在 24 小时内完成，过了桥守护者（Guardian Set）可能已换，签名（VAA）会被拒，要先更新签名——说的是桥的签名，不是钱包授权 → <https://wormhole.com/docs/products/token-transfers/wrapped-token-transfers/concepts/transfer-flow/>（"The user who initiated the transfer must complete it within 24 hours for manual transfers. Guardian Sets are guaranteed to be valid for at least that long."）
- Wormhole（同样是 WTT 指南）：看起来卡住或没自动完成的，可以用源链交易哈希手动恢复；以太坊最终确认最多约 20 分钟 → <https://wormhole.com/docs/products/token-transfers/wrapped-token-transfers/guides/transfer-wrapped-assets/>（"Wait up to 20 minutes for Ethereum finality before attempting recovery"。官方给的恢复办法是下载脚本自己跑，属于开发者操作；页面写明「官方另给了一个开发者用的恢复脚本」，没教脚本，20 分钟也限定在这份 WTT 指南）
- Circle CCTP：签发时间按**源链**列（表头 "Source blockchain"）。快速：以太坊约 20 秒，Arbitrum、Base、Linea、OP Mainnet 约 8 秒；标准：以太坊、Arbitrum、Base、OP Mainnet 约 15–19 分钟，BNB Smart Chain 约 2 秒，Polygon PoS 约 8 秒，Linea 约 6–32 小时 → <https://developers.circle.com/cctp/concepts/finality-and-block-confirmations>（旧地址 /cctp/required-block-confirmations 跳到这里；"Standard Transfer on Linea typically requires 6-32 hours before attestations become available."）
- Circle CCTP：消息里带 24 小时的过期区块，过期要重新签；过期的快速转账不是永久卡住，随时可以重新签发 → <https://developers.circle.com/cctp/references/technical-guide>（"An expiration block 24 hours in the future is encoded in the message"；"An expired Fast Transfer burn is not permanently stuck."；"There is no deadline after which re-attestation becomes unavailable."）
- Circle CCTP：开了 Forwarding，签发会自动提交到目标链 → <https://www.circle.com/cross-chain-transfer-protocol>（"With Forwarding enabled, the attestation is submitted automatically."）
- Circle 开发文档页脚 Support 链到 help.circle.com 的提交工单页 → 同上两页的页脚（<https://developers.circle.com/cctp/concepts/finality-and-block-confirmations>）
- Linea 官方桥的 USDC：走 CCTP；USDC 一律手动 Claim，交易记录显示 "Ready to claim" 后才能 Claim（"If your manual claim transaction is ready to claim, it will be marked as 'Ready to claim'"，原文用的是双引号）；标准模式 L2 → L1 约 2–12 小时 → <https://docs.linea.build/network/how-to/bridge>（"USDC transfers currently require manual claiming."；表里 "L2 → L1 ~2-12 hours"）。和上面 Circle 的 6–32 小时不一样，页面两个数都写了、标明各是哪一页，没合成一个数。
- Across 用 CCTP 结算原生 USDC → <https://docs.across.to/introduction/features>（"CCTP V2 / CCTPFast — Native USDC settlement"）；Portal 支持 CCTP → <https://wormhole.com/blog/the-portal-upgrade-is-now-live>
- Chainlink CCIP：CCIP Explorer（ccip.chain.link）按 Message ID 查 → <https://docs.chain.link/ccip/tools-resources/ccip-explorer>（"You can search for specific transactions using their unique Message ID."）
- Chainlink CCIP：源链最终确认时间（以太坊约 12.8 分钟、Arbitrum 17 分钟、Base 18 分钟、OP Mainnet 20 分钟、Polygon 17 分钟、BNB Chain 5 秒）；"The values below can change" → <https://docs.chain.link/ccip/concepts/execution-latency/finality-by-chain>；「到账时间受源链最终确认影响」见 <https://docs.chain.link/ccip/concepts/execution-latency>（"Execution latency is the time from source-chain submission to a message reaching its final state on the destination chain. These pages explain how finality and confirmation settings affect latency"）。旧版文档（docs.chain.link/ccip/v1/ccip-execution-latency）说得更重："depend largely on the time-to-finality of the source blockchain"；页面按现行版本写成「受……影响」。
- Chainlink CCIP：默认执行服务会自动尝试执行；Explorer 显示 Ready for manual execution 时有 Trigger Manual Execution；执行失败（FAILURE）的要等原因修好再重试（"A message at `FAILURE` already ran and must be retried after the underlying issue is fixed."），页面写成「先让原来的应用确认修好了，别反复提交」；觉得 Explorer 状态不对，带 Message ID 提交支持工单 → <https://docs.chain.link/ccip/concepts/manual-execution>（"the default executor service automatically attempts to execute every message"；"submit a support ticket with the CCIP message ID"。文档没写工单从哪提交；页脚 Support 指向 chain.link/support，我们打开跳到一个 404 页面）
- Squid：NEEDS_GAS 是 Axelar 交易特有，去 Axelarscan 看；ONGOING 时 15 分钟或预计时间两倍取大的再找客服；Axelar 路线是 PARTIAL_SUCCESS（源链成功、目标链执行回滚）、表里 "Destination swap fails" 时给目标链上的 axlUSDC；Squid Intents 失败自动退回源链，约 10 分钟 → <https://docs.squidrouter.com/api-and-sdk-integration/key-concepts/track-status>（"We generally recommend contacting support after either 15 minutes has passed, or double the estimatedRouteDuration, whichever is larger."；"Refunds typically take ~10 minutes"）
- Squid：源链那笔没发起成功的，币还在源链钱包里，可能已经花了一点 gas（"If the initial swap on the source chain swap did not initiate, the user's tokens will still be in their wallet on the source chain, aside from a small amount that may have been spent on gas."），页面写明这种不适用 axlUSDC 那条；交易暂停时，可以在 Axelarscan 的交易页手动加 gas；收到 axlUSDC 可以在目标链换；有问题找 Discord → <https://docs.squidrouter.com/widget-integration/add-a-widget/widget/information-for-integrators>（"the user can manually add gas to re-start the transaction by visiting the transaction's page in Axelarscan's UI"）
- Axelar：Axelarscan 显示 Pay Gas、Insufficient Fee、Not Enough Gas 时加 gas；连源链钱包点 Add gas，金额它算；多出来的退回 → <https://docs.axelar.dev/gmp/track-and-recover/recover-transactions>（"Use this when Axelarscan shows Pay Gas , Insufficient Fee or Not Enough Gas ."）
- Celer cBridge："Most of the cross-chain transfers take 5-20 minutes to complete."；大额受限额影响要多等；Submitting 先看源链确认、可提高 gas；SGN 两种状态再等至少 2 小时、超过 3 小时找客服（FAQ 里的 customer support 链接，带源链交易哈希）；Completed 但 MetaMask 看不到是没添加代币；FAQ 开头列了 Discord、Telegram → <https://cbridge-docs.celer.network/reference/faq>（客服链接是 FAQ 里给的一个 Typeform 表单，页面只说「官方常见问题里的 customer support 链接」，不写表单网址）
- Celer cBridge：右上角 Pending 看状态；目标链流动性不够或滑点太小导致失败时，在交易记录里点 Request Refund → <https://cbridge-docs.celer.network/tutorial/cross-chain-transfer>（"You can click “Request Refund” in the transfer history."）；应用网址 cbridge.celer.network 见官方文档 <https://cbridge-docs.celer.network/print.html> 里的链接
- deBridge："completed in seconds, not minutes"；少数情况更久；没人接的订单一直挂着；deExplorer 可按订单编号、钱包地址、交易哈希查，状态 Created、Fulfilled、Canceling、Canceled；页脚 Contact 列 Support（帮助中心）和 Discord；顶部菜单里 deExplorer 链到 app.debridge.com/orders → <https://debridge.com/support/>
- deBridge："If not fulfilled immediately, it remains as an open order. If it is never fulfilled, you should be able to cancel the transaction." → <https://debridge.com/support/what-happens-if-a-bridge-transaction-is-delayed-or-pending/>
- deBridge：取消步骤（deExplorer 打开订单 → 连接目标链上的 Order Authority 地址 → Cancel → 填源链退款地址 → Send Cancel → 钱包确认） → <https://debridge.com/support/how-can-i-cancel-an-order/>
- deBridge：取消后锁定的钱全额退回，含 affiliate 和 protocol 费，只付取消交易的 gas → <https://debridge.com/support/if-i-cancel-a-transaction-will-i-get-my-fees-back/>
- Relay：每笔有交易页；relay.link/transactions 按钱包地址、ENS、交易哈希筛；状态 Success、Processing、Failure；找不到的话在 relay.link 的聊天窗口求助；帮助中心页底写了 live support chat 和邮箱 support@relay.link → <https://support.relay.link/en/articles/9260724-how-do-i-find-my-transaction>
- Relay：先自动退款；失败了交易页才显示 "Automatic refund failed" 和 Withdraw funds；"Only withdraw at relay.link/withdraw, and never share your recovery phrase or private key with anyone, including anyone who says they’re from Relay."；还在处理中、已到账的 "You do not need to and can not withdraw"；签名免费、准备几分钟、约一小时内 Submit；只有发款钱包能提，客服不能代提 → <https://support.relay.link/en/articles/15100985-how-to-withdraw-funds>
- Orbiter："Transactions between two EOAs can be completed within 10 to 20 seconds." → <https://docs.orbiter.finance/welcome/overview>
- Orbiter：先到 orbiter.finance/history 的 Search 页签找，再在 Discord 里 Create Ticket，附上两边的链、交易哈希、钱包地址 → <https://docs.orbiter.finance/faq>
- Synapse：Activity 页签、进度下拉菜单里的区块浏览器链接；"Synapse time estimates are based on destination block times."；"Transactions that fail to complete are not lost, and are manually addressed by the Synapse support team."；滑点突然变大时给中间资产；gas 空投和返还自动到账，但 Synapse 页面只显示能跨链的资产，没看到就连到目标链看钱包；求助走 Discord；应用网址 synapseprotocol.com 在页脚 → <https://docs.synapseprotocol.com/docs/Support/Transaction-Support>
- Hop："A normal L1 <> L2 transfer takes up to 15 minutes and a L2 <> L2 transfer up to 5 minutes"；偶尔收到 hToken 要去 Convert 换；没有 Bonder 流动性会一直挂着 → <https://docs.hop.exchange/basics/faq/i-sent-a-token-but-its-not-arriving-at-the-destination>
- Hop：按出发的链列的时间（"L2 to Any"："Optimism: ~25 minutes (finality)"、"Arbitrum: ~12 minutes"、"Polygon: ~60 minutes (1600 blocks)"、"Base: ~25 minutes"）；还提到 "Hop has a multichain block explorer"（explorer.hop.exchange） → <https://docs.hop.exchange/basics/how-long-does-a-transfer-take>（这一页标着 "Last updated 3 years ago"）。和上面「最多 15／5 分钟」对不上，页面两边都写了，并写明「过了 5 或 15 分钟不等于要手动提款」；摘要里拿掉了 Hop 的时间。
- Hop 查询站：explorer.hop.exchange 根目录和 /mainnet 我们 2026-11-06 用 curl 打开都是 404（"Not Found"）。页面如实写「我们打开是 404，没找到别的官方查询页」，不当成可用入口推荐。
- Hop：Bonder 费太低、离线、没流动性时手动提款；Transfer Root 传到目标链 "could take a few hours or days"；Withdraw 页贴源链交易哈希；L2 拿到 hToken 要换，到以太坊直接是原生币 → <https://docs.hop.exchange/basics/manual-withdrawals>
- Hop：USDC 桥改用 CCTP、USDC.e 的 Bonder 停用后，USDC.e 转账要手动处理；hUSDC.e 回 L1 "takes at least 7 days after the root commit"；步骤：Convert 页选 "via Hop Bridge" 发起 → Relay 页贴源链交易哈希提交 "Commit Transfers" → 同页提交 "Prove Withdrawal"（"This will initiate a 7-day exit period."）→ Relay 页 "Finalize Withdrawal" → Withdraw 页 "Withdraw"；第 2、4、5 步都是贴 "the transaction hash of your transfer on the origin chain"，也就是同一笔原转账的源链哈希 → <https://docs.hop.exchange/basics/usdce-manual-withdrawals>。指南第 1 步「发起」是给还没发起的人的；页面分开写：还没发起的才去 Convert 页发起，已经发起、卡住的别再发一笔，拿原转账的哈希去 Relay 页补做还没做的步骤（指南里还给了第三方的 superchainrelayer.xyz 作为 OP Stack 链的替代，不是 Hop 自己的域名，页面没写）
- opBNB 官方桥：主网 dApp opbnb-bridge.bnbchain.org；默认打开的是社区桥，要切到 official bridge 页签；7 天挑战期；状态 Waiting for Proof，"You need to submit the proof manually."；证明后 7 天再领取；社区桥可能没有官方桥安全 → <https://docs.bnbchain.org/bnb-opbnb/get-started/withdraw-from-opbnb/>
- opBNB：7 天没到，一种可能是忘了在交易记录里签证明，不签就不开始 7 天（原文是 "might"，页面写「一种可能」「先去交易记录看看」，不当成确定原因） → <https://docs.bnbchain.org/bnb-opbnb/faq/opbnb-bridge-faqs/>（"You might have forgotten to sign the proof in the transaction history."）
- Polygon PoS：从 Polygon 提回以太坊，钱准备好后在交易记录里点 Initiate Claim，钱包确认后点 Claim Tokens → <https://docs.polygon.technology/tools/wallets/portal>（官方指南以 MATIC 为例）
- Polygon PoS：卡着的提款到 portal.polygon.technology/withdraw-tool，贴交易哈希点 Confirm Exit；卡超过一小时会出现 Try Again；交易记录页 portal.polygon.technology/transactions → <https://support.polygon.technology/support/solutions/articles/82000890640-my-transaction-is-pending-for-too-long-how-can-i-proceed-further->
- Polygon PoS：提款发起后 "can't be cancelled or reverted"；"there is no time limit to complete the pending transaction, and your funds are always safe in the bridge contract" → <https://support.polygon.technology/support/solutions/articles/82000887804-checkpoint-arrived-but-i-want-to-cancel-my-transaction>
- Polygon 帮助中心：不登录时只看得到知识库文章，没看到提交工单的入口（页面配置里 "hasTickets":false；页面上有登录、注册，我们没登录） → <https://support.polygon.technology/support/home>（这一页没放进页面的依据列表，依据里放的是上面两篇文章）

防骗：

- 以太坊官网 Scam help & reporting："If someone contacts you claiming they can recover your funds for a fee, that is almost certainly a second scam."；"Real moderators will never DM you first"；"Never enter your seed phrase on any website. Legitimate apps never ask for it" → <https://ethereum.org/community/support/scams/>。这是以太坊官网的通用资料，页面写明「不是哪一家桥的规定」。
- Relay 的「只在 relay.link/withdraw 提现」见上面 Relay 那条。别的桥没找到专门的防骗原话，页面没写。

查到但没写进去的：

- Circle 帮助中心「Transfer times and status explained」（help.circle.com，KB0011095）：网页是脚本渲染的，curl 和 WebFetch 都只拿到「Loading」空壳，读不到正文，没用。时间改按 Circle 开发文档写（表头明确是源链）。
- CCTP V1（旧版）停用日期：Circle 官网 CCTP 页写 "its phase-out will commence on October 31, 2026"；线索里说的旧帮助页 7-31 那一处读不到。停用以后还没完成的转账怎么处理，两边都没说，所以页面不写日期。
- Wormhole Portal 2024-10 升级公告说一些链之间 15 秒内到：是 2024 年的说法、只讲新路线，路线可能变过，没写。
- Wormhole Portal Legacy（legacy.portalbridge.com）2026-06-30 下线、跳到新站 → <https://wormhole.com/blog/sunsetting-portal-legacy-what-you-need-to-know>：日期已过，公告没说之后还没完成的转账怎么办，没写。
- Hop 另一篇常见问题「How long does a Hop transfer take?」（docs.hop.exchange/basics/faq/how-long-does-a-hop-transfer-take，按路线给数，比如以太坊到 Polygon 约 18 分钟，同一页又说 Polygon 官方桥 8 分钟）：和主导航那篇时长页（以太坊到 Polygon 约 20 分钟、Polygon 官方桥约 22 分钟）又不一样，页面只引主导航那篇和「没到账」那篇。
- Polygon PoS 桥提回以太坊要多久：官方帮助中心和开发文档都没给数；搜索结果里的「45 分钟到 3 小时」是 Polygon Plasma 桥的帮助文章，不是 PoS，没用。Portal 指南里「30 到 45 分钟」说的是 Polygon zkEVM，不在本页范围。
- CCIP 旧版文档（docs.chain.link/ccip/v1/…）的延迟表：页面用的是现行的 finality-by-chain 页。
- Stargate 常见问题里「从 Polygon 撤流动性约 20 分钟」：讲的是撤出流动性，不是转账，没写。
- LayerZero Scan 首页对程序返回 Vercel 安全检查（429），没读到页面本身；网址取自 Stargate 和 LayerZero 官方文档。
- Relay「没带 Relay 订单直接转进存款合约的，7 天后才能提」、Squid「NOT_FOUND 持续几分钟就找 Discord」、Synapse「DeFi Kingdoms 的 NFT 挂了两小时以上找客服」、Across「只有主网存款才退款」：情况太窄，没写。
- Orbiter 文档里的仲裁、赔偿、Maker 系统：是设计说明，没说现在对所有用户生效，没写。Orbiter 常见问题里的 TGE 提醒是旧背景，也没写。

线索文件和原文不一致的地方（按原文写）：

- Across：线索说「没找到面向普通用户的工单入口」；官方常见问题列了 Telegram、across.to 网站里的在线客服和 Slack，还给了退款约 120–150 分钟、超过 3 小时找人。
- deBridge：线索给的查询页是 app.debridge.com/explorer；官网菜单里 deExplorer 链到的是 app.debridge.com/orders，页面按官网写。
- Polygon：线索说帮助中心有「Support 及 ticket 流程」；不登录时帮助中心只有知识库，配置里 "hasTickets":false，没找到提交工单的入口。
- Chainlink CCIP：线索说「从文档支持入口导航」；页脚 Support 链接（chain.link/support）我们打开是 404。
- Circle：线索说帮助页表头写的是目标链、有歧义；帮助页读不到，开发文档的表头明确是 "Source blockchain"，页面按开发文档写。
- Wormhole：线索说「自动未完成可以走官方恢复流程」；官方给的恢复办法是下载脚本自己跑（开发者操作），不是网页按钮。线索也没提手动模式「24 小时内完成」这一条。
- zkSync：线索说 CLI 旧教程仍写 24 小时；那个地址（docs.zksync.io/zksync-network/tooling/zksync-cli/bridging）现在跳到 custom-tooling 页，页面里没有 24 小时这句。zkSync 本页不写时间，指向 l2-withdrawal-wait 专题。
- Stargate：线索说官网有 Support/Discord 导航、没核到工单流程——这一条线索是对的。我们第一版写成「页脚只有 Discord 和 Telegram」是我们自己漏看了页脚的 Support → Help Center（指向官方 Discord），复审时已改。

## 给渲染器的说明

- related 里除了 `deadline:` 和 `guide:`，还用了 `topic:<slug>` 互相指向（比如 `topic:l2-withdrawal-wait`）。渲染器不认的话，直接丢掉即可。
- 我们的安全提示句每页只出现一次（都放在某一节的列表里）。
