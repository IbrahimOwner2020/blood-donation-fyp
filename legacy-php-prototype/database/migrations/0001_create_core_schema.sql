CREATE TABLE roles (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(60) NOT NULL UNIQUE,
    description VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE permissions (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL UNIQUE,
    description VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE role_permissions (
    role_id BIGINT UNSIGNED NOT NULL,
    permission_id BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (role_id, permission_id),
    CONSTRAINT fk_role_permissions_role FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    CONSTRAINT fk_role_permissions_permission FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(150) NOT NULL,
    email VARCHAR(190) NULL UNIQUE,
    phone VARCHAR(30) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role_id BIGINT UNSIGNED NOT NULL,
    status ENUM('active', 'pending', 'suspended', 'inactive') NOT NULL DEFAULT 'pending',
    email_verified_at DATETIME NULL,
    phone_verified_at DATETIME NULL,
    last_login_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_users_role FOREIGN KEY (role_id) REFERENCES roles(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE locations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    region VARCHAR(100) NOT NULL,
    district VARCHAR(100) NOT NULL,
    ward VARCHAR(100) NULL,
    address VARCHAR(255) NULL,
    latitude DECIMAL(10,7) NULL,
    longitude DECIMAL(10,7) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_locations_region_district (region, district),
    INDEX idx_locations_coordinates (latitude, longitude)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE donor_profiles (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL UNIQUE,
    date_of_birth DATE NULL,
    blood_group ENUM('O', 'A', 'B', 'AB') NOT NULL,
    rh_factor ENUM('positive', 'negative') NOT NULL,
    blood_type_verified_at DATETIME NULL,
    availability_status ENUM('available', 'temporarily_unavailable', 'cooldown', 'suspended', 'inactive') NOT NULL DEFAULT 'available',
    preferred_radius_km INT NOT NULL DEFAULT 25,
    last_donation_date DATE NULL,
    notification_sms BOOLEAN NOT NULL DEFAULT TRUE,
    notification_email BOOLEAN NOT NULL DEFAULT FALSE,
    consent_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_donor_profiles_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_donor_match_fields (blood_group, rh_factor, availability_status, last_donation_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE donor_locations (
    donor_id BIGINT UNSIGNED NOT NULL,
    location_id BIGINT UNSIGNED NOT NULL,
    is_current BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (donor_id, location_id),
    CONSTRAINT fk_donor_locations_donor FOREIGN KEY (donor_id) REFERENCES donor_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_donor_locations_location FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE CASCADE,
    INDEX idx_donor_locations_current (is_current)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hospitals (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(180) NOT NULL,
    registration_number VARCHAR(100) NOT NULL UNIQUE,
    official_email VARCHAR(190) NULL,
    phone VARCHAR(30) NOT NULL,
    location_id BIGINT UNSIGNED NOT NULL,
    verification_status ENUM('pending', 'verified', 'rejected', 'suspended') NOT NULL DEFAULT 'pending',
    verified_by BIGINT UNSIGNED NULL,
    verified_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_hospitals_location FOREIGN KEY (location_id) REFERENCES locations(id),
    CONSTRAINT fk_hospitals_verified_by FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_hospitals_verification_status (verification_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE hospital_users (
    hospital_id BIGINT UNSIGNED NOT NULL,
    user_id BIGINT UNSIGNED NOT NULL,
    job_title VARCHAR(120) NULL,
    status ENUM('active', 'pending', 'suspended', 'inactive') NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (hospital_id, user_id),
    CONSTRAINT fk_hospital_users_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals(id) ON DELETE CASCADE,
    CONSTRAINT fk_hospital_users_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE emergency_requests (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    reference_number VARCHAR(40) NOT NULL UNIQUE,
    hospital_id BIGINT UNSIGNED NOT NULL,
    created_by BIGINT UNSIGNED NOT NULL,
    patient_reference VARCHAR(100) NOT NULL,
    blood_group_needed ENUM('O', 'A', 'B', 'AB') NOT NULL,
    rh_factor_needed ENUM('positive', 'negative') NOT NULL,
    units_needed INT NOT NULL,
    units_fulfilled INT NOT NULL DEFAULT 0,
    urgency_level ENUM('critical', 'high', 'medium') NOT NULL DEFAULT 'high',
    reason_category VARCHAR(120) NOT NULL,
    required_by DATETIME NOT NULL,
    status ENUM('draft', 'submitted', 'matching', 'notifying', 'active', 'partially_fulfilled', 'fulfilled', 'expired', 'cancelled') NOT NULL DEFAULT 'submitted',
    notes TEXT NULL,
    submitted_at DATETIME NULL,
    closed_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_emergency_requests_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
    CONSTRAINT fk_emergency_requests_created_by FOREIGN KEY (created_by) REFERENCES users(id),
    CONSTRAINT chk_emergency_units_needed CHECK (units_needed > 0),
    INDEX idx_emergency_status_required_by (status, required_by),
    INDEX idx_emergency_blood_type (blood_group_needed, rh_factor_needed)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE request_status_history (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    request_id BIGINT UNSIGNED NOT NULL,
    old_status VARCHAR(40) NULL,
    new_status VARCHAR(40) NOT NULL,
    changed_by BIGINT UNSIGNED NULL,
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_request_status_request FOREIGN KEY (request_id) REFERENCES emergency_requests(id) ON DELETE CASCADE,
    CONSTRAINT fk_request_status_user FOREIGN KEY (changed_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE matches (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    request_id BIGINT UNSIGNED NOT NULL,
    donor_id BIGINT UNSIGNED NOT NULL,
    compatibility_type VARCHAR(60) NOT NULL,
    distance_km DECIMAL(8,2) NULL,
    match_score DECIMAL(8,2) NOT NULL DEFAULT 0,
    rank_number INT NOT NULL,
    status ENUM('queued', 'notified', 'accepted', 'declined', 'expired', 'cancelled') NOT NULL DEFAULT 'queued',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_matches_request FOREIGN KEY (request_id) REFERENCES emergency_requests(id) ON DELETE CASCADE,
    CONSTRAINT fk_matches_donor FOREIGN KEY (donor_id) REFERENCES donor_profiles(id) ON DELETE CASCADE,
    UNIQUE KEY uq_matches_request_donor (request_id, donor_id),
    INDEX idx_matches_request_score (request_id, match_score)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE donor_responses (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    request_id BIGINT UNSIGNED NOT NULL,
    donor_id BIGINT UNSIGNED NOT NULL,
    match_id BIGINT UNSIGNED NOT NULL,
    response_status ENUM('accepted', 'declined', 'pending', 'expired', 'cancelled') NOT NULL DEFAULT 'pending',
    response_channel ENUM('secure_link', 'portal', 'sms') NOT NULL DEFAULT 'portal',
    notes TEXT NULL,
    responded_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_donor_responses_request FOREIGN KEY (request_id) REFERENCES emergency_requests(id) ON DELETE CASCADE,
    CONSTRAINT fk_donor_responses_donor FOREIGN KEY (donor_id) REFERENCES donor_profiles(id) ON DELETE CASCADE,
    CONSTRAINT fk_donor_responses_match FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
    UNIQUE KEY uq_donor_response_request_donor (request_id, donor_id),
    INDEX idx_donor_response_request_status (request_id, response_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    request_id BIGINT UNSIGNED NULL,
    recipient_user_id BIGINT UNSIGNED NOT NULL,
    channel ENUM('sms', 'email') NOT NULL,
    template_key VARCHAR(100) NOT NULL,
    subject VARCHAR(190) NULL,
    message TEXT NOT NULL,
    status ENUM('pending', 'processing', 'sent', 'delivered', 'failed', 'retry_scheduled', 'cancelled') NOT NULL DEFAULT 'pending',
    provider VARCHAR(80) NULL,
    provider_message_id VARCHAR(190) NULL,
    attempt_count INT NOT NULL DEFAULT 0,
    next_attempt_at DATETIME NULL,
    sent_at DATETIME NULL,
    delivered_at DATETIME NULL,
    failure_reason TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_notifications_request FOREIGN KEY (request_id) REFERENCES emergency_requests(id) ON DELETE SET NULL,
    CONSTRAINT fk_notifications_recipient FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_notifications_status_next_attempt (status, next_attempt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE donations (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    request_id BIGINT UNSIGNED NULL,
    donor_id BIGINT UNSIGNED NOT NULL,
    hospital_id BIGINT UNSIGNED NOT NULL,
    units_donated INT NOT NULL,
    donation_date DATETIME NOT NULL,
    verification_status ENUM('pending', 'verified', 'rejected') NOT NULL DEFAULT 'pending',
    verified_by BIGINT UNSIGNED NULL,
    verified_at DATETIME NULL,
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_donations_request FOREIGN KEY (request_id) REFERENCES emergency_requests(id) ON DELETE SET NULL,
    CONSTRAINT fk_donations_donor FOREIGN KEY (donor_id) REFERENCES donor_profiles(id),
    CONSTRAINT fk_donations_hospital FOREIGN KEY (hospital_id) REFERENCES hospitals(id),
    CONSTRAINT fk_donations_verified_by FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE audit_logs (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NULL,
    action VARCHAR(120) NOT NULL,
    entity_type VARCHAR(120) NOT NULL,
    entity_id BIGINT UNSIGNED NULL,
    ip_address VARCHAR(45) NULL,
    user_agent VARCHAR(255) NULL,
    metadata_json JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_audit_user_date (user_id, created_at),
    INDEX idx_audit_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE system_settings (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    setting_key VARCHAR(120) NOT NULL UNIQUE,
    setting_value TEXT NOT NULL,
    is_secret BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by BIGINT UNSIGNED NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_system_settings_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

