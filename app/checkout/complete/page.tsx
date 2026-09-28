import CheckoutReturn from "@/components/checkout-return"

export const dynamic = "force-dynamic"

export default async function CheckoutComplete({
  searchParams,
}: {
  searchParams: Promise<{ payment_id?: string; session_id?: string }>
}) {
  const params = await searchParams
  return (
    <CheckoutReturn
      paymentId={params.payment_id}
      sessionId={params.session_id}
    />
  )
}
