import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { LedgerStore } from './store';
import type { Actor, PaymentProviderEnvironment } from './service';
import type { Credential, Customer, Fulfillment, Order, OrderItem, Payment, Product, Quote, QuoteItem } from '../types';
import { ApiError } from './errors';
import { decryptWorkspaceSecret, encryptWorkspaceSecret } from './stripe-config';

const text = z.string().trim().min(1).max(120);
const cents = z.number().int().min(0).max(10_000_000);
const email = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
function requireScope(actor: Actor, scope: string) {
  if (!actor.scopes.includes('*') && !actor.scopes.includes(scope)) throw new ApiError(403, 'permission_denied', `This key needs ${scope}.`);
}
function assertResourceMode(actor:Actor,mode:string|null|undefined,message:string){if(actor.credential&&(mode||'sandbox')!==(actor.credential.provider_mode||'sandbox'))throw new ApiError(404,'not_found',message);}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(422, 'invalid_request', parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  return parsed.data;
}
function customerById(store: LedgerStore, tenantId: string, customerId: string) {
  const customer = store.one<Customer>('SELECT * FROM customers WHERE id=? AND tenant_id=?', customerId, tenantId);
  if (!customer) throw new ApiError(404, 'not_found', 'Customer not found.');
  return customer;
}
function saveCustomer(store: LedgerStore, tenantId: string, name: string, normalizedEmail?: string) {
  const existing = normalizedEmail
    ? store.one<Customer>('SELECT * FROM customers WHERE tenant_id=? AND email=? COLLATE NOCASE AND name=?', tenantId, normalizedEmail, name)
    : undefined;
  const now = store.now();
  if (existing) {
    store.run('UPDATE customers SET name=?,updated_at=? WHERE id=? AND tenant_id=?', name, now, existing.id, tenantId);
    return store.one<Customer>('SELECT * FROM customers WHERE id=? AND tenant_id=?', existing.id, tenantId)!;
  }
  // Older schemas impose one normalized email per tenant. Keep the email on the
  // distinct customer row, but only reserve the lookup key for the first identity.
  const reservedEmail = normalizedEmail && !store.one('SELECT id FROM customers WHERE tenant_id=? AND email_normalized=?', tenantId, normalizedEmail) ? normalizedEmail : null;
  const customer: Customer = { id: store.id('cus'), tenant_id: tenantId, name, email: normalizedEmail || null, created_at: now, updated_at: now };
  store.run('INSERT INTO customers(id,tenant_id,name,email,email_normalized,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', customer.id, tenantId, name, customer.email, reservedEmail, now, now);
  return customer;
}
export function createCustomer(store: LedgerStore, actor: Actor, body: unknown) {
  requireScope(actor, 'customers:write');
  const input = parse(z.object({ name: text, email: email.optional() }).strict(), body);
  return saveCustomer(store, actor.tenant_id, input.name, input.email);
}
export function getCustomer(store: LedgerStore, actor: Actor, customerId: string) {
  requireScope(actor, 'customers:read');
  return customerById(store, actor.tenant_id, customerId);
}
export function listCustomers(store: LedgerStore, actor: Actor, cursor: number, limit: number) {
  requireScope(actor, 'customers:read');
  const rows = store.all<Customer & { cursor_id: number; email_normalized?: string | null }>('SELECT rowid AS cursor_id,* FROM customers WHERE tenant_id=? AND rowid>? ORDER BY rowid LIMIT ?', actor.tenant_id, cursor, limit + 1);
  const hasMore = rows.length > limit;
  return { data: rows.slice(0, limit).map(({ cursor_id: _cursor, email_normalized: _normalized, ...customer }) => customer), next_cursor: hasMore ? rows[limit - 1]?.cursor_id : null };
}

