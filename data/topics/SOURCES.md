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

## 给渲染器的说明

- related 里除了 `deadline:` 和 `guide:`，还用了 `topic:<slug>` 互相指向（比如 `topic:l2-withdrawal-wait`）。渲染器不认的话，直接丢掉即可。
- 我们的安全提示句每页只出现一次（都放在某一节的列表里）。
