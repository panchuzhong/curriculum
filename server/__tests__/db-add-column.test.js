import { describe, it, expect, vi } from 'vitest';
import { addColumn } from '../db/index.js';

// 迁移用它补列。「列已存在」是预期中的"这步早就做过了"，可以咽下去；
// 别的失败（磁盘满、表被锁、表名写错）必须抛出去中断迁移——咽下去的话，
// 这次迁移会被记成"已应用"写进 _migrations，那一列从此永远补不上，
// 而下游的读写只会在运行时莫名其妙地报错。
describe('addColumn 只咽下"列已存在"', () => {
  const dbThatThrows = (message) => ({ exec: vi.fn(() => { throw new Error(message); }) });

  it.each([
    ['duplicate column name: subjects'],
    ['DUPLICATE COLUMN NAME: subjects'],  // 大小写不敏感
  ])('%s 被咽下，不中断迁移', (message) => {
    expect(() => addColumn(dbThatThrows(message), 'teachers', 'subjects TEXT')).not.toThrow();
  });

  it.each([
    ['database or disk is full'],
    ['database is locked'],
    ['no such table: teachers'],
    ['attempt to write a readonly database'],
    // 只有「列已存在」这一种可以咽；别的带 duplicate 字样的一样要抛。
    // （今天的 ALTER TABLE ADD COLUMN 大概只会报前者，但这条守卫的注释写明了
    //  「其余一律中断」，把这个意图钉住，别让判据被悄悄放宽。）
    ['duplicate index name: idx_foo'],
  ])('%s 必须抛出去', (message) => {
    expect(() => addColumn(dbThatThrows(message), 'teachers', 'subjects TEXT')).toThrow(message);
  });

  it('成功时照常执行 ALTER', () => {
    const db = { exec: vi.fn() };
    addColumn(db, 'teachers', 'subjects TEXT');
    expect(db.exec).toHaveBeenCalledWith('ALTER TABLE teachers ADD COLUMN subjects TEXT');
  });
});
