// 路线(src/js/lib/ui.js 的 route):会动资产、只给权限的那几站各自标出来,别的站照旧。
// 单独一个文件:要换掉全局的 document(node --test 每个文件一个进程,不影响别的测试)。
import { test } from "node:test";
import assert from "node:assert/strict";
import { route } from "../src/js/lib/ui.js";

// 很小的假页面:只够 el() 和 icon() 建节点
class FakeNode {
  constructor(tag) { this.tag = tag; this.className = ""; this.attrs = {}; this.children = []; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  append(...xs) { this.children.push(...xs); }
}
globalThis.Node = FakeNode;
globalThis.document = { createElement: (tag) => new FakeNode(tag), createElementNS: (_, tag) => new FakeNode(tag) };
const classes = (box) => box.children.map((c) => c.className);

test("路线:会动资产的站标 moves、只给权限的站标 grants(走过的、你在的、还没到的都标);不传就一个都不标", () => {
  assert.deepEqual(classes(route(5, 2, false, ["", "grants", "moves", "moves"])), [
    "node past", "seg past", "node past grants", "seg past", "node here moves", "seg next", "node next moves", "seg next", "node next", "seg next", "exit-box",
  ]);
  assert.deepEqual(classes(route(3, 0, false, ["grants"])).filter((c) => c.startsWith("node")), ["node here grants", "node next", "node next"]);
  // 到账页这类不传的,和原来一样
  assert.ok(!classes(route(5, 5, true)).some((c) => / (moves|grants)/.test(c)));
  assert.equal(route(3, 0).attrs.role, "img");
});
