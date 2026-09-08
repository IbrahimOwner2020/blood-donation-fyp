<?php

declare(strict_types=1);

require_once __DIR__ . '/../app/bootstrap.php';

$existingAdmin = db()->query('
    SELECT COUNT(*)
    FROM users
    JOIN roles ON roles.id = users.role_id
    WHERE roles.name = "admin"
')->fetchColumn();

if ((int) $existingAdmin > 0) {
    exit("An admin account already exists.\n");
}

$isCli = php_sapi_name() === 'cli';
if ($isCli) {
    $fullName = $argv[1] ?? null;
    $email = $argv[2] ?? null;
    $phone = $argv[3] ?? null;
    $password = $argv[4] ?? null;

    if (!$fullName || !$email || !$phone || !$password) {
        exit("Usage: php database/create_admin.php \"Full Name\" admin@example.com +255700000000 password\n");
    }
} else {
    if (!is_post()) {
        header('Content-Type: text/html; charset=utf-8');
        echo '<!doctype html><title>Create admin</title><h1>Create initial admin</h1>';
        echo '<form method="post">';
        echo csrf_field();
        echo '<p><label>Full name <input name="full_name" required></label></p>';
        echo '<p><label>Email <input name="email" type="email" required></label></p>';
        echo '<p><label>Phone <input name="phone" required></label></p>';
        echo '<p><label>Password <input name="password" type="password" required></label></p>';
        echo '<button type="submit">Create admin</button></form>';
        exit;
    }

    require_csrf();
    $fullName = trim((string) ($_POST['full_name'] ?? ''));
    $email = trim((string) ($_POST['email'] ?? ''));
    $phone = trim((string) ($_POST['phone'] ?? ''));
    $password = (string) ($_POST['password'] ?? '');

    if ($fullName === '' || $email === '' || $phone === '' || $password === '') {
        exit("All fields are required.\n");
    }
}

$stmt = db()->prepare('
    INSERT INTO users (full_name, email, phone, password_hash, role_id, status, email_verified_at, phone_verified_at)
    VALUES (?, ?, ?, ?, ?, "active", NOW(), NOW())
');
$stmt->execute([
    $fullName,
    $email,
    normalize_phone($phone),
    password_hash($password, PASSWORD_DEFAULT),
    role_id('admin'),
]);

echo "Initial admin account created.\n";

