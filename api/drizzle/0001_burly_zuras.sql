CREATE TABLE `ai_analysis_runs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`trigger_type` enum('USER','SCHEDULED') NOT NULL,
	`triggered_by_user_id` int,
	`status` enum('RUNNING','COMPLETED','PARTIAL','FAILED') NOT NULL DEFAULT 'RUNNING',
	`horizon_days` int NOT NULL DEFAULT 60,
	`risk_level` enum('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL DEFAULT 'LOW',
	`notification_mode` enum('REQUIRE_APPROVAL','AUTO_SEND','REPORT_ONLY') NOT NULL DEFAULT 'REQUIRE_APPROVAL',
	`conclusion` text NOT NULL,
	`prediction_ids_json` json,
	`alert_ids_json` json,
	`recommendations_json` json,
	`failure_details` text,
	`started_at` timestamp NOT NULL DEFAULT (now()),
	`completed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_analysis_runs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_analysis_settings` (
	`id` int NOT NULL,
	`notification_mode` enum('REQUIRE_APPROVAL','AUTO_SEND','REPORT_ONLY') NOT NULL DEFAULT 'REQUIRE_APPROVAL',
	`updated_by_user_id` int,
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_analysis_settings_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `facility_id` int;--> statement-breakpoint
ALTER TABLE `donors` ADD `user_id` int;--> statement-breakpoint
ALTER TABLE `donors` ADD CONSTRAINT `donors_user_id_uidx` UNIQUE(`user_id`);--> statement-breakpoint
ALTER TABLE `ai_analysis_runs` ADD CONSTRAINT `ai_analysis_runs_triggered_by_user_id_users_id_fk` FOREIGN KEY (`triggered_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_analysis_settings` ADD CONSTRAINT `ai_analysis_settings_updated_by_user_id_users_id_fk` FOREIGN KEY (`updated_by_user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `ai_analysis_runs_status_created_idx` ON `ai_analysis_runs` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `ai_analysis_runs_trigger_idx` ON `ai_analysis_runs` (`trigger_type`);--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_facility_id_healthcare_facilities_id_fk` FOREIGN KEY (`facility_id`) REFERENCES `healthcare_facilities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `donors` ADD CONSTRAINT `donors_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;