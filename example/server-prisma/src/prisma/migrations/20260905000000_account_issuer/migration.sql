BEGIN;

-- Support databases created before or after issuer was added to the initial migration.
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "issuer" TEXT;

-- These examples use email/password accounts, whose identity is the linked user ID.
UPDATE "account"
SET "issuer" = 'local:credential', "accountId" = "userId"
WHERE "providerId" = 'credential' AND "issuer" IS NULL;

ALTER TABLE "account" ALTER COLUMN "issuer" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "account_issuer_accountId_key" ON "account"("issuer", "accountId");
DROP INDEX IF EXISTS "account_providerId_accountId_key";

COMMIT;
