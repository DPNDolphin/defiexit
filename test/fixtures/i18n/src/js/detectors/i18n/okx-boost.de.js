// 测试用的样例,不是真的德文译文:OKX Boost 检测器的几句话加了「[de]」,只翻一部分,别的退回英文
export default {
  total: "[de] You can get back about",
  row: { locked: (sym) => `[de] Locked ${sym}` },
  head: { nothing: "[de] Nothing locked here" },
  arr: { list: (items) => items.map((x) => `${x.amount} ${x.sym}`).join(" + ") },
};
