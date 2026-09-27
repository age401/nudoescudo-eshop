# Stock overhaul — multi-session plan

Living document. **Every session working on this overhaul starts by reading
this file and ends by updating the Status table and the Session log.**

Branch: `feat/stock-overhaul` (cut from `staging`). Merge into `staging` at the
end of each phase that leaves the app in a working state — pushing `staging`
auto-deploys to staging.tcg.nudoescudo.com (ask the user before pushing).

## Goal (from the user, 2026-09-27)

1. Stock is managed **entirely on the website** — the admin panel must be good
   enough to maintain it professionally.
2. Delver Lens is only used for two things:
   - **Adding new cards** to stock (merge import). "Replace all stock" stays,
     as a separate option behind a real, non-trivial confirmation.
   - **In-store orders**: scan what a customer brings to the counter, upload
     the file, review matches (with suggestions when Delver picked the wrong
     edition), confirm → stock is decremented and a sale is recorded.
3. Database backups: recommend and implement the best path. Catalog/stock
   downloadable as CSV.
4. Remove the card-condition leftover from emails.

## Key design decisions

| # | Decision | Why |
|---|----------|-----|
| D1 | Add a **`stock_movements` ledger**; every stock change goes through one helper (`src/lib/stock.ts`) that updates the row *and* writes a movement (delta, reason, ref). | Audit trail, per-card history, undo of imports, and the only sane way to "maintain stock professionally". |
| D2 | Manual edits send the **quantity the admin saw**; the server rejects the save if it changed meanwhile (optimistic concurrency) and never lets quantity drop below `reserved`. | Today an absolute `SET quantity=` can silently overwrite a sale that happened while the page was open. |
| D3 | Imports are two-step: upload → a `stock_imports` row stores the **parsed rows** (status `previewed`) → confirm applies exactly that. | What was previewed is what gets applied; no re-upload; gives an import history with undo. |
| D4 | Replace mode confirmation = separate "Zona peligrosa" flow: impact summary (copies/rows that disappear, web-side edits lost, reservations touched) + **type the exact phrase `REEMPLAZAR TODO EL STOCK`** + acknowledge checkbox; server re-checks the phrase. A pre-replace stock snapshot is downloadable and the import is undoable via the ledger. | User asked for "a measure that ensures the user is really willing", not a Continue button. |
| D5 | `orders.channel` enum `web` \| `in_store`. In-store orders are created directly as `completed`; `email` and `confirmation_token` become nullable. | Reuses the orders list/detail/receipt; sales reporting stays in one place. |
| D6 | In-store matching: exact printing+finish(+language) against available stock; else **suggestions** = in-stock copies of the *same card* (oracle id) in other printings/finishes, falling back to normalized name when the Scryfall id isn't in our catalog. Ranked: same finish+lang > same finish > other. Admin ticks a suggestion, picks the concrete variant, or skips the line. | Exactly the "Unlimited vs 4th Edition Serra Angel" case. |
| D7 | In-store sale **cannot take copies reserved by web orders**; the review table shows which order holds them (link) so the admin can resolve it. | Keeps `quantity >= reserved` invariant; overriding silently would break a customer's confirmed order. |
| D8 | In-store prices default to the web price; the admin can edit the unit price per line and add a note/customer name before confirming. | Counter sales often get a rounded price/discount. |
| D9 | Retire "Vendidas — quitar de Delver" (`/admin/vendidas`, dashboard card, import warnings). Route redirects to the new movements page. `orders.delver_removed_at` is left in place (unused) — dropping it is optional cleanup. | Delver is no longer the source of truth, so there is nothing to reconcile. |
| D10 | Backups: keep the existing nightly `pg_dump` container; **add off-site copies** (rclone → Backblaze B2 or Cloudflare R2, pending user choice), a restore-test script (restore latest dump into staging), and an admin **Respaldos** page (backups dir mounted read-only into the app) with download + freshness warning on the dashboard. | Current dumps live on the same VPS as the DB — one disk/provider failure loses both. |
| D11 | Stock CSV export uses **import-compatible headers** (Scryfall ID, Quantity, Foil, Condition, Language, Name…) plus price/reserved columns. | The export doubles as a portable stock backup that our own importer can read back. |

## Phases

