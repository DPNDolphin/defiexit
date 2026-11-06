// 照 Cloudflare Pages 的规矩读 _headers,算某个地址最后带上哪些响应头(官方文档 developers.cloudflare.com/pages/configuration/headers/):
// 顶格一行是地址规则,下面缩进的几行是它的响应头;一个地址配上几条规则,几条的响应头都带上。
// 占位符 :name 配一段(不含 /),* 贪心配剩下的全部。
export function headerRules(text) {
  const rules = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    if (/^\s/.test(line)) rules.at(-1).headers.push(line.trim());
    else rules.push({ path: line.trim(), headers: [] });
  }
  return rules;
}

const pattern = (p) => new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/:[A-Za-z]\w*/g, "[^/]+").replace(/\*/g, ".*") + "$");

export function headersFor(text, path) {
  return headerRules(text).filter((r) => pattern(r.path).test(path)).flatMap((r) => r.headers);
}
