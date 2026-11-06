// 多语言:语言登记表、缺了退回英文、译文的逐条核对(写错了报什么)、语言菜单、样例语言从头到尾走一遍构建。
// 样例语言是 test/fixtures/i18n 里的「[de]」(不是真的德文译文),构建到临时目录,不碰 dist/(build.test.mjs 在别的进程里删了重建)。
// 单独一个文件:要往 i18n.js 里装样例语言、换掉全局的 document(node --test 每个文件一个进程,不影响别的测试)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import vm from "node:vm";
import { LANGS, BASE, langOf, prefixOf, locale, listSep } from "../src/js/lib/langs.js";
import { STR, makeT, addUI, hasText } from "../src/js/lib/i18n.js";
import { tokenDiff, chineseIn, checkUI, SAMPLES, loadUI, checkDeadlineOverlay, applyDeadlines, checkTopicOverlay, applyTopic, checkRecipeOverlay, recipeLangs, readDataOverlays, localNumbers, DTEXT, checkDText, loadDTexts } from "../scripts/i18n.mjs";
import { build, localize, langSwitch, texts, checkDeadlines, loadTopics, deadlinesPage, TITLE_BAN } from "../scripts/build.mjs";
import { addText, pickText } from "../src/js/lib/dtext.js";
import { TEXT as OKX } from "../src/js/detectors/okx-boost.text.js";
import { HOW } from "../src/js/lib/xlayer.text.js";
import { makeFixtureRoot, tag, FIX_TOPIC, FIX_RECIPE } from "./fixtures/i18n/make.mjs";

