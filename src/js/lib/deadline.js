// 退出截止日历的倒数。构建脚本、截止日历页、体检结果页的提醒卡共用,几处算出来一样。
// 截止的那一刻:写了 at(deadlineAt,带时区的时间,比如 2026-11-11T23:59:59-05:00)就按它;
// 只写了日子的,算「还没到 / 已过」按那一天(UTC)结束——那一天里都还算没过。
const cutOf = (iso, at) => (at ? Date.parse(at) : Date.parse(`${iso}T00:00:00Z`) + 864e5);

// 回的是还有几天:0 是离截止不到一整天,负数是已经过了(截止那一刻起就算过了)。分「还没到 / 已过」、排先后、定颜色都按它
export function daysLeft(iso, now = new Date(), at = null) {
  return Math.ceil((cutOf(iso, at) - now.getTime()) / 864e5) - 1;
}

// 倒数写成什么字(i18n 的 dlLeft、dueLeft、dueNext 拿它):{ days, hours, day }。倒数只能往少里说,不能多说:
//   写了 deadlineAt 的:离那一刻 48 小时以内给 hours,还剩几个整小时,向下取整(1 小时 59 分算 1 小时),不到 1 小时是 0;
//     48 小时以上给 days,整天数,向下取整(47 小时 59 分写的是小时,不会说成 2 天)。
//   只写了日子 D 的:官方可能是「D 日前」,也可能是 D 日里哪个时候截止,倒数按最早的那一刻算到 D 日 00:00(UTC);
//     到了 D 日(UTC)这一整天,day 是 D(说「按 UTC 算,今天是截止日」),不写几小时;D 日过完才算过了。
//   过了的:days 是 -1。不说没带 UTC 的「今天」「明天」:读的人在别的时区,他那边的「今天」可能已经是另一天
export function timeLeft(iso, now = new Date(), at = null) {
  const t = now.getTime(), ms = (at ? Date.parse(at) : Date.parse(`${iso}T00:00:00Z`)) - t;
  if (!at && ms <= 0 && ms > -864e5) return { days: 0, hours: null, day: iso };
  if (ms <= 0) return { days: -1, hours: null, day: null };
  return { days: Math.floor(ms / 864e5), hours: ms <= 2 * 864e5 ? Math.floor(ms / 36e5) : null, day: null };
}

// 分几步截止的(milestones,比如先截止空投、再强平、最后截止提款):还没过的第一步;都过了回 null
export const nextMilestone = (e, now = new Date()) => (e.milestones || []).find((m) => daysLeft(m.date, now, m.deadlineAt) >= 0) || null;

// 倒数的样子:7 天以内(含不到一天的)最醒目,30 天以内次之;过了的、没定日期的不着色。字本身写着还剩多少,不只靠颜色
export const urgency = (n) => (n === null ? "none" : n < 0 ? "past" : n <= 7 ? "soon" : n <= 30 ? "near" : "far");
