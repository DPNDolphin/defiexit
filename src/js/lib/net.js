// 只读网络请求:带超时;失败抛出带代码的错误(code:http / timeout / network),页面按语言翻译。
function netError(code, message, status) {
  const e = new Error(message);
  e.code = code;
  if (status) e.status = status;
  return e;
}

async function request(url, init, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: ctl.signal, credentials: "omit", referrerPolicy: "no-referrer" });
    if (!r.ok) throw netError("http", `接口返回 ${r.status}`, r.status);
    return await r.json();
  } catch (e) {
    // 自己的错误码是字符串;浏览器的 AbortError(DOMException)也带数字 code,不能原样往外抛,否则页面上会出英文原话
    if (typeof e.code === "string") throw e;
    throw e.name === "AbortError" ? netError("timeout", "查询超时") : netError("network", "网络错误");
  } finally {
    clearTimeout(t);
  }
}

export const postJSON = (url, body, ms = 12000) =>
  request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, ms);
export const getJSON = (url, ms = 12000) => request(url, { method: "GET" }, ms);

export const isEvmAddress = (s) => /^0x[0-9a-fA-F]{40}$/.test(s);
export const shortAddr = (a) => `${a.slice(0, 6)}…${a.slice(-4)}`;
// 向下取到 d 位小数(显示「约」时宁少勿多)
export const floorTo = (x, d = 2) => Math.floor(x * 10 ** d + 1e-9) / 10 ** d;
export const fmt = (x, d = 2) => floorTo(x, d).toFixed(d);
