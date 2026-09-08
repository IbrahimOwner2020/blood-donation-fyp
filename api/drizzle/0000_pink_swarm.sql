CREATE TABLE `sessions` (
	`id` varchar(64) NOT NULL,
	`user_id` int NOT NULL,
	`expires_at` timestamp NOT NULL,
	`ip_address` varchar(45),
	`user_agent` varchar(512),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`email` varchar(255) NOT NULL,
	`password_hash` varchar(255) NOT NULL,
	`status` enum('ACTIVE','INACTIVE') NOT NULL DEFAULT 'ACTIVE',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `users_id` PRIMARY KEY(`id`),
	CONSTRAINT `users_email_unique` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`code` varchar(100) NOT NULL,
	`description` text,
	CONSTRAINT `permissions_id` PRIMARY KEY(`id`),
	CONSTRAINT `permissions_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`role_id` int NOT NULL,
	`permission_id` int NOT NULL,
	CONSTRAINT `role_permissions_role_id_permission_id_pk` PRIMARY KEY(`role_id`,`permission_id`)
);
--> statement-breakpoint
CREATE TABLE `roles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(100) NOT NULL,
	`description` text,
	CONSTRAINT `roles_id` PRIMARY KEY(`id`),
	CONSTRAINT `roles_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `user_roles` (
	`user_id` int NOT NULL,
	`role_id` int NOT NULL,
	CONSTRAINT `user_roles_user_id_role_id_pk` PRIMARY KEY(`user_id`,`role_id`)
);
--> statement-breakpoint
CREATE TABLE `blood_groups` (
	`id` int AUTO_INCREMENT NOT NULL,
	`abo` varchar(2) NOT NULL,
	`rh` varchar(1) NOT NULL,
	`code` varchar(3) NOT NULL,
	CONSTRAINT `blood_groups_id` PRIMARY KEY(`id`),
	CONSTRAINT `blood_groups_code_unique` UNIQUE(`code`)
);
--> statement-breakpoint
CREATE TABLE `donors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`donor_number` varchar(64) NOT NULL,
	`first_name` varchar(120) NOT NULL,
	`last_name` varchar(120) NOT NULL,
	`phone` varchar(32),
	`email` varchar(255),
	`blood_group_id` int NOT NULL,
	`eligibility_status` enum('POTENTIALLY_ELIGIBLE','TEMPORARILY_INELIGIBLE','INELIGIBLE','UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
	`active` boolean NOT NULL DEFAULT true,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `donors_id` PRIMARY KEY(`id`),
	CONSTRAINT `donors_donor_number_uidx` UNIQUE(`donor_number`),
	CONSTRAINT `donors_phone_uidx` UNIQUE(`phone`),
	CONSTRAINT `donors_email_uidx` UNIQUE(`email`)
);
--> statement-breakpoint
CREATE TABLE `donation_centres` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`region` varchar(120) NOT NULL,
	`address` text,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `donation_centres_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `donations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`donor_id` int NOT NULL,
	`donation_centre_id` int NOT NULL,
	`blood_group_id` int NOT NULL,
	`donation_date` date NOT NULL,
	`units` int NOT NULL DEFAULT 1,
	`notes` text,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `donations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `healthcare_facilities` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`region` varchar(120) NOT NULL,
	`district` varchar(120) NOT NULL,
	`active` boolean NOT NULL DEFAULT true,
	CONSTRAINT `healthcare_facilities_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `blood_inventory` (
	`id` int AUTO_INCREMENT NOT NULL,
	`donation_id` int,
	`blood_group_id` int NOT NULL,
	`collection_date` date NOT NULL,
	`expiry_date` date NOT NULL,
	`status` enum('AVAILABLE','RESERVED','ISSUED','EXPIRED','DISCARDED') NOT NULL DEFAULT 'AVAILABLE',
	`facility_id` int,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `blood_inventory_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `blood_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`facility_id` int NOT NULL,
	`blood_group_id` int NOT NULL,
	`units_requested` int NOT NULL,
	`priority` enum('LOW','MEDIUM','HIGH','URGENT') NOT NULL DEFAULT 'MEDIUM',
	`requested_at` timestamp NOT NULL DEFAULT (now()),
	`required_at` timestamp,
	`status` enum('PENDING','APPROVED','PARTIAL','FULFILLED','CANCELLED') NOT NULL DEFAULT 'PENDING',
	`fulfilled_units` int NOT NULL DEFAULT 0,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`updated_at` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `blood_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `demand_records` (
	`id` int AUTO_INCREMENT NOT NULL,
	`facility_id` int,
	`blood_group_id` int NOT NULL,
	`date` date NOT NULL,
	`units_requested` int NOT NULL DEFAULT 0,
	`units_issued` int NOT NULL DEFAULT 0,
	`units_used` int,
	`unfulfilled_units` int,
	`source` enum('BLOOD_REQUEST','MANUAL','IMPORT','SYSTEM') NOT NULL DEFAULT 'SYSTEM',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `demand_records_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ai_predictions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`blood_group_id` int NOT NULL,
	`facility_id` int,
	`forecast_start` date NOT NULL,
	`forecast_end` date NOT NULL,
	`predicted_units` decimal(12,2) NOT NULL,
	`model_name` varchar(120) NOT NULL,
	`model_version` varchar(64),
	`metrics_json` json,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `ai_predictions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shortage_alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`blood_group_id` int NOT NULL,
	`facility_id` int,
	`prediction_id` int NOT NULL,
	`available_units` decimal(12,2) NOT NULL,
	`predicted_units` decimal(12,2) NOT NULL,
	`projected_gap` decimal(12,2) NOT NULL,
	`severity` enum('LOW','MEDIUM','HIGH','CRITICAL') NOT NULL,
	`status` enum('OPEN','ACKNOWLEDGED','RESOLVED','DISMISSED') NOT NULL DEFAULT 'OPEN',
	`created_at` timestamp NOT NULL DEFAULT (now()),
	`resolved_at` timestamp,
	CONSTRAINT `shortage_alerts_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` int AUTO_INCREMENT NOT NULL,
	`donor_id` int NOT NULL,
	`alert_id` int,
	`channel` enum('SMS','EMAIL') NOT NULL,
	`recipient` varchar(255) NOT NULL,
	`message` text NOT NULL,
	`status` enum('PENDING','SENT','FAILED','CANCELLED') NOT NULL DEFAULT 'PENDING',
	`provider_message_id` varchar(255),
	`sent_at` timestamp,
	`created_by` int NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `notifications_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `activity_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`user_id` int,
	`action` varchar(120) NOT NULL,
	`entity_type` varchar(120) NOT NULL,
	`entity_id` varchar(64),
	`metadata_json` json,
	`ip_address` varchar(45),
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `activity_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `sessions` ADD CONSTRAINT `sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permission_id_permissions_id_fk` FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `user_roles` ADD CONSTRAINT `user_roles_role_id_roles_id_fk` FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `donors` ADD CONSTRAINT `donors_blood_group_id_blood_groups_id_fk` FOREIGN KEY (`blood_group_id`) REFERENCES `blood_groups`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `donations` ADD CONSTRAINT `donations_donor_id_donors_id_fk` FOREIGN KEY (`donor_id`) REFERENCES `donors`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `donations` ADD CONSTRAINT `donations_donation_centre_id_donation_centres_id_fk` FOREIGN KEY (`donation_centre_id`) REFERENCES `donation_centres`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `donations` ADD CONSTRAINT `donations_blood_group_id_blood_groups_id_fk` FOREIGN KEY (`blood_group_id`) REFERENCES `blood_groups`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `donations` ADD CONSTRAINT `donations_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blood_inventory` ADD CONSTRAINT `blood_inventory_donation_id_donations_id_fk` FOREIGN KEY (`donation_id`) REFERENCES `donations`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blood_inventory` ADD CONSTRAINT `blood_inventory_blood_group_id_blood_groups_id_fk` FOREIGN KEY (`blood_group_id`) REFERENCES `blood_groups`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blood_inventory` ADD CONSTRAINT `blood_inventory_facility_id_healthcare_facilities_id_fk` FOREIGN KEY (`facility_id`) REFERENCES `healthcare_facilities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blood_requests` ADD CONSTRAINT `blood_requests_facility_id_healthcare_facilities_id_fk` FOREIGN KEY (`facility_id`) REFERENCES `healthcare_facilities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blood_requests` ADD CONSTRAINT `blood_requests_blood_group_id_blood_groups_id_fk` FOREIGN KEY (`blood_group_id`) REFERENCES `blood_groups`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `blood_requests` ADD CONSTRAINT `blood_requests_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `demand_records` ADD CONSTRAINT `demand_records_facility_id_healthcare_facilities_id_fk` FOREIGN KEY (`facility_id`) REFERENCES `healthcare_facilities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `demand_records` ADD CONSTRAINT `demand_records_blood_group_id_blood_groups_id_fk` FOREIGN KEY (`blood_group_id`) REFERENCES `blood_groups`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_predictions` ADD CONSTRAINT `ai_predictions_blood_group_id_blood_groups_id_fk` FOREIGN KEY (`blood_group_id`) REFERENCES `blood_groups`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ai_predictions` ADD CONSTRAINT `ai_predictions_facility_id_healthcare_facilities_id_fk` FOREIGN KEY (`facility_id`) REFERENCES `healthcare_facilities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shortage_alerts` ADD CONSTRAINT `shortage_alerts_blood_group_id_blood_groups_id_fk` FOREIGN KEY (`blood_group_id`) REFERENCES `blood_groups`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shortage_alerts` ADD CONSTRAINT `shortage_alerts_facility_id_healthcare_facilities_id_fk` FOREIGN KEY (`facility_id`) REFERENCES `healthcare_facilities`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `shortage_alerts` ADD CONSTRAINT `shortage_alerts_prediction_id_ai_predictions_id_fk` FOREIGN KEY (`prediction_id`) REFERENCES `ai_predictions`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_donor_id_donors_id_fk` FOREIGN KEY (`donor_id`) REFERENCES `donors`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_alert_id_shortage_alerts_id_fk` FOREIGN KEY (`alert_id`) REFERENCES `shortage_alerts`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_created_by_users_id_fk` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `activity_logs` ADD CONSTRAINT `activity_logs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_at_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX `users_status_idx` ON `users` (`status`);--> statement-breakpoint
CREATE INDEX `role_permissions_permission_id_idx` ON `role_permissions` (`permission_id`);--> statement-breakpoint
CREATE INDEX `user_roles_role_id_idx` ON `user_roles` (`role_id`);--> statement-breakpoint
CREATE INDEX `donors_blood_group_id_idx` ON `donors` (`blood_group_id`);--> statement-breakpoint
CREATE INDEX `donors_active_idx` ON `donors` (`active`);--> statement-breakpoint
CREATE INDEX `donors_eligibility_status_idx` ON `donors` (`eligibility_status`);--> statement-breakpoint
CREATE INDEX `donation_centres_region_idx` ON `donation_centres` (`region`);--> statement-breakpoint
CREATE INDEX `donation_centres_active_idx` ON `donation_centres` (`active`);--> statement-breakpoint
CREATE INDEX `donations_donor_id_idx` ON `donations` (`donor_id`);--> statement-breakpoint
CREATE INDEX `donations_donation_date_idx` ON `donations` (`donation_date`);--> statement-breakpoint
CREATE INDEX `donations_blood_group_id_idx` ON `donations` (`blood_group_id`);--> statement-breakpoint
CREATE INDEX `donations_donation_centre_id_idx` ON `donations` (`donation_centre_id`);--> statement-breakpoint
CREATE INDEX `healthcare_facilities_region_idx` ON `healthcare_facilities` (`region`);--> statement-breakpoint
CREATE INDEX `healthcare_facilities_active_idx` ON `healthcare_facilities` (`active`);--> statement-breakpoint
CREATE INDEX `blood_inventory_group_status_idx` ON `blood_inventory` (`blood_group_id`,`status`);--> statement-breakpoint
CREATE INDEX `blood_inventory_expiry_date_idx` ON `blood_inventory` (`expiry_date`);--> statement-breakpoint
CREATE INDEX `blood_inventory_donation_id_idx` ON `blood_inventory` (`donation_id`);--> statement-breakpoint
CREATE INDEX `blood_inventory_facility_id_idx` ON `blood_inventory` (`facility_id`);--> statement-breakpoint
CREATE INDEX `blood_requests_facility_status_idx` ON `blood_requests` (`facility_id`,`status`);--> statement-breakpoint
CREATE INDEX `blood_requests_blood_group_id_idx` ON `blood_requests` (`blood_group_id`);--> statement-breakpoint
CREATE INDEX `blood_requests_required_at_idx` ON `blood_requests` (`required_at`);--> statement-breakpoint
CREATE INDEX `demand_records_date_group_idx` ON `demand_records` (`date`,`blood_group_id`);--> statement-breakpoint
CREATE INDEX `demand_records_facility_id_idx` ON `demand_records` (`facility_id`);--> statement-breakpoint
CREATE INDEX `ai_predictions_group_start_idx` ON `ai_predictions` (`blood_group_id`,`forecast_start`);--> statement-breakpoint
CREATE INDEX `ai_predictions_facility_id_idx` ON `ai_predictions` (`facility_id`);--> statement-breakpoint
CREATE INDEX `shortage_alerts_status_severity_idx` ON `shortage_alerts` (`status`,`severity`);--> statement-breakpoint
CREATE INDEX `shortage_alerts_blood_group_id_idx` ON `shortage_alerts` (`blood_group_id`);--> statement-breakpoint
CREATE INDEX `shortage_alerts_prediction_id_idx` ON `shortage_alerts` (`prediction_id`);--> statement-breakpoint
CREATE INDEX `notifications_donor_created_idx` ON `notifications` (`donor_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_alert_id_idx` ON `notifications` (`alert_id`);--> statement-breakpoint
CREATE INDEX `notifications_status_idx` ON `notifications` (`status`);--> statement-breakpoint
CREATE INDEX `activity_logs_user_created_idx` ON `activity_logs` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_logs_entity_idx` ON `activity_logs` (`entity_type`,`entity_id`);