ALTER TABLE "clicks" ADD COLUMN "outcome" text DEFAULT 'redirected' NOT NULL;--> statement-breakpoint
-- Every click recorded so far redirected; give rolled-up days their outcome rows.
INSERT INTO "click_daily" ("link_id", "day", "dimension", "value", "count")
SELECT "link_id", "day", 'outcome', 'redirected', sum("count")::int
FROM "click_daily" WHERE "dimension" = 'bot'
GROUP BY 1, 2;
--> statement-breakpoint
-- Without statistics on the new column, stats queries plan badly (~30% slower) until autovacuum runs.
ANALYZE "clicks";
