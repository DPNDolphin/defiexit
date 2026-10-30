// 站点配置。改域名、联系方式、允许访问的接口都在这里。
export const site = {
  name: "DeFiExit",
  nameZh: "安全出口",
  domain: "defiexit.com",
  github: "https://github.com/DPNDolphin/defiexit",
  // 求助渠道:用户自己发起联系;我们从不先私信。为 null 时页面显示「联系方式即将公布」。
  contact: null,
  // 浏览器只允许连这些公开接口(写进 CSP 的 connect-src);新增检测器时在这里加
  // Arbitrum 公共节点:现场诊断查提现到没到账(只读 eth_getTransactionReceipt)
  // X Layer 公共节点、Merlin 官方浏览器(Blockscout)、DefiLlama 价格:体检结果页查 Zerion 查不到的两条链的钱包余额
  connect: ["https://api.hyperliquid.xyz", "https://arb1.arbitrum.io/rpc", "https://rpc.xlayer.tech", "https://scan.merlinchain.io", "https://coins.llama.fi"],
  // 截图求助(页面图鉴里的「发截图给 AI 认」,服务端是 functions/api/see.js)。关掉就改成 false,页面上不出现这个入口
  shotAI: true,
  // Cloudflare 人机验证(Turnstile)的站点密钥:后台建好后填进来;服务端同时要配 TURNSTILE_SECRET。null 时两边都不启用
  turnstile: "0x4AAAAAAFrRJ1KeCd4glj7F",
};
