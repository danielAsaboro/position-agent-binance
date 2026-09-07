CREATE TABLE `connections` (
	`owner` text PRIMARY KEY NOT NULL,
	`encrypted` text NOT NULL,
	`environment` text NOT NULL,
	`updated_at` integer NOT NULL,
	`token_hash` text,
	`monitor_at` integer
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`mandate_id` text,
	`kind` text NOT NULL,
	`message` text NOT NULL,
	`details` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_owner_time` ON `events` (`owner`,`created_at`);--> statement-breakpoint
CREATE TABLE `locks` (
	`key` text PRIMARY KEY NOT NULL,
	`holder` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mandates` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`symbol` text NOT NULL,
	`body` text NOT NULL,
	`status` text NOT NULL,
	`version` integer NOT NULL,
	`last_check` integer,
	`last_error` text,
	`snapshot` text,
	`assessment` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `mandates_owner` ON `mandates` (`owner`);--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`mandate_id` text NOT NULL,
	`mandate_version` integer NOT NULL,
	`body` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`client_id` text NOT NULL,
	`receipt` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proposals_client_id_unique` ON `proposals` (`client_id`);--> statement-breakpoint
CREATE INDEX `proposals_owner` ON `proposals` (`owner`);--> statement-breakpoint
CREATE INDEX `proposals_mandate` ON `proposals` (`mandate_id`);