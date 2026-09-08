<?php

declare(strict_types=1);

require_once __DIR__ . '/../db_connect.php';

$isCli = php_sapi_name() === 'cli';
if (!$isCli) {
    header('Content-Type: text/plain; charset=utf-8');
}

$pdo->exec("
    CREATE TABLE IF NOT EXISTS migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        migration_name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
");

$migrationsDir = __DIR__ . '/migrations';
$migrationFiles = glob($migrationsDir . '/*.sql') ?: [];
sort($migrationFiles, SORT_STRING);

$stmt = $pdo->query('SELECT migration_name FROM migrations ORDER BY migration_name');
$executedMigrations = $stmt->fetchAll(PDO::FETCH_COLUMN);
$appliedCount = 0;

foreach ($migrationFiles as $file) {
    $migrationName = basename($file);

    if (in_array($migrationName, $executedMigrations, true)) {
        continue;
    }

    echo "Applying migration: {$migrationName}\n";
    $sql = file_get_contents($file);

    if ($sql === false || trim($sql) === '') {
        echo "Skipped empty file: {$migrationName}\n";
        continue;
    }

    try {
        $pdo->beginTransaction();
        $pdo->exec($sql);

        $logStmt = $pdo->prepare('INSERT INTO migrations (migration_name) VALUES (?)');
        $logStmt->execute([$migrationName]);

        $pdo->commit();
        echo "Successfully applied: {$migrationName}\n\n";
        $appliedCount++;
    } catch (PDOException $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        echo "Error applying {$migrationName}: " . $e->getMessage() . "\n";
        echo "Execution halted.\n";
        exit(1);
    }
}

echo $appliedCount === 0 ? "Everything is up to date.\n" : "Completed. {$appliedCount} files applied.\n";

