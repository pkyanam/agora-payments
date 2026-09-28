import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';

const dir = mkdtempSync(join(tmpdir(), 'agora-password-test-'));
process.env.AGORA_DATABASE_PATH = join(dir, 'test.sqlite');
process.env.AGORA_SEED = 'false';
process.env.AGORA_DEPLOYMENT_ENV = 'qa';
process.env.AGORA_ADMIN_PASSWORD = 'legacy bootstrap password for compatibility';
process.env.AGORA_ADMIN_TOKEN = 'test-only-signing-secret-long-enough-for-auth';
process.env.AGORA_PUBLIC_ORIGIN = 'https://agora.example';
process.env.AGORA_MFA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.AGORA_OWNER_EMAIL = 'owner@example.test';
(process.env as Record<string, string | undefined>).NODE_ENV = 'production';

const auth = await import('../lib/server/local');
const db = await import('../lib/server/db');

function totp(secret: string, counterOffset = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of secret) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Math.floor(Date.now() / 30_000) + counterOffset;
  const input = Buffer.alloc(8);
  input.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', Buffer.from(bytes)).update(input).digest();
  const offset = digest[digest.length - 1] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

function request(path: string, cookie?: string, origin = 'https://agora.example') {
  return new Request(`https://api.example${path}`, {
    method: 'POST',
    headers: { host: 'api.example', origin, ...(cookie ? { cookie } : {}) },
  });
}

function cookieFor(response: Response, name: string) {
  const raw = response.headers.get('set-cookie');
  assert.ok(raw, `expected ${name} cookie`);
  const match = raw!.split(/, (?=[^;,]+=)/).find((part) => part.startsWith(`${name}=`));
  assert.ok(match, `expected ${name} cookie in ${raw}`);
  return match!.split(';')[0];
}

