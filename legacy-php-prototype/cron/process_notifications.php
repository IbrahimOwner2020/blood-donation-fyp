<?php

declare(strict_types=1);

require_once __DIR__ . '/../app/bootstrap.php';

$stmt = db()->prepare('
    SELECT *
    FROM notifications
    WHERE status IN ("pending", "retry_scheduled")
      AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
    ORDER BY created_at ASC
    LIMIT 50
');
$stmt->execute();
$jobs = $stmt->fetchAll();

$processed = 0;
foreach ($jobs as $job) {
    db()->prepare('UPDATE notifications SET status = "processing", attempt_count = attempt_count + 1 WHERE id = ?')
        ->execute([$job['id']]);

    db()->prepare('UPDATE notifications SET status = "sent", sent_at = NOW(), provider_message_id = ? WHERE id = ?')
        ->execute(['dev-' . $job['id'] . '-' . time(), $job['id']]);

    $processed++;
}

echo "Processed {$processed} notification jobs.\n";