function quoteItems(store: LedgerStore, quoteId: string) {
  return store.all<QuoteItem>('SELECT id,quote_id,product_id,product_name,catalog_version,quantity,unit_amount,line_total,discount_amount,net_total FROM quote_items WHERE quote_id=? ORDER BY rowid', quoteId);
}
function quoteById(store: LedgerStore, tenantId: string, quoteId: string): Quote {
  const row = store.one<Quote & { email_normalized?: string | null }>(`SELECT q.*,COALESCE(q.customer_name_snapshot,c.name) AS customer_name,COALESCE(q.customer_email_snapshot,c.email) AS customer_email
    FROM quotes q JOIN customers c ON c.id=q.customer_id AND c.tenant_id=q.tenant_id WHERE q.id=? AND q.tenant_id=?`, quoteId, tenantId);
  if (!row) throw new ApiError(404, 'not_found', 'Quote not found.');
  const status = row.status === 'open' && Date.parse(row.expires_at) <= Date.now() ? 'expired' : row.status;
  const { email_normalized: _normalized, ...quote } = row;
  return { ...quote, status, items: quoteItems(store, quoteId) };
}
export function getQuote(store: LedgerStore, actor: Actor, quoteId: string) {
  requireScope(actor, 'quotes:read');
  const quote=quoteById(store, actor.tenant_id, quoteId);assertResourceMode(actor,quote.provider_mode,'Quote not found.');return quote;
}
export function listQuotes(store: LedgerStore, actor: Actor, cursor: number, limit: number) {
  requireScope(actor, 'quotes:read');
  const modeFilter=actor.credential?" AND COALESCE(provider_mode,'sandbox')=?":'';const args:(string|number)[]=[actor.tenant_id,cursor];if(actor.credential)args.push(actor.credential.provider_mode||'sandbox');args.push(limit+1);
  const rows = store.all<{ id: string; cursor_id: number }>(`SELECT rowid AS cursor_id,id FROM quotes WHERE tenant_id=? AND rowid>?${modeFilter} ORDER BY rowid LIMIT ?`, ...args);
  const hasMore = rows.length > limit;
  return { data: rows.slice(0, limit).map(({ id }) => quoteById(store, actor.tenant_id, id)), next_cursor: hasMore ? rows[limit - 1]?.cursor_id : null };
}
export function createQuote(store: LedgerStore, actor: Actor, body: unknown, environment:PaymentProviderEnvironment=process.env) {
  requireScope(actor, 'quotes:write');
  const input = parse(z.object({
    customer: z.object({ name: text, email: email.optional() }).strict(),
    items: z.array(z.object({ product_id: text, quantity: z.number().int().min(1).max(1000) }).strict()).min(1).max(50),
    discount_amount: cents.optional(), expires_at: z.string().datetime({ offset: true }).optional(),
  }).strict(), body);
  const now = store.now();
  const nowMs = Date.parse(now);
  const expiresAt = input.expires_at ? new Date(input.expires_at).toISOString() : new Date(nowMs + 7 * 86400_000).toISOString();
  if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= nowMs || Date.parse(expiresAt) > nowMs + 30 * 86400_000) throw new ApiError(422, 'invalid_expiration', 'Quote expiry must be in the future and no more than 30 days away.');
  const items = input.items.map((item) => {
    const product = store.one<Product>('SELECT * FROM products WHERE id=? AND tenant_id=? AND COALESCE(archived_at,\'\')=\'\'', item.product_id, actor.tenant_id);
    if (!product) throw new ApiError(404, 'not_found', `Active product not found: ${item.product_id}.`);
    const lineTotal = product.amount * item.quantity;
    if (!Number.isSafeInteger(lineTotal) || lineTotal > 10_000_000) throw new ApiError(422, 'quote_total_limit', 'A quote line exceeds the supported USD amount.');
    return { product, quantity: item.quantity, line_total: lineTotal };
  });
  const subtotal = items.reduce((total, item) => total + item.line_total, 0);
  const discount = input.discount_amount || 0;
  const total = subtotal - discount;
  if (!Number.isSafeInteger(subtotal) || subtotal > 10_000_000 || discount > subtotal || total < 1) throw new ApiError(422, 'invalid_quote_total', 'Quote total must be between 1 and 10,000,000 USD cents and discount cannot exceed subtotal.');
  const customer = saveCustomer(store, actor.tenant_id, input.customer.name, input.customer.email);
  const quoteId = store.id('quo');
  const token=randomBytes(32).toString('base64url');
  const providerMode=actor.credential?.provider_mode||(environment.AGORA_PAYMENT_PROVIDER==='stripe'?(environment.AGORA_STRIPE_MODE==='live'?'live':environment.AGORA_STRIPE_MODE==='test'?'test':'invalid'):'sandbox');
  store.run('INSERT INTO quotes(id,tenant_id,customer_id,status,currency,subtotal_amount,discount_amount,total_amount,expires_at,created_at,created_by,token_hash,token_ciphertext,creator_credential_id,amount_limit_snapshot,provider_mode,customer_name_snapshot,customer_email_snapshot,version) VALUES(?,?,?,\'open\',\'usd\',?,?,?,?,?,?,?,?,?,?,?,?,?,1)', quoteId, actor.tenant_id, customer.id, subtotal, discount, total, expiresAt, now, actor.name, createHash('sha256').update(token).digest('hex'), encryptWorkspaceSecret(token,environment), actor.credential?.id||null, actor.credential?.max_amount||null, providerMode, customer.name, customer.email);
  let remainingDiscount=discount;
  for (let index=0;index<items.length;index++) { const item=items[index]!; const allocated=index===items.length-1?remainingDiscount:Math.min(remainingDiscount,Math.floor(discount*item.line_total/subtotal));remainingDiscount-=allocated;const netTotal=item.line_total-allocated;store.run('INSERT INTO quote_items(id,quote_id,product_id,product_name,catalog_version,quantity,unit_amount,line_total,discount_amount,net_total) VALUES(?,?,?,?,?,?,?,?,?,?)', store.id('qit'), quoteId, item.product.id, item.product.name, item.product.version || 1, item.quantity, item.product.amount, item.line_total, allocated, netTotal); }
  store.event('quote.created', actor.name, quoteId, { customer_id: customer.id, total_amount: total, expires_at: expiresAt }, actor.tenant_id);
  return {...quoteById(store, actor.tenant_id, quoteId),quote_token:token};
}

