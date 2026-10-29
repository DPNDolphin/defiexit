import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { findWallets, askAddresses, sharedAddresses } from "../src/js/lib/wallet.js";

// 只用来测格式的假地址(这些测试不连网)
const A = "0x" + "1".repeat(40), B = "0x" + "2".repeat(40);

test("从钱包读地址:只发一次 eth_requestAccounts;只认 0x 开头、42 位的地址,重复的去掉", async () => {
  const calls = [];
  const provider = { request: async (q) => { calls.push(q); return [A, "nope", A, 42, B]; } };
  assert.deepEqual(await askAddresses(provider), [A, B]);
  assert.deepEqual(calls, [{ method: "eth_requestAccounts" }]);
  assert.deepEqual(await askAddresses({ request: async () => A }), [], "不是数组就当没给");
  assert.deepEqual(await askAddresses({ request: async () => null }), []);
});

test("问已经共享的地址:只发 eth_accounts,不弹窗;没连过就是空的", async () => {
  const calls = [];
  assert.deepEqual(await sharedAddresses({ request: async (q) => { calls.push(q); return [B]; } }), [B]);
  assert.deepEqual(await sharedAddresses({ request: async () => [] }), []);
  assert.deepEqual(calls, [{ method: "eth_accounts" }]);
});

test("从钱包读地址:用户在钱包里拒绝,错误原样交给页面(页面看 4001 说「你拒绝了」)", async () => {
  const e = Object.assign(new Error("User rejected the request."), { code: 4001 });
  await assert.rejects(askAddresses({ request: async () => { throw e; } }), (x) => x.code === 4001);
});

test("找钱包:收 EIP-6963 的回应,按 uuid 去重;名字只当文字;找的时候不向钱包发任何请求", async () => {
  const win = new EventTarget();
  const reqs = [];
  const mk = () => ({ request: async (q) => { reqs.push(q); return []; } });
  const p1 = mk(), p2 = mk();
  win.addEventListener("eip6963:requestProvider", () => {
    for (const [uuid, name, provider] of [["u1", "Wallet A", p1], ["u1", "Wallet A again", p1], ["u2", "  Wallet B  ", p2]]) {
      win.dispatchEvent(Object.assign(new Event("eip6963:announceProvider"), { detail: { info: { uuid, name }, provider } }));
    }
  });
  win.ethereum = { request: async () => { throw new Error("有 EIP-6963 的回应时不该用到它"); } };
  const list = await findWallets(win, [5, 5]);
  assert.deepEqual(list.map((w) => w.name), ["Wallet A", "Wallet B"]);
  assert.equal(list[1].provider, p2);
  assert.equal(reqs.length, 0);
});

test("找钱包:没有 EIP-6963 就用 window.ethereum;什么都没有就是空的(页面上不出按钮)", async () => {
  const win = new EventTarget();
  assert.deepEqual(await findWallets(win, [1, 1]), []);
  const eth = { request: async () => [] };
  win.ethereum = eth;
  const list = await findWallets(win, [1, 1]);
  assert.equal(list.length, 1);
  assert.equal(list[0].provider, eth);
});

test("全站只有 lib/wallet.js 碰钱包,而且只发 eth_accounts、eth_requestAccounts 这两种请求", () => {
  const files = [];
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".js")) files.push(p);
    }
  };
  walk("src/js");
  let seen = false;
  for (const f of files) {
    const s = readFileSync(f, "utf8");
    if (f.replace(/\\/g, "/").endsWith("lib/wallet.js")) {
      seen = true;
      assert.deepEqual([...s.matchAll(/method:\s*"([^"]+)"/g)].map((m) => m[1]), ["eth_accounts", "eth_requestAccounts"]);
      assert.equal(s.match(/\.request\(/g)?.length, 2);
      continue;
    }
    assert.ok(!/\bethereum\b|eip6963|\.request\(/.test(s), `${f} 不该碰钱包`);
  }
  assert.ok(seen);
});
