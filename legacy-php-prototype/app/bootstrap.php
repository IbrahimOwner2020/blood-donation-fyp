<?php

declare(strict_types=1);

require_once __DIR__ . '/../db_connect.php';
require_once __DIR__ . '/helpers/functions.php';
require_once __DIR__ . '/services/AuditService.php';
require_once __DIR__ . '/services/MatchingService.php';
require_once __DIR__ . '/services/NotificationService.php';
require_once __DIR__ . '/controllers/AuthController.php';
require_once __DIR__ . '/controllers/DonorController.php';
require_once __DIR__ . '/controllers/HospitalController.php';
require_once __DIR__ . '/controllers/AdminController.php';
require_once __DIR__ . '/controllers/ApiController.php';

if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start([
        'cookie_httponly' => true,
        'cookie_samesite' => 'Lax',
    ]);
}

