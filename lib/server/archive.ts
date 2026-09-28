import type { LedgerStore } from "./store"
import type { Actor } from "./service"
import { ApiError } from "./errors"

function requireWorkspaceOwner(actor: Actor) {
  if (actor.tenant_id !== "owner" || actor.credential) {
    throw new ApiError(403, "permission_denied", "Only the workspace owner can archive records.")
  }
}

function setArchiveState(store: LedgerStore, actor: Actor, table: "products" | "payments", id: string, archived: boolean) {
  requireWorkspaceOwner(actor)
  if (typeof archived !== "boolean") throw new ApiError(422, "invalid_request", "Provide archived as true or false.")
  return store.transaction(() => {
    const current = store.one<{ id: string; archived_at: string | null }>(`SELECT id, archived_at FROM ${table} WHERE id=? AND tenant_id=?`, id, actor.tenant_id)
    if (!current) throw new ApiError(404, "not_found", `${table === "products" ? "Product" : "Payment"} not found.`)
    const archivedAt = archived ? current.archived_at || store.now() : null
    if (current.archived_at !== archivedAt) {
      store.run(`UPDATE ${table} SET archived_at=? WHERE id=? AND tenant_id=?`, archivedAt, id, actor.tenant_id)
      const kind = table === "products" ? "product" : "payment"
      store.event(`${kind}.${archived ? "archived" : "restored"}`, actor.name, id, { archived, archived_at: archivedAt }, actor.tenant_id)
    }
    return { id, archived: Boolean(archivedAt), archived_at: archivedAt }
  })
}

export function archiveProduct(store: LedgerStore, actor: Actor, productId: string, archived: boolean) {
  return setArchiveState(store, actor, "products", productId, archived)
}

export function archivePayment(store: LedgerStore, actor: Actor, paymentId: string, archived: boolean) {
  return setArchiveState(store, actor, "payments", paymentId, archived)
}
