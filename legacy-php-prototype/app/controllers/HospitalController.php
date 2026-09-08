<?php

declare(strict_types=1);

function hospital_dashboard(): void
{
    $user = require_role('hospital_staff');
    $hospital = hospital_for_user((int) $user['id']);
    $requests = [];
    if ($hospital) {
        $stmt = db()->prepare('SELECT * FROM emergency_requests WHERE hospital_id = ? ORDER BY created_at DESC LIMIT 20');
        $stmt->execute([$hospital['id']]);
        $requests = $stmt->fetchAll();
    }

    render('hospital/dashboard', ['title' => 'Hospital dashboard', 'hospital' => $hospital, 'requests' => $requests]);
}

function show_hospital_request_form(array $errors = []): void
{
    $user = require_role('hospital_staff');
    $hospital = hospital_for_user((int) $user['id']);
    if (!$hospital || $hospital['verification_status'] !== 'verified') {
        flash('Your hospital must be verified before creating emergency requests.', 'warning');
        redirect('/hospital/dashboard');
    }
    render('hospital/request_form', ['title' => 'Create emergency request', 'errors' => $errors, 'hospital' => $hospital]);
}

function create_hospital_request(): void
{
    $user = require_role('hospital_staff');
    require_csrf();
    $hospital = hospital_for_user((int) $user['id']);
    if (!$hospital || $hospital['verification_status'] !== 'verified') {
        flash('Your hospital must be verified before creating emergency requests.', 'warning');
        redirect('/hospital/dashboard');
    }

    $errors = validate_required($_POST, [
        'patient_reference' => 'Patient reference',
        'blood_group_needed' => 'Blood group',
        'rh_factor_needed' => 'Rh factor',
        'units_needed' => 'Units needed',
        'urgency_level' => 'Urgency',
        'reason_category' => 'Reason',
        'required_by' => 'Required by',
    ]);

    if ((int) ($_POST['units_needed'] ?? 0) < 1) {
        $errors['units_needed'] = 'Units needed must be at least 1.';
    }
    if (!empty($_POST['required_by']) && strtotime((string) $_POST['required_by']) <= time()) {
        $errors['required_by'] = 'Required by must be in the future.';
    }
    if ($errors) {
        show_hospital_request_form($errors);
        return;
    }

    db()->beginTransaction();
    try {
        $reference = 'REQ-' . date('Ymd') . '-' . strtoupper(bin2hex(random_bytes(3)));
        $stmt = db()->prepare('
            INSERT INTO emergency_requests
                (reference_number, hospital_id, created_by, patient_reference, blood_group_needed, rh_factor_needed,
                 units_needed, urgency_level, reason_category, required_by, status, notes, submitted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "submitted", ?, NOW())
        ');
        $stmt->execute([
            $reference,
            $hospital['id'],
            $user['id'],
            trim((string) $_POST['patient_reference']),
            $_POST['blood_group_needed'],
            $_POST['rh_factor_needed'],
            (int) $_POST['units_needed'],
            $_POST['urgency_level'],
            trim((string) $_POST['reason_category']),
            str_replace('T', ' ', (string) $_POST['required_by']) . ':00',
            trim((string) ($_POST['notes'] ?? '')) ?: null,
        ]);
        $requestId = (int) db()->lastInsertId();
        db()->prepare('INSERT INTO request_status_history (request_id, old_status, new_status, changed_by, notes) VALUES (?, NULL, "submitted", ?, "Request created")')
            ->execute([$requestId, $user['id']]);
        db()->commit();
    } catch (Throwable $e) {
        db()->rollBack();
        show_hospital_request_form(['form' => 'Request creation failed: ' . $e->getMessage()]);
        return;
    }

    match_emergency_request($requestId);
    flash('Emergency request created, matched, and queued for donor notification.');
    redirect('/hospital/requests/' . $requestId);
}

function hospital_request_detail(int $id): void
{
    $user = require_role('hospital_staff');
    $hospital = hospital_for_user((int) $user['id']);
    $stmt = db()->prepare('
        SELECT * FROM emergency_requests WHERE id = ? AND hospital_id = ?
    ');
    $stmt->execute([$id, $hospital['id'] ?? 0]);
    $request = $stmt->fetch();
    if (!$request) {
        http_response_code(404);
        exit('Request not found.');
    }

    $stmt = db()->prepare('
        SELECT m.*, u.full_name, u.phone, u.email, dp.blood_group, dp.rh_factor, dr.response_status, dr.responded_at
        FROM matches m
        JOIN donor_profiles dp ON dp.id = m.donor_id
        JOIN users u ON u.id = dp.user_id
        LEFT JOIN donor_responses dr ON dr.match_id = m.id
        WHERE m.request_id = ?
        ORDER BY m.rank_number ASC
    ');
    $stmt->execute([$id]);
    $matches = $stmt->fetchAll();

    render('hospital/request_detail', ['title' => 'Request detail', 'request' => $request, 'matches' => $matches]);
}

function hospital_for_user(int $userId): ?array
{
    $stmt = db()->prepare('
        SELECT h.*
        FROM hospitals h
        JOIN hospital_users hu ON hu.hospital_id = h.id
        WHERE hu.user_id = ?
        LIMIT 1
    ');
    $stmt->execute([$userId]);
    return $stmt->fetch() ?: null;
}

