-- void:allow-destructive
DROP INDEX `account_issuer_accountId_key`;
--> statement-breakpoint
ALTER TABLE `account` DROP COLUMN `issuer`;
