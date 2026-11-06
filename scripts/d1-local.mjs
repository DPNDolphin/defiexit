// 本地用的 D1 替身(只给测试和本地预览用,不上线):用 Node 自带的 SQLite(node:sqlite,Node 22.5 起有)
// 实现运营台用到的那几个方法:prepare().bind().first()/all()/run(),batch()(一个事务,出错整批回滚)。
import { DatabaseSync } from "node:sqlite";

const plain = (r) => (r ? { ...r } : null);
const arg = (v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v);

class Stmt {
  constructor(db, sql, args = []) {
    this.db = db;
    this.sql = sql;
    this.args = args;
  }
  bind(...a) {
    return new Stmt(this.db, this.sql, a.map(arg));
  }
  async first(col) {
    const r = this.db.prepare(this.sql).get(...this.args);
    return r ? (col ? r[col] : plain(r)) : null;
  }
  async all() {
    return { success: true, results: this.db.prepare(this.sql).all(...this.args).map(plain) };
  }
  runSync() {
    const i = this.db.prepare(this.sql).run(...this.args);
    return { success: true, meta: { changes: Number(i.changes) } };
  }
  async run() {
    return this.runSync();
  }
}

export class LocalD1 {
  constructor(file = ":memory:") {
    this.db = new DatabaseSync(file);
  }
  prepare(sql) {
    return new Stmt(this.db, sql);
  }
  // 和 D1 一样:每一句回一个结果,查询的(SELECT)带 results;整批是一个事务,中间插不进别的写
  async batch(stmts) {
    this.db.exec("BEGIN");
    try {
      const out = stmts.map((s) => (/^\s*(SELECT|WITH)\b/i.test(s.sql) ? { success: true, results: this.db.prepare(s.sql).all(...s.args).map(plain), meta: { changes: 0 } } : s.runSync()));
      this.db.exec("COMMIT");
      return out;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}
