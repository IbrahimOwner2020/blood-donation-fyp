<?php

declare(strict_types=1);

require_once __DIR__ . '/../app/bootstrap.php';

$route = path();

try {
    if ($route === '/') {
        render('home', ['title' => 'Home']);
    } elseif ($route === '/dashboard') {
        $user = require_login();
        redirect(match ($user['role_name']) {
            'donor' => '/donor/dashboard',
            'hospital_staff' => '/hospital/dashboard',
            'admin', 'blood_bank' => '/admin/dashboard',
            default => '/',
        });
    } elseif ($route === '/login' && !is_post()) {
        show_login();
    } elseif ($route === '/login' && is_post()) {
        login();
    } elseif ($route === '/logout' && is_post()) {
        logout();
    } elseif ($route === '/register/donor' && !is_post()) {
        show_register_donor();
    } elseif ($route === '/register/donor' && is_post()) {
        register_donor();
    } elseif ($route === '/register/hospital' && !is_post()) {
        show_register_hospital();
    } elseif ($route === '/register/hospital' && is_post()) {
        register_hospital();
    } elseif ($route === '/donor/dashboard') {
        donor_dashboard();
    } elseif ($route === '/donor/availability' && is_post()) {
        donor_update_availability();
    } elseif (preg_match('#^/donor/requests/(\d+)/respond$#', $route, $m) && is_post()) {
        donor_respond((int) $m[1]);
    } elseif ($route === '/hospital/dashboard') {
        hospital_dashboard();
    } elseif ($route === '/hospital/requests/new' && !is_post()) {
        show_hospital_request_form();
    } elseif ($route === '/hospital/requests' && is_post()) {
        create_hospital_request();
    } elseif (preg_match('#^/hospital/requests/(\d+)$#', $route, $m)) {
        hospital_request_detail((int) $m[1]);
    } elseif (preg_match('#^/api/hospital/requests/(\d+)/responses$#', $route, $m)) {
        api_request_responses((int) $m[1]);
    } elseif ($route === '/admin/dashboard') {
        admin_dashboard();
    } elseif (preg_match('#^/admin/hospitals/(\d+)/verify$#', $route, $m) && is_post()) {
        verify_hospital((int) $m[1]);
    } elseif (preg_match('#^/admin/hospitals/(\d+)/reject$#', $route, $m) && is_post()) {
        reject_hospital((int) $m[1]);
    } elseif ($route === '/admin/reports/requests.csv') {
        export_requests_csv();
    } else {
        http_response_code(404);
        render('errors/404', ['title' => 'Not found']);
    }
} catch (Throwable $e) {
    http_response_code(500);
    render('errors/500', ['title' => 'Server error', 'error' => $e]);
}

