CREATE TYPE "public"."order_status" AS ENUM('pending_confirmation', 'confirmed', 'completed', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."price_source" AS ENUM('cardkingdom', 'tcgplayer');--> statement-breakpoint
CREATE TYPE "public"."sync_run_status" AS ENUM('running', 'success', 'error');--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" text NOT NULL,
	"external_group_id" text NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"slug" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"stock_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price_usd" numeric(10, 2) NOT NULL,
	"card_name" text NOT NULL,
	"set_name" text NOT NULL,
	"collector_number" text,
	"finish" text NOT NULL,
	"condition" text NOT NULL,
	"language" text NOT NULL,
	"image_url" text
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_code" text NOT NULL,
	"email" text NOT NULL,
	"customer_name" text,
	"phone" text,
	"status" "order_status" DEFAULT 'pending_confirmation' NOT NULL,
	"confirmation_token" text NOT NULL,
	"fx_rate_uyu_per_usd" numeric(10, 4),
	"price_multiplier" numeric(6, 3) NOT NULL,
	"total_usd" numeric(10, 2) NOT NULL,
	"total_uyu" numeric(12, 2),
	"admin_note" text,
	"seen_by_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reservation_expires_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	CONSTRAINT "orders_public_code_unique" UNIQUE("public_code"),
	CONSTRAINT "orders_confirmation_token_unique" UNIQUE("confirmation_token")
);
--> statement-breakpoint
CREATE TABLE "prices" (
	"printing_id" uuid NOT NULL,
	"finish" text NOT NULL,
	"source" "price_source" NOT NULL,
	"price_usd" numeric(10, 2) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prices_printing_id_finish_pk" PRIMARY KEY("printing_id","finish")
);
--> statement-breakpoint
CREATE TABLE "printings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"card_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"set_code" text NOT NULL,
	"set_name" text NOT NULL,
	"collector_number" text NOT NULL,
	"rarity" text,
	"lang" text DEFAULT 'en' NOT NULL,
	"image_uris" jsonb,
	"finishes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"released_at" date,
	CONSTRAINT "printings_external_id_unique" UNIQUE("external_id")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"printing_id" uuid NOT NULL,
	"finish" text NOT NULL,
	"condition" text DEFAULT 'NM' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"price_override_usd" numeric(10, 2),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"status" "sync_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"message" text,
	"stats" jsonb
);
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_stock_id_stock_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."stock"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prices" ADD CONSTRAINT "prices_printing_id_printings_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "printings" ADD CONSTRAINT "printings_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock" ADD CONSTRAINT "stock_printing_id_printings_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cards_game_external_group_idx" ON "cards" USING btree ("game_id","external_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cards_game_slug_idx" ON "cards" USING btree ("game_id","slug");--> statement-breakpoint
CREATE INDEX "cards_normalized_name_idx" ON "cards" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_created_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "printings_card_idx" ON "printings" USING btree ("card_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_unique_idx" ON "stock" USING btree ("printing_id","finish","condition","language");--> statement-breakpoint
CREATE INDEX "stock_printing_idx" ON "stock" USING btree ("printing_id");--> statement-breakpoint
CREATE INDEX "sync_runs_job_idx" ON "sync_runs" USING btree ("job","started_at");