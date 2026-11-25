import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

it('creates private database and WAL files under a permissive shell umask', () => {
  const dir = mkdtempSync(join(tmpdir(), 'curriculum-permission-test-'));
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { statSync } from 'node:fs';
      process.umask(0o022);
      const { db, initDb, dbDir } = await import(${JSON.stringify(pathToFileURL(resolve('server/db/index.js')).href)});
      initDb();
      console.log(JSON.stringify([dbDir, process.env.DB_PATH, process.env.DB_PATH + '-wal'].map(p => statSync(p).mode & 0o777)));
      db.close();
    `], { env: { ...process.env, DB_PATH: join(dir, 'private', 'data.db') }, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual([0o700, 0o600, 0o600]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
