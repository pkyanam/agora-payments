import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { LedgerStore, SqlValue } from '../lib/server/store';
import { markWebhookVerified, setStripeConfig, stripeConfigSummary, stripeRuntimeEnvironment } from '../lib/server/stripe-config';

function settingsStore(): LedgerStore {
  const values = new Map<string,string>();
  return {
    one<T>(sql:string,...args:SqlValue[]) { if(sql.includes('FROM workspace_settings')) { const value=values.get(String(args[0]));return value===undefined?undefined:{value} as T; } return undefined; },
    all<T>() { return [] as T[]; },
    run(sql:string,...args:SqlValue[]) { if(sql.startsWith('INSERT INTO workspace_settings')) values.set(String(args[0]),String(args[1]));else if(sql.startsWith('DELETE FROM workspace_settings')) values.delete(String(args[0]));return undefined; },
    transaction<T>(fn:()=>T) { return fn(); },id:(prefix:string)=>`${prefix}_test`,now:()=>new Date(0).toISOString(),event:()=>'',journal:()=>{},
  };
}

await test('Stripe credentials are encrypted at rest and never appear in setup summaries',()=>{
  const store=settingsStore();const encryption=randomBytes(32).toString('base64');const env={NODE_ENV:'production',AGORA_SECRETS_ENCRYPTION_KEY:encryption};
  const result=setStripeConfig(store,{provider:'stripe',mode:'test',public_origin:'https://agora.example',test_secret_key:'sk_test_onlyForThisFixture123',test_webhook_secret:'whsec_testOnlyFixture123'},env);
  assert.equal(result.configured.test.secret_key,true);assert.equal(result.configured.test.webhook_secret,true);assert.equal(result.configured.test.webhook_verified,false);
  const persisted=String(store.one<{value:string}>('SELECT value FROM workspace_settings WHERE key=?','test_secret_key')?.value);
  assert.ok(persisted.startsWith('v1.'));assert.ok(!persisted.includes('sk_test_'));
  assert.equal(JSON.stringify(result).includes('sk_test_onlyForThisFixture123'),false);
  assert.equal(stripeRuntimeEnvironment(store,env).STRIPE_TEST_SECRET_KEY,'sk_test_onlyForThisFixture123');
});

await test('webhook proof is bound to the current signing secret and survives a mode switch safely',()=>{
  const store=settingsStore();const env={AGORA_SECRETS_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
  setStripeConfig(store,{provider:'stripe',mode:'test',public_origin:'https://agora.example',test_secret_key:'sk_test_onlyForThisFixture123',test_webhook_secret:'whsec_firstFixture123'},env);
  markWebhookVerified(store,'test','whsec_firstFixture123');
  assert.equal(stripeConfigSummary(store,env).configured.test.webhook_verified,true);
  setStripeConfig(store,{provider:'stripe',mode:'live',public_origin:'https://agora.example',live_secret_key:'sk_live_onlyForThisFixture123',live_webhook_secret:'whsec_liveFixture123'},env);
  assert.equal(stripeConfigSummary(store,env).mode,'live');assert.equal(stripeConfigSummary(store,env).configured.test.webhook_verified,true);
  setStripeConfig(store,{provider:'stripe',mode:'test',public_origin:'https://agora.example',test_webhook_secret:'whsec_rotatedFixture123'},env);
  assert.equal(stripeConfigSummary(store,env).configured.test.webhook_verified,false);
});

await test('mode mismatches and unsafe origins fail without persisting config',()=>{
  const store=settingsStore();const env={AGORA_SECRETS_ENCRYPTION_KEY:randomBytes(32).toString('base64'),NODE_ENV:'production'};
  assert.throws(()=>setStripeConfig(store,{provider:'stripe',mode:'test',public_origin:'https://agora.example',test_secret_key:'sk_live_wrongMode123'},env));
  assert.throws(()=>setStripeConfig(store,{provider:'stripe',mode:'test',public_origin:'http://agora.example'},env));
  assert.equal(store.one('SELECT value FROM workspace_settings WHERE key=?','payment_provider'),undefined);
});
