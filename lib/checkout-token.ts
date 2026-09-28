export function checkoutTokenFromHash(fragment: string, cached: string | null): string {
  return cached ?? fragment.replace(/^#/, "")
}

export function isCheckoutCapabilityToken(token: string): boolean {
  return /^[a-f0-9]{32,128}$/i.test(token)
}
