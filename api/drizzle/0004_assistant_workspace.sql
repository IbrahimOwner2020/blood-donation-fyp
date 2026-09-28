CREATE TABLE `assistant_conversations` (
	`id` varchar(64) NOT NULL,
	`owner_user_id` int NOT NULL,
	`title` varchar(160) NOT NULL,
	`preferred_language` enum('en','sw') NOT NULL DEFAULT 'en',
	`last_message_at` timestamp NOT NULL DEFAULT (now()),
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `assistant_conversations_id` PRIMARY KEY(`id`),
	CONSTRAINT `assistant_conversations_owner_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_conversations_owner_activity_idx` ON `assistant_conversations` (`owner_user_id`,`last_message_at`);
--> statement-breakpoint
CREATE INDEX `assistant_conversations_expires_idx` ON `assistant_conversations` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `assistant_messages` (
	`id` varchar(64) NOT NULL,
	`conversation_id` varchar(64) NOT NULL,
	`role` enum('USER','ASSISTANT') NOT NULL,
	`language` enum('en','sw') NOT NULL DEFAULT 'en',
	`blocks_json` json NOT NULL,
	`suggestions_json` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `assistant_messages_id` PRIMARY KEY(`id`),
	CONSTRAINT `assistant_messages_conversation_fk` FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversations`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_messages_conversation_created_idx` ON `assistant_messages` (`conversation_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `assistant_artifacts` (
	`id` varchar(64) NOT NULL,
	`conversation_id` varchar(64) NOT NULL,
	`message_id` varchar(64),
	`owner_user_id` int NOT NULL,
	`artifact_type` enum('REPORT') NOT NULL,
	`report_type` varchar(80) NOT NULL,
	`title` varchar(220) NOT NULL,
	`required_permission` varchar(80) NOT NULL,
	`facility_id` int,
	`filters_json` json NOT NULL,
	`snapshot_json` json NOT NULL,
	`language` enum('en','sw') NOT NULL DEFAULT 'en',
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `assistant_artifacts_id` PRIMARY KEY(`id`),
	CONSTRAINT `assistant_artifacts_conversation_fk` FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversations`(`id`) ON DELETE cascade,
	CONSTRAINT `assistant_artifacts_message_fk` FOREIGN KEY (`message_id`) REFERENCES `assistant_messages`(`id`) ON DELETE set null,
	CONSTRAINT `assistant_artifacts_owner_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE cascade,
	CONSTRAINT `assistant_artifacts_facility_fk` FOREIGN KEY (`facility_id`) REFERENCES `healthcare_facilities`(`id`)
);
--> statement-breakpoint
CREATE INDEX `assistant_artifacts_owner_created_idx` ON `assistant_artifacts` (`owner_user_id`,`created_at`);
--> statement-breakpoint
CREATE INDEX `assistant_artifacts_expires_idx` ON `assistant_artifacts` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `assistant_drafts` (
	`id` varchar(64) NOT NULL,
	`conversation_id` varchar(64) NOT NULL,
	`owner_user_id` int NOT NULL,
	`workflow` varchar(80) NOT NULL,
	`values_json` json NOT NULL,
	`missing_fields_json` json NOT NULL,
	`errors_json` json,
	`expires_at` timestamp NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `assistant_drafts_id` PRIMARY KEY(`id`),
	CONSTRAINT `assistant_drafts_conversation_fk` FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversations`(`id`) ON DELETE cascade,
	CONSTRAINT `assistant_drafts_owner_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_drafts_owner_expires_idx` ON `assistant_drafts` (`owner_user_id`,`expires_at`);
--> statement-breakpoint
CREATE TABLE `assistant_action_proposals` (
	`id` varchar(120) NOT NULL,
	`conversation_id` varchar(64),
	`owner_user_id` int NOT NULL,
	`session_id` varchar(128) NOT NULL,
	`action` varchar(80) NOT NULL,
	`title` varchar(200) NOT NULL,
	`description` text NOT NULL,
	`required_permission` varchar(80) NOT NULL,
	`payload_json` json NOT NULL,
	`effect` text NOT NULL,
	`status` enum('PENDING','CONFIRMED','CANCELLED','FAILED') NOT NULL DEFAULT 'PENDING',
	`expires_at` timestamp NOT NULL,
	`consumed_at` timestamp,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `assistant_action_proposals_id` PRIMARY KEY(`id`),
	CONSTRAINT `assistant_proposals_conversation_fk` FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversations`(`id`) ON DELETE cascade,
	CONSTRAINT `assistant_proposals_owner_fk` FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `assistant_proposals_owner_status_idx` ON `assistant_action_proposals` (`owner_user_id`,`status`);
--> statement-breakpoint
CREATE INDEX `assistant_proposals_expires_idx` ON `assistant_action_proposals` (`expires_at`);
