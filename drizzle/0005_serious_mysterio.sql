ALTER TABLE "driver_profiles" ADD COLUMN "azaRecipient" varchar(320);--> statement-breakpoint
CREATE INDEX "payments_reference_idx" ON "payments" USING btree ("reference");