const read = (f) => readFileSync(f, "utf8");
const D = checkDeadlines(JSON.parse(read("data/deadlines.json")));
const TOPICS = loadTopics();
const CJK = /[　-〿一-鿿＀-￯]/;
const noMenu = (h) => h.replace(/<nav class="langs"[\s\S]*?<\/nav>/g, "");
const tmp = (p) => mkdtempSync(join(tmpdir(), p));
const NBSP = String.fromCharCode(0xa0), NNBSP = String.fromCharCode(0x202f);
// 构建脚本传给截止日历译文检查的几样(和 build 里的一样:转发到 X 的字数按 X 的算法,标题里不写领取类的词)
const xLen = (s) => [...s].reduce((n, c) => { const p = c.codePointAt(0); return n + (p <= 0x10ff || (p >= 0x2000 && p <= 0x200d) || (p >= 0x2010 && p <= 0x201f) || (p >= 0x2032 && p <= 0x2037) ? 1 : 2); }, 0);
const CHECKS = { xLen, flat: (s) => String(s).replace(/\*\*|`/g, ""), ban: TITLE_BAN };

test("语言登记表:中文在根目录、英文在 /en,另外十种照规格表(前缀、<html lang>、og:locale、本族语名字);编号、前缀不重复", () => {
  assert.deepEqual(LANGS.map((l) => [l.code, l.prefix, l.html, l.og, l.label]), [
    ["zh", "", "zh-CN", "zh_CN", "中文"], ["en", "/en", "en", "en_US", "English"],
    ["es", "/es", "es", "es_ES", "Español"], ["pt", "/pt", "pt-BR", "pt_BR", "Português"], ["ru", "/ru", "ru", "ru_RU", "Русский"],
    ["tr", "/tr", "tr", "tr_TR", "Türkçe"], ["vi", "/vi", "vi", "vi_VN", "Tiếng Việt"], ["id", "/id", "id", "id_ID", "Bahasa Indonesia"],
    ["ko", "/ko", "ko", "ko_KR", "한국어"], ["ja", "/ja", "ja", "ja_JP", "日本語"], ["fr", "/fr", "fr", "fr_FR", "Français"], ["de", "/de", "de", "de_DE", "Deutsch"],
  ]);
  assert.equal(new Set(LANGS.map((l) => l.code)).size, LANGS.length);
  assert.equal(new Set(LANGS.map((l) => l.prefix)).size, LANGS.length);
  assert.deepEqual(BASE, ["zh", "en"]);
  // <html lang> → 编号:先找一模一样的,再按主语言;认不出来的当英文
  assert.deepEqual(["zh-CN", "en", "EN-us", "pt-BR", "pt-PT", "ja", "ko-KR", "xx", ""].map(langOf), ["zh", "en", "en", "pt", "pt", "ja", "ko", "en", "en"]);
  assert.deepEqual(["zh", "en", "de", "nope"].map(prefixOf), ["", "/en", "/de", "/en"]);
  // 数字、日期的写法:中文、英文照原来;中文页面的数字和英文一样是 1,234.56
  assert.deepEqual(["zh", "en", "pt", "de"].map(locale), ["zh-CN", "en-US", "pt-BR", "de"]);
  assert.equal((1234.5).toLocaleString(locale("zh"), { minimumFractionDigits: 2 }), (1234.5).toLocaleString("en-US", { minimumFractionDigits: 2 }));
  assert.deepEqual(["zh", "ja", "en", "ko", "de"].map(listSep), ["、", "、", ", ", ", ", ", "]);
});

test("界面文字:别的语言装进来以后,自己有的用自己的,缺的键一律退回英文;中英两套照旧缺键就报错;没登记的语言装不进来", () => {
  addUI("fr", { checkTitle: "[fr] Results", lastChecked: (d) => `[fr] ${d}` });
  const t = makeT("fr");
  assert.equal(t.lang, "fr");
  assert.equal(t("checkTitle"), "[fr] Results");
  assert.equal(t("lastChecked", "2026-11-05"), "[fr] 2026-11-05");
  assert.equal(t("checked"), STR.en.checked, "没写的文字用英文");
  assert.equal(t("foundN", 3), STR.en.foundN(3), "没写的函数用英文");
  assert.equal(t("guideInEn"), STR.en.guideInEn);
  assert.ok(hasText("fr", "checkTitle") && !hasText("fr", "checked") && hasText("zh", "checked"));
  // 登记了、但界面文字没装上(浏览器里文件没加载成):整套用英文,不报错
  assert.equal(makeT("ko")("checkTitle"), STR.en.checkTitle);
  for (const l of ["zh", "en"]) assert.throws(() => makeT(l)("noSuchKey"), new RegExp(`missing text: ${l}\\.noSuchKey`));
  assert.throws(() => makeT("xx"), /unknown language: xx/);
  assert.throws(() => addUI("zh", {}), /addUI/);
  assert.throws(() => addUI("xx", {}), /addUI/);
  assert.equal(makeT("zh").lang, "zh");
});

test("译文里不能改的:数字、网址、域名、0x 地址、`代码`、{{变量}}、①、**粗体**;英文的月份名、数字词可以写成数字;西语的 p.ej. 这类缩写不当域名", () => {
  const ok = [
    ["Go to `legacy.balancer.fi` on Nov 30, 2026 at 10:00 UTC.", "Ve a `legacy.balancer.fi` el 30 de noviembre de 2026 a las 10:00 UTC."],
    ["Go to `legacy.balancer.fi` on Nov 30, 2026 at 10:00 UTC.", "`legacy.balancer.fi` へ。2026年11月30日 10:00 UTC。"],
    ["Open https://woofi.com/stake and tap ① Stake", "https://woofi.com/stakeを開き ① Stake をタップ"],
    ["**The only official site is defiexit.com.** We never DM you.", "**El único sitio oficial es defiexit.com.** Nunca te escribimos."],
    ["Contract 0xDA63…FD2b, 0.5 OKB", "Contrato 0xDA63…FD2b, 0,5 OKB"],
    ["One picture per step", "1ステップに1枚"],
    ["more than a thousand addresses", "1,000 以上のアドレス"],
    ["Over $500,000 in old positions", "Más de 500.000 $ en posiciones antiguas"],
    ["e.g. Abstract", "p.ej. Abstract"],
    // 按数值也算对:千分位写成不换行空格、不写千分位;日文韩文的万、億
    ["344,056 FIL is still locked", `344${NBSP}056 FIL sont encore bloqués`],
    ["344,056 FIL is still locked", "344056 FIL bleiben gesperrt"],
    ["About 5.2 million USDC is stuck", "約520万 USDC が残っています"],
    ["About 5.2 million USDC is stuck", "약 520만 USDC가 남아 있습니다"],
    ["Over $500,000 in old positions", "古いポジションに 50万ドル以上"],
    ["$1.5 billion in TVL", "TVL は 15億ドル"],
  ];
  for (const [en, tr] of ok) assert.equal(tokenDiff(en, tr), null, tr);
  const bad = [
    ["Withdraw by Nov 30, 2026.", "Retira antes del 31 de noviembre de 2026.", /数字「30」/],
    ["Wait 7 days.", "Espera 7 días o 8.", /多了英文没有的数字「8」/],
    ["The only official site is defiexit.com.", "El único sitio oficial es defiexit.es.", /域名「defiexit\.com」/],
    ["Open https://woofi.com/stake", "Abre https://woofi.com/", /网址「https:\/\/woofi\.com\/stake」/],
    ["Send to 0x1E69…6036", "Envía a 0x1E69…6037", /0x 地址/],
    ["Type `unstake(tokenId)`", "Escribe `unstake(id)`", /`代码`/],
    ["Sell at {{floorPx}} USDH", "Vende a USDH", /\{\{floorPx\}\}/],
    ["① Tap Stake", "Toca Stake", /编号「①」/],
    ["**Never** share it", "Nunca lo compartas", /粗体/],
    ["Visit `app.x.io`", "Visita `app.x.io` o https://scam.example.com", /多了英文没有的网址/],
    ["Hold $CAKE", "Ten CAKE", /\$CAKE/],
    ["About 5.2 million USDC is stuck", "約52万 USDC が残っています", /数字/],
  ];
  for (const [en, tr, re] of bad) assert.match(tokenDiff(en, tr) || "", re, tr);
  // 英文写成 2026-11-05 的日子,译文可以按这种语言的习惯写:年、日都在,月写成数字或这种语言的月份名(含变格、带数字的月份名)
  const iso = "Below is what the official docs say (checked 2026-11-05). Numbers change.";
  for (const [code, tr] of [
    ["id", "Berikut isi dokumentasi resmi (dicek 5 November 2026). Angkanya bisa berubah."],
    ["vi", "Đây là tài liệu chính thức (kiểm tra ngày 5 tháng 11 năm 2026). Con số có thể thay đổi."],
    ["ja", "公式ドキュメントの内容(2026年11月5日確認)。数字は変わります。"],
    ["ko", "공식 문서 내용입니다(2026년 11월 5일 확인). 숫자는 바뀝니다."],
    ["ru", "Вот что пишут документы (проверено 5 ноября 2026 г.). Цифры меняются."],
    ["de", "Das steht in den Dokumenten (geprüft am 05.11.2026). Zahlen ändern sich."],
    ["tr", "Resmi belgelerde yazanlar (5 Kasım 2026 tarihinde kontrol edildi). Rakamlar değişir."],
    ["fr", "Voici ce que disent les docs (vérifié le 2026-11-05). Les chiffres changent."],
  ]) assert.equal(tokenDiff(iso, tr, code), null, `${code}: ${tr}`);
  assert.match(tokenDiff(iso, "Esto dicen los documentos (revisado el 6 de noviembre de 2026).", "es") || "", /数字/, "日子写错了");
  assert.match(tokenDiff(iso, "Veja os documentos (verificado em 5 de dezembro de 2026).", "pt") || "", /数字「11」/, "月写错了");
  // 中文:拼音文字里一个汉字、中文标点都不能有;日文可以有汉字,不能有只有简体中文才用的字,也不能整句照抄中文;韩文不能有汉字
  assert.equal(chineseIn("es", "Hola 你好"), "你好");
  assert.equal(chineseIn("de", "Gebühr：0"), "：");
  assert.equal(chineseIn("ja", "手数料は 0.01 ドル未満"), null);
  assert.equal(chineseIn("ja", "这一步会动你的资产"), "这");
  assert.equal(chineseIn("ja", "退出截止日历暂停服务", "退出截止日历暂停服务"), "退出截止日历暂停服务");
  assert.equal(chineseIn("ja", "注意", "注意"), null, "短的词日文和中文一样写,不算没翻");
  assert.equal(chineseIn("ja", "数量 × 0.995", "数量 × 0.995"), null, "汉字少的,日文和中文一样写也不算没翻");
  assert.equal(chineseIn("ko", "수수료는 0.01달러 미만"), null);
  assert.equal(chineseIn("ko", "手數料"), "手數料");
  assert.equal(chineseIn("ko", String.fromCodePoint(0xf900)), String.fromCodePoint(0xf900), "兼容汉字也算汉字");
});

test("截止日历、专题译文里照英文写的数,构建时换成这种语言的写法:小数位数不变;已经本地化的、网址、代码、日子、时间、粘着字母的不动;不换行空格原样留着", () => {
  const show = (s) => s.replaceAll(NBSP, "[NB]").replaceAll(NNBSP, "[NNB]");
  const all = "344,056 FIL, 0.2 BNBx, $500,000, 1,707.26 USDH, 0.5%, 2026-11-25 10:00 UTC, V3.5, L2, USDT0, 0xDA63…FD2b, `1,234.5`, https://x.com/a/1.5, 2026, 1:750, Nov 30.";
  assert.equal(localNumbers(all, "de"), "344.056 FIL, 0,2 BNBx, $500.000, 1.707,26 USDH, 0,5%, 2026-11-25 10:00 UTC, V3.5, L2, USDT0, 0xDA63…FD2b, `1,234.5`, https://x.com/a/1.5, 2026, 1:750, Nov 30.");
  assert.equal(show(localNumbers("344,056 и 0.25", "ru")), "344[NB]056 и 0,25");
  assert.equal(localNumbers("US$ 1,234.50", "pt-BR"), "US$ 1.234,50");
  assert.equal(localNumbers("1,000 y 12,345.67", "es"), "1000 y 12.345,67", "西文四位数不分组(Intl 的写法)");
  assert.equal(localNumbers("344,056 と 0.2", "ja"), "344,056 と 0.2", "日文、韩文和英文写法一样");
  // 法文:千分位已经换成不换行空格的不动,带英文小数点的只换小数点;标点前的不换行空格、« » 里的都原样
  const fr = `Il reste 45${NBSP}818 FIL et 45${NBSP}818.5 FIL${NBSP}; « 0.2${NBSP}BNBx »${NBSP}?`;
  assert.equal(show(localNumbers(fr, "fr", "45,818 FIL and 45,818.5 FIL; 0.2 BNBx?")), "Il reste 45[NB]818 FIL et 45[NB]818,5 FIL[NB]; « 0,2[NB]BNBx »[NB]?");
  // 给了英文原文:只换原文里有的数;译文自己换成德文写法的 344.056(就是 344056)不当小数再换
  assert.equal(localNumbers("Noch 344.056 FIL und 0.2 BNBx", "de", "Still 344,056 FIL and 0.2 BNBx"), "Noch 344.056 FIL und 0,2 BNBx");
  assert.equal(localNumbers("Noch 344,056 FIL", "de", "Still 344,056 FIL"), "Noch 344.056 FIL");
  // 换过的再换一遍不变
  assert.equal(localNumbers(localNumbers("344,056 FIL, 0.2", "de", "344,056 FIL, 0.2"), "de", "344,056 FIL, 0.2"), "344.056 FIL, 0,2");
  // 合进截止日历:翻了的换写法,没翻的(英文)原样;没翻的记下来(页面上说一句)
  const bal = D.events.find((e) => e.id === "balancer-winddown"), so = D.events.find((e) => e.id === "sophon-chain-shutdown");
  assert.ok(bal.who.en.includes("$500,000"));
  const X = applyDeadlines(structuredClone(D), "de", { [bal.id]: { who: tag(bal.who.en) } });
  assert.ok(X.events.find((e) => e.id === bal.id).who.de.includes("$500.000"));
  assert.ok(X.events.find((e) => e.id === bal.id).summary.de === bal.summary.en);
  assert.ok(X.partial.has("de"));
  const full = Object.fromEntries(D.events.map((e) => [e.id, {
    ...Object.fromEntries(["name", "summary", "deadlineNote", "who", "todo", "caution"].filter((k) => e[k]).map((k) => [k, e[k].en])),
    official: e.official.map((o) => o.label.en), ...(e.milestones ? { milestones: e.milestones.map((m) => m.note.en) } : {}),
  }]));
  assert.equal(applyDeadlines(structuredClone(D), "de", full).partial, undefined, "全翻了的不记");
  assert.equal(applyDeadlines(structuredClone(D), "de", full).events.find((e) => e.id === so.id).name.de, so.name.en);
  // 专题:标题、一句话没翻的记 partialHead(专题列表上看得到),哪儿没翻都记 partial
  const T = TOPICS.find((x) => x.slug === FIX_TOPIC);
  const t1 = applyTopic(structuredClone(T), "de", { title: tag(T.title.en), summary: tag(T.summary.en) });
  assert.ok(t1.partial.has("de") && !t1.partialHead);
  const t2 = applyTopic(structuredClone(T), "de", {});
  assert.ok(t2.partial.has("de") && t2.partialHead.has("de"));
});

test("截止日历顶上三个数和后面的字:中文、日文、韩文不空格,别的语言空一格;有没翻的地方时,标题下面说一句", () => {
  addUI("ja", {});
  addUI("ko", {});
  const data = (l) => (BASE.includes(l) ? D : applyDeadlines(structuredClone(D), l, {}));
  const jump = (h) => [...h.matchAll(/<li><a href="#(open|nodate|passed)"><b[^>]*>\d+<\/b>( ?)/g)].map((m) => m[2]);
  for (const l of ["zh", "ja", "ko"]) assert.deepEqual(jump(deadlinesPage(texts(l), data(l))), ["", "", ""], l);
  for (const l of ["en", "fr"]) assert.deepEqual(jump(deadlinesPage(texts(l), data(l))), [" ", " ", " "], l);
  assert.ok(deadlinesPage(texts("fr"), data("fr")).includes(`<p class="lead">${texts("fr").h("dlLead")}</p><p class="lang-note" lang="en">`), "没翻的地方:说一句(这句也没翻,标 lang=en)");
  assert.ok(!deadlinesPage(texts("en"), D).includes("lang-note"));
});

test("检测器、X Layer 取法的译文:盖在英文上(一组一组、一条一条),缺的退回英文;中英两套照旧", () => {
  addText("okx-boost", "fr", { total: "[fr] total", row: { locked: (s) => `[fr] ${s}` } });
  const T = pickText("okx-boost", OKX, "fr");
  assert.equal(T.total, "[fr] total");
  assert.equal(T.row.locked("OKB"), "[fr] OKB");
  assert.equal(T.row.end, OKX.en.row.end, "同一组里没翻的用英文");
  assert.equal(T.say.nothing, OKX.en.say.nothing, "没翻的一组用英文");
  assert.equal(pickText("okx-boost", OKX, "fr"), T, "合一次就记住");
  assert.equal(pickText("okx-boost", OKX, "zh"), OKX.zh);
  assert.equal(pickText("okx-boost", OKX, "es"), OKX.en, "没有译文:整套英文");
  addText("xlayer", "fr", { foot: "[fr] foot" });
  assert.equal(pickText("xlayer", HOW, "fr").foot, "[fr] foot");
  assert.equal(pickText("xlayer", HOW, "fr")["okx-boost"], HOW.en["okx-boost"]);
});

test("检测器译文文件:照抄英文的能过;键拼错、类型和参数个数不对、数字网址改了、混中文、函数出错、漏了参数、取法的步骤条数和要复制的网址不对,都报错;文件名要对", async () => {
  for (const code of LANGS.map((l) => l.code).filter((c) => !BASE.includes(c))) for (const [name, en] of Object.entries(DTEXT)) assert.doesNotThrow(() => checkDText(code, name, en, `${name}.${code}.js`), `${code} ${name}`);
  const bad = (name, dict, re, code = "es") => assert.throws(() => checkDText(code, name, dict, `src/js/detectors/i18n/${name}.${code}.js`), re);
  bad("okx-boost", [], /export default/);
  bad("okx-boost", { head: { arrivd: "Llegó" } }, /okx-boost\.es\.js: head\.arrivd:src\/js\/detectors\/okx-boost\.text\.js 的 TEXT\.en 里没有这个键/);
  bad("okx-boost", { row: "x" }, /row 要和英文一样是一组/);
  bad("okx-boost", { total: () => "x" }, /total 要和英文一样是一段文字/);
  bad("okx-boost", { line: { end: (d) => `Desbloqueo: ${d}` } }, /line\.end 的参数要和英文一样/);
  bad("okx-boost", { warn: { lowGas: (x) => `Solo ${x} OKB; envía un poco (0.01 basta)` } }, /warn\.lowGas\(参数都在\):英文里的数字/);
  bad("okx-boost", { row: { locked: (sym) => "Bloqueado" } }, /row\.locked\(参数都在\):英文显示了参数 ⟦a⟧/);
  bad("okx-boost", { arr: { list: (items) => items.map((x) => `${x.amount}`).join(", ") } }, /英文显示了参数 ⟦a\[0\]\.sym⟧/);
  bad("okx-boost", { line: { end: (d, ready) => `${d}${ready.x.y ? "!" : ""}` } }, /line\.end\(参数是 null\)出错了/);
  bad("okx-boost", { say: { nothing: "这个地址没有锁仓" } }, /say\.nothing 里有中文/);
  bad("hyperliquid", { say: { pending: (m) => `Enviado hace ${m} min. Llega en 15 minutos.` } }, /say\.pending\(参数都在\):英文里的数字「5」/);
  const h = HOW.en;
  bad("xlayer", { "okx-boost": (v) => ({ ...h["okx-boost"](v), steps: h["okx-boost"](v).steps.slice(1) }) }, /okx-boost\(参数都在\)\.steps 要和英文一样是 4 条的列表/);
  bad("xlayer", { "okx-boost": (v) => { const o = h["okx-boost"](v); return { ...o, steps: [{ ...o.steps[0], copy: "https://web3.okx.com/es-es/boost/x-launch/plasma" }, ...o.steps.slice(1)] }; } }, /steps\[0\]\.copy:英文里的网址/);
  bad("xlayer", { dyorswap: (v) => ({ ...h.dyorswap(v), extra: "x" }) }, /dyorswap\(参数都在\)\.extra:英文回的没有这一项/);
  assert.doesNotThrow(() => checkDText("es", "xlayer", { foot: "Estos pasos se comprobaron en el sitio oficial y en los contratos." }, "xlayer.es.js"));
  // 译文自己防着参数为空(英文这样调用会出错的那一遍不比):不算错
  const HLen = DTEXT.hyperliquid;
  assert.doesNotThrow(() => checkDText("es", "okx-boost", { arr: { list: (items) => (items || []).map((x) => `${x.amount} ${x.sym}`).join(", ") } }, "okx-boost.es.js"));
  assert.doesNotThrow(() => checkDText("es", "hyperliquid", { choice: { sellBody: (amount, s) => (s ? HLen.choice.sellBody(amount, s) : "") } }, "hyperliquid.es.js"));
  assert.doesNotThrow(() => checkDText("es", "xlayer", { "okx-boost": (v) => (v ? h["okx-boost"](v) : {}) }, "xlayer.es.js"));
  assert.doesNotThrow(() => checkDText("ru", "okx-boost", { arr: { list: (items) => (Array.isArray(items) ? items : []).map((x) => `${x?.amount} ${x?.sym}`).join(", ") } }, "okx-boost.ru.js"), "Array.isArray 防着不是列表的,替身参数照样是列表");
  // 文件名:<名字>.<编号>.js
  const dir = tmp("dx-dt-");
  try {
    const at = join(dir, "src", "js", "detectors", "i18n");
    mkdirSync(at, { recursive: true });
    assert.deepEqual(await loadDTexts(dir), {});
    writeFileSync(join(at, "okx.es.js"), "export default {};");
    await assert.rejects(loadDTexts(dir), /okx\.es\.js: 文件名要是 <名字>\.<编号>\.js/);
    rmSync(join(at, "okx.es.js"));
    writeFileSync(join(at, "woofi.zh.js"), "export default {};");
    await assert.rejects(loadDTexts(dir), /woofi\.zh\.js: 文件名要是/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("页面代码、构建脚本里不再按「不是英文就是中文」分支:日期数字的写法、列举的分隔符、网址前缀都从 lib/langs.js 取", () => {
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.m?js$/.test(f)) files.push(p); } };
  walk("src/js");
  walk("scripts");
  for (const f of files) {
    if (f.replace(/\\/g, "/").endsWith("src/js/lib/langs.js")) continue;
    const s = read(f);
    assert.ok(!/(lang|code|l)\s*[!=]==?\s*"en"\s*\?/.test(s), `${f}:按是不是英文分支`);
    assert.ok(!/toLocaleString\("(zh-CN|en-US)"/.test(s), `${f}:写死了地区`);
    assert.ok(!/\|\|\s*TEXT\.zh\b/.test(s), `${f}:没有译文时退回了中文`);
  }
});

test("界面文字文件:每个函数都有样例参数;照抄英文的一份能过;键拼错、类型不对、参数个数不对、空的、数字和网址改了、混着中文、函数出错或漏了参数,都报错", () => {
  const fns = Object.keys(STR.en).filter((k) => typeof STR.en[k] === "function");
  assert.deepEqual(fns.filter((k) => !SAMPLES[k]), [], "新加的函数要在 scripts/i18n.mjs 的 SAMPLES 里给几组样例参数");
  assert.deepEqual(Object.keys(SAMPLES).filter((k) => typeof STR.en[k] !== "function"), []);
  for (const k of fns) for (const args of SAMPLES[k]) assert.equal(typeof STR.en[k](...args), "string", k);
  assert.doesNotThrow(() => checkUI("de", { ...STR.en }, "de.js"));
  assert.doesNotThrow(() => checkUI("es", { checkTitle: "Resultados", foundN: (n) => (n === 1 ? "Encontramos dinero en un lugar" : `Encontramos dinero en ${n} lugares`) }, "es.js"));
  const bad = (dict, re, code = "es") => assert.throws(() => checkUI(code, dict, "src/js/lib/i18n/es.js"), re);
  bad([], /export default/);
  bad({ checkTitel: "x" }, /src\/js\/lib\/i18n\/es\.js: checkTitel 不是界面文字的键/);
  bad({ checkTitle: () => "x" }, /checkTitle 要和英文一样是一段文字/);
  bad({ foundN: "x" }, /foundN 要和英文一样是函数/);
  bad({ stepOf: (i) => `${i}` }, /stepOf 的参数要和英文一样/);
  bad({ checkTitle: "  " }, /checkTitle 要是不空的一段文字/);
  bad({ addrPlaceholder: "Empieza por 0x, 40 caracteres" }, /addrPlaceholder:英文里的数字「42」/);
  bad({ footOfficial: STR.en.footOfficial.replace("defiexit.com", "defiexit.io") }, /footOfficial:英文里的域名/);
  bad({ footOfficial: STR.en.footOfficial.replace(/\*\*/g, "") }, /粗体/);
  bad({ checkTitle: "Resultados 结果" }, /checkTitle 里有中文「结果」/);
  bad({ checkTitle: "检查结果" }, /checkTitle 里有中文/, "ja");
  bad({ foundN: (n) => { throw new Error(`boom ${n}`); } }, /foundN\(1\) 出错了:boom 1/);
  bad({ exitGasOk: (qty, sym) => `${qty} disponibles` }, /exitGasOk\("0\.0123", "ETH"\):英文显示了参数「ETH」/);
  bad({ stepsAt: (ns) => `Pasos ${ns[0]}` }, /stepsAt\(\[8,9\]\):英文显示了参数「9」/);
  bad({ dueLeft: (x) => `${x.dias} días` }, /dueLeft\(.*\) 回的文字里有「undefined」/);
  bad({ assetType: (k) => 3 }, /assetType\("deposit"\) 要回一段不空的文字/);
  bad({ tpGuide: (t) => `指南:${t}` }, /tpGuide\("WOOFi to your wallet"\) 回的文字里有中文「指南」/);
});

test("照抄英文的译文(整份截止日历、每篇专题、每份指南)对每一种新语言都能过:核对规则不会误伤现有的原文", () => {
  const codes = LANGS.map((l) => l.code).filter((c) => !BASE.includes(c));
  const dl = Object.fromEntries(D.events.map((e) => [e.id, {
    ...Object.fromEntries(["name", "summary", "deadlineNote", "who", "todo", "caution"].filter((k) => e[k]).map((k) => [k, e[k].en])),
    official: e.official.map((o) => o.label.en), ...(e.milestones ? { milestones: e.milestones.map((m) => m.note.en) } : {}),
  }]));
  const recipes = ["hyperliquid", "woofi", "okx-boost", "dyorswap"].map((id) => [id, JSON.parse(read(`recipes/${id}/recipe.json`)), JSON.parse(read(`recipes/${id}/i18n/en.json`))]);
  for (const code of codes) {
    assert.doesNotThrow(() => checkDeadlineOverlay(code, dl, D, "deadlines.json", CHECKS), code);
    for (const T of TOPICS) {
      const o = { title: T.title.en, summary: T.summary.en, sections: T.sections.map((s) => ({ h: s.h.en, p: (s.p || []).map((x) => x.en), list: (s.list || []).map((x) => x.en) })), sources: T.sources.map((s) => s.label.en), ...(T.faq ? { faq: T.faq.map((x) => ({ q: x.q.en, a: x.a.en })) } : {}) };
      assert.doesNotThrow(() => checkTopicOverlay(code, o, T, `${T.slug}.json`, CHECKS), `${code} ${T.slug}`);
    }
    for (const [id, r, en] of recipes) assert.doesNotThrow(() => localize(r, checkRecipeOverlay(code, structuredClone(en), en, `${id}/${code}.json`), `${id}/${code}.json`, code), `${code} ${id}`);
  }
});

test("截止日历译文:写错了构建报错(哪个文件、哪一条、错在哪);合进去以后没翻的地方用英文", () => {
  const so = D.events.find((e) => e.id === "sophon-chain-shutdown"), sx = D.events.find((e) => e.id === "standx-winddown");
  const good = { [so.id]: { name: tag(so.name.en), summary: tag(so.summary.en), official: so.official.map((o) => tag(o.label.en)) }, [sx.id]: { milestones: sx.milestones.map((m) => tag(m.note.en)) } };
  assert.doesNotThrow(() => checkDeadlineOverlay("de", good, D, "x.json", CHECKS));
  const bad = (mut, re) => {
    const o = structuredClone(good);
    mut(o);
    assert.throws(() => checkDeadlineOverlay("de", o, D, "data/i18n/de/deadlines.json", CHECKS), re);
  };
  bad((o) => { o["no-such-event"] = { name: "x" }; }, /data\/i18n\/de\/deadlines\.json: no-such-event 不是 data\/deadlines\.json 里的事件编号/);
  bad((o) => { o[so.id].title = "x"; }, /sophon-chain-shutdown\.title 不是能翻的字段/);
  bad((o) => { o[so.id].milestones = ["x"]; }, /sophon-chain-shutdown\.milestones:这一条没有 milestones/);
  bad((o) => { o[so.id].official.pop(); }, /sophon-chain-shutdown\.official 要是 3 条的列表/);
  bad((o) => { o[so.id].name = ""; }, /sophon-chain-shutdown\.name 要是不空的一段文字/);
  bad((o) => { o[so.id].summary = o[so.id].summary.replace("Nov 25", "Nov 26"); }, /summary:英文里的数字「25」/);
  bad((o) => { o[so.id].who = so.who.en.replace("SOPH", "SOPH 和"); }, /who 里有中文/);
  bad((o) => { o[so.id].name = "Claim your Sophon funds"; }, /claim/);
  bad((o) => { o[so.id].summary = `${so.summary.en} ${"x".repeat(200)}`; }, /summary 太长/);
  bad((o) => { o[sx.id] = "x"; }, /standx-winddown 要是 \{ 字段: 译文 \}/);
  const caution = D.events.find((e) => !e.caution);
  if (caution) bad((o) => { o[caution.id] = { caution: "x" }; }, new RegExp(`${caution.id}\\.caution:这一条没有 caution`));
  // 合进去:翻了的用译文,没翻的(别的事件、这一条没翻的字段)用英文
  const X = applyDeadlines(structuredClone(D), "de", good);
  const e = (id) => X.events.find((y) => y.id === id);
  assert.equal(e(so.id).name.de, tag(so.name.en));
  assert.equal(e(so.id).todo.de, so.todo.en);
  assert.equal(e(so.id).official[1].label.de, tag(so.official[1].label.en));
  assert.equal(e(sx.id).milestones[0].note.de, tag(sx.milestones[0].note.en));
  assert.equal(e("balancer-winddown").summary.de, e("balancer-winddown").summary.en);
  assert.equal(e(so.id).name.zh, so.name.zh, "中英两套不动");
});

test("专题译文:字段、条数一条一条对上;原文没有的 p、list 可以不写或写空列表;合进去以后没翻的地方用英文", () => {
  const T = TOPICS.find((x) => x.slug === FIX_TOPIC);
  const good = {
    title: tag(T.title.en), summary: tag(T.summary.en),
    sections: T.sections.map((s) => ({ h: tag(s.h.en), p: (s.p || []).map((x) => tag(x.en)), list: (s.list || []).map((x) => tag(x.en)) })),
    faq: (T.faq || []).map((x) => ({ q: tag(x.q.en), a: tag(x.a.en) })), sources: T.sources.map((s) => tag(s.label.en)),
  };
  assert.doesNotThrow(() => checkTopicOverlay("de", good, T, "t.json", CHECKS));
  assert.doesNotThrow(() => checkTopicOverlay("de", { title: good.title }, T, "t.json", CHECKS), "只翻了标题也行");
  const noList = T.sections.findIndex((s) => !s.list?.length);
  const bad = (mut, re) => {
    const o = structuredClone(good);
    mut(o);
    assert.throws(() => checkTopicOverlay("de", o, T, `data/i18n/de/topics/${FIX_TOPIC}.json`, CHECKS), re);
  };
  bad((o) => { o.intro = "x"; }, /intro 不是能翻的字段/);
  bad((o) => { o.sections.pop(); }, new RegExp(`sections 要是 ${T.sections.length} 条的列表`));
  bad((o) => { o.sections[0].p.pop(); }, /sections\[0\]\.p 要是 \d+ 条的列表/);
  bad((o) => { o.sections[0].note = "x"; }, /sections\[0\]\.note 不是能翻的字段/);
  bad((o) => { o.faq[0] = { q: o.faq[0].q }; }, /faq\[0\]\.a 要是不空的一段文字/);
  bad((o) => { o.sources = o.sources.slice(1); }, /sources 要是 \d+ 条的列表/);
  bad((o) => { o.title = "Recover your stake"; }, /title 里不写/);
  if (noList >= 0) {
    const o = structuredClone(good);
    delete o.sections[noList].list;
    assert.doesNotThrow(() => checkTopicOverlay("de", o, T, "t.json", CHECKS), "原文没有 list 的,译文不写也行");
    bad((x) => { x.sections[noList].list = ["extra"]; }, new RegExp(`sections\\[${noList}\\]\\.list 要是 0 条的列表`));
  }
  const X = applyTopic(structuredClone(T), "de", { title: good.title, sections: [good.sections[0]] });
  assert.equal(X.title.de, good.title);
  assert.equal(X.summary.de, T.summary.en);
  assert.equal(X.sections[0].h.de, good.sections[0].h);
  assert.equal(X.sections[1].h.de, T.sections[1].h.en);
  assert.equal(X.sources[0].label.de, T.sources[0].label.en);
});

test("指南译文:和 en.json 结构一模一样、不能改的都留着,再走英文版那一套 localize;还剩中文的报错(日文按日文的规矩)", () => {
  const r = JSON.parse(read(`recipes/${FIX_RECIPE}/recipe.json`)), en = JSON.parse(read(`recipes/${FIX_RECIPE}/i18n/en.json`));
  const fixRoot = makeFixtureRoot(tmp("dx-fix-"), process.cwd());
  const de = JSON.parse(read(join(fixRoot, "recipes", FIX_RECIPE, "i18n", "de.json")));
  const file = `recipes/${FIX_RECIPE}/i18n/de.json`;
  const L = localize(r, checkRecipeOverlay("de", de, en, file), file, "de");
  assert.equal(L.title, tag(en.title));
  assert.equal(L.official[0].url, en.official[0].url, "网址照英文版");
  const bad = (mut, re, code = "de") => {
    const o = structuredClone(de);
    mut(o);
    assert.throws(() => checkRecipeOverlay(code, o, en, file), re);
  };
  bad((o) => { delete o.summary; }, /recipes\/okx-boost\/i18n\/de\.json: 缺 summary/);
  bad((o) => { o.subtitle = "x"; }, /subtitle 是 en\.json 里没有的字段/);
  bad((o) => { o.facts.pop(); }, /facts 要是 \d+ 条的列表/);
  bad((o) => { o.official[0].url = "https://web3.okx.com/de/boost/x-launch/plasma"; }, /official\[0\]\.url:英文里的网址/);
  bad((o) => { o.pro[2] = o.pro[2].replace("{{got}}", "die Token"); }, /pro\[2\]:英文里的\{\{变量\}\}「\{\{got\}\}」/);
  bad((o) => { o.chips[0] = 2; }, /chips\[0\] 要是不空的一段文字/);
  // 截图说明里对着红框的编号、开头的「! 」「✗ 」不能丢
  const step = Object.keys(en.steps).find((k) => (en.steps[k].images || []).some((im) => /[①-⑨]/.test(typeof im === "string" ? im : im.caption)));
  const i = en.steps[step].images.findIndex((im) => /[①-⑨]/.test(typeof im === "string" ? im : im.caption));
  bad((o) => { const im = o.steps[step].images[i]; if (typeof im === "string") o.steps[step].images[i] = im.replace(/[①-⑨]/g, ""); else im.caption = im.caption.replace(/[①-⑨]/g, ""); }, /编号/);
  // 页面按记号拆段、上色的两处:步骤条目开头的「✗ 」(红色:别这样做)丢了;截图说明里多出前后带空格的「 ! 」(法文习惯),
  // 会被拆成一段提示。条目中间、别的文字里的「 ! 」不管。WOOFi 的指南里两种都有
  const wEn = JSON.parse(read("recipes/woofi/i18n/en.json")), wFile = "recipes/woofi/i18n/fr.json";
  assert.doesNotThrow(() => checkRecipeOverlay("fr", structuredClone(wEn), wEn, wFile), "照抄英文的一份能过");
  const tipAt = Object.keys(wEn.steps).find((k) => (wEn.steps[k].items || []).some((x) => /^✗ /.test(x)));
  const j = wEn.steps[tipAt].items.findIndex((x) => /^✗ /.test(x));
  const noMark = structuredClone(wEn);
  noMark.steps[tipAt].items[j] = noMark.steps[tipAt].items[j].replace(/^✗ /, "");
  assert.throws(() => checkRecipeOverlay("fr", noMark, wEn, wFile), new RegExp(`steps\\.${tipAt}\\.items\\[${j}\\]:开头要和英文一样是「✗ 」`));
  const okBang = structuredClone(wEn);
  okBang.steps[tipAt].items[j] = `${okBang.steps[tipAt].items[j]} Attention ! Ne signez rien.`;
  okBang.summary = `${okBang.summary} Attention ! Lisez tout.`;
  assert.doesNotThrow(() => checkRecipeOverlay("fr", okBang, wEn, wFile), "条目中间、概要里的「 ! 」页面不拆,不管");
  const capAt = Object.keys(wEn.steps).find((k) => (wEn.steps[k].images || []).some((im) => typeof im === "string"));
  const c = wEn.steps[capAt].images.findIndex((im) => typeof im === "string");
  const frBang = structuredClone(wEn);
  frBang.steps[capAt].images[c] = `${frBang.steps[capAt].images[c]} Attention ! Ne signez rien.`;
  assert.throws(() => checkRecipeOverlay("fr", frBang, wEn, wFile), new RegExp(`steps\\.${capAt}\\.images\\[${c}\\]:截图说明里前后带空格的「! 」「✗ 」要和英文一样`));
  // 翻好以后还剩中文:不在 en.json 里、从中文配方带过来的那几处也算
  assert.throws(() => localize(r, { ...structuredClone(de), title: "OKX Boost 取回" }, file, "de"), /译文里还有中文「取回」/);
  assert.throws(() => localize(r, { ...structuredClone(de), title: "OKX Boost 活动锁仓取回钱包" }, file, "ja"), /译文里还有中文/);
  assert.doesNotThrow(() => localize(r, { ...structuredClone(de), title: "OKX Boost のロックを取り出す" }, file, "ja"));
  // i18n/ 下面只放 en.json 和登记过的新语言
  const dir = tmp("dx-r-");
  mkdirSync(join(dir, "recipes", "x", "i18n"), { recursive: true });
  for (const f of ["en.json", "de.json"]) writeFileSync(join(dir, "recipes", "x", "i18n", f), "{}");
  assert.deepEqual(recipeLangs(dir, "x"), ["de"]);
  writeFileSync(join(dir, "recipes", "x", "i18n", "zh.json"), "{}");
  assert.throws(() => recipeLangs(dir, "x"), /recipes\/x\/i18n\/zh\.json: 这里只放 en\.json 和登记过的新语言/);
  rmSync(dir, { recursive: true, force: true });
  rmSync(fixRoot, { recursive: true, force: true });
});

test("译文文件放错地方:data/i18n 下面的未知语言、未知文件、对不上的专题,界面文字目录里的中英文件、未知语言,都报错", async () => {
  const dir = tmp("dx-o-");
  const at = (...p) => join(dir, ...p);
  const put = (p, s) => { mkdirSync(join(p, ".."), { recursive: true }); writeFileSync(p, s); };
  const reads = () => readDataOverlays(dir, D, TOPICS, CHECKS);
  try {
    assert.deepEqual(reads(), {});
    put(at("data", "i18n", "de", "deadlines.json"), "{}");
    put(at("data", "i18n", "de", "topics", `${FIX_TOPIC}.json`), "{}");
    assert.deepEqual(reads(), { de: { deadlines: {}, topics: { [FIX_TOPIC]: {} } } });
    put(at("data", "i18n", "de", "topics", "nope.json"), "{}");
    assert.throws(reads, /data\/i18n\/de\/topics\/nope\.json: data\/topics 里没有这篇专题/);
    rmSync(at("data", "i18n", "de", "topics", "nope.json"));
    put(at("data", "i18n", "de", "deadline.json"), "{}");
    assert.throws(reads, /data\/i18n\/de\/deadline\.json: data\/i18n\/de\/ 下面只放 deadlines\.json 和 topics/);
    rmSync(at("data", "i18n", "de", "deadline.json"));
    put(at("data", "i18n", "de", "deadlines.json"), "{ not json");
    assert.throws(reads, /data\/i18n\/de\/deadlines\.json: 不是合法的 JSON/);
    put(at("data", "i18n", "de", "deadlines.json"), "{}");
    put(at("data", "i18n", "it", "deadlines.json"), "{}");
    assert.throws(reads, /data\/i18n\/it: data\/i18n 下面只放登记过的新语言/);
    rmSync(at("data", "i18n", "it"), { recursive: true });
    // 界面文字目录
    assert.deepEqual(await loadUI(dir), ["zh", "en"], "没有界面文字文件:只出中英");
    put(at("src", "js", "lib", "i18n", "zh.js"), "export default {};");
    await assert.rejects(loadUI(dir), /src\/js\/lib\/i18n\/zh\.js: 只放登记过的新语言的界面文字/);
    rmSync(at("src", "js", "lib", "i18n", "zh.js"));
    put(at("src", "js", "lib", "i18n", "xx.js"), "export default {};");
    await assert.rejects(loadUI(dir), /xx\.js: 只放登记过的新语言的界面文字/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("语言菜单:<details> 下拉,列出这次出了的每一种语言(本族语名字、hreflang、lang),当前的标 aria-current;按钮写短名,读屏读全名;不用内联样式", async () => {
  const zh = langSwitch("zh", "/deadlines/", texts("zh")), en = langSwitch("en", "/", texts("en"));
  assert.ok(zh.startsWith('<nav class="langs" aria-label="语言"><details class="lang-menu"><summary>'), zh);
  assert.ok(zh.includes('<span class="lm-cur">中文</span>') && en.includes('<span class="lm-cur" aria-hidden="true">EN</span><span class="sr-only">English</span>'));
  assert.ok(zh.includes('<a href="/deadlines/" hreflang="zh-CN" lang="zh-CN" data-lang="zh" aria-current="page"><span>中文</span>'));
  assert.ok(zh.includes('<a href="/en/deadlines/" hreflang="en" lang="en" data-lang="en"><span>English</span></a>'));
  assert.equal(zh.match(/aria-current/g).length, 1);
  assert.equal(en.match(/<li>/g).length, (await loadUI(process.cwd())).length, "出了几种语言就列几种");
  for (const h of [zh, en]) assert.ok(!/\sstyle=|<script/.test(h));
});

test("首页跳转(boot.js):中文首页、没选过语言、浏览器也不是中文的,按浏览器的语言去出了的那一版,没有就去英文版;选过语言、浏览器有中文的不跳", () => {
  const src = read("src/js/boot.js");
  const run = ({ langs, built = ["zh-CN", "en"], saved = null, page = "home", lang = "zh-CN" }) => {
    let to = null;
    const alts = [...built, "x-default"].map((h) => ({ getAttribute: () => h, href: `https://defiexit.com${h === "x-default" ? "/en" : prefixOf(langOf(h))}/` }));
    const ctx = {
      document: { documentElement: { lang, getAttribute: () => page, setAttribute() {} }, querySelectorAll: () => alts },
      navigator: { languages: langs }, localStorage: { getItem: (k) => (k === "dx-lang" ? saved : null) },
      location: { hash: "#a=0x1", replace: (u) => { to = u; } }, URL,
    };
    vm.runInNewContext(src, ctx);
    return to;
  };
  assert.equal(run({ langs: ["en-US"] }), "/en/#a=0x1");
  assert.equal(run({ langs: ["de-DE", "en"] }), "/en/#a=0x1", "德文还没出:去英文版");
  assert.equal(run({ langs: ["de-DE", "en"], built: ["zh-CN", "en", "de"] }), "/de/#a=0x1");
  assert.equal(run({ langs: ["pt-PT"], built: ["zh-CN", "en", "pt-BR"] }), "/pt/#a=0x1", "按主语言对上");
  assert.equal(run({ langs: ["fr", "zh-CN"], built: ["zh-CN", "en", "fr"] }), null, "浏览器里有中文:照旧不跳");
  assert.equal(run({ langs: ["de"], built: ["zh-CN", "en", "de"], saved: "zh" }), null, "选过语言的不跳");
  assert.equal(run({ langs: ["de"], built: ["zh-CN", "en", "de"], page: "check" }), null, "只有首页跳");
});

