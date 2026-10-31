# DeFiExit · 安全出口

**链上资产体检 + 取回指南。** 粘贴钱包地址,看看有没有被遗忘在链上的钱;查到了,就给你一步一图的官方路线。签名在你自己的钱包里完成,钱直接回到你自己的地址。

- **只读**:体检只要地址,可以粘贴;在钱包里打开时,也可以点一下从钱包读取(只请钱包告诉本页地址)。本站从不发起签名、代币授权或交易。
- **不碰私钥**:任何人向你要私钥或助记词,都是骗子,包括冒充我们的人。
- **你自己签**:每一步都在官方网站上操作。签名前,核对卡会告诉你弹窗里应该看到什么。
- **开源免费**:代码和每份指南都公开,不收任何费用。
- **不先私信**:我们从不主动私信任何人。官方网站只有 **defiexit.com**。

## 目前支持

| 配方 | 能处理什么 | 最后核验 |
|---|---|---|
| [Hyperliquid](recipes/hyperliquid/recipe.json) | 账户里的 USDC、已停发的 USDH,提回 Arbitrum | 2026-10-27 |
| [WOOFi](recipes/woofi/recipe.json) | Arbitrum 上质押的 WOO、没领的奖励、ETH 金库里已结算待取的钱 | 2026-10-29 |
| [OKX Boost](recipes/okx-boost/recipe.json) | 「Plasma X Launch」活动时在 X Layer 上锁的 OKB、USDT0、USDG(在 OKX App 里取回) | 2026-10 |

更多协议陆续加入,先做被问得最多的。

## 它是怎么工作的

- **配方**(`recipes/<协议>/recipe.json`):每个协议一份。
  - 怎么查到你有这笔钱;
  - 官方入口;
  - 每一步的截图和说明;
  - 每次签名的核对卡;
  - 坑;
  - 依据和最后核验日期。
- **检测器**(`src/js/detectors/`):在你的浏览器里只读查询公开接口,算出你能提回多少、哪些步骤用不到。地址只从你的浏览器发给这些公开接口,不经过我们;这些接口能看到你的地址和 IP。
- **现场诊断**:卡住时点「我卡在这一步」,浏览器实时查你账户的挂单、成交、提现记录、锁仓和链上到账,告诉你实际做到了哪一步、该怎么办;每一步的常见情况都有审过的答案。不用 AI,地址同样不经过我们。
- **网站**:静态页面加两个小接口(Cloudflare Pages Functions):`/api/see` 截图求助(图交给 Cloudflare Workers AI 认),`/api/assets` 全部资产(地址交给 Zerion 查,需要在 Pages 里配机密 `ZERION_API_KEY`,没配就不显示这一块)。都不存数据(托管在 Cloudflare,托管商会处理访问日志)。Zerion 查不到的 X Layer、Merlin,由浏览器直接只读查这两条链的公共节点(OKX 的 X Layer 节点、Merlin 官方浏览器),币价用 DefiLlama 的免费接口。前端零依赖;安全响应头只允许页面连到配置里列出的公开接口(`scripts/site.mjs`)。链图标放在 `static/chains/`,来源和许可(web3icons、Trust Wallet assets,都是 MIT)见那里的 `LICENSE.txt`。
- **中英两套**:中文在 `/`,英文在 `/en/`。界面文字在 `src/js/lib/i18n.js`;每份配方都要带英文版 `recipes/<协议>/i18n/en.json`,缺一条、条数对不上、或者英文版里混着中文,构建直接报错。
- **字体**:Barlow Semi Condensed(标题)、Atkinson Hyperlegible Next(正文)、Atkinson Hyperlegible Mono(地址和数字),都放在本站 `static/fonts/`,SIL Open Font License,授权文件在同一目录;汉字用系统字体。

## 本地运行

需要 Node.js 20 或更高版本,不用装任何依赖:

```sh
npm run dev      # 构建并在 http://127.0.0.1:4321 预览
npm run build    # 只构建,产物在 dist/
npm test         # 跑测试
```

## 贡献配方

欢迎提交新配方。每份配方必须带三样证据:
1. **官方来源**:官方文档或官方前端的原文出处;
2. **实测记录**:用真实仓位按步骤走通、到账核对过,写进 `verified`;
3. **截图**:截图里不能出现任何真实用户的地址(打码或用测试钱包)。

每份配方还要带英文版 `i18n/en.json`:按英文读者的习惯写,不逐字翻译;警告类的话(「立刻拒绝」「别重复提现」)两边意思必须一致。

涉及直接调用合约的配方(官方入口已经没了的情况),必须经懂合约的复核者签字后才会合并。

## English

DeFiExit is a free, open-source, read-only checkup for forgotten on-chain positions. It gives step-by-step guides through each protocol's **official** interface, with a check card before every signature. It never asks for keys, never starts a signature, token approval or transaction (it can read your address from your wallet if you tap the button), and never DMs you first. The only official domain is **defiexit.com**.

## 许可证

[MIT](LICENSE)
