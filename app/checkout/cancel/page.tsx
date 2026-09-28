import CheckoutReturn from "@/components/checkout-return"

export const dynamic = "force-dynamic"

export default async function CheckoutCancel({
  searchParams,
}: {
  searchParams: Promise<{ payment_id?: string }>
}) {
  const params = await searchParams
  return <CheckoutReturn paymentId={params.payment_id} canceled />
}
