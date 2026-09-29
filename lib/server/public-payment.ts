import type { Payment } from '@/lib/types';

export function canonicalCheckoutUrl(payment: Pick<Payment, 'provider' | 'checkout_token'>, publicOrigin?: string) {
  const path = payment.provider === 'stripe'
    ? `/checkout/start#${payment.checkout_token}`
    : `/checkout/${payment.checkout_token}`;
  return publicOrigin ? new URL(path, publicOrigin).toString() : path;
}

/** Public payment view. The checkout capability is embedded only in the URL;
 * provider session URLs and IDs stay private to the server. */
export function publicPayment(payment: Payment, publicOrigin: string) {
  return {
    id: payment.id,
    product_id: payment.product_id,
    product_name: payment.product_name,
    customer: payment.customer,
    amount: payment.amount,
    refunded: payment.refunded,
    currency: payment.currency,
    status: payment.status,
    actor: payment.actor,
    created_at: payment.created_at,
    sample: payment.sample,
    ...(payment.provider ? { provider: payment.provider } : {}),
    ...(payment.provider_mode !== undefined ? { provider_mode: payment.provider_mode } : {}),
    ...(payment.archived_at !== undefined ? { archived_at: payment.archived_at } : {}),
    checkout_url: canonicalCheckoutUrl(payment, publicOrigin),
  };
}
