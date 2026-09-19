import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { spawnSync } from 'child_process';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { createTestDb } from './setup.js';

// 这个用例要 spawn 四次 bash，而脚本里的 bcrypt 是故意设成慢的（算上本文件里的
// compareSync 一共六轮）。空机器上跑完大约 1 秒，vitest 默认的 5 秒只留了五倍余量：
// 机器上同时跑着另一份完整测试时，它就会因为抢不到 CPU 而超时，报成一个和
// 代码无关的失败。显式给到 30 秒：够挡负载，也还拦得住真死循环。
it('manages users from outside the project with a relative DB_PATH', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'curriculum-cli-test-'));
  const { db: seed } = createTestDb();
  let db;
  try {
    await seed.backup(join(dir, 'users.db'));
    seed.close();
    db = new Database(join(dir, 'users.db'));
    const script = resolve('scripts/user-manage.sh');
    const run = (args, input) => spawnSync('bash', [script, ...args], {
      cwd: dir, env: { ...process.env, DB_PATH: 'users.db' }, encoding: 'utf8', input,
    });
    expect(run(['register', 'audituser', 'Audit', 'testpassword']).status).toBe(0);
    const user = db.prepare('SELECT * FROM teachers').get();
    expect(bcrypt.compareSync('testpassword', user.password_hash)).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM pricing_tiers WHERE teacher_id = ?').get(user.id).n).toBe(5);
    expect(run(['reset-pw', '密'.repeat(25), String(user.id)]).status).toBe(1);
    expect(db.prepare('SELECT password_hash FROM teachers').get().password_hash).toBe(user.password_hash);
    expect(run(['reset-pw', '密'.repeat(24), String(user.id)]).status).toBe(0);
    const updated = db.prepare('SELECT * FROM teachers').get();
    expect(updated.pwd_version).toBe(1);
    expect(bcrypt.compareSync('密'.repeat(24), updated.password_hash)).toBe(true);
    expect(run(['delete', String(user.id)], 'yes\n').status).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM teachers').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM pricing_tiers').get().n).toBe(0);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  } finally {
    if (seed.open) seed.close();
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}, 30000);
