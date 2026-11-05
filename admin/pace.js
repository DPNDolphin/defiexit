// 运营台的两条节奏规矩(决策记录 11-05「上限与爬坡」「发送节奏」),页面(admin.js)和测试用的是同一份:
// 1. 对人的首回每天(北京时间)最多放出 cap 条:今天已发的先占名额,剩下的按待发的顺序放,多的排队,明天再放;
//    项目帖不算,收件里的续答也不算。cap 来自运营规则(看板 rules 的 dailyReplyCap,改它不用重新发布),没写就是 15。
// 2. 发得快了提醒一句,不拦人:30 分钟里发了 6 条,请他歇一会儿;一次坐下(相邻两条隔不到 2 小时)发了 10 条,请他隔两小时再来。
// 「发了」= 待发里点了「已发」(点「在 X 打开」会自动记成已发),时间用服务器记的 decided_at。

export const CAP = { dflt: 15, min: 1, max: 50 };
export const PACE = { burst: 6, burstMs: 30 * 60e3, sitting: 10, gapMs: 2 * 3600e3 };

const H8 = 8 * 3600e3;
// 北京时间的日期 YYYY-MM-DD;时间读不出来回空串
export const bjDay = (t) => { const x = t == null ? NaN : new Date(t).getTime(); return Number.isFinite(x) ? new Date(x + H8).toISOString().slice(0, 10) : ""; };
// 对人的首回要有目标帖子的编号:30 天到期删掉了编号的(状态还是待发)发不出去,不占名额,也不排队
const isReply = (d) => !!(d && d.mine && d.mine.kind !== "post" && d.mine.target && /^\d{1,25}$/.test(String(d.mine.target.id || "")));

export function capOf(rules) {
  const n = rules && rules.dailyReplyCap;
  return Number.isInteger(n) && n >= CAP.min && n <= CAP.max ? n : CAP.dflt;
}

// all:待发里的全部(含点过的);pend:还没点的,按页面上的顺序(先送来的在上面)。回 { cap, used: 今天已发几条, queued: 排队的编号 }
export function gate(all, pend, cap, now = Date.now()) {
  const today = bjDay(now);
  const used = all.filter((d) => isReply(d) && d.status === "已发" && bjDay(d.decided_at) === today).length;
  let left = Math.max(0, cap - used);
  const queued = new Set();
  for (const d of pend) if (isReply(d)) { if (left > 0) left--; else queued.add(d.id); }
  return { cap, used, queued };
}
// 排队的那张卡片上写的
export const waitText = (g) => (g.used >= g.cap
  ? "排队:今天已到上限 " + g.cap + " 条,明天放出"
  : "排队:今天上限 " + g.cap + " 条(已发 " + g.used + " 条,上面 " + (g.cap - g.used) + " 条先发),明天放出");

// 刚发了一条以后要不要提醒:times 是点了「已发」的时间,以最近的一条为准(不看本机时钟)。回一句话,或 null
export function paceNote(times) {
  const ts = times.map((t) => Date.parse(t)).filter(Number.isFinite).sort((a, b) => b - a);
  if (!ts.length) return null;
  let n = 1;
  while (n < ts.length && ts[n - 1] - ts[n] < PACE.gapMs) n++;
  if (n >= PACE.sitting) return "这一次已经发了 " + n + " 条,隔两小时再来";
  const burst = ts.filter((t) => ts[0] - t <= PACE.burstMs).length;
  return burst >= PACE.burst ? "30 分钟里已经发了 " + burst + " 条,歇一会儿" : null;
}
