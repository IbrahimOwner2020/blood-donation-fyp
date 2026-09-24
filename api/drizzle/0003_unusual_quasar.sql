CREATE TABLE `inventory_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`kind` enum('LOW_STOCK','EXPIRING_UNIT') NOT NULL,
	`blood_group_id` int NOT NULL,
	`facility_id` int,
	`inventory_unit_id` int,
	`current_units` int,
	`threshold_units` int,
	`expiry_date` date,
	`condition_key` varchar(255) NOT NULL,
	`severity` enum('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL,
	`status` enum('OPEN','ACKNOWLEDGED','RESOLVED','DISMISSED') NOT NULL DEFAULT 'OPEN',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	`resolved_at` timestamp,
	CONSTRAINT `inventory_alerts_id` PRIMARY KEY(`id`),
	CONSTRAINT `inventory_alerts_condition_key_uidx` UNIQUE(`condition_key`)
);
--> statement-breakpoint
ALTER TABLE `inventory_alerts` ADD CONSTRAINT `inventory_alerts_blood_group_id_blood_groups_id_fk` FOREIGN KEY (`blood_group_id`) REFERENCES `blood_groups`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `inventory_alerts` ADD CONSTRAINT `inventory_alerts_facility_id_healthcare_facilities_id_fk` FOREIGN KEY (`facility_id`) REFERENCES `healthcare_facilities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `inventory_alerts_status_severity_idx` ON `inventory_alerts` (`status`,`severity`);--> statement-breakpoint
CREATE INDEX `inventory_alerts_facility_kind_idx` ON `inventory_alerts` (`facility_id`,`kind`);