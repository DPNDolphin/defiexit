// 线条图标(24×24,描边,颜色跟着文字走)。构建脚本拼成 <svg> 字符串;浏览器里用 createElementNS 建节点。
export const ICONS = {
  arrowRight: [["path", { d: "M5 12h14M13 6l6 6-6 6" }]],
  arrowLeft: [["path", { d: "M19 12H5M11 6l-6 6 6 6" }]],
  x: [["path", { d: "M6 6l12 12M18 6L6 18" }]],
  help: [["circle", { cx: "12", cy: "12", r: "9" }], ["path", { d: "M9.5 9.5a2.5 2.5 0 114 2c-1 .6-1.5 1.2-1.5 2.5M12 17h.01" }]],
  copy: [["rect", { x: "9", y: "9", width: "11", height: "11", rx: "2" }], ["path", { d: "M5 15V5a1 1 0 011-1h10" }]],
  check: [["path", { d: "M5 12.5l4.5 4.5L19 7.5" }]],
  clock: [["circle", { cx: "12", cy: "12", r: "9" }], ["path", { d: "M12 7v5l3 2" }]],
  pen: [["path", { d: "M4 20h4L19 9l-4-4L4 16v4z" }]],
  tag: [["path", { d: "M3 12V4h8l10 10-8 8L3 12z" }], ["circle", { cx: "7.5", cy: "7.5", r: "1.5" }]],
  eye: [["path", { d: "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" }], ["circle", { cx: "12", cy: "12", r: "3" }]],
  unlink: [["path", { d: "M9 15l-1.5 1.5a3.5 3.5 0 01-5-5L4 10M15 9l1.5-1.5a3.5 3.5 0 015 5L20 14M8 3l1 2.5M16 21l-1-2.5M3 8l2.5 1M21 16l-2.5-1" }]],
  lock: [["rect", { x: "5", y: "11", width: "14", height: "9", rx: "2" }], ["path", { d: "M8 11V8a4 4 0 018 0v3" }]],
  shield: [["path", { d: "M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" }], ["path", { d: "M9 12l2.2 2.2L15.5 10" }]],
  nodm: [["path", { d: "M4 5h16v11H8l-4 4V5z" }], ["path", { d: "M3 3l18 18" }]],
  alert: [["path", { d: "M12 3l10 18H2L12 3z" }], ["path", { d: "M12 10v5M12 18h.01" }]],
  info: [["circle", { cx: "12", cy: "12", r: "9" }], ["path", { d: "M12 11v5M12 8h.01" }]],
  exit: [["path", { d: "M13 4h7v16h-7" }], ["path", { d: "M3 12h12M11 8l4 4-4 4" }]],
  refresh: [["path", { d: "M20 11a8 8 0 10-2.3 5.7M20 5v6h-6" }]],
  chevron: [["path", { d: "M9 6l6 6-6 6" }]],
  sun: [["circle", { cx: "12", cy: "12", r: "4" }], ["path", { d: "M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" }]],
  moon: [["path", { d: "M20.5 13.5A8.5 8.5 0 1110.5 3.5a6.5 6.5 0 0010 10z" }]],
  share: [["path", { d: "M4 12v7a1 1 0 001 1h14a1 1 0 001-1v-7M12 3v13M7 8l5-5 5 5" }]],
  image: [["rect", { x: "3", y: "5", width: "18", height: "14", rx: "2" }], ["circle", { cx: "8.5", cy: "10", r: "1.5" }], ["path", { d: "M21 16l-5-5-8 8" }]],
  wallet: [["path", { d: "M4 7.5A1.5 1.5 0 015.5 6H19a1 1 0 011 1v11a1 1 0 01-1 1H5.5A1.5 1.5 0 014 17.5v-10z" }], ["path", { d: "M4 7.5L15 4l1 2" }], ["path", { d: "M20 11h-4a1.5 1.5 0 000 3h4" }]],
};

export function svgString(name, cls = "") {
  const parts = ICONS[name].map(([tag, a]) => `<${tag} ${Object.entries(a).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`).join("");
  return `<svg class="i${cls ? ` ${cls}` : ""}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${parts}</svg>`;
}
