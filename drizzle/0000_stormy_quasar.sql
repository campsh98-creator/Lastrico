CREATE TABLE `road_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`start_lng` real NOT NULL,
	`start_lat` real NOT NULL,
	`end_lng` real NOT NULL,
	`end_lat` real NOT NULL,
	`kind` text NOT NULL,
	`severity` integer DEFAULT 2 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`nickname` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `road_reports_status_idx` ON `road_reports` (`status`);--> statement-breakpoint
CREATE INDEX `road_reports_created_at_idx` ON `road_reports` (`created_at`);