export function updateQuote(store:LedgerStore,actor:Actor,quoteId:string,body:unknown,environment:PaymentProviderEnvironment=process.env) {
  requireScope(actor,'quotes:write');
  const input=parse(z.object({expected_version:z.number().int().min(1),customer_id:text.optional(),customer:z.object({name:text,email:email.optional()}).strict().optional(),items:z.array(z.object({product_id:text,quantity:z.number().int().min(1).max(1000)}).strict()).min(1).max(50).optional(),discount_amount:cents.optional(),expires_at:z.string().datetime({offset:true}).optional()}).strict().refine(v=>!(v.customer_id&&v.customer),{message:'Provide customer_id or customer, not both.'}),body);
  const quote=store.one<{status:string;version:number;expires_at:string;customer_id:string;subtotal_amount:number;discount_amount:number;total_amount:number;customer_name_snapshot:string|null;customer_email_snapshot:string|null}>('SELECT status,version,expires_at,customer_id,subtotal_amount,discount_amount,total_amount,customer_name_snapshot,customer_email_snapshot FROM quotes WHERE id=? AND tenant_id=?',quoteId,actor.tenant_id);
  if(!quote)throw new ApiError(404,'not_found','Quote not found.');
  if(quote.status!=='open'||Date.parse(quote.expires_at)<=Date.now())throw new ApiError(409,'quote_not_editable','Only open, unexpired quotes can be edited.');
  if(quote.version!==input.expected_version)throw new ApiError(409,'version_conflict','This quote changed. Reload it before saving.');
  const now=store.now(),nowMs=Date.parse(now),expiresAt=input.expires_at?new Date(input.expires_at).toISOString():quote.expires_at;
  if(!Number.isFinite(Date.parse(expiresAt))||Date.parse(expiresAt)<=nowMs||Date.parse(expiresAt)>nowMs+30*86400_000)throw new ApiError(422,'invalid_expiration','Quote expiry must be in the future and no more than 30 days away.');
  const oldItems=store.all<QuoteItem>('SELECT * FROM quote_items WHERE quote_id=? ORDER BY rowid',quoteId);
  let items=input.items?.map(item=>{const product=store.one<Product>('SELECT * FROM products WHERE id=? AND tenant_id=? AND COALESCE(archived_at,\'\')=\'\'',item.product_id,actor.tenant_id);if(!product)throw new ApiError(404,'not_found',`Active product not found: ${item.product_id}.`);const line_total=product.amount*item.quantity;if(!Number.isSafeInteger(line_total)||line_total>10_000_000)throw new ApiError(422,'quote_total_limit','A quote line exceeds the supported USD amount.');return{product,quantity:item.quantity,line_total};});
  if(items&&items.length===oldItems.length&&items.every((item,index)=>item.product.id===oldItems[index]?.product_id&&item.quantity===oldItems[index]?.quantity))items=undefined;
  const subtotal=items?items.reduce((sum,item)=>sum+item.line_total,0):quote.subtotal_amount,discount=input.discount_amount??quote.discount_amount,total=subtotal-discount;
  if(!Number.isSafeInteger(subtotal)||subtotal>10_000_000||discount>subtotal||total<1)throw new ApiError(422,'invalid_quote_total','Quote total must be between 1 and 10,000,000 USD cents and discount cannot exceed subtotal.');
  const customer=input.customer_id?customerById(store,actor.tenant_id,input.customer_id):input.customer?saveCustomer(store,actor.tenant_id,input.customer.name,input.customer.email):customerById(store,actor.tenant_id,quote.customer_id);
  const customerName=input.customer_id||input.customer?customer.name:quote.customer_name_snapshot||customer.name,customerEmail=input.customer_id||input.customer?customer.email:quote.customer_email_snapshot??customer.email;
  const token=randomBytes(32).toString('base64url');
  const result=store.run("UPDATE quotes SET customer_id=?,customer_name_snapshot=?,customer_email_snapshot=?,subtotal_amount=?,discount_amount=?,total_amount=?,expires_at=?,version=version+1,token_hash=?,token_ciphertext=? WHERE id=? AND tenant_id=? AND status='open' AND version=? AND expires_at>?",customer.id,customerName,customerEmail,subtotal,discount,total,expiresAt,createHash('sha256').update(token).digest('hex'),encryptWorkspaceSecret(token,environment),quoteId,actor.tenant_id,input.expected_version,now) as {changes?:number|bigint;rowsWritten?:number|bigint};
  if(Number(result.changes??result.rowsWritten??0)!==1)throw new ApiError(409,'version_conflict','This quote changed. Reload it before saving.');
  if(items){store.run('DELETE FROM quote_items WHERE quote_id=?',quoteId);let remaining=discount;for(let i=0;i<items.length;i++){const item=items[i]!,allocated=i===items.length-1?remaining:Math.min(remaining,Math.floor(discount*item.line_total/subtotal));remaining-=allocated;const net_total=item.line_total-allocated;store.run('INSERT INTO quote_items(id,quote_id,product_id,product_name,catalog_version,quantity,unit_amount,line_total,discount_amount,net_total) VALUES(?,?,?,?,?,?,?,?,?,?)',store.id('qit'),quoteId,item.product.id,item.product.name,item.product.version||1,item.quantity,item.product.amount,item.line_total,allocated,net_total);}}
  else if(input.discount_amount!==undefined){let remaining=discount;for(let i=0;i<oldItems.length;i++){const item=oldItems[i]!,allocated=i===oldItems.length-1?remaining:Math.min(remaining,Math.floor(discount*item.line_total/subtotal));remaining-=allocated;store.run('UPDATE quote_items SET discount_amount=?,net_total=? WHERE id=? AND quote_id=?',allocated,item.line_total-allocated,item.id,quoteId);}}
  store.event('quote.updated',actor.name,quoteId,{version:input.expected_version+1,total_amount:total},actor.tenant_id);
  return {...quoteById(store,actor.tenant_id,quoteId),quote_token:token};
}

