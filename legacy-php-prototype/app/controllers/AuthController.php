<?php

declare(strict_types=1);

function show_login(): void
{
    render('auth/login', ['title' => 'Login']);
}

function login(): void
{
    require_csrf();
    $login = trim((string) ($_POST['login'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');

    $stmt = db()->prepare('
        SELECT users.*, roles.name AS role_name
        FROM users
        JOIN roles ON roles.id = users.role_id
        WHERE users.email = ? OR users.phone = ?
        LIMIT 1
    ');
    $stmt->execute([$login, normalize_phone($login)]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash']) || !in_array($user['status'], ['active', 'pending'], true)) {
        flash('Invalid credentials or inactive account.', 'danger');
        redirect('/login');
    }

    session_regenerate_id(true);
    $_SESSION['user_id'] = (int) $user['id'];
    db()->prepare('UPDATE users SET last_login_at = NOW() WHERE id = ?')->execute([$user['id']]);
    audit_log('auth.login', 'user', (int) $user['id']);
    redirect('/dashboard');
}

function logout(): void
{
    require_csrf();
    audit_log('auth.logout', 'user', current_user()['id'] ?? null);
    $_SESSION = [];
    session_destroy();
    redirect('/');
}

function show_register_donor(array $errors = []): void
{
    render('auth/register_donor', ['title' => 'Donor registration', 'errors' => $errors]);
}

function register_donor(): void
{
    require_csrf();
    $errors = validate_required($_POST, [
        'full_name' => 'Full name',
        'phone' => 'Phone number',
        'password' => 'Password',
        'blood_group' => 'Blood group',
        'rh_factor' => 'Rh factor',
        'region' => 'Region',
        'district' => 'District',
        'consent' => 'Consent',
    ]);

    if ($errors) {
        show_register_donor($errors);
        return;
    }

    db()->beginTransaction();
    try {
        $location = create_location($_POST);
        $stmt = db()->prepare('
            INSERT INTO users (full_name, email, phone, password_hash, role_id, status, phone_verified_at)
            VALUES (?, ?, ?, ?, ?, "active", NOW())
        ');
        $stmt->execute([
            trim((string) $_POST['full_name']),
            trim((string) ($_POST['email'] ?? '')) ?: null,
            normalize_phone((string) $_POST['phone']),
            password_hash((string) $_POST['password'], PASSWORD_DEFAULT),
            role_id('donor'),
        ]);
        $userId = (int) db()->lastInsertId();

        $stmt = db()->prepare('
            INSERT INTO donor_profiles
                (user_id, date_of_birth, blood_group, rh_factor, preferred_radius_km, notification_sms, notification_email, consent_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
        ');
        $stmt->execute([
            $userId,
            trim((string) ($_POST['date_of_birth'] ?? '')) ?: null,
            $_POST['blood_group'],
            $_POST['rh_factor'],
            (int) ($_POST['preferred_radius_km'] ?? 25),
            isset($_POST['notification_sms']) ? 1 : 0,
            isset($_POST['notification_email']) ? 1 : 0,
        ]);
        $donorId = (int) db()->lastInsertId();

        db()->prepare('INSERT INTO donor_locations (donor_id, location_id, is_current) VALUES (?, ?, 1)')
            ->execute([$donorId, $location]);

        db()->commit();
        audit_log('donor.registered', 'user', $userId);
        flash('Donor account created. You can now sign in.');
        redirect('/login');
    } catch (Throwable $e) {
        db()->rollBack();
        show_register_donor(['form' => 'Registration failed: ' . $e->getMessage()]);
    }
}

function show_register_hospital(array $errors = []): void
{
    render('auth/register_hospital', ['title' => 'Hospital registration', 'errors' => $errors]);
}

function register_hospital(): void
{
    require_csrf();
    $errors = validate_required($_POST, [
        'hospital_name' => 'Hospital name',
        'registration_number' => 'Registration number',
        'full_name' => 'Contact person',
        'phone' => 'Phone number',
        'password' => 'Password',
        'region' => 'Region',
        'district' => 'District',
    ]);

    if ($errors) {
        show_register_hospital($errors);
        return;
    }

    db()->beginTransaction();
    try {
        $location = create_location($_POST);
        $stmt = db()->prepare('
            INSERT INTO users (full_name, email, phone, password_hash, role_id, status, phone_verified_at)
            VALUES (?, ?, ?, ?, ?, "pending", NOW())
        ');
        $stmt->execute([
            trim((string) $_POST['full_name']),
            trim((string) ($_POST['email'] ?? '')) ?: null,
            normalize_phone((string) $_POST['phone']),
            password_hash((string) $_POST['password'], PASSWORD_DEFAULT),
            role_id('hospital_staff'),
        ]);
        $userId = (int) db()->lastInsertId();

        $stmt = db()->prepare('
            INSERT INTO hospitals (name, registration_number, official_email, phone, location_id)
            VALUES (?, ?, ?, ?, ?)
        ');
        $stmt->execute([
            trim((string) $_POST['hospital_name']),
            trim((string) $_POST['registration_number']),
            trim((string) ($_POST['official_email'] ?? $_POST['email'] ?? '')) ?: null,
            normalize_phone((string) $_POST['phone']),
            $location,
        ]);
        $hospitalId = (int) db()->lastInsertId();

        db()->prepare('INSERT INTO hospital_users (hospital_id, user_id, job_title, status) VALUES (?, ?, ?, "pending")')
            ->execute([$hospitalId, $userId, trim((string) ($_POST['job_title'] ?? '')) ?: null]);

        db()->commit();
        audit_log('hospital.registered', 'hospital', $hospitalId);
        flash('Hospital registration submitted. An administrator must verify it before requests can be created.');
        redirect('/login');
    } catch (Throwable $e) {
        db()->rollBack();
        show_register_hospital(['form' => 'Registration failed: ' . $e->getMessage()]);
    }
}

function create_location(array $data): int
{
    $stmt = db()->prepare('
        INSERT INTO locations (region, district, ward, address, latitude, longitude)
        VALUES (?, ?, ?, ?, ?, ?)
    ');
    $stmt->execute([
        trim((string) $data['region']),
        trim((string) $data['district']),
        trim((string) ($data['ward'] ?? '')) ?: null,
        trim((string) ($data['address'] ?? '')) ?: null,
        trim((string) ($data['latitude'] ?? '')) !== '' ? (float) $data['latitude'] : null,
        trim((string) ($data['longitude'] ?? '')) !== '' ? (float) $data['longitude'] : null,
    ]);
    return (int) db()->lastInsertId();
}

