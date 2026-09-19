import { it, expect } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

it('importing image generators does not open a database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'curriculum-image-import-'));
  const dbPath = join(dir, 'unused.db');
  const modules = ['image-gen.js', 'image-gen-monthly.js', 'image-gen-yearly.js']
    .map(name => new URL(`../services/${name}`, import.meta.url).href);
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e',
      `await Promise.all(${JSON.stringify(modules)}.map(url => import(url)));`], {
      env: { ...process.env, DB_PATH: dbPath }, encoding: 'utf8', timeout: 10000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(dbPath)).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
