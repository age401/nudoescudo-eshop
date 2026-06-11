import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Catalog (multi-TCG ready)
// ---------------------------------------------------------------------------

/** Supported games. Seeded with 'mtg' and 'pokemon'. */
export const games = pgTable("games", {
  id: text("id").primaryKey(), // 'mtg' | 'pokemon'
  name: text("name").notNull(), // 'Magic: The Gathering'
  enabled: boolean("enabled").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
});

/**
 * Canonical card per game (one row per card name / oracle identity).
 * Printings hang off this.
 */
export const cards = pgTable(
  "cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameId: text("game_id")
      .notNull()
      .references(() => games.id),
    /** Grouping id from the source: Scryfall oracle_id for MTG. */
    externalGroupId: text("external_group_id").notNull(),
    name: text("name").notNull(),
    /** Lowercased, accent-stripped name used for search. */
    normalizedName: text("normalized_name").notNull(),
    /** URL slug, unique within a game. */
    slug: text("slug").notNull(),
  },
  (t) => [
    uniqueIndex("cards_game_external_group_idx").on(t.gameId, t.externalGroupId),
    uniqueIndex("cards_game_slug_idx").on(t.gameId, t.slug),
    // Prefix search (autocomplete). A trigram GIN index is added in a custom
    // migration since drizzle-kit cannot express operator classes.
    index("cards_normalized_name_idx").on(t.normalizedName),
  ],
);

/** One row per printing/edition of a card. */
export const printings = pgTable(
  "printings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cardId: uuid("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    /** Source-specific printing id: Scryfall card id for MTG, TCGdex id for Pokemon. */
    externalId: text("external_id").notNull().unique(),
    setCode: text("set_code").notNull(),
    setName: text("set_name").notNull(),
    collectorNumber: text("collector_number").notNull(),
    rarity: text("rarity"),
    /** Language of the printing itself (Scryfall default_cards is 'en'). */
    lang: text("lang").notNull().default("en"),
    /** e.g. { small, normal, large, back? } absolute URLs (hotlinked CDN). */
    imageUris: jsonb("image_uris").$type<Record<string, string>>(),
    /** Subset of ['nonfoil','foil','etched'] this printing exists in. */
    finishes: jsonb("finishes").$type<string[]>().notNull().default([]),
    releasedAt: date("released_at"),
  },
  (t) => [index("printings_card_idx").on(t.cardId)],
);

export const priceSourceEnum = pgEnum("price_source", [
  "cardkingdom",
  "tcgplayer",
]);

/** Latest reference retail price per printing+finish, in USD. */
export const prices = pgTable(
  "prices",
  {
    printingId: uuid("printing_id")
      .notNull()
      .references(() => printings.id, { onDelete: "cascade" }),
    finish: text("finish").notNull(), // 'nonfoil' | 'foil' | 'etched'
    source: priceSourceEnum("source").notNull(),
    priceUsd: numeric("price_usd", { precision: 10, scale: 2 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.printingId, t.finish] })],
);

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

/**
 * Physical stock rows. Delver Lens exports condition + language per copy, so
 * stock is keyed by (printing, finish, condition, language).
 * Available to sell = quantity - reserved.
 */
export const stock = pgTable(
  "stock",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    printingId: uuid("printing_id")
      .notNull()
      .references(() => printings.id),
    finish: text("finish").notNull(), // 'nonfoil' | 'foil' | 'etched'
    condition: text("condition").notNull().default("NM"), // NM/LP/MP/HP/DMG
    language: text("language").notNull().default("en"),
    quantity: integer("quantity").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    /** Manual price override in USD; null = use reference price × multiplier. */
    priceOverrideUsd: numeric("price_override_usd", { precision: 10, scale: 2 }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("stock_unique_idx").on(
      t.printingId,
      t.finish,
      t.condition,
      t.language,
    ),
    index("stock_printing_idx").on(t.printingId),
  ],
);

// ---------------------------------------------------------------------------
// Orders (purchase orders, no online payment)
// ---------------------------------------------------------------------------

export const orderStatusEnum = pgEnum("order_status", [
  "pending_confirmation", // submitted, waiting for email link click
  "confirmed", // customer confirmed; stock reserved; awaiting fulfillment
  "completed", // handed over / picked up; stock decremented permanently
  "cancelled", // cancelled by admin (or customer request); reservation released
  "expired", // confirmation link never clicked; reservation released
]);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Short human-friendly code shown to customer and admin, e.g. "NE-A7K3F2". */
    publicCode: text("public_code").notNull().unique(),
    email: text("email").notNull(),
    customerName: text("customer_name"),
    phone: text("phone"),
    status: orderStatusEnum("status").notNull().default("pending_confirmation"),
    /** Random token for the email confirmation link. */
    confirmationToken: text("confirmation_token").notNull().unique(),
    /** Snapshots taken at submission time. */
    fxRateUyuPerUsd: numeric("fx_rate_uyu_per_usd", { precision: 10, scale: 4 }),
    priceMultiplier: numeric("price_multiplier", { precision: 6, scale: 3 }).notNull(),
    totalUsd: numeric("total_usd", { precision: 10, scale: 2 }).notNull(),
    totalUyu: numeric("total_uyu", { precision: 12, scale: 2 }),
    adminNote: text("admin_note"),
    /** Set true once the admin has seen the order in the panel. */
    seenByAdmin: boolean("seen_by_admin").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** pending_confirmation orders expire (and release stock) after this. */
    reservationExpiresAt: timestamp("reservation_expires_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }), // completed/cancelled/expired
  },
  (t) => [
    index("orders_status_idx").on(t.status),
    index("orders_created_idx").on(t.createdAt),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    stockId: uuid("stock_id")
      .notNull()
      .references(() => stock.id),
    quantity: integer("quantity").notNull(),
    unitPriceUsd: numeric("unit_price_usd", { precision: 10, scale: 2 }).notNull(),
    // Display snapshot (survives catalog changes):
    cardName: text("card_name").notNull(),
    setName: text("set_name").notNull(),
    collectorNumber: text("collector_number"),
    finish: text("finish").notNull(),
    condition: text("condition").notNull(),
    language: text("language").notNull(),
    imageUrl: text("image_url"),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
);

// ---------------------------------------------------------------------------
// Settings & ops
// ---------------------------------------------------------------------------

/** Key-value settings editable from the admin panel. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const syncRunStatusEnum = pgEnum("sync_run_status", [
  "running",
  "success",
  "error",
]);

/** Log of background job executions, surfaced in the admin dashboard. */
export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job: text("job").notNull(), // 'scryfall_catalog' | 'mtgjson_prices' | 'fx_rate' | 'order_expiry' | ...
    status: syncRunStatusEnum("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    message: text("message"),
    stats: jsonb("stats").$type<Record<string, unknown>>(),
  },
  (t) => [index("sync_runs_job_idx").on(t.job, t.startedAt)],
);
