CREATE TABLE "click_daily" (
	"link_id" text NOT NULL,
	"day" date NOT NULL,
	"dimension" text NOT NULL,
	"value" text NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "click_daily_link_id_day_dimension_value_pk" PRIMARY KEY("link_id","day","dimension","value")
);
--> statement-breakpoint
ALTER TABLE "click_daily" ADD CONSTRAINT "click_daily_link_id_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "click_daily_day_idx" ON "click_daily" USING btree ("day");--> statement-breakpoint
-- Backfill every finished UTC day so the first cron run only rolls up one day.
-- Mirrors dailyRows() in src/lib/stats.ts.
INSERT INTO "click_daily" ("link_id", "day", "dimension", "value", "count")
SELECT link_id, day,
  CASE
    WHEN grouping(country) = 0 THEN 'country' WHEN grouping(referrer) = 0 THEN 'referrer'
    WHEN grouping(browser) = 0 THEN 'browser' WHEN grouping(os) = 0 THEN 'os'
    WHEN grouping(device_type) = 0 THEN 'device' ELSE 'bot'
  END,
  coalesce(country, referrer, browser, os, device_type, is_bot::text, ''),
  count(*)::int
FROM (
  SELECT link_id, "timestamp"::date AS day, country, referrer, browser, os, device_type, is_bot
  FROM "clicks" WHERE "timestamp" < (now() AT TIME ZONE 'utc')::date
) c
GROUP BY GROUPING SETS (
  (link_id, day, country), (link_id, day, referrer), (link_id, day, browser),
  (link_id, day, os), (link_id, day, device_type), (link_id, day, is_bot)
)
UNION ALL
SELECT link_id, day, 'unique', '', (count(*) FILTER (WHERE human))::int
FROM (
  SELECT link_id, "timestamp"::date AS day, visitor_hash, bool_or(NOT is_bot) AS human
  FROM "clicks" WHERE "timestamp" < (now() AT TIME ZONE 'utc')::date AND visitor_hash IS NOT NULL
  GROUP BY 1, 2, 3
) v
GROUP BY 1, 2;