export function quoteShareUrl(store:LedgerStore,actor:Actor,quoteId:string,origin:string,environment:PaymentProviderEnvironment=process.env){requireScope(actor,'quotes:read');const row=store.one<{token_ciphertext:string|null}>('SELECT token_ciphertext FROM quotes WHERE id=? AND tenant_id=?',quoteId,actor.tenant_id);if(!row)throw new ApiError(404,'not_found','Quote not found.');if(!row.token_ciphertext)return null;const token=decryptWorkspaceSecret(row.token_ciphertext,environment);return`${origin.replace(/\/$/,'')}/quote#${token}`;}

export function reviewPublicQuote(store:LedgerStore,token:string){
  if(!/^[A-Za-z0-9_-]{40,60}$/.test(token))throw new ApiError(404,'not_found','Quote not found.');
  const digest=createHash('sha256').update(token).digest('hex');const row=store.one<{id:string;tenant_id:string;creator_credential_id:string|null;amount_limit_snapshot:number|null;provider_mode:string|null}>('SELECT id,tenant_id,creator_credential_id,amount_limit_snapshot,provider_mode FROM quotes WHERE token_hash=?',digest);
  if(!row)throw new ApiError(404,'not_found','Quote not found.');const quote=quoteById(store,row.tenant_id,row.id);
  if(quote.status==='expired')throw new ApiError(410,'quote_expired','This quote has expired. Ask the seller for a new quote.');
  if(row.creator_credential_id&&quote.status==='open'){const key=store.one<{id:string;name:string;scopes:string;tenant_id:string;provider_mode:string;max_amount:number;refund_budget:number;spent:number}>('SELECT * FROM credentials WHERE id=? AND revoked=0',row.creator_credential_id);if(!key||key.tenant_id!==row.tenant_id)throw new ApiError(410,'quote_unavailable','This quote is no longer available.');}
  const merchant=store.one<{business_name:string}>('SELECT business_name FROM tenants WHERE id=?',row.tenant_id)?.business_name||quote.created_by;
  let order:Record<string,unknown>|undefined;
  if(quote.order_id){const orderRow=store.one<{id:string;status:string;total_amount:number;paid_at:string|null;fulfillment_status:string|null;cancelled_at:string|null;payment_amount:number;payment_refunded:number;payment_state:string}>('SELECT o.id,o.status,o.total_amount,o.paid_at,f.status AS fulfillment_status,f.cancelled_at,p.amount AS payment_amount,p.refunded AS payment_refunded,p.status AS payment_state FROM orders o LEFT JOIN fulfillments f ON f.order_id=o.id AND f.tenant_id=o.tenant_id LEFT JOIN payments p ON p.id=o.payment_id AND p.tenant_id=o.tenant_id WHERE o.id=? AND o.tenant_id=?',quote.order_id,row.tenant_id);if(orderRow){const refunded=Number(orderRow.payment_refunded||0);const amount=Number(orderRow.payment_amount||orderRow.total_amount);const payment_status=refunded>=amount&&amount>0?'refunded':refunded>0?'partially_refunded':orderRow.payment_state==='succeeded'?'paid':orderRow.payment_state==='pending'?'pending':'failed';order={id:orderRow.id,status:orderRow.status,payment_status,refunded_amount:refunded,net_amount:Math.max(0,amount-refunded),fulfillment_status:orderRow.cancelled_at?'cancelled':orderRow.fulfillment_status,total_amount:orderRow.total_amount,paid_at:orderRow.paid_at,items:store.all('SELECT product_name,quantity,unit_amount,line_total,discount_amount,net_total FROM order_items WHERE order_id=? ORDER BY rowid',orderRow.id)};}}
  const publicQuote={id:quote.id,status:quote.status,merchant,customer_name:quote.customer_name,currency:quote.currency,subtotal_amount:quote.subtotal_amount,discount_amount:quote.discount_amount,total_amount:quote.total_amount,expires_at:quote.expires_at,items:quote.items,...(order?{order}:{})};
  return {quote:publicQuote,guard:{tenant_id:row.tenant_id,creator_credential_id:row.creator_credential_id,amount_limit_snapshot:row.amount_limit_snapshot,provider_mode:row.provider_mode},internalQuote:quote};
}

