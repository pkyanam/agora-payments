import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'agora-owner-setup-reset-test-'));
const dbPath = join(dir, 'state', 'data', 'agora.sqlite');
const manifestPath = join(dir, 'install.json');
const scriptPath = fileURLToPath(new URL('../scripts/reset-owner-setup.mjs', import.meta.url));

function runReset() {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, AGORA_DATABASE_PATH: dbPath },
  });
}

test('expired setup link regeneration keeps token private, replaces only unclaimed setup state and protects claimed accounts', () => {
  mkdirSync(join(dir, 'state', 'data'), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  db.exec("CREATE TABLE owner_password(id TEXT PRIMARY KEY CHECK(id='owner'),email TEXT,salt TEXT NOT NULL,password_hash TEXT NOT NULL,session_version INTEGER NOT NULL DEFAULT 1,must_change INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)");
  db.exec("CREATE TABLE owner_setup(id TEXT PRIMARY KEY CHECK(id='owner'),token_hash TEXT NOT NULL,expires_at TEXT NOT NULL)");
  const oldHash = createHash('sha256').update('expired token').digest('hex');
  db.prepare("INSERT INTO owner_setup(id,token_hash,expires_at) VALUES('owner',?,?)").run(oldHash, new Date(Date.now() - 1000).toISOString());
  db.close();
  writeFileSync(manifestPath, JSON.stringify({ public_origin: 'https://agora.example' }));
  chmodSync(manifestPath, 0o600);

  const result = runReset();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /one-time setup link was saved/i);
  assert.equal(result.stdout.includes('#setup='), false, 'stdout must never print the secret URL');
  const handoffPath = join(dir, 'state', 'data', 'community-owner-credentials.txt');
  assert.equal(statSync(handoffPath).mode & 0o777, 0o600);
  const handoff = readFileSync(handoffPath, 'utf8');
  const link = handoff.match(/https:\/\/agora\.example\/#setup=([A-Za-z0-9_-]+)/);
  assert.ok(link, 'the generated link should be saved in the private handoff file');
  const token = link![1];
  assert.ok(token.length >= 40);

  const verify = new DatabaseSync(dbPath);
  const saved = verify.prepare("SELECT token_hash,expires_at FROM owner_setup WHERE id='owner'").get() as { token_hash: string; expires_at: string };
  assert.equal(saved.token_hash, createHash('sha256').update(token).digest('hex'));
  assert.notEqual(saved.token_hash, token, 'only the token hash belongs in SQLite');
  assert.ok(Date.parse(saved.expires_at) > Date.now());
  assert.ok(Date.parse(saved.expires_at) <= Date.now() + 7 * 24 * 60 * 60 * 1000 + 5000);

  verify.prepare("INSERT INTO owner_password(id,email,salt,password_hash,session_version,must_change,updated_at) VALUES('owner','owner@example.test','salt','hash',0,0,?)").run(new Date().toISOString());
  verify.close();
  const existing = readFileSync(handoffPath, 'utf8');
  const denied = runReset();
  assert.notEqual(denied.status, 0, 'a claimed owner account cannot be replaced by setup reset');
  assert.match(denied.stderr, /owner account already exists/i);
  assert.equal(readFileSync(handoffPath, 'utf8'), existing, 'denied reset must not replace the current handoff link');
});

after(() => rmSync(dir, { recursive: true, force: true }));
