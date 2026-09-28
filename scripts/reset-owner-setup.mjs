#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const dbPath = process.env.AGORA_DATABASE_PATH || resolve('state/data/agora.sqlite');
const manifestPath = resolve('install.json');
if (!existsSync(dbPath) || !existsSync(manifestPath)) throw new Error('Run this from an Agora install directory with its database and install.json.');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (typeof manifest.public_origin !== 'string' || !/^https:\/\//.test(manifest.public_origin)) throw new Error('Install manifest has no public HTTPS origin.');
const token = randomBytes(32).toString('base64url');
const tokenHash = createHash('sha256').update(token).digest('hex');
const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const db = new DatabaseSync(dbPath);
try {
  if (db.prepare("SELECT id FROM owner_password WHERE id='owner'").get()) throw new Error('An owner account already exists; use reset-owner-password.mjs instead.');
  db.exec("CREATE TABLE IF NOT EXISTS owner_setup(id TEXT PRIMARY KEY CHECK(id='owner'),token_hash TEXT NOT NULL,expires_at TEXT NOT NULL)");
  db.prepare("INSERT INTO owner_setup(id,token_hash,expires_at) VALUES('owner',?,?) ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at").run(tokenHash, expires);
} finally { db.close(); }
const handoff = resolve(dirname(dbPath), 'community-owner-credentials.txt');
mkdirSync(dirname(handoff), { recursive: true, mode: 0o700 });
writeFileSync(handoff, `Agora one-time owner setup link (expires ${expires}):\n${manifest.public_origin}/#setup=${token}\nKeep private; remove after setup.\n`, { mode: 0o600 });
chmodSync(handoff, 0o600);
console.log(`A new one-time setup link was saved to ${handoff} (permissions 600).`);
