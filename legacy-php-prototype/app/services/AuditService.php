<?php

declare(strict_types=1);

function audit_log(string $action, string $entityType, ?int $entityId = null, array $metadata = []): void
{
    $user = current_user();
    $stmt = db()->prepare('
        INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address, user_agent, metadata_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ');
    $stmt->execute([
        $user['id'] ?? null,
        $action,
        $entityType,
        $entityId,
        $_SERVER['REMOTE_ADDR'] ?? null,
        substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255),
        $metadata ? json_encode($metadata, JSON_UNESCAPED_SLASHES) : null,
    ]);
}

