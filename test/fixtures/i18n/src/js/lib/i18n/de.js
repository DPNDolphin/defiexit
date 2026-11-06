// 测试用的样例,不是真的德文译文(test/i18n.test.mjs 拿它从头到尾走一遍构建):
// 几条文字、几个函数都加了「[de]」好认;别的键故意不写,页面上要退回英文
export default {
  brandSub: "[de] Safe exit",
  langNav: "[de] Language",
  homeTitle: "[de] DeFiExit: a free checkup for money left on-chain",
  heroBadge: "[de] Read-only · Open source · Free",
  checkTitle: "[de] Results",
  badHash: "[de] We couldn't read that address. It should start with 0x and be 42 characters long.",
  dlH1: "[de] Exit deadlines",
  shareX: "[de] Share",
  guideInEn: "[de] This guide is shown in English for now.",
  nfTitle: "[de] Page not found",
  nfBack: "[de] Back to home",
  lastChecked: (d) => `[de] Last checked ${d}`,
  dlLeft: ({ days, hours, day }) => (day ? `[de] Deadline day (UTC): ${day}` : hours != null ? `[de] ${hours} h left` : days >= 0 ? `[de] ${days} d left` : "[de] passed"),
  checkingN: (n) => `[de] Checking ${n} API${n === 1 ? "" : "s"}…`,
};
