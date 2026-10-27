// 小工具:建节点(只用 textContent,不拼 HTML)、提示条、复制。
import { zh } from "./zh.js";

export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v;
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) n.append(c instanceof Node ? c : zh(c));
  return n;
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
