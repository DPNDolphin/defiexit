// 小工具:建节点(只用 textContent,不拼 HTML)、图标、路线、明细表、提示条、复制。
import { zh } from "./zh.js";
import { ICONS } from "./icons.js";

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : zh(c));
  return n;
}

const NS = "http://www.w3.org/2000/svg";
export function icon(name, cls = "") {
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("class", cls ? `i ${cls}` : "i");
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("focusable", "false");
  for (const [tag, attrs] of ICONS[name] || []) {
    const c = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) c.setAttribute(k, v);
    s.append(c);
  }
  return s;
}

// 「你在这里 → 出口」路线:n 个站,cur 是当前站(从 0 数),done 表示整条走完了
export function route(n, cur, done = false) {
  const box = el("div", { class: "route", role: "img" });
  for (let i = 0; i < n; i++) {
    box.append(el("span", { class: `node ${done || i < cur ? "past" : i === cur ? "here" : "next"}` }));
    box.append(el("span", { class: `seg ${done || i < cur ? "past" : "next"}` }));
  }
  box.append(el("span", { class: `exit-box${done ? " lit" : ""}` }, icon("exit")));
  return box;
}

// 明细表:一行一个数,最后一行是合计
export function rowsTable(rows, total) {
  return el("dl", { class: "rows" },
    rows.map((x) => el("div", {}, el("dt", {}, x.label, x.hint ? el("small", {}, x.hint) : null), el("dd", {}, x.value))),
    total ? el("div", { class: "total" }, el("dt", {}, total.label), el("dd", {}, total.value)) : null);
}

let timer;
export function toast(msg, ms = 4000) {
  const t = document.getElementById("toast");
  t.textContent = zh(msg);
  t.classList.add("show");
  clearTimeout(timer);
  timer = setTimeout(() => t.classList.remove("show"), ms);
}

export async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = el("textarea", { readonly: true, class: "offscreen" });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* 不支持就算了 */ }
    ta.remove();
    return ok;
  }
}

export const contact = () => document.querySelector('meta[name="dx-contact"]')?.content || "";
export const setText = (node, text) => { node.textContent = zh(text); };
