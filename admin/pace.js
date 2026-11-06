// 运营台的节奏规矩和「发出去没有」的算法(决策记录 11-05「上限与爬坡」「发送节奏」「运营台要修的」),页面(admin.js)、服务器(导出)和测试用的是同一份:
// 1. 对人的首回每天(北京时间)最多放出 cap 条:今天已打开的先占名额,剩下的按待发的顺序放,多的排队,明天再放;
//    项目帖不算,收件里的续答也不算。cap 来自运营规则(看板 rules 的 dailyReplyCap,改它不用重新发布),没写就是 15。
// 2. 发得快了提醒一句,不拦人:30 分钟里发了 6 条,请他歇一会儿;一次坐下(相邻两条隔不到 2 小时)发了 10 条,请他隔两小时再来。
// 这两条都按点开算(防发多):点了「在 X 打开」(或「已发」)那一刻就算,核没核实都算;时间用服务器记的 decided_at。
// 3. 「已发」拆成三种(sentState):
//    已打开 opened   —— 管理员点了「在 X 打开」(或「已发」;库里的状态还叫「已发」,decided_at 是点开那一刻),还没满 SENT.graceMs;
//    待核实 pending  —— 点开满 SENT.graceMs(6 小时)还没核到:可能没发出去、发完删了,或者 fxtwitter 没读到。之后核到了照样转「核实已发」;
//    核实已发 verified —— 主窗口经 fxtwitter 在 X 上找到了他发的那条(项目号发的、回的是那条目标帖、正文对得上;项目帖是项目号自己发的、
//                      不是回复、正文对得上),经签名投递送进来,记在 mine.sent:opened 是那次点开的时间(和 decided_at 一模一样才算,
//                      改回待发以后再点开就要重新核),at 是核到的时间,url 是那条的链接(30 天到期删掉,opened、at 留着数)。
//    另有 已发(旧,没核)legacy —— 这一版上线以前点的(decided_at 早于 rule.cutover:服务器第一次跑这一版时记下的时间),还没核到的。
//    导出、看板、读钟数的「已发」只数核实已发;另外单列已打开、待核实(和旧的没核)。

export const CAP = { dflt: 15, min: 1, max: 50 };
export const PACE = { burst: 6, burstMs: 30 * 60e3, sitting: 10, gapMs: 2 * 3600e3 };
// graceMs:点开以后多久还核不到算「待核实」。老板一次坐下最多发 10 条、两次隔 ≥2 小时,主窗口每半小时核一次;
// fxtwitter 时好时坏,6 小时里能核十来次,还核不到的才请他看一眼。
// skewMs:核到的那条最早可以比这一批发送的起点早多久(服务器和 X 的钟差)。起点是这一轮第一次点「复制」或点开的时间
// (服务器的 send_batches;改回待发再点开是新的一批,上一批发的不算);这一版以前点开、没有批次的旧记录补核,起点按卡片送进运营台的时间。
// 拿核实过的帖子再充数,由「一条帖子永远只归第一次核到的那一次点开」挡住(服务器的 sent_posts,改回待发也不放出来)
export const SENT = { graceMs: 6 * 3600e3, skewMs: 15 * 60e3 };
export const SENT_LABEL = { opened: "已打开", pending: "待核实", verified: "核实已发", legacy: "已发(旧,没核)" };

const H8 = 8 * 3600e3;
// 北京时间的日期 YYYY-MM-DD;时间读不出来回空串
export const bjDay = (t) => { const x = t == null ? NaN : new Date(t).getTime(); return Number.isFinite(x) ? new Date(x + H8).toISOString().slice(0, 10) : ""; };
// 对人的首回要有目标帖子的编号:30 天到期删掉了编号的(状态还是待发)发不出去,不占名额,也不排队
const isReply = (d) => !!(d && d.mine && d.mine.kind !== "post" && d.mine.target && /^\d{1,25}$/.test(String(d.mine.target.id || "")));

export function capOf(rules) {
  const n = rules && rules.dailyReplyCap;
  return Number.isInteger(n) && n >= CAP.min && n <= CAP.max ? n : CAP.dflt;
}

// d:待发里的一条(status、decided_at、mine);rule:服务器给的 { graceMs, cutover }。不是「已发」的回 null
export function sentState(d, rule, now = Date.now()) {
  if (!d || d.status !== "已发") return null;
  const s = d.mine && d.mine.sent;
  if (s && typeof s === "object" && typeof s.opened === "string" && s.opened === d.decided_at && typeof s.at === "string") return "verified";
  const opened = Date.parse(d.decided_at || "");
  const cut = rule && typeof rule.cutover === "string" ? Date.parse(rule.cutover) : NaN;
  if (Number.isFinite(cut) && (!Number.isFinite(opened) || opened < cut)) return "legacy";
  const grace = rule && Number.isFinite(rule.graceMs) && rule.graceMs > 0 ? rule.graceMs : SENT.graceMs;
  return Number.isFinite(opened) && +now - opened < grace ? "opened" : "pending";
}

// all:待发里的全部(含点过的);pend:还没点的,按页面上的顺序(先送来的在上面)。回 { cap, used: 今天已打开几条, queued: 排队的编号 }
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
  : "排队:今天上限 " + g.cap + " 条(已打开 " + g.used + " 条,上面 " + (g.cap - g.used) + " 条先发),明天放出");

// 刚发了一条以后要不要提醒:times 是点开(点「在 X 打开」或「已发」)的时间,以最近的一条为准(不看本机时钟)。回一句话,或 null
export function paceNote(times) {
  const ts = times.map((t) => Date.parse(t)).filter(Number.isFinite).sort((a, b) => b - a);
  if (!ts.length) return null;
  let n = 1;
  while (n < ts.length && ts[n - 1] - ts[n] < PACE.gapMs) n++;
  if (n >= PACE.sitting) return "这一次已经发了 " + n + " 条,隔两小时再来";
  const burst = ts.filter((t) => ts[0] - t <= PACE.burstMs).length;
  return burst >= PACE.burst ? "30 分钟里已经发了 " + burst + " 条,歇一会儿" : null;
}
