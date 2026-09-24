ALTER TABLE `donors` ADD `date_of_birth` date;--> statement-breakpoint
ALTER TABLE `donors` ADD `sex` enum('MALE','FEMALE');--> statement-breakpoint
ALTER TABLE `donors` ADD `address` text;--> statement-breakpoint
ALTER TABLE `donors` ADD `weight_kg` decimal(5,2);--> statement-breakpoint
ALTER TABLE `donors` ADD `sms_consent` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `donors` ADD `email_consent` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `donations` ADD `category` enum('VOLUNTARY','FAMILY_REPLACEMENT') DEFAULT 'VOLUNTARY' NOT NULL;--> statement-breakpoint
ALTER TABLE `donations` ADD `weight_kg_at_donation` decimal(5,2);--> statement-breakpoint
ALTER TABLE `notifications` ADD `deduplication_key` varchar(255);--> statement-breakpoint
ALTER TABLE `notifications` ADD `delivery_error` varchar(500);--> statement-breakpoint
ALTER TABLE `notifications` ADD CONSTRAINT `notifications_deduplication_key_uidx` UNIQUE(`deduplication_key`);
--> statement-breakpoint
INSERT INTO `roles` (`name`, `description`) VALUES
  ('Administrator', 'Manages users, fixed roles, facilities, operational records, reports, notifications, audit logs, and configuration.'),
  ('Blood Bank Staff', 'Manages donors, donations, inventory, blood requests, stock alerts, notifications, and reports.'),
  ('Hospital Staff', 'Own-facility inventory, blood requests, unit issuing, and operational reports.'),
  ('Registered Donor', 'Own donor profile and donation history only.')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);
--> statement-breakpoint
INSERT IGNORE INTO `user_roles` (`user_id`, `role_id`)
SELECT DISTINCT ur.`user_id`, target.`id`
FROM `user_roles` ur
JOIN `roles` source ON source.`id` = ur.`role_id` AND source.`name` = 'System Administrator'
JOIN `roles` target ON target.`name` = 'Administrator';
--> statement-breakpoint
INSERT IGNORE INTO `user_roles` (`user_id`, `role_id`)
SELECT DISTINCT ur.`user_id`, target.`id`
FROM `user_roles` ur
JOIN `roles` source ON source.`id` = ur.`role_id` AND source.`name` IN ('Doctor', 'Hospital Staff')
JOIN `roles` target ON target.`name` = 'Hospital Staff'
WHERE NOT EXISTS (
  SELECT 1 FROM `user_roles` current_roles
  JOIN `roles` current_role ON current_role.`id` = current_roles.`role_id`
  WHERE current_roles.`user_id` = ur.`user_id` AND current_role.`name` IN ('System Administrator', 'Administrator')
);
--> statement-breakpoint
INSERT IGNORE INTO `user_roles` (`user_id`, `role_id`)
SELECT DISTINCT ur.`user_id`, target.`id`
FROM `user_roles` ur
JOIN `roles` source ON source.`id` = ur.`role_id` AND source.`name` IN ('Facility Manager', 'Donor Manager', 'Blood Collector', 'Blood Bank Manager', 'NBTS Blood Bank Officer', 'Authorized Manager')
JOIN `roles` target ON target.`name` = 'Blood Bank Staff'
WHERE NOT EXISTS (
  SELECT 1 FROM `user_roles` current_roles
  JOIN `roles` current_role ON current_role.`id` = current_roles.`role_id`
  WHERE current_roles.`user_id` = ur.`user_id` AND current_role.`name` IN ('System Administrator', 'Administrator', 'Doctor', 'Hospital Staff')
);
--> statement-breakpoint
INSERT IGNORE INTO `user_roles` (`user_id`, `role_id`)
SELECT DISTINCT d.`user_id`, target.`id`
FROM `donors` d
JOIN `roles` target ON target.`name` = 'Registered Donor'
WHERE d.`user_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `user_roles` current_roles
  JOIN `roles` current_role ON current_role.`id` = current_roles.`role_id`
  WHERE current_roles.`user_id` = d.`user_id` AND current_role.`name` IN ('System Administrator', 'Administrator', 'Doctor', 'Hospital Staff', 'Facility Manager', 'Donor Manager', 'Blood Collector', 'Blood Bank Manager', 'NBTS Blood Bank Officer', 'Authorized Manager', 'Blood Bank Staff')
);
--> statement-breakpoint
DELETE ur FROM `user_roles` ur JOIN `roles` r ON r.`id` = ur.`role_id`
WHERE r.`name` NOT IN ('Administrator', 'Blood Bank Staff', 'Hospital Staff', 'Registered Donor');
--> statement-breakpoint
DELETE rp FROM `role_permissions` rp JOIN `roles` r ON r.`id` = rp.`role_id`;
--> statement-breakpoint
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r CROSS JOIN `permissions` p
WHERE r.`name` = 'Administrator' AND p.`code` NOT IN ('predictions:read', 'predictions:run');
--> statement-breakpoint
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r JOIN `permissions` p ON p.`code` IN ('facilities:read','donors:read','donors:create','donors:update','donations:read','donations:create','inventory:read','inventory:update','requests:read','requests:create','requests:update','alerts:read','alerts:update','notifications:read','notifications:send','reports:read')
WHERE r.`name` = 'Blood Bank Staff';
--> statement-breakpoint
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.`id`, p.`id` FROM `roles` r JOIN `permissions` p ON p.`code` IN ('facilities:read','inventory:read','inventory:update','requests:read','requests:create','requests:update','reports:read')
WHERE r.`name` = 'Hospital Staff';
--> statement-breakpoint
DELETE FROM `roles` WHERE `name` NOT IN ('Administrator', 'Blood Bank Staff', 'Hospital Staff', 'Registered Donor');
--> statement-breakpoint
DELETE FROM `permissions` WHERE `code` IN ('predictions:read', 'predictions:run');