export function acceptPublicQuote(store:LedgerStore,token:string,environment:PaymentProviderEnvironment=process.env){
  const reviewed=reviewPublicQuote(store,token);const quote=reviewed.internalQuote;const guard=reviewed.guard;
  if(quote.status!=='open')throw new ApiError(409,'quote_not_open','This quote is no longer available for acceptance.');
  if(guard.amount_limit_snapshot!==null&&quote.total_amount>guard.amount_limit_snapshot)throw new ApiError(403,'limit_exceeded','This quote exceeds the seller key’s payment limit.');
  const currentMode=environment.AGORA_PAYMENT_PROVIDER==='stripe'?(environment.AGORA_STRIPE_MODE==='live'?'live':environment.AGORA_STRIPE_MODE==='test'?'test':'invalid'):'sandbox';
  if(currentMode!==guard.provider_mode)throw new ApiError(409,'quote_mode_changed','The seller’s payment mode changed after this quote was issued. Ask for a new quote.');
  let actor:Actor={id:'public_quote_capability',name:'Customer quote acceptance',scopes:['*'],tenant_id:guard.tenant_id};
  if(guard.creator_credential_id){const key=store.one<Credential & {scopes:string}>('SELECT * FROM credentials WHERE id=? AND revoked=0',guard.creator_credential_id);if(!key||key.tenant_id!==guard.tenant_id)throw new ApiError(410,'quote_unavailable','This quote is no longer available.');const credential={...key,scopes:JSON.parse(key.scopes) as string[]};actor={id:key.id,name:key.name,tenant_id:key.tenant_id,scopes:credential.scopes,credential};}
  return acceptQuote(store,actor,quote.id,environment,quote.version);
}

function paymentId(store: LedgerStore) { return store.id('pay'); }
export function acceptQuote(store: LedgerStore, actor: Actor, quoteId: string, environment: PaymentProviderEnvironment = process.env, expectedVersion?:number) {
  requireScope(actor, 'quotes:write');
  requireScope(actor, 'payments:write');
  const quote = quoteById(store, actor.tenant_id, quoteId);
  if(expectedVersion!==undefined&&quote.version!==expectedVersion)throw new ApiError(409,'version_conflict','This quote changed after review. Review the latest version before accepting.');
  const selectedProvider=environment.AGORA_PAYMENT_PROVIDER==='stripe'?'stripe':'sandbox';const selectedMode=selectedProvider==='stripe'?(environment.AGORA_STRIPE_MODE==='live'?'live':environment.AGORA_STRIPE_MODE==='test'?'test':'invalid'):'sandbox';
  assertResourceMode(actor,quote.provider_mode,'Quote not found.');
  if(selectedMode!==quote.provider_mode)throw new ApiError(409,'quote_mode_changed','The configured payment mode changed after this quote was issued. Create a new quote.');
  if (quote.status === 'expired') throw new ApiError(409, 'quote_expired', 'This quote has expired. Create a new quote with current catalog prices.');
  if (quote.status !== 'open') throw new ApiError(409, 'quote_not_open', 'This quote is no longer available for acceptance.');
  if (actor.credential && quote.total_amount > actor.credential.max_amount) throw new ApiError(403, 'limit_exceeded', 'This quote exceeds the key’s per-payment amount limit.');
  const acceptedAt = store.now();
  const changed = store.run("UPDATE quotes SET status='accepted',accepted_at=? WHERE id=? AND tenant_id=? AND status='open' AND expires_at>? AND (? IS NULL OR version=?)", acceptedAt, quoteId, actor.tenant_id, acceptedAt, expectedVersion??null, expectedVersion??null) as {changes?:number|bigint;rowsWritten?:number|bigint};
  if (Number(changed.changes??changed.rowsWritten) !== 1) throw new ApiError(409, expectedVersion===undefined?'quote_not_open':'version_conflict', expectedVersion===undefined?'This quote expired or was already accepted.':'This quote changed after review. Review the latest version before accepting.');
  const customer = customerById(store, actor.tenant_id, quote.customer_id);
  const first = quote.items[0];
  const orderId = store.id('ord');
  const payId = paymentId(store);
  const combinedProductName = quote.items.map((item) => `${item.product_name} × ${item.quantity}`).join(', ').slice(0, 120);
  const payment: Payment = { id: payId, product_id: first.product_id, product_name: combinedProductName, customer: customer.name, amount: quote.total_amount, refunded: 0, currency: 'usd', status: 'pending', actor: actor.name, created_at: acceptedAt, checkout_token: randomBytes(24).toString('hex'), sample: 0, tenant_id: actor.tenant_id, provider:selectedProvider, provider_mode:selectedMode==='test'||selectedMode==='live'?selectedMode:null };
  store.run('INSERT INTO payments(id,product_id,product_name,customer,amount,refunded,currency,status,actor,created_at,checkout_token,sample,tenant_id,provider,provider_mode) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', payment.id, payment.product_id, payment.product_name, payment.customer, payment.amount, 0, payment.currency, payment.status, payment.actor, payment.created_at, payment.checkout_token, 0, actor.tenant_id, selectedProvider, payment.provider_mode||null);
  store.run("INSERT INTO orders(id,tenant_id,quote_id,customer_id,payment_id,status,currency,total_amount,created_at) VALUES(?,?,?, ?,?,'awaiting_payment','usd',?,?)", orderId, actor.tenant_id, quoteId, customer.id, payId, quote.total_amount, acceptedAt);
  store.run('UPDATE quotes SET order_id=? WHERE id=? AND tenant_id=?', orderId, quoteId, actor.tenant_id);
  for (const item of quote.items) store.run('INSERT INTO order_items(id,order_id,product_id,product_name,catalog_version,quantity,unit_amount,line_total,discount_amount,net_total) VALUES(?,?,?,?,?,?,?,?,?,?)', store.id('oit'), orderId, item.product_id, item.product_name, item.catalog_version, item.quantity, item.unit_amount, item.line_total, item.discount_amount, item.net_total);
  store.run("INSERT INTO fulfillments(id,tenant_id,order_id,payment_id,status,created_at,updated_at) VALUES(?,?,?,?,'awaiting_payment',?,?)", store.id('ful'), actor.tenant_id, orderId, payId, acceptedAt, acceptedAt);
  store.event('quote.accepted',actor.name,quoteId,{order_id:orderId,payment_id:payId,acceptance_channel:actor.id.startsWith('public_quote_customer:')?'customer_capability':'authenticated_api'},actor.tenant_id);
  store.event('payment.created', actor.name, payId, { amount: payment.amount, provider:selectedProvider, provider_mode:payment.provider_mode, order_id: orderId, quote_id: quoteId }, actor.tenant_id);
  return { quote_id: quoteId, order_id: orderId, payment, items: quote.items };
}

