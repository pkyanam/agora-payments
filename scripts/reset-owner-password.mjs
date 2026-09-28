#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const dbPath = process.env.AGORA_DATABASE_PATH || resolve('state/data/agora.sqlite');
const secretPath = resolve(dirname(dbPath), 'community-owner-credentials.txt');
if (!existsSync(dbPath)) throw new Error(`Agora database not found at ${dbPath}; run this command from the install directory.`);
const password = randomBytes(32).toString('base64url');
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 32, { N: 65536, r: 8, p: 2, maxmem: 96 * 1024 * 1024 });
const db = new DatabaseSync(dbPath);
try {
  db.exec("CREATE TABLE IF NOT EXISTS owner_password(id TEXT PRIMARY KEY CHECK(id='owner'),email TEXT,salt TEXT NOT NULL,password_hash TEXT NOT NULL,session_version INTEGER NOT NULL DEFAULT 1,must_change INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL)");
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("INSERT INTO owner_password(id,salt,password_hash,session_version,must_change,updated_at) VALUES('owner',?,?,1,1,?) ON CONFLICT(id) DO UPDATE SET salt=excluded.salt,password_hash=excluded.password_hash,session_version=owner_password.session_version+1,must_change=1,updated_at=excluded.updated_at").run(salt.toString('base64url'), hash.toString('base64url'), new Date().toISOString());
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  mkdirSync(dirname(secretPath), { recursive: true, mode: 0o700 });
  writeFileSync(secretPath, `Agora owner temporary password: ${password}\nSign in, choose a new password, then remove this file.\n`, { mode: 0o600 });
  chmodSync(secretPath, 0o600);
  console.log(`A one-time temporary owner password was saved to ${secretPath} (permissions 600). Sign in with it, set a new password, then securely remove the file. MFA remains enabled.`);
} finally { db.close(); }
