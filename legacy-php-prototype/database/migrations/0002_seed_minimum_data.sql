INSERT INTO roles (name, description) VALUES
('donor', 'Voluntary blood donor'),
('hospital_staff', 'Verified hospital staff member'),
('blood_bank', 'Blood-bank personnel'),
('admin', 'System administrator');

INSERT INTO permissions (name, description) VALUES
('donor.profile.update', 'Update own donor profile'),
('donor.request.respond', 'Respond to assigned emergency requests'),
('hospital.request.create', 'Create emergency blood requests'),
('hospital.request.view_own', 'View own hospital requests'),
('hospital.request.complete', 'Complete own hospital requests'),
('bloodbank.hospital.verify', 'Verify hospital registrations'),
('admin.user.manage', 'Manage users'),
('admin.settings.manage', 'Manage system settings'),
('admin.audit.view', 'View audit logs');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON (
    (r.name = 'donor' AND p.name IN ('donor.profile.update', 'donor.request.respond'))
    OR (r.name = 'hospital_staff' AND p.name IN ('hospital.request.create', 'hospital.request.view_own', 'hospital.request.complete'))
    OR (r.name = 'blood_bank' AND p.name IN ('bloodbank.hospital.verify', 'admin.audit.view'))
    OR (r.name = 'admin')
);

INSERT INTO system_settings (setting_key, setting_value, is_secret) VALUES
('compatibility_matrix', '{"O-":["O-"],"O+":["O-","O+"],"A-":["O-","A-"],"A+":["O-","O+","A-","A+"],"B-":["O-","B-"],"B+":["O-","O+","B-","B+"],"AB-":["O-","A-","B-","AB-"],"AB+":["O-","O+","A-","A+","B-","B+","AB-","AB+"]}', FALSE),
('request_urgency_levels', 'critical,high,medium', FALSE),
('notification_batch_size', '10', FALSE),
('notification_retry_minutes', '5,15,30', FALSE),
('donor_cooldown_days', '90', FALSE),
('default_search_radius_km', '25', FALSE);

