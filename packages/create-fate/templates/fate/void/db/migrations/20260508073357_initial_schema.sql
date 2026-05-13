CREATE TABLE `account` (
	`accessToken` text,
	`accessTokenExpiresAt` integer,
	`accountId` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`idToken` text,
	`password` text,
	`providerId` text NOT NULL,
	`refreshToken` text,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	`userId` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `account_providerId_accountId_key` ON `account` (`providerId`,`accountId`);--> statement-breakpoint
CREATE TABLE `Category` (
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`description` text,
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Category_name_key` ON `Category` (`name`);--> statement-breakpoint
CREATE TABLE `Comment` (
	`authorId` text,
	`content` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`postId` text NOT NULL,
	FOREIGN KEY (`authorId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `Comment_authorId_idx` ON `Comment` (`authorId`);--> statement-breakpoint
CREATE INDEX `Comment_postId_idx` ON `Comment` (`postId`);--> statement-breakpoint
CREATE TABLE `Event` (
	`capacity` integer NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`description` text NOT NULL,
	`endAt` integer NOT NULL,
	`hostId` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`livestreamUrl` text,
	`location` text NOT NULL,
	`name` text NOT NULL,
	`startAt` integer NOT NULL,
	`topics` text DEFAULT '[]' NOT NULL,
	`type` text DEFAULT 'MEETUP' NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`hostId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `Event_hostId_idx` ON `Event` (`hostId`);--> statement-breakpoint
CREATE TABLE `EventAttendee` (
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`eventId` text NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`notes` text,
	`status` text DEFAULT 'INVITED' NOT NULL,
	`userId` text NOT NULL,
	FOREIGN KEY (`eventId`) REFERENCES `Event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `EventAttendee_eventId_userId_key` ON `EventAttendee` (`eventId`,`userId`);--> statement-breakpoint
CREATE INDEX `EventAttendee_userId_idx` ON `EventAttendee` (`userId`);--> statement-breakpoint
CREATE TABLE `Post` (
	`authorId` text NOT NULL,
	`categoryId` text,
	`content` text NOT NULL,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`likes` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`authorId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `Post_authorId_idx` ON `Post` (`authorId`);--> statement-breakpoint
CREATE TABLE `_PostTags` (
	`A` text NOT NULL,
	`B` text NOT NULL,
	PRIMARY KEY(`A`, `B`),
	FOREIGN KEY (`A`) REFERENCES `Post`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`B`) REFERENCES `Tag`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `_PostTags_B_index` ON `_PostTags` (`B`);--> statement-breakpoint
CREATE TABLE `session` (
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`expiresAt` integer NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`ipAddress` text,
	`token` text NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	`userAgent` text,
	`userId` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_key` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `Tag` (
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`description` text,
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Tag_name_key` ON `Tag` (`name`);--> statement-breakpoint
CREATE TABLE `user` (
	`banExpires` integer,
	`banned` integer,
	`banReason` text,
	`createdAt` integer DEFAULT (unixepoch()) NOT NULL,
	`displayUsername` text,
	`email` text NOT NULL,
	`emailVerified` integer DEFAULT false NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`image` text,
	`name` text NOT NULL,
	`password` text,
	`role` text DEFAULT 'user' NOT NULL,
	`updatedAt` integer DEFAULT (unixepoch()) NOT NULL,
	`username` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_key` ON `user` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_key` ON `user` (`username`);--> statement-breakpoint
CREATE INDEX `user_id_idx` ON `user` (`id`);