Each phase ends with: typecheck + lint + `npm test` green, manual check in the
browser preview, commit, Status table updated.

### P0 — Plan + quick win
- [x] This document.
- [x] Remove condition from **all** emails (`src/lib/email-templates.ts`: drop `showCondition`).

### P1 — Data foundation
- [x] Migration: `stock_movements` (id, stock_id FK, delta int, qty_after int, reason enum `import_add|import_replace|import_undo|manual_adjust|manual_add|web_order|in_store_sale|correction`, import_id?, order_id?, note, created_at). Index (stock_id, created_at), (created_at).
- [x] Migration: `stock_imports` (id, kind `add|replace`, status `previewed|applied|undone|discarded`, filename, rows jsonb, summary jsonb, created_at, applied_at, undone_at).
- [x] Migration: `order_channel` enum + `orders.channel` default `web`; `orders.email`, `orders.confirmation_token` nullable; `orders.note`/customer fields reuse existing.
- [x] `src/lib/stock.ts`: `applyStockDelta(tx, …)`, `setStockQuantity(tx, …, expected)`, `upsertStockAndAdd(tx, …)`; all writing movements.
- [x] Route existing writers through it: `delver-import.ts`, `orders.ts#completeOrder`, admin stock page action, `api/admin/stock`.
- [x] Tests for the helper + existing tests still green.

### P2 — Stock management UI
- [x] `/admin/stock` rewrite: filters (text, game, set, finish, language, condition, availability: con stock / sin stock / reservadas), sort (name, set, qty, price, updated), pagination (no 500 cap), result count.
- [x] Row edit (client component): quantity with +/− and direct value, price override, optional note; D2 concurrency error shown inline; toast/confirmation feedback.
- [x] Row history (movements for that stock row) in an expandable panel.
- [x] Delete row when qty 0, not reserved, not referenced by orders.
- [x] `/admin/stock/movimientos`: global ledger, filter by reason/date, links to orders/imports.
- [x] CSV export (`/api/admin/stock/export`) honoring current filters (D11).
- [x] Retire `/admin/vendidas` (D9): nav, dashboard card, warnings, redirect.
- [x] Admin nav: "Venta en tienda" added (P4); "Respaldos" lands with P5. Stock now has sub-tabs Inventario · Importar de Delver · Movimientos (`stock/layout.tsx`).

