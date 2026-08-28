ALTER TABLE "clicks" ADD COLUMN "visitor_hash" text;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "starts_at" timestamp;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "expired_redirect_url" text;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "max_clicks" integer;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "privacy_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "clicks_link_visitor_idx" ON "clicks" USING btree ("link_id","visitor_hash");