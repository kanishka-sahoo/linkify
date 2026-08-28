CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"action" text NOT NULL,
	"actor_user_id" text,
	"target_type" text,
	"target_id" text,
	"ip" text,
	"user_agent" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "auth_rate_limit_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "scopes" text[] DEFAULT array['links:read', 'links:write', 'stats:read']::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "must_change_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "bootstrap_owner" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$
DECLARE
	owner_id text;
BEGIN
	SELECT "id" INTO owner_id
	FROM "user"
	WHERE "role" = 'admin'
	ORDER BY "created_at", "id"
	LIMIT 1;

	IF owner_id IS NULL AND EXISTS (SELECT 1 FROM "user") THEN
		RAISE EXCEPTION 'Cannot migrate an existing installation without an administrator';
	END IF;

	IF owner_id IS NULL AND (EXISTS (SELECT 1 FROM "links") OR EXISTS (SELECT 1 FROM "api_keys")) THEN
		RAISE EXCEPTION 'Cannot assign legacy links/API keys because no administrator exists';
	END IF;

	IF owner_id IS NOT NULL THEN
		UPDATE "links" SET "user_id" = owner_id WHERE "user_id" IS NULL;
		UPDATE "api_keys" SET "user_id" = owner_id WHERE "user_id" IS NULL;
		UPDATE "user" SET "bootstrap_owner" = true WHERE "id" = owner_id;
	END IF;
END $$;--> statement-breakpoint
UPDATE "api_keys" SET "expires_at" = now() + interval '30 days' WHERE "expires_at" IS NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "expires_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "links" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_single_bootstrap_owner_idx" ON "user" USING btree ("bootstrap_owner") WHERE "user"."bootstrap_owner" = true;
