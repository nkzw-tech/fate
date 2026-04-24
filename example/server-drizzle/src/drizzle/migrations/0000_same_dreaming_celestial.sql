CREATE TYPE "public"."EventType" AS ENUM('WORKSHOP', 'MEETUP', 'AMA', 'LAUNCH', 'COMMUNITY_CALL');--> statement-breakpoint
CREATE TYPE "public"."RSVPStatus" AS ENUM('INVITED', 'GOING', 'INTERESTED', 'DECLINED');--> statement-breakpoint
CREATE TABLE "account" (
	"accessToken" text,
	"accessTokenExpiresAt" timestamp,
	"accountId" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"idToken" text,
	"password" text,
	"providerId" text NOT NULL,
	"refreshToken" text,
	"refreshTokenExpiresAt" timestamp,
	"scope" text,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"userId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Category" (
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"description" text,
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Comment" (
	"authorId" text,
	"content" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"postId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Event" (
	"capacity" integer NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"description" text NOT NULL,
	"endAt" timestamp NOT NULL,
	"hostId" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"livestreamUrl" text,
	"location" text NOT NULL,
	"name" text NOT NULL,
	"startAt" timestamp NOT NULL,
	"topics" text[] DEFAULT ARRAY[]::TEXT[] NOT NULL,
	"type" "EventType" DEFAULT 'MEETUP' NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "EventAttendee" (
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"eventId" text NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"notes" text,
	"status" "RSVPStatus" DEFAULT 'INVITED' NOT NULL,
	"userId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Post" (
	"authorId" text NOT NULL,
	"categoryId" text,
	"content" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"likes" integer DEFAULT 0 NOT NULL,
	"title" text NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "_PostTags" (
	"A" text NOT NULL,
	"B" text NOT NULL,
	CONSTRAINT "_PostTags_AB_pkey" PRIMARY KEY("A","B")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"ipAddress" text,
	"token" text NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"userAgent" text,
	"userId" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Tag" (
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"description" text,
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"banExpires" timestamp,
	"banned" boolean,
	"banReason" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"displayUsername" text,
	"email" text NOT NULL,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"id" text PRIMARY KEY NOT NULL,
	"image" text,
	"name" text NOT NULL,
	"password" text,
	"role" text DEFAULT 'user' NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	"username" text
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_authorId_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_postId_Post_id_fk" FOREIGN KEY ("postId") REFERENCES "public"."Post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Event" ADD CONSTRAINT "Event_hostId_user_id_fk" FOREIGN KEY ("hostId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_eventId_Event_id_fk" FOREIGN KEY ("eventId") REFERENCES "public"."Event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "EventAttendee" ADD CONSTRAINT "EventAttendee_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Post" ADD CONSTRAINT "Post_authorId_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Post" ADD CONSTRAINT "Post_categoryId_Category_id_fk" FOREIGN KEY ("categoryId") REFERENCES "public"."Category"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "_PostTags" ADD CONSTRAINT "_PostTags_A_Post_id_fk" FOREIGN KEY ("A") REFERENCES "public"."Post"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "_PostTags" ADD CONSTRAINT "_PostTags_B_Tag_id_fk" FOREIGN KEY ("B") REFERENCES "public"."Tag"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_providerId_accountId_key" ON "account" USING btree ("providerId","accountId");--> statement-breakpoint
CREATE UNIQUE INDEX "Category_name_key" ON "Category" USING btree ("name");--> statement-breakpoint
CREATE INDEX "Comment_authorId_idx" ON "Comment" USING btree ("authorId");--> statement-breakpoint
CREATE INDEX "Comment_postId_idx" ON "Comment" USING btree ("postId");--> statement-breakpoint
CREATE INDEX "Event_hostId_idx" ON "Event" USING btree ("hostId");--> statement-breakpoint
CREATE UNIQUE INDEX "EventAttendee_eventId_userId_key" ON "EventAttendee" USING btree ("eventId","userId");--> statement-breakpoint
CREATE INDEX "EventAttendee_userId_idx" ON "EventAttendee" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "Post_authorId_idx" ON "Post" USING btree ("authorId");--> statement-breakpoint
CREATE INDEX "_PostTags_B_index" ON "_PostTags" USING btree ("B");--> statement-breakpoint
CREATE UNIQUE INDEX "session_token_key" ON "session" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_key" ON "user" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "user_username_key" ON "user" USING btree ("username");--> statement-breakpoint
CREATE INDEX "user_id_idx" ON "user" USING btree ("id");