import assert from "node:assert/strict"
import test from "node:test"
import { checkoutTokenFromHash, isCheckoutCapabilityToken } from "../lib/checkout-token"

test("checkout capability survives a Strict Mode replay after the URL fragment is removed", () => {
  const capability = "a".repeat(48)
  const firstPass = checkoutTokenFromHash(`#${capability}`, null)
  const replay = checkoutTokenFromHash("", firstPass)

  assert.equal(firstPass, capability)
  assert.equal(replay, capability)
  assert.equal(isCheckoutCapabilityToken(replay), true)
})

test("an incomplete link stays invalid when no capability was cached", () => {
  const token = checkoutTokenFromHash("", null)
  assert.equal(token, "")
  assert.equal(isCheckoutCapabilityToken(token), false)
})
