CREATE TYPE "public"."order_channel" AS ENUM('web', 'in_store');--> statement-breakpoint
CREATE TYPE "public"."stock_import_kind" AS ENUM('add', 'replace');--> statement-breakpoint
CREATE TYPE "public"."stock_import_status" AS ENUM('previewed', 'applied', 'undone', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."stock_movement_reason" AS ENUM('import_add', 'import_replace', 'import_undo', 'manual_add', 'manual_adjust', 'web_order', 'in_store_sale');--> statement-breakpoint
CREATE TABLE "stock_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "stock_import_kind" NOT NULL,
	"status" "stock_import_status" DEFAULT 'previewed' NOT NULL,
	"filename" text,
	"rows" jsonb NOT NULL,
	"summary" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_at" timestamp with time zone,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stock_id" uuid,
	"printing_id" uuid NOT NULL,
	"finish" text NOT NULL,
	"condition" text NOT NULL,
	"language" text NOT NULL,
	"delta" integer NOT NULL,
	"quantity_after" integer NOT NULL,
	"reason" "stock_movement_reason" NOT NULL,
	"import_id" uuid,
	"order_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "confirmation_token" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "channel" "order_channel" DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_stock_id_stock_id_fk" FOREIGN KEY ("stock_id") REFERENCES "public"."stock"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_printing_id_printings_id_fk" FOREIGN KEY ("printing_id") REFERENCES "public"."printings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_import_id_stock_imports_id_fk" FOREIGN KEY ("import_id") REFERENCES "public"."stock_imports"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_imports_created_idx" ON "stock_imports" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_stock_idx" ON "stock_movements" USING btree ("stock_id","created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_created_idx" ON "stock_movements" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "stock_movements_import_idx" ON "stock_movements" USING btree ("import_id");--> statement-breakpoint
CREATE INDEX "stock_movements_order_idx" ON "stock_movements" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_channel_idx" ON "orders" USING btree ("channel","created_at");