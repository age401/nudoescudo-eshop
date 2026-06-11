-- Autocomplete search support: trigram similarity + fast prefix matching on
-- normalized card names. drizzle-kit can't express operator classes, so these
-- live in a custom migration.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cards_normalized_name_trgm_idx" ON "cards" USING gin ("normalized_name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cards_normalized_name_prefix_idx" ON "cards" ("normalized_name" text_pattern_ops);
