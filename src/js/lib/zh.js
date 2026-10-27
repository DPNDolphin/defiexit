// 中文排版:挨着汉字的半角标点换成全角;括号成对换。
// hyperliquidChain: Mainnet、USDC:0x..、1:1、https:// 这类技术写法不动。构建脚本和浏览器共用。
const CJK = /[一-鿿　-〿＀-￯]/;
const isCjk = (c) => !!c && CJK.test(c);

export function zh(s) {
  s = String(s);
  const out = [...s];
  const n = s.length;
  const zhLine = [...s].some(isCjk);
  // 找左右最近的「真字符」:跳过 **粗体** 标记
  const near = (i, step) => { let k = i + step; while (s[k] === "*") k += step; return s[k] || ""; };
  for (let i = 0; i < n; i++) {
    const ch = s[i], prev = near(i, -1), next = near(i, 1);
    if (ch === "," && (isCjk(prev) || isCjk(next) || (zhLine && !(/\d/.test(prev) && /\d/.test(next))))) out[i] = "，";
    else if (ch === ";" && (zhLine || isCjk(prev) || isCjk(next))) out[i] = "；";
    else if (ch === ":" && (isCjk(prev) || isCjk(next))) out[i] = "：";
    else if (ch === "?" && isCjk(prev)) out[i] = "？";
    else if (ch === "!" && isCjk(prev)) out[i] = "！";
  }
  const stack = [];
  for (let i = 0; i < n; i++) {
    if (s[i] === "(") stack.push(i);
    else if (s[i] === ")" && stack.length) {
      const j = stack.pop();
      const around = [near(j, -1), near(j, 1), near(i, -1), near(i, 1)];
      if (around.some(isCjk) || [...s.slice(j + 1, i)].some(isCjk)) { out[j] = "（"; out[i] = "）"; }
    }
  }
  return out.join("");
}