test('legacy environment bootstrap remains compatible through first MFA, then password change revokes sessions', () => {
  const login = request('/api/auth/login');
  const first = auth.beginAdminLogin(login, { password: process.env.AGORA_ADMIN_PASSWORD });
  assert.equal(first.stage, 'enroll');
  assert.equal(db.one("SELECT id FROM owner_password WHERE id='owner'"), undefined);

  const pendingCookie = cookieFor(auth.setMfaCookie(new Response(null), login, 'pending', first.cookie), 'agora_pending');
  const enrollmentRequest = request('/api/auth/mfa/enroll', pendingCookie);
  const enrolled = auth.enrollAdminMfa(enrollmentRequest, { code: totp(first.secret) });
  assert.equal(enrolled.recovery_codes.length, 10);
  const ownerCookie = cookieFor(auth.setMfaCookie(new Response(null), login, 'owner', enrolled.cookie), 'agora_session');
  const ownerRequest = request('/api/auth/password/change', ownerCookie);
  assert.equal(auth.hasAdminSession(new Request('https://api.example/api/auth/session', { headers: { host: 'api.example', cookie: ownerCookie } })), true);
  const secondLogin = auth.beginAdminLogin(login, { password: process.env.AGORA_ADMIN_PASSWORD });
  assert.equal(secondLogin.stage, 'verify');
  const secondPending = cookieFor(auth.setMfaCookie(new Response(null), login, 'pending', secondLogin.cookie), 'agora_pending');
  const secondSession = auth.verifyAdminMfa(request('/api/auth/mfa/verify', secondPending), { recovery_code: enrolled.recovery_codes[0] });
  const secondOwnerCookie = cookieFor(auth.setMfaCookie(new Response(null), login, 'owner', secondSession.cookie), 'agora_session');
  assert.equal(auth.hasAdminSession(new Request('https://api.example/api/auth/session', { headers: { host: 'api.example', cookie: secondOwnerCookie } })), true);

  assert.throws(
    () => auth.changeAdminPassword(request('/api/auth/password/change', ownerCookie), { current_password: 'wrong current password', new_password: 'a different strong password' }),
    (error: unknown) => error instanceof auth.ApiError && error.code === 'invalid_credentials',
  );
  assert.throws(
    () => auth.changeAdminPassword(request('/api/auth/password/change', ownerCookie), { current_password: process.env.AGORA_ADMIN_PASSWORD, new_password: 'short' }),
    (error: unknown) => error instanceof auth.ApiError && error.code === 'invalid_request',
  );
  assert.throws(
    () => auth.changeAdminPassword(request('/api/auth/password/change', ownerCookie), { current_password: process.env.AGORA_ADMIN_PASSWORD, new_password: process.env.AGORA_ADMIN_PASSWORD }),
    (error: unknown) => error instanceof auth.ApiError && error.code === 'password_reuse',
  );
  assert.throws(
    () => auth.changeAdminPassword(request('/api/auth/password/change', ownerCookie, 'https://attacker.example'), { current_password: process.env.AGORA_ADMIN_PASSWORD, new_password: 'a different strong password' }),
    (error: unknown) => error instanceof auth.ApiError && error.code === 'origin_rejected',
  );
  assert.throws(
    () => auth.changeAdminPassword(request('/api/auth/password/change', cookieFor(auth.setMfaCookie(new Response(null), login, 'pending', first.cookie), 'agora_pending')), { current_password: process.env.AGORA_ADMIN_PASSWORD, new_password: 'a different strong password' }),
    (error: unknown) => error instanceof auth.ApiError && error.status === 401,
  );

  const oldPassword = process.env.AGORA_ADMIN_PASSWORD!;
  const newPassword = 'a different strong password';
  assert.deepEqual(auth.changeAdminPassword(ownerRequest, { current_password: oldPassword, new_password: newPassword }), { ok: true });
  assert.equal(auth.hasAdminSession(new Request('https://api.example/api/auth/session', { headers: { host: 'api.example', cookie: ownerCookie } })), false, 'all existing owner sessions must be invalidated');
  assert.equal(auth.hasAdminSession(new Request('https://api.example/api/auth/session', { headers: { host: 'api.example', cookie: secondOwnerCookie } })), false, 'other devices must be signed out too');
  const record = db.one<{ salt: string; password_hash: string; session_version: number; must_change: number }>("SELECT salt,password_hash,session_version,must_change FROM owner_password WHERE id='owner'");
  assert.ok(record);
  assert.notEqual(record!.salt, newPassword);
  assert.notEqual(record!.password_hash, newPassword);
  assert.equal(record!.must_change, 0);
  assert.equal(record!.session_version, 1);
  const passwordEvent = db.one<{ data: string }>("SELECT data FROM events WHERE type='owner.password_changed' ORDER BY created_at DESC LIMIT 1");
  assert.ok(passwordEvent);
  assert.equal(passwordEvent!.data.includes(newPassword), false, 'audit data must not include credentials');

  assert.throws(() => auth.beginAdminLogin(login, { password: oldPassword }), (error: unknown) => error instanceof auth.ApiError && error.code === 'invalid_credentials');
  const next = auth.beginAdminLogin(login, { password: newPassword });
  assert.equal(next.stage, 'verify', 'changing the password must preserve the enrolled MFA setup');
  const pending = cookieFor(auth.setMfaCookie(new Response(null), login, 'pending', next.cookie), 'agora_pending');
  const signedIn = auth.verifyAdminMfa(request('/api/auth/mfa/verify', pending), { code: totp(first.secret, 1) });
  assert.ok(signedIn.cookie.value);
  assert.equal(auth.hasAdminSession(new Request('https://api.example/api/auth/session', { headers: { host: 'api.example', cookie: cookieFor(auth.setMfaCookie(new Response(null), login, 'owner', signedIn.cookie), 'agora_session') } })), true);
});

after(() => {
  db.db.close();
  rmSync(dir, { recursive: true, force: true });
});