### P3 — Delver import rework
- [x] `/admin/stock/importar`: "Agregar cartas" as the default flow — upload → preview table (card, set, variant, qty, current stock → new stock; unmatched rows listed with reason) → Confirm.
- [x] Import history with per-import detail and **Deshacer** (reverses the import's movements; refuses lines that would go below reserved, reports them).
- [x] "Reemplazar todo el stock" in a separate danger section → preview → dedicated confirmation screen (D4) with impact numbers, snapshot download, typed phrase, checkbox; server validation.
- [x] CLI `scripts/import-delver.ts` updated to the same library (replace needs `--i-understand` flag).

### P4 — In-store sale ("Venta en tienda")
- [x] `src/lib/in-store.ts`: parse (reuse `parseDelverCsv`), match (D6), suggestions, availability incl. reservations (D7). Unit/integration tests incl. the Serra Angel case.
- [x] `/admin/venta`: upload → review table: ✔ matched lines (variant picker if several conditions/langs), ⚠ partially available, ✖ unmatched with suggestion radios / manual search (reuse printings search) / skip; editable unit price, customer name, note; live total.
- [x] Confirm server action: locks rows, re-validates, creates `in_store` completed order, decrements stock via ledger. Idempotency guard against double submit.
- [x] Receipt/detail page works for in-store orders (no email); orders list gets a channel filter + badge; dashboard shows today's in-store sales.

- [x] Extra: "Anular venta" on any completed order returns copies to stock (reason `order_void`, migration 0007).
- [x] Extra: lines without a reference price start empty and block confirmation (no accidental US$ 0 sales).
### P5 — Backups & export
- [x] docker-compose: mount `./backups:/backups:ro` into `app`; `BACKUP_DIR` env.
- [x] `/admin/respaldos`: list dumps (date, size, daily/weekly/monthly), download (streamed, admin-only), freshness status; dashboard warning if newest > 36 h.
- [x] Off-site: `deploy/backup-offsite.sh` (rclone sync of `backups/` to the chosen bucket, run by cron after the dump) + setup docs. **Needs user decision + credentials.**
- [x] `deploy/backup-restore-test.sh`: restore newest dump into staging DB (adapts `staging-refresh-db.sh`), documented monthly check.
- [x] Runbook updated (`docs/runbook-mantenimiento.md`).

- [ ] **On hold (user):** create the B2 bucket + key, `rclone config`, install the two scripts and the cron line — steps in `docs/runbook-mantenimiento.md`. Run the restore test once after the first deploy.
### P6 — Docs, QA, release
- [x] `docs/guia-operacion.md` rewritten for the new workflows (Spanish, operator-facing); README updated.
- [x] `deploy/staging-refresh-db.sh`: skip `stock_movements` data (its rows reference the orders that aren't copied). **Re-install the script on the server** (`/usr/local/sbin/nudoescudo-staging-refresh-db.sh`).
- [x] `next build` passes; backups code no longer triggers whole-project NFT tracing (remaining warnings come from `src/lib/env.ts`, pre-existing).
- [ ] Full manual QA on staging with a real Delver file (import add, replace w/ undo, in-store sale with a wrong edition).
- [ ] PR `staging` → `master`.

## Status

| Phase | State | Notes |
|-------|-------|-------|
| P0 | done | |
| P1 | done | migration 0006; `src/lib/stock.ts`; fixtures in `src/test/fixtures.ts`. |
| P2 | done | `src/lib/stock-query.ts` (filters shared with export), `components/admin/StockRow.tsx`, `stock/actions.ts`. Old import UI moved as-is to `/admin/stock/importar` until P3. |
| P3 | done | `src/lib/stock-import.ts` (+tests); UI in `stock/importar/` + `components/admin/ImportForms.tsx`. Replace phrase: `REEMPLAZAR TODO EL STOCK` (paste blocked, value uppercased). |
| P4 | done | `src/lib/in-store.ts` (+tests incl. Serra Angel case), `components/admin/InStoreSale.tsx`, `/admin/venta`. Idempotency: in-store orders store `in_store:<requestId>` in `confirmation_token`. |
| P5 | done (code) | `src/lib/backups.ts`, `/admin/respaldos`, download route, `deploy/backup-offsite.sh` (rclone copy, provider-agnostic, recommended B2), `deploy/backup-restore-test.sh`. Pending: one-time server setup by the user. |
| P6 | in progress | Docs + build done. Remaining: merge to `staging`, QA on staging with a real Delver file, then PR to `master`. |

## Open questions for the user
- Off-site backups: **on hold by user decision (2026-09-27).** Code/scripts are ready; the Respaldos page shows "No configurada" until it is set up.

## Session log
- 2026-09-27 — Explored codebase, wrote this plan, P0 done.
- 2026-09-27 — P1 done. Notes: replace-import now clamps rows to their reserved count (was: dropped to 0, breaking `quantity >= reserved`). `completeOrder`/`cancelOrder` lock the order row; `completeOrder` is idempotent. Dev tip: `npx tsx .local/clean-tests.mts` wipes leftover test fixtures if a test run dies before teardown.
- 2026-09-27 — P2 done, verified in browser (edit/save/history/stale guard/export/redirect). Dev tip: `.local/admin-cookie.mts` mints an admin session cookie for the preview browser (set `ne_admin` via document.cookie).
- 2026-09-27 — P3 done, verified in browser (add preview→apply, replace impact→guard→apply→undo restored stock). Dev tip: the built-in browser has no file upload; inject a `File` via `DataTransfer` into the input and `requestSubmit()`.
- 2026-09-27 — P4 done, verified in browser with real catalog printings (wrong-edition suggestion, skip, price guard, confirm, void).
- 2026-09-27 — P5 done (code). Checked prodrigestivill image: default POSTGRES_EXTRA_OPTS is now `-Z1` (whole DB) — pinned it explicitly since old versions defaulted to `--schema=public`, which isn't restorable.
- 2026-09-27 — P6: docs, staging-refresh fix, build clean. Branch ready to merge into `staging` (awaiting user go-ahead to push, since that deploys).
- 2026-09-27 — User: B2 on hold; in-store sales now record an optional phone; web checkout requires the customer name (form + API).
