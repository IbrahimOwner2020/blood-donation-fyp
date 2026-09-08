<?php

declare(strict_types=1);

function admin_dashboard(): void
{
    require_role(['admin', 'blood_bank']);
    $counts = [];
    foreach ([
        'donors' => 'SELECT COUNT(*) FROM donor_profiles',
        'hospitals_pending' => 'SELECT COUNT(*) FROM hospitals WHERE verification_status = "pending"',
        'open_requests' => 'SELECT COUNT(*) FROM emergency_requests WHERE status IN ("submitted", "active", "partially_fulfilled")',
        'fulfilled_requests' => 'SELECT COUNT(*) FROM emergency_requests WHERE status = "fulfilled"',
        'notifications_pending' => 'SELECT COUNT(*) FROM notifications WHERE status = "pending"',
    ] as $key => $sql) {
        $counts[$key] = (int) db()->query($sql)->fetchColumn();
    }

    $hospitals = db()->query('
        SELECT h.*, l.region, l.district
        FROM hospitals h
        JOIN locations l ON l.id = h.location_id
        ORDER BY h.created_at DESC
        LIMIT 20
    ')->fetchAll();

    $auditLogs = db()->query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 10')->fetchAll();

    render('admin/dashboard', [
        'title' => 'Admin dashboard',
        'counts' => $counts,
        'hospitals' => $hospitals,
        'auditLogs' => $auditLogs,
    ]);
}

function verify_hospital(int $id): void
{
    $user = require_role(['admin', 'blood_bank']);
    require_csrf();

    db()->beginTransaction();
    try {
        db()->prepare('UPDATE hospitals SET verification_status = "verified", verified_by = ?, verified_at = NOW() WHERE id = ?')
            ->execute([$user['id'], $id]);
        db()->prepare('
            UPDATE users u
            JOIN hospital_users hu ON hu.user_id = u.id
            SET u.status = "active", hu.status = "active"
            WHERE hu.hospital_id = ?
        ')->execute([$id]);
        db()->commit();
    } catch (Throwable $e) {
        db()->rollBack();
        throw $e;
    }

    audit_log('hospital.verified', 'hospital', $id);
    flash('Hospital verified.');
    redirect('/admin/dashboard');
}

function reject_hospital(int $id): void
{
    require_role(['admin', 'blood_bank']);
    require_csrf();
    db()->prepare('UPDATE hospitals SET verification_status = "rejected" WHERE id = ?')->execute([$id]);
    audit_log('hospital.rejected', 'hospital', $id);
    flash('Hospital rejected.', 'warning');
    redirect('/admin/dashboard');
}

function export_requests_csv(): void
{
    require_role(['admin', 'blood_bank']);
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="emergency-requests.csv"');
    $out = fopen('php://output', 'w');
    fputcsv($out, ['Reference', 'Hospital', 'Blood type', 'Units needed', 'Units fulfilled', 'Urgency', 'Status', 'Required by']);
    $rows = db()->query('
        SELECT er.*, h.name AS hospital_name
        FROM emergency_requests er
        JOIN hospitals h ON h.id = er.hospital_id
        ORDER BY er.created_at DESC
    ');
    foreach ($rows as $row) {
        fputcsv($out, [
            $row['reference_number'],
            $row['hospital_name'],
            $row['blood_group_needed'] . ($row['rh_factor_needed'] === 'positive' ? '+' : '-'),
            $row['units_needed'],
            $row['units_fulfilled'],
            $row['urgency_level'],
            $row['status'],
            $row['required_by'],
        ]);
    }
    exit;
}

