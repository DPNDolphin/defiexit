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
  connect: ["https://api.hyperliquid.xyz", "https://arb1.arbitrum.io/rpc"],
};
