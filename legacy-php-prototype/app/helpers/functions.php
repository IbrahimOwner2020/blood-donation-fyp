<?php

declare(strict_types=1);

function db(): PDO
{
    global $pdo;
    return $pdo;
}

function app_name(): string
{
    return env_value('APP_NAME', 'Emergency Blood Matching') ?? 'Emergency Blood Matching';
}

function e(?string $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

function path(): string
{
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
    return rtrim($path ?: '/', '/') ?: '/';
}

function is_post(): bool
{
    return ($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST';
}

function redirect(string $to): never
{
    header('Location: ' . $to);
    exit;
}

function csrf_token(): string
{
    if (empty($_SESSION['_csrf'])) {
        $_SESSION['_csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['_csrf'];
}

function csrf_field(): string
{
    return '<input type="hidden" name="_csrf" value="' . e(csrf_token()) . '">';
}

function require_csrf(): void
{
    $token = $_POST['_csrf'] ?? '';
    if (!is_string($token) || !hash_equals($_SESSION['_csrf'] ?? '', $token)) {
        http_response_code(419);
        exit('Invalid security token.');
    }
}

function flash(?string $message = null, string $type = 'success'): ?array
{
    if ($message !== null) {
        $_SESSION['_flash'] = ['message' => $message, 'type' => $type];
        return null;
    }

    $flash = $_SESSION['_flash'] ?? null;
    unset($_SESSION['_flash']);
    return $flash;
}

function current_user(): ?array
{
    if (empty($_SESSION['user_id'])) {
        return null;
    }

    static $user = null;
    if ($user !== null) {
        return $user;
    }

    $stmt = db()->prepare('
        SELECT users.*, roles.name AS role_name
        FROM users
        JOIN roles ON roles.id = users.role_id
        WHERE users.id = ?
    ');
    $stmt->execute([$_SESSION['user_id']]);
    $user = $stmt->fetch() ?: null;
    return $user;
}

function require_login(): array
{
    $user = current_user();
    if (!$user) {
        flash('Please sign in to continue.', 'warning');
        redirect('/login');
    }
    return $user;
}

function require_role(array|string $roles): array
{
    $user = require_login();
    $allowed = is_array($roles) ? $roles : [$roles];
    if (!in_array($user['role_name'], $allowed, true)) {
        http_response_code(403);
        exit('You are not allowed to access this page.');
    }
    return $user;
}

function validate_required(array $data, array $fields): array
{
    $errors = [];
    foreach ($fields as $field => $label) {
        if (!isset($data[$field]) || trim((string) $data[$field]) === '') {
            $errors[$field] = "{$label} is required.";
        }
    }
    return $errors;
}

function normalize_phone(string $phone): string
{
    $phone = preg_replace('/\s+/', '', trim($phone)) ?? '';
    if (str_starts_with($phone, '0')) {
        return '+255' . substr($phone, 1);
    }
    if (!str_starts_with($phone, '+')) {
        return '+' . $phone;
    }
    return $phone;
}

function role_id(string $roleName): int
{
    $stmt = db()->prepare('SELECT id FROM roles WHERE name = ?');
    $stmt->execute([$roleName]);
    $id = $stmt->fetchColumn();
    if (!$id) {
        throw new RuntimeException("Missing role: {$roleName}");
    }
    return (int) $id;
}

function render(string $view, array $data = []): void
{
    extract($data, EXTR_SKIP);
    $viewFile = __DIR__ . '/../views/' . $view . '.php';
    require __DIR__ . '/../views/layout.php';
}

function json_response(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_SLASHES);
    exit;
}

