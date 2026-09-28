import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'agora-owner-setup-test-'));
const token = randomBytes(32).toString('base64url');
process.env.AGORA_DATABASE_PATH = join(dir, 'test.sqlite');
process.env.AGORA_SEED = 'false';
process.env.AGORA_DEPLOYMENT_ENV = 'qa';
process.env.AGORA_ADMIN_TOKEN = 'test-only-signing-secret-long-enough-for-auth';
process.env.AGORA_PUBLIC_ORIGIN = 'https://agora.example';
process.env.AGORA_MFA_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
process.env.AGORA_OWNER_SETUP_TOKEN_HASH = createHash('sha256').update(token).digest('hex');
(process.env as Record<string, string | undefined>).AGORA_ADMIN_PASSWORD = undefined;

const auth = await import('../lib/server/local');
const db = await import('../lib/server/db');
const route = await import('../app/api/auth/setup/claim/route');

function request(origin = 'https://agora.example') {
  return new Request('https://api.example/api/auth/setup/claim', {
    method: 'POST',
    headers: { host: 'api.example', origin },
  });
}

function claimRequest(body: unknown) {
  return new Request('https://api.example/api/auth/setup/claim', {
    method: 'POST',
    headers: { host: 'api.example', origin: 'https://agora.example', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('first owner setup is hash-only, origin-gated, single-use, MFA-gated and race-safe', async () => {
  const tokenRow = db.one<{ token_hash: string; expires_at: string }>("SELECT token_hash,expires_at FROM owner_setup WHERE id='owner'");
  assert.ok(tokenRow, 'installer token hash should seed the unclaimed local database');
  assert.equal(tokenRow!.token_hash, createHash('sha256').update(token).digest('hex'));
  assert.notEqual(tokenRow!.token_hash, token);
  const initialSession = auth.authSession(new Request('https://api.example/api/auth/session'));
  assert.equal('owner_setup_required' in initialSession ? initialSession.owner_setup_required : undefined, true);

  const details = { token, email: 'Founder@example.test', password: 'initial owner password with length' };
  db.run("UPDATE owner_setup SET expires_at=? WHERE id='owner'", new Date(Date.now() - 1000).toISOString());
  const expiredSession = auth.authSession(new Request('https://api.example/api/auth/session'));
  assert.equal('owner_setup_required' in expiredSession ? expiredSession.owner_setup_required : undefined, false);
  assert.throws(
    () => auth.claimOwnerSetup(request(), details),
    (error: unknown) => error instanceof auth.ApiError && error.code === 'setup_token_invalid',
  );
  db.run("UPDATE owner_setup SET expires_at=? WHERE id='owner'", tokenRow!.expires_at);

  assert.throws(
    () => auth.claimOwnerSetup(request('https://attacker.example'), details),
    (error: unknown) => error instanceof auth.ApiError && error.code === 'origin_rejected',
  );
  assert.throws(
    () => auth.claimOwnerSetup(request(), { ...details, token: randomBytes(32).toString('base64url') }),
    (error: unknown) => error instanceof auth.ApiError && error.code === 'setup_token_invalid',
  );
  assert.ok(db.one("SELECT id FROM owner_setup WHERE id='owner'"), 'invalid attempts must not consume the valid link');

  const claims = await Promise.allSettled([
    route.POST(claimRequest(details)),
    route.POST(claimRequest(details)),
  ]);
  const winners = claims.filter((claim) => claim.status === 'fulfilled' && claim.value.status === 200);
  const losers = claims.filter((claim) => claim.status === 'fulfilled' && claim.value.status !== 200);
  assert.equal(winners.length, 1, 'only one concurrent claim may succeed');
  assert.equal(losers.length, 1, 'the racing request must be rejected');
  const successResponse = (winners[0] as PromiseFulfilledResult<Response>).value;
  const result = await successResponse.json() as { stage: string; email: string; secret: string; otpauth_url: string; cookie?: unknown };
  assert.equal(result.stage, 'enroll');
  assert.equal(result.email, 'founder@example.test');
  assert.match(result.secret, /^[A-Z2-7]+$/);
  assert.match(result.otpauth_url, /otpauth:\/\/totp\//);
  assert.equal(result.cookie, undefined, 'signed session material must be sent only as a cookie');
  assert.match(successResponse.headers.get('set-cookie') || '', /^agora_pending=/);
  assert.equal(successResponse.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(JSON.stringify(result).includes(details.password), false, 'claim response must not echo the password');
  assert.equal(JSON.stringify(result).includes(token), false, 'claim response must not echo the setup token');

  const password = db.one<{ email: string; salt: string; password_hash: string; session_version: number }>("SELECT email,salt,password_hash,session_version FROM owner_password WHERE id='owner'");
  assert.ok(password);
  assert.equal(password!.email, 'founder@example.test');
  assert.notEqual(password!.salt, details.password);
  assert.notEqual(password!.password_hash, details.password);
  assert.equal(password!.session_version, 0);
  assert.equal(db.one("SELECT id FROM owner_setup WHERE id='owner'"), undefined, 'successful claim consumes setup token');
  const claimedSession = auth.authSession(new Request('https://api.example/api/auth/session'));
  assert.equal('owner_setup_required' in claimedSession ? claimedSession.owner_setup_required : undefined, false);
  const pendingCookie = successResponse.headers.get('set-cookie')!.split(';')[0];
  assert.equal(auth.hasAdminSession(new Request('https://api.example/api/auth/session', { headers: { cookie: pendingCookie } })), false, 'claim must not create a completed owner session');
  assert.equal(db.one("SELECT id FROM owner_mfa WHERE id='owner' AND confirmed=0" ) !== undefined, true, 'claim must begin MFA enrollment');

  assert.throws(
    () => auth.claimOwnerSetup(request(), details),
    (error: unknown) => error instanceof auth.ApiError && ['owner_already_claimed', 'setup_token_invalid'].includes(error.code),
  );
  assert.throws(
    () => auth.claimOwnerSetup(request(), { ...details, email: 'attacker@example.test' }),
    (error: unknown) => error instanceof auth.ApiError && ['owner_already_claimed', 'setup_token_invalid'].includes(error.code),
  );
  assert.equal(db.one<{ email: string }>("SELECT email FROM owner_password WHERE id='owner'")?.email, 'founder@example.test', 'replay cannot replace the claimed owner');
});

after(() => {
  db.db.close();
  rmSync(dir, { recursive: true, force: true });
});
