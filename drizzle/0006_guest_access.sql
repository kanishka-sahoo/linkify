CREATE TABLE "guest_access" (
	"guest_id" text NOT NULL,
	"owner_id" text NOT NULL,
	CONSTRAINT "guest_access_guest_id_owner_id_pk" PRIMARY KEY("guest_id","owner_id")
);
--> statement-breakpoint
ALTER TABLE "guest_access" ADD CONSTRAINT "guest_access_guest_id_user_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guest_access" ADD CONSTRAINT "guest_access_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;