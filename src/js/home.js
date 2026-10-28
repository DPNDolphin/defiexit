// 首页:粘贴地址 → 去检查结果页(地址放在 # 后面,不会发给任何服务器)。
import "./site.js";
import { isEvmAddress } from "./lib/net.js";
import { setText } from "./lib/ui.js";
import { makeT, pageLang, prefix } from "./lib/i18n.js";

const lang = pageLang(), t = makeT(lang);
const form = document.getElementById("scan");
const input = document.getElementById("addr");
const err = document.getElementById("addrErr");

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const a = input.value.replace(/\s+/g, "");
  if (!isEvmAddress(a)) {
    setText(err, t("badAddr"));
    err.hidden = false;
    input.setAttribute("aria-invalid", "true");
    input.focus();
    return;
  }
  location.href = `${prefix(lang)}/check/#a=${a}`;
});
input.addEventListener("input", () => {
  if (err.hidden) return;
  err.hidden = true;
  input.removeAttribute("aria-invalid");
});