test("中文标点只在中文页面上换:截止日历页的重标、页面上动态建的字(日文、韩文页面上不换)", async () => {
  const { relabel } = await import("../src/js/lib/relabel.js");
  const span = { textContent: "" };
  const pill = { className: "", querySelector: () => span };
  const art = { dataset: { deadline: "2026-11-06" }, querySelector: () => pill };
  const doc = { getElementById: () => null, querySelectorAll: (s) => (s === ".dl[data-deadline]" ? [art] : []) };
  relabel(doc, makeT("zh"), new Date("2026-11-06T05:00:00Z"));
  assert.equal(span.textContent, "按 UTC 算，今天是截止日（11 月 6 日）");
  span.textContent = "";
  relabel(doc, makeT("zh"), new Date("2026-11-06T05:00:00Z"), "ja");
  assert.equal(span.textContent, "按 UTC 算,今天是截止日(11 月 6 日)", "别的语言不换");
  // ui.js 的 el():按页面的 <html lang>
  class N { constructor() { this.children = []; } setAttribute() {} append(...x) { this.children.push(...x); } }
  globalThis.Node = N;
  globalThis.document = { documentElement: { lang: "ja" }, createElement: () => new N(), createElementNS: () => new N() };
  const { el } = await import("../src/js/lib/ui.js");
  assert.deepEqual(el("p", {}, "残り:3 日(UTC)").children, ["残り:3 日(UTC)"]);
  globalThis.document.documentElement.lang = "zh-CN";
  assert.deepEqual(el("p", {}, "还有:3 天(UTC)").children, ["还有：3 天（UTC）"]);
});

