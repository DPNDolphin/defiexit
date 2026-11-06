// 测试用:在 dir 下照仓库的样子摆一套「[de]」样例译文(不是真译文,只在英文前面加个记号),给构建从头到尾走一遍:
//   src/js/lib/i18n/de.js           拷这个目录里的那份(几条文字、几个函数,别的键退回英文)
//   data/i18n/de/deadlines.json     两条事件:Sophon(名字、一句话、官方链接)、StandX(该做什么、分几步截止)
//   data/i18n/de/topics/<slug>.json 一篇专题,整篇都换
//   recipes/okx-boost/i18n/de.json  从 en.json 换出来,结构一样;别的三份指南不给,页面上要退回英文
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const FIX_TOPIC = "unstake-wait";
export const FIX_RECIPE = "okx-boost";

// 开头的「! 」「✗ 」(指南里的提示、别这样做)留在最前面
export const tag = (s) => s.replace(/^((?:!|✗)\s+)?/, "$1[de] ");
// 网址、截图文件名、要复制的原文不换
const KEEP = new Set(["src", "url", "thumb", "img", "copy"]);
const deep = (v, k = "") => (KEEP.has(k) ? v : typeof v === "string" ? tag(v) : Array.isArray(v) ? v.map((x) => deep(x)) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([a, b]) => [a, deep(b, a)])) : v);

export function makeFixtureRoot(dir, root) {
  const put = (rel, data) => {
    const f = join(dir, rel);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, typeof data === "string" ? data : JSON.stringify(data, null, 1));
  };
  put("package.json", '{ "type": "module" }\n'); // 界面文字是 ES 模块(仓库根目录的 package.json 也这么写)
  mkdirSync(join(dir, "src", "js", "lib", "i18n"), { recursive: true });
  copyFileSync(join(HERE, "src", "js", "lib", "i18n", "de.js"), join(dir, "src", "js", "lib", "i18n", "de.js"));
  const D = JSON.parse(readFileSync(join(root, "data", "deadlines.json"), "utf8"));
  const e = (id) => D.events.find((x) => x.id === id);
  const so = e("sophon-chain-shutdown"), sx = e("standx-winddown");
  put("data/i18n/de/deadlines.json", {
    "sophon-chain-shutdown": { name: tag(so.name.en), summary: tag(so.summary.en), official: so.official.map((o) => tag(o.label.en)) },
    "standx-winddown": { todo: tag(sx.todo.en), milestones: sx.milestones.map((m) => tag(m.note.en)) },
  });
  const T = JSON.parse(readFileSync(join(root, "data", "topics", `${FIX_TOPIC}.json`), "utf8"));
  put(`data/i18n/de/topics/${FIX_TOPIC}.json`, {
    title: tag(T.title.en), summary: tag(T.summary.en),
    sections: T.sections.map((s) => ({ h: tag(s.h.en), p: (s.p || []).map((x) => tag(x.en)), list: (s.list || []).map((x) => tag(x.en)) })),
    faq: (T.faq || []).map((x) => ({ q: tag(x.q.en), a: tag(x.a.en) })),
    sources: T.sources.map((s) => tag(s.label.en)),
  });
  put(`recipes/${FIX_RECIPE}/i18n/de.json`, deep(JSON.parse(readFileSync(join(root, "recipes", FIX_RECIPE, "i18n", "en.json"), "utf8"))));
  return dir;
}
