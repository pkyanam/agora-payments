import { ApiError } from './errors';
import type { Actor } from './service';
import type { LedgerStore } from './store';
import type { StripeEvent } from './stripe';
import { stripeConfigSummary } from './stripe-config';
import type { PaymentProviderEnvironment } from './service';

export type RiskMode='test'|'live';
const warningEvents=new Set(['radar.early_fraud_warning.created','radar.early_fraud_warning.updated']);
const reviewEvents=new Set(['review.opened','review.closed']);
function expandableId(value:unknown):string|null{if(typeof value==='string')return value;if(value&&typeof value==='object'&&typeof (value as {id?:unknown}).id==='string')return (value as {id:string}).id;return null;}

/** Persist only verified Stripe Radar identifiers and minimal risk state. */
export function persistStripeRiskSignal(store:LedgerStore,event:StripeEvent,mode:RiskMode){
  const isWarning=warningEvents.has(event.type),isReview=reviewEvents.has(event.type);if(!isWarning&&!isReview)return{handled:false,persisted:false};
  const obj=event.data.object;const id=typeof obj.id==='string'&&obj.id.length<=100?obj.id:null;const paymentIntent=expandableId(obj.payment_intent);const expectedLive=mode==='live';
  if(typeof obj.livemode==='boolean'&&obj.livemode!==expectedLive)throw new ApiError(400,'webhook_mode_mismatch','Stripe risk object mode does not match its signed event.');
  if(!id||!paymentIntent||typeof obj.livemode!=='boolean')return{handled:true,persisted:false};
  const accountId=typeof event.account==='string'?event.account:null;if(event.account!==undefined&&(typeof event.account!=='string'||event.account.length>100))throw new ApiError(400,'webhook_risk_invalid','Stripe risk event account is invalid.');
  const matches=store.all<{id:string;tenant_id:string;provider_account_id:string|null}>('SELECT id,tenant_id,provider_account_id FROM payments WHERE provider=\'stripe\' AND provider_mode=? AND provider_payment_intent=? AND COALESCE(provider_account_id,\'\')=COALESCE(?,\'\') ORDER BY created_at DESC LIMIT 2',mode,paymentIntent,accountId);
  if(matches.length!==1)return{handled:true,persisted:false};
  const payment=matches[0];const kind=isWarning?'early_fraud_warning':'review';const actionable=isWarning&&typeof obj.actionable==='boolean'?Number(obj.actionable):null;
  const open=isReview?(typeof obj.open==='boolean'?obj.open:event.type==='review.opened'):false;
  const state=isWarning?(actionable===1?'actionable':actionable===0?'inactive':'unknown'):(open?'open':'closed');
  const fraudType=isWarning&&typeof obj.fraud_type==='string'?obj.fraud_type.slice(0,80):null;
  const rawReason=isReview?(typeof obj.reason==='string'?obj.reason:typeof obj.closed_reason==='string'?obj.closed_reason:null):null;
  const reason=rawReason?.slice(0,80)||null;const timestamp=typeof obj.created==='number'&&Number.isSafeInteger(obj.created)&&obj.created>0?new Date(obj.created*1000):null;const createdAt=timestamp&&Number.isFinite(timestamp.getTime())?timestamp.toISOString():store.now();const updatedAt=store.now();
  const existing=store.one<{tenant_id:string;payment_id:string;mode:string;account_id:string|null;kind:string}>('SELECT tenant_id,payment_id,mode,account_id,kind FROM stripe_risk_signals WHERE id=?',id);
  if(existing&&(existing.tenant_id!==payment.tenant_id||existing.payment_id!==payment.id||existing.mode!==mode||(existing.account_id||null)!==accountId||existing.kind!==kind))throw new ApiError(400,'webhook_risk_mapping_conflict','Stripe risk signal does not match its stored Agora payment.');
  store.run('INSERT INTO stripe_risk_signals(id,tenant_id,payment_id,mode,account_id,kind,state,actionable,fraud_type,reason,created_at,updated_at,event_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,actionable=excluded.actionable,fraud_type=excluded.fraud_type,reason=excluded.reason,updated_at=excluded.updated_at,event_id=excluded.event_id',id,payment.tenant_id,payment.id,mode,accountId,kind,state,actionable,fraudType,reason,createdAt,updatedAt,event.id);
  return{handled:true,persisted:true};
}

function cursorEncode(row:{created_at:string;id:string}){return Buffer.from(`${row.created_at}\n${row.id}`).toString('base64url');}
function cursorDecode(value:string){try{const [created,id]=Buffer.from(value,'base64url').toString().split('\n');if(!created||!id)throw 0;return{created,id};}catch{throw new ApiError(422,'invalid_cursor','The risk signal cursor is invalid.');}}
export function listStripeRiskSignals(store:LedgerStore,actor:Actor,mode:RiskMode,cursor?:string,limitInput=25,environment:PaymentProviderEnvironment=process.env){
  if(actor.tenant_id!=='owner')throw new ApiError(403,'permission_denied','Only the workspace owner can view Stripe risk signals.');
  const limit=Math.max(1,Math.min(100,Math.trunc(limitInput)||25));const configured=stripeConfigSummary(store,environment).configured[mode];const status=!configured.webhook_secret?'unconfigured':configured.webhook_verified?'ready':'awaiting_verification';
  const args:(string|number|null|Uint8Array)[]=['owner',mode];let where='tenant_id=? AND mode=?';if(cursor){const c=cursorDecode(cursor);where+=' AND (created_at<? OR (created_at=? AND id<?))';args.push(c.created,c.created,c.id);}
  const rows=store.all<{id:string;payment_id:string;kind:string;state:string;actionable:number|null;fraud_type:string|null;reason:string|null;created_at:string;updated_at:string}>(`SELECT id,payment_id,kind,state,actionable,fraud_type,reason,created_at,updated_at FROM stripe_risk_signals WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ?`,...args,limit+1);
  const more=rows.length>limit;const data=rows.slice(0,limit).map(row=>({...row,actionable:row.actionable===null?null:Boolean(row.actionable)}));return{status,mode,source:'verified_stripe_webhooks',data,next_cursor:more&&data.length?cursorEncode(data.at(-1)!):null};
}