test("样例语言从头到尾走一遍构建:页面、hreflang、og:locale、语言菜单、界面文字(缺的退回英文)、截止日历和专题的译文、没翻的指南用英文并说一句、404、_headers", async () => {
  const fixRoot = makeFixtureRoot(tmp("dx-fix-"), process.cwd());
  const out = tmp("dx-out-");
  try {
    const langs = await loadUI(fixRoot), dtexts = await loadDTexts(fixRoot);
    assert.deepEqual(langs, ["zh", "en", "de"]);
    assert.deepEqual(dtexts, { de: ["okx-boost"] });
    build({ out, i18nRoot: fixRoot, langs, dtexts });
    const P = (p) => read(join(out, p));
    const home = P("de/index.html");
    assert.match(home, /<html lang="de" data-page="home">/);
    assert.ok(home.includes('<meta property="og:locale" content="de_DE">') && home.includes('<link rel="canonical" href="https://defiexit.com/de/">'));
    for (const [h, u] of [["zh-CN", "/"], ["en", "/en/"], ["de", "/de/"], ["x-default", "/en/"]]) assert.ok(home.includes(`<link rel="alternate" hreflang="${h}" href="https://defiexit.com${u}">`), h);
    // 先装界面文字,再跑主脚本;中英页面不带这一段
    assert.ok(home.includes('<script type="module" src="/assets/js/lang/de.js"></script>\n<script type="module" src="/assets/js/home.js"></script>'));
    assert.ok(!P("index.html").includes("/assets/js/lang/") && !P("en/index.html").includes("/assets/js/lang/"));
    assert.equal(P("assets/js/lib/i18n/de.js"), read("test/fixtures/i18n/src/js/lib/i18n/de.js"));
    assert.equal(P("assets/js/detectors/i18n/okx-boost.de.js"), read("test/fixtures/i18n/src/js/detectors/i18n/okx-boost.de.js"));
    // 装译文的那一段:界面文字进 i18n.js,检测器的话进 lib/dtext.js
    assert.match(P("assets/js/lang/de.js"), /import ui from "\.\.\/lib\/i18n\/de\.js";\nimport \{ addUI \} from "\.\.\/lib\/i18n\.js";\nimport \{ addText \} from "\.\.\/lib\/dtext\.js";\nimport t0 from "\.\.\/detectors\/i18n\/okx-boost\.de\.js";\n\naddUI\("de", ui\);\naddText\("okx-boost", "de", t0\);\n$/);
    // 界面文字:写了的用样例,没写的用英文
    assert.ok(home.includes("[de] Read-only · Open source · Free") && home.includes(`<h1 class="display">${STR.en.heroH1a} <span class="hl">${STR.en.heroH1b}</span></h1>`));
    // 语言菜单:三种都在,德文标成当前;中英页面也列出德文
    assert.ok(home.includes('<a href="/de/" hreflang="de" lang="de" data-lang="de" aria-current="page"><span>Deutsch</span>'));
    assert.ok(home.includes('<span class="lm-cur" aria-hidden="true">DE</span><span class="sr-only">Deutsch</span>'));
    assert.ok(P("index.html").includes('<a href="/de/" hreflang="de" lang="de" data-lang="de"><span>Deutsch</span></a>'));
    assert.ok(P("en/deadlines/index.html").includes('<link rel="alternate" hreflang="de" href="https://defiexit.com/de/deadlines/">'));
    // 截止日历:Sophon 翻了名字、一句话、官方链接,别的字段用英文;倒数用样例的 dlLeft;转给朋友的字是译文、网址带 /de/
    const dl = P("de/deadlines/index.html"), so = D.events.find((e) => e.id === "sophon-chain-shutdown");
    const entry = dl.slice(dl.indexOf('<article class="dl" id="sophon-chain-shutdown"'), dl.indexOf("</article>", dl.indexOf('<article class="dl" id="sophon-chain-shutdown"')));
    assert.ok(entry.includes(`<h3 id="h-sophon-chain-shutdown">[de] ${so.name.en}</h3>`));
    assert.ok(entry.includes(`<span>[de] ${so.official[0].label.en}</span>`));
    assert.ok(entry.includes(`<dd>${so.who.en.replace(/&/g, "&amp;")}</dd>`), "没翻的字段用英文");
    assert.match(entry, /<span class="dl-left [a-z]+"><svg[^>]*>[\s\S]*?<\/svg><span>\[de\] [^<]+<\/span>/, "倒数用样例的 dlLeft(哪天跑测试都行)");
    const txt = (s) => s.replace(/\*\*|`/g, "").trim();
    const share = new URL(entry.match(/<a class="xshare" href="([^"]+)"/)[1].replace(/&amp;/g, "&"));
    assert.equal(share.searchParams.get("text"), `[de] ${txt(so.summary.en)}\nhttps://defiexit.com/de/deadlines/#sophon-chain-shutdown`);
    const sx = D.events.find((e) => e.id === "standx-winddown");
    assert.ok(dl.includes(tag(sx.milestones[0].note.en)), "分几步截止的那几步也换了");
    // 译文里照英文写的金额换成德文写法($500,000 → $500.000);没翻的(英文)不换;有没翻的地方,标题下面说一句(样例没翻这一句,标 lang=en)
    const bal = dl.slice(dl.indexOf('<article class="dl" id="balancer-winddown"'), dl.indexOf("</article>", dl.indexOf('<article class="dl" id="balancer-winddown"')));
    assert.ok(bal.includes("$500.000") && !bal.includes("$500,000"), "译文里的金额换了写法");
    assert.ok(dl.includes(`<p class="lead">${STR.en.dlLead}</p><p class="lang-note" lang="en">`), "有没翻的地方:说一句");
    assert.match(dl, /<a href="#open"><b data-n="open">\d+<\/b> /, "德文:数和后面的字空一格");
    // 体检结果页嵌的截止日历也是这一种语言的(翻了的用译文,没翻的用英文;只嵌还没过的,哪天跑测试都对)
    const due = [...P("de/check/index.html").matchAll(/<li data-event="([^"]*)"><\/li>/g)].map((m) => JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")));
    assert.ok(due.length > 0);
    for (const x of due) assert.equal(x.name, txt(x.id === so.id ? tag(so.name.en) : D.events.find((e) => e.id === x.id).name.en), x.id);
    // 专题:翻了的那篇用译文,别的用英文;列表里两种都有
    const T = TOPICS.find((x) => x.slug === FIX_TOPIC), other = TOPICS.find((x) => x.slug !== FIX_TOPIC);
    assert.ok(P(`de/topics/${FIX_TOPIC}/index.html`).includes(`<title>[de] ${txt(T.title.en)} · DeFiExit</title>`));
    assert.ok(P(`de/topics/${other.slug}/index.html`).includes(`<title>${txt(other.title.en)} · DeFiExit</title>`));
    assert.ok(P("de/topics/index.html").includes(`<a href="/de/topics/${FIX_TOPIC}/">`));
    // 整篇翻了的不说;没翻的那几篇、列表(有几篇的标题没翻)说一句
    assert.ok(!P(`de/topics/${FIX_TOPIC}/index.html`).includes("lang-note") && P(`de/topics/${other.slug}/index.html`).includes('<p class="lang-note" lang="en">'));
    assert.ok(P("de/topics/index.html").includes('<p class="lang-note" lang="en">'));
    assert.ok(!P("topics/index.html").includes("lang-note") && !P("en/deadlines/index.html").includes("lang-note"), "中英页面不说");
    // 指南:翻了的(okx-boost)用译文、不说「英文版」;没翻的用英文,标题下面说一句
    const ok = P(`de/r/${FIX_RECIPE}/index.html`), hl = P("de/r/hyperliquid/index.html");
    const enTitle = (id) => JSON.parse(read(`recipes/${id}/i18n/en.json`)).title;
    assert.ok(ok.includes(`<h1 class="display">${tag(enTitle(FIX_RECIPE))}</h1>`) && !ok.includes("lang-note"));
    assert.ok(hl.includes(`<h1 class="display">${enTitle("hyperliquid")}</h1><p class="lang-note">`));
    assert.ok(hl.includes("<span>[de] This guide is shown in English for now.</span>"));
    assert.ok(!P("en/r/hyperliquid/index.html").includes("lang-note"), "英文版本身不说");
    // 404:翻了那两句的语言多一行;_headers 每一页都带 no-transform
    assert.ok(P("404.html").includes('<ul class="nf-langs"><li lang="de">[de] Page not found · <a href="/de/">[de] Back to home</a></li></ul>'));
    const headers = P("_headers");
    for (const p of ["/de/", "/de/check/", "/de/r/hyperliquid/", `/de/r/${FIX_RECIPE}/`, "/de/deadlines/", "/de/topics/", `/de/topics/${FIX_TOPIC}/`]) assert.ok(headers.includes(`\n${p}\n  Cache-Control: public, max-age=0, must-revalidate, no-transform\n`), p);
    // 德文页面:除了语言菜单,一个汉字都没有;不用内联脚本和样式
    for (const f of ["de/index.html", "de/check/index.html", "de/r/hyperliquid/index.html", `de/r/${FIX_RECIPE}/index.html`, "de/deadlines/index.html", "de/topics/index.html", `de/topics/${FIX_TOPIC}/index.html`]) {
      const h = P(f);
      assert.equal(noMenu(h).match(CJK), null, f);
      assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>/.test(h) && !/\sstyle="/.test(h), f);
    }
    // 中文页面也照常带上新语言的 hreflang,别的不变
    assert.ok(P("index.html").includes('<link rel="alternate" hreflang="de" href="https://defiexit.com/de/">'));
    assert.ok(existsSync(join(out, "r", FIX_RECIPE, "screens.json")));
  } finally {
    rmSync(out, { recursive: true, force: true });
    rmSync(fixRoot, { recursive: true, force: true });
  }
});