export function createDirectSaleRecords(store:LedgerStore,actor:Actor,payment:Payment,product:Product){
  const customer=saveCustomer(store,actor.tenant_id,payment.customer||'Guest');const now=payment.created_at;const orderId=store.id('ord');const fulfillmentId=store.id('ful');
  store.run("INSERT INTO orders(id,tenant_id,quote_id,customer_id,payment_id,status,currency,total_amount,created_at) VALUES(?,?,NULL,?,?,'awaiting_payment','usd',?,?)",orderId,actor.tenant_id,customer.id,payment.id,payment.amount,now);
  store.run('INSERT INTO order_items(id,order_id,product_id,product_name,catalog_version,quantity,unit_amount,line_total,discount_amount,net_total) VALUES(?,?,?,?,?,1,?,?,0,?)',store.id('oit'),orderId,product.id,product.name,product.version||1,payment.amount,payment.amount,payment.amount);
  store.run("INSERT INTO fulfillments(id,tenant_id,order_id,payment_id,status,created_at,updated_at) VALUES(?,?,?,?,'awaiting_payment',?,?)",fulfillmentId,actor.tenant_id,orderId,payment.id,now,now);
  store.event('order.created',actor.name,orderId,{payment_id:payment.id,source:'direct_payment'},actor.tenant_id);
  return {order_id:orderId,fulfillment_id:fulfillmentId};
}

export function markOrderPaymentState(store: LedgerStore, paymentId: string, tenantId: string, status: 'succeeded' | 'failed') {
  const order = store.one<{ id: string; status: string }>('SELECT id,status FROM orders WHERE payment_id=? AND tenant_id=?', paymentId, tenantId);
  if (!order || order.status !== 'awaiting_payment') return;
  const now = store.now();
  if (status === 'succeeded') {
    store.run("UPDATE orders SET status='paid',paid_at=? WHERE id=? AND tenant_id=? AND status='awaiting_payment'", now, order.id, tenantId);
    store.run("UPDATE fulfillments SET status='ready',updated_at=? WHERE order_id=? AND tenant_id=? AND status='awaiting_payment'", now, order.id, tenantId);
    store.event('fulfillment.ready', 'Agora payment confirmation', order.id, { payment_id: paymentId }, tenantId);
  } else {
    store.run("UPDATE orders SET status='cancelled' WHERE id=? AND tenant_id=? AND status='awaiting_payment'", order.id, tenantId);
    store.run("UPDATE fulfillments SET status='failed',note='Payment failed',updated_at=? WHERE order_id=? AND tenant_id=? AND status='awaiting_payment'", now, order.id, tenantId);
  }
}
export function markOrderRefundState(store:LedgerStore,paymentId:string,tenantId:string){const payment=store.one<{amount:number;refunded:number}>('SELECT amount,refunded FROM payments WHERE id=? AND tenant_id=?',paymentId,tenantId);if(!payment||payment.refunded<payment.amount)return;const now=store.now();store.run("UPDATE fulfillments SET status='failed',cancelled_at=?,note='Cancelled after full refund',updated_at=? WHERE payment_id=? AND tenant_id=? AND status<>'completed' AND cancelled_at IS NULL",now,now,paymentId,tenantId);store.event('fulfillment.cancelled','Full refund',paymentId,{payment_id:paymentId},tenantId);}

