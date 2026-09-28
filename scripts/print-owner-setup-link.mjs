#!/usr/bin/env node
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = resolve(process.argv[2] || process.cwd());
const manifest = JSON.parse(readFileSync(resolve(root, 'install.json'), 'utf8'));
const db = new DatabaseSync(resolve(root, 'state/data/agora.sqlite'), { readOnly: true });
let password;
let setup;
try {
  password = db.prepare("SELECT id FROM owner_password WHERE id='owner'").get();
  setup = db.prepare("SELECT token_hash,expires_at FROM owner_setup WHERE id='owner'").get();
} finally { db.close(); }

if (password) {
  console.log('Owner setup is already complete.');
} else if (!setup) {
  console.log('No active owner setup link is available. If setup is still needed, run node current/scripts/reset-owner-setup.mjs in the install directory, then rerun this installer.');
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