// 放在最后:会把十种语言的界面文字都换成空的(全用英文),别的测试装的样例就被盖掉了
test("每一种语言都出一遍(都还没有译文,全用英文):中文以外的页面上,除了语言菜单,一个汉字、中文标点都没有;体检结果页顶上的截止提醒卡也一样", async () => {
  const root = tmp("dx-all-"), out = tmp("dx-allout-");
  try {
    writeFileSync(join(root, "package.json"), '{ "type": "module" }\n');
    mkdirSync(join(root, "src", "js", "lib", "i18n"), { recursive: true });
    const codes = LANGS.map((l) => l.code).filter((c) => !BASE.includes(c));
    for (const c of codes) writeFileSync(join(root, "src", "js", "lib", "i18n", `${c}.js`), "export default {};\n");
    const langs = await loadUI(root);
    assert.equal(langs.length, 12);
    build({ out, i18nRoot: root, langs, dtexts: {} });
    const pages = (dir) => readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? pages(p) : f.endsWith(".html") ? [p] : [];
    });
    // 体检结果页顶上的提醒卡:浏览器里按嵌进页面的截止日历现画(lib/due.js),这里用很小的假页面画一遍
    class N { constructor(tag) { this.tag = tag; this.children = []; } setAttribute() {} append(...x) { this.children.push(...x); } }
    globalThis.Node = N;
    globalThis.document = { documentElement: { lang: "en" }, createElement: (t) => new N(t), createElementNS: (_, t) => new N(t) };
    const { dueCard } = await import("../src/js/lib/due.js");
    const text = (n) => (typeof n === "string" ? n : n.children.map(text).join(" "));
    const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    for (const c of ["en", ...codes]) {
      const list = pages(join(out, c));
      assert.equal(list.length, 2 + 4 + 2 + TOPICS.length, c); // 首页、体检结果、四份指南、截止日历、专题列表、每篇专题
      for (const f of list) assert.equal(noMenu(read(f)).match(CJK), null, f);
      document.documentElement.lang = LANGS.find((l) => l.code === c).html;
      const events = [...read(join(out, c, "check", "index.html")).matchAll(/<li data-event="([^"]*)"><\/li>/g)].map((m) => JSON.parse(unesc(m[1])));
      for (const e of events) {
        const card = text(dueCard({ e, where: e.chains.slice(0, 2), tokens: (e.tokenContracts || []).slice(0, 2).map((x) => ({ sym: x.symbol, loan: false })) }, makeT(c), c, new Date()));
        assert.equal(card.match(CJK), null, `${c} ${e.id}: ${card}`);
      }
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});