function orderRow(store: LedgerStore, actor:Actor, orderId: string): Order & { items?: OrderItem[] } {
  const row = store.one<Order & {resource_provider:string;resource_mode:string|null;payment_amount:number;payment_refunded:number;payment_state:string}>('SELECT o.*,c.name AS customer_name,c.email AS customer_email,f.status AS fulfillment_status,p.provider AS resource_provider,p.provider_mode AS resource_mode,p.amount AS payment_amount,p.refunded AS payment_refunded,p.status AS payment_state FROM orders o JOIN customers c ON c.id=o.customer_id AND c.tenant_id=o.tenant_id LEFT JOIN fulfillments f ON f.order_id=o.id AND f.tenant_id=o.tenant_id LEFT JOIN payments p ON p.id=o.payment_id AND p.tenant_id=o.tenant_id WHERE o.id=? AND o.tenant_id=?', orderId, actor.tenant_id);
  if (!row) throw new ApiError(404, 'not_found', 'Order not found.');
  assertResourceMode(actor,row.resource_provider==='stripe'?row.resource_mode||'test':'sandbox','Order not found.');const refunded=Number(row.payment_refunded||0);const paymentAmount=Number(row.payment_amount||row.total_amount);const {resource_provider:_provider,resource_mode:_mode,payment_amount:_amount,payment_refunded:_refunded,payment_state:_state,...safe}=row;
  const payment_status:NonNullable<Order['payment_status']>=refunded>=paymentAmount&&paymentAmount>0?'refunded':refunded>0?'partially_refunded':row.payment_state==='succeeded'?'paid':row.payment_state==='pending'?'pending':'failed';
  return { ...safe,refunded_amount:refunded,net_amount:Math.max(0,paymentAmount-refunded),payment_status, items: store.all<OrderItem>('SELECT * FROM order_items WHERE order_id=? ORDER BY rowid', orderId) };
}
export function getOrder(store: LedgerStore, actor: Actor, orderId: string) { requireScope(actor, 'orders:read'); return orderRow(store, actor, orderId); }
export function getOrderReceipt(store:LedgerStore,actor:Actor,orderId:string){requireScope(actor,'orders:read');const order=orderRow(store,actor,orderId);if(order.status!=='paid')throw new ApiError(409,'order_not_paid','A receipt is available after payment is confirmed.');const merchant=store.one<{business_name:string}>('SELECT business_name FROM tenants WHERE id=?',actor.tenant_id)?.business_name||'Agora';return{order_id:order.id,merchant,status:order.status,payment_status:order.payment_status,refunded_amount:order.refunded_amount,net_amount:order.net_amount,fulfillment_status:order.fulfillment_status||null,currency:order.currency,total_amount:order.total_amount,paid_at:order.paid_at,items:(order.items||[]).map(({product_name,quantity,unit_amount,line_total,discount_amount,net_total})=>({product_name,quantity,unit_amount,line_total,discount_amount,net_total}))};}
export function listOrders(store: LedgerStore, actor: Actor, cursor: number, limit: number) {
  requireScope(actor, 'orders:read');
  const modeFilter=actor.credential?" AND COALESCE(p.provider_mode,CASE WHEN p.provider='stripe' THEN 'test' ELSE 'sandbox' END,'sandbox')=?":'';const args:(string|number)[]=[actor.tenant_id,cursor];if(actor.credential)args.push(actor.credential.provider_mode||'sandbox');args.push(limit+1);
  const rows = store.all<{ id: string; cursor_id: number }>(`SELECT o.rowid AS cursor_id,o.id FROM orders o LEFT JOIN payments p ON p.id=o.payment_id AND p.tenant_id=o.tenant_id WHERE o.tenant_id=? AND o.rowid>?${modeFilter} ORDER BY o.rowid LIMIT ?`, ...args);
  const hasMore = rows.length > limit;
  return { data: rows.slice(0, limit).map(({ id }) => orderRow(store, actor, id)), next_cursor: hasMore ? rows[limit - 1]?.cursor_id : null };
}
function fulfillmentRow(store: LedgerStore, actor:Actor, fulfillmentId: string) {
  const row = store.one<Fulfillment & { order_status: string; customer_name: string; customer_email: string | null; total_amount: number;resource_provider:string;resource_mode:string|null }>(`SELECT f.*,o.status AS order_status,c.name AS customer_name,c.email AS customer_email,o.total_amount,p.provider AS resource_provider,p.provider_mode AS resource_mode
    FROM fulfillments f JOIN orders o ON o.id=f.order_id AND o.tenant_id=f.tenant_id JOIN customers c ON c.id=o.customer_id AND c.tenant_id=o.tenant_id JOIN payments p ON p.id=f.payment_id AND p.tenant_id=f.tenant_id WHERE f.id=? AND f.tenant_id=?`, fulfillmentId, actor.tenant_id);
  if (!row) throw new ApiError(404, 'not_found', 'Fulfillment not found.');
  assertResourceMode(actor,row.resource_provider==='stripe'?row.resource_mode||'test':'sandbox','Fulfillment not found.');const {resource_provider:_provider,resource_mode:_mode,...visible}=row;return {...visible,status:row.cancelled_at?'cancelled':row.status};
}
export function getFulfillment(store: LedgerStore, actor: Actor, fulfillmentId: string) { requireScope(actor, 'fulfillment:read'); return fulfillmentRow(store, actor, fulfillmentId); }
export function listFulfillments(store: LedgerStore, actor: Actor, cursor: number, limit: number, status?: string) {
  requireScope(actor, 'fulfillment:read');
  if (status && !['awaiting_payment', 'ready', 'claimed', 'completed', 'failed','cancelled'].includes(status)) throw new ApiError(422, 'invalid_status', 'Unknown fulfillment status.');
  const statusFilter=status?(status==='cancelled'?' AND f.cancelled_at IS NOT NULL':' AND f.status=?'):'';const modeFilter=actor.credential?" AND COALESCE(p.provider_mode,CASE WHEN p.provider='stripe' THEN 'test' ELSE 'sandbox' END,'sandbox')=?":'';const args:(string|number)[]=[actor.tenant_id,cursor];if(status&&status!=='cancelled')args.push(status);if(actor.credential)args.push(actor.credential.provider_mode||'sandbox');args.push(limit+1);
  const rows = store.all<{ id: string; cursor_id: number }>(`SELECT f.rowid AS cursor_id,f.id FROM fulfillments f JOIN payments p ON p.id=f.payment_id AND p.tenant_id=f.tenant_id WHERE f.tenant_id=? AND f.rowid>?${statusFilter}${modeFilter} ORDER BY f.rowid LIMIT ?`, ...args);
  const hasMore = rows.length > limit;
  return { data: rows.slice(0, limit).map(({ id }) => fulfillmentRow(store, actor, id)), next_cursor: hasMore ? rows[limit - 1]?.cursor_id : null };
}
export function transitionFulfillment(store: LedgerStore, actor: Actor, fulfillmentId: string, action: 'claim' | 'complete' | 'fail' | 'retry', body: unknown = {}) {
  requireScope(actor, 'fulfillment:write');
  const input = parse(z.object({ note: z.string().trim().max(400).optional() }).strict(), body);
    const current = fulfillmentRow(store, actor, fulfillmentId);
    if(current.status==='cancelled')throw new ApiError(409,'fulfillment_cancelled','This fulfillment was cancelled after a full refund.');
    const now = store.now();
    if (action === 'claim') {
      if (current.status === 'claimed' && current.claimed_by === actor.id) return current;
      if (current.status !== 'ready') throw new ApiError(409, 'fulfillment_not_ready', 'Only a paid, ready fulfillment can be claimed.');
      store.run("UPDATE fulfillments SET status='claimed',claimed_by=?,claimed_at=?,attempt_count=attempt_count+1,updated_at=? WHERE id=? AND tenant_id=? AND status='ready'", actor.id, now, now, fulfillmentId, actor.tenant_id);
    } else if (action === 'complete' || action === 'fail') {
      if (current.status === 'completed' && action === 'complete') return current;
      if (current.status === 'failed' && action === 'fail') return current;
      if (current.status !== 'claimed' || current.claimed_by !== actor.id) throw new ApiError(409, 'fulfillment_not_claimed', 'Claim this fulfillment before completing or failing it.');
      if (current.order_status !== 'paid') throw new ApiError(409, 'payment_not_confirmed', 'Fulfillment requires verified payment confirmation.');
      if (action === 'complete') store.run("UPDATE fulfillments SET status='completed',completed_at=?,note=?,updated_at=? WHERE id=? AND tenant_id=? AND status='claimed' AND claimed_by=?", now, input.note || null, now, fulfillmentId, actor.tenant_id, actor.id);
      else store.run("UPDATE fulfillments SET status='failed',note=?,updated_at=? WHERE id=? AND tenant_id=? AND status='claimed' AND claimed_by=?", input.note || null, now, fulfillmentId, actor.tenant_id, actor.id);
    } else {
      if (current.status !== 'failed' || current.order_status !== 'paid') throw new ApiError(409, 'fulfillment_not_retryable', 'Only failed fulfillment for a paid order can be retried.');
      store.run("UPDATE fulfillments SET status='ready',claimed_by=NULL,claimed_at=NULL,completed_at=NULL,note=?,updated_at=? WHERE id=? AND tenant_id=? AND status='failed'", input.note || null, now, fulfillmentId, actor.tenant_id);
    }
    const next = fulfillmentRow(store, actor, fulfillmentId);
    store.event(`fulfillment.${action === 'retry' ? 'ready' : action === 'claim' ? 'claimed' : action === 'complete' ? 'completed' : 'failed'}`, actor.name, fulfillmentId, { order_id: current.order_id, note: input.note || null }, actor.tenant_id);
    return next;
}
