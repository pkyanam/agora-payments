import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('concurrent fresh SQLite initialization serializes schema migrations', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'agora-db-migration-'));
  const database = join(directory, 'fresh.sqlite');
  const processes = Array.from({ length: 8 }, () => spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', "const store=await import('./lib/server/db.ts');store.one('SELECT 1')"], {
    cwd: process.cwd(),
    env: { ...process.env, AGORA_DATABASE_PATH: database, AGORA_SEED: 'false', NODE_ENV: 'production' },
    stdio: ['ignore', 'ignore', 'pipe'],
  }));
  try {
    const results = await Promise.all(processes.map((child) => new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      let stderr = '';
      child.stderr?.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
      child.once('error', reject);
      child.once('close', (code) => resolve({ code, stderr }));
    })));
    for (const result of results) assert.equal(result.code, 0, result.stderr);
  } finally {
    await Promise.all(processes.map((child) => new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once('close', () => resolve());
      child.kill('SIGKILL');
    })));
    await rm(directory, { recursive: true, force: true });
  }
});
