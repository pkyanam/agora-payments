#!/usr/bin/env node
import { createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(process.argv[2] || process.cwd());
const manifest = JSON.parse(readFileSync(resolve(root, 'install.json'), 'utf8'));
const envText = (() => { try { return readFileSync(resolve(root, 'state/.env.local'), 'utf8'); } catch { return ''; } })();
const envValue = (name) => {
  const row = envText.split(/\r?\n/).find((line) => line.startsWith(`${name}=`));
  if (!row) return '';
  try { return JSON.parse(row.slice(name.length + 1)); } catch { return row.slice(name.length + 1).replace(/^['"]|['"]$/g, ''); }
};
let password;
let setup;
const dbPath = resolve(root, envValue('AGORA_DATABASE_PATH') || 'state/data/agora.sqlite');
if (existsSync(dbPath)) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    password = db.prepare("SELECT id FROM owner_password WHERE id='owner'").get();
    setup = db.prepare("SELECT token_hash,expires_at FROM owner_setup WHERE id='owner'").get();
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('no such table')) throw error;
  } finally { db.close(); }
}

if (password) {
  console.log('Owner setup is already complete.');
} else if (!setup) {
  const configuredHash = envValue('AGORA_OWNER_SETUP_TOKEN_HASH');
  const handoff = (() => { try { return readFileSync(resolve(root, 'state/community-owner-credentials.txt'), 'utf8'); } catch { return ''; } })();
  const match = handoff.match(/^Open:\s*(https?:\/\/[^\s]+)\s*$/m);
  const url = match?.[1];
  const prefix = `${manifest.public_origin}/#setup=`;
  const token = url?.startsWith(prefix) ? url.slice(prefix.length) : '';
  const actual = createHash('sha256').update(token).digest();
  const expected = Buffer.from(typeof configuredHash === 'string' ? configuredHash : '', 'hex');
  if (token && /^[A-Za-z0-9_-]{32,256}$/.test(token) && actual.length === expected.length && timingSafeEqual(actual, expected)) {
    // On a fresh install, the DB is intentionally not created until the first
    // runtime request. The bootstrap hash and private handoff are authoritative.
    console.log(`One-time owner setup URL: ${url}`);
  } else {
    console.log('No active owner setup link is available. If setup is still needed, run node current/scripts/reset-owner-setup.mjs in the install directory, then rerun this installer.');
  }
} else if (Date.parse(setup.expires_at) <= Date.now()) {
  console.log('The owner setup link has expired. Run node current/scripts/reset-owner-setup.mjs in the install directory, then rerun this installer to display the replacement link.');
} else {
  let handoff = '';
  try { handoff = readFileSync(resolve(root, 'state/community-owner-credentials.txt'), 'utf8'); } catch {}
  const match = handoff.match(/^Open:\s*(https?:\/\/[^\s]+)\s*$/m);
  const url = match?.[1];
  const prefix = `${manifest.public_origin}/#setup=`;
  const token = url?.startsWith(prefix) ? url.slice(prefix.length) : '';
  const actual = createHash('sha256').update(token).digest();
  const expected = Buffer.from(setup.token_hash, 'hex');
  if (token && /^[A-Za-z0-9_-]{32,256}$/.test(token) && actual.length === expected.length && timingSafeEqual(actual, expected)) {
    console.log(`One-time owner setup URL: ${url}`);
  } else {
    console.log('A valid owner setup URL is not available in the private handoff file. Run node current/scripts/reset-owner-setup.mjs in the install directory, then rerun this installer to display the replacement link.');
  }
}
