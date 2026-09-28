import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const script = join(process.cwd(), 'scripts/print-owner-setup-link.mjs');
const token = 'SAFE_TEST_SETUP_TOKEN_123456789012345678901234567890';

test('installer displays only an active unclaimed setup URL from the private handoff', () => {
  const root = mkdtempSync(join(tmpdir(), 'agora-setup-print-'));
  try {
    mkdirSync(join(root, 'state/data'), { recursive: true });
    writeFileSync(join(root, 'install.json'), JSON.stringify({ public_origin: 'https://agora.example' }));
    writeFileSync(join(root, 'state/community-owner-credentials.txt'), `Open: https://agora.example/#setup=${token}\n`, { mode: 0o600 });
    const db = new DatabaseSync(join(root, 'state/data/agora.sqlite'));
    db.exec("CREATE TABLE owner_password(id TEXT PRIMARY KEY); CREATE TABLE owner_setup(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL,expires_at TEXT NOT NULL)");
    const hash = createHash('sha256').update(token).digest('hex');
    db.prepare("INSERT INTO owner_setup VALUES('owner',?,?)").run(hash, new Date(Date.now() + 60_000).toISOString());
    db.close();

    const valid = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
    assert.equal(valid.status, 0, valid.stderr);
    assert.equal(valid.stdout.trim(), `One-time owner setup URL: https://agora.example/#setup=${token}`);

    const expiredDb = new DatabaseSync(join(root, 'state/data/agora.sqlite'));
    expiredDb.prepare("UPDATE owner_setup SET expires_at=? WHERE id='owner'").run(new Date(Date.now() - 60_000).toISOString());
    expiredDb.close();
    const expired = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
    assert.equal(expired.status, 0, expired.stderr);
    assert.match(expired.stdout, /has expired[\s\S]*reset-owner-setup\.mjs/);
    assert.doesNotMatch(expired.stdout, new RegExp(token));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
