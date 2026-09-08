<?php

declare(strict_types=1);

function donor_dashboard(): void
{
    $user = require_role('donor');
    $stmt = db()->prepare('
        SELECT dp.*, l.region, l.district
        FROM donor_profiles dp
        JOIN donor_locations dl ON dl.donor_id = dp.id AND dl.is_current = 1
        JOIN locations l ON l.id = dl.location_id
        WHERE dp.user_id = ?
    ');
    $stmt->execute([$user['id']]);
    $profile = $stmt->fetch();

    $matches = [];
    $responses = [];
    if ($profile) {
        $stmt = db()->prepare('
            SELECT er.id AS request_id, er.reference_number, er.blood_group_needed, er.rh_factor_needed,
                   er.urgency_level, er.required_by, h.name AS hospital_name, m.status AS match_status
            FROM matches m
            JOIN emergency_requests er ON er.id = m.request_id
            JOIN hospitals h ON h.id = er.hospital_id
            LEFT JOIN donor_responses dr ON dr.match_id = m.id
            WHERE m.donor_id = ?
              AND er.status IN ("active", "partially_fulfilled")
              AND dr.id IS NULL
            ORDER BY er.required_by ASC
            LIMIT 10
        ');
        $stmt->execute([$profile['id']]);
        $matches = $stmt->fetchAll();

        $stmt = db()->prepare('
            SELECT er.reference_number, er.blood_group_needed, er.rh_factor_needed, er.urgency_level,
                   er.required_by, h.name AS hospital_name, dr.response_status, dr.responded_at
            FROM donor_responses dr
            JOIN emergency_requests er ON er.id = dr.request_id
            JOIN hospitals h ON h.id = er.hospital_id
            WHERE dr.donor_id = ?
            ORDER BY dr.created_at DESC
            LIMIT 10
        ');
        $stmt->execute([$profile['id']]);
        $responses = $stmt->fetchAll();
    }

    render('donor/dashboard', ['title' => 'Donor dashboard', 'profile' => $profile, 'matches' => $matches, 'responses' => $responses]);
}

function donor_update_availability(): void
{
    $user = require_role('donor');
    require_csrf();
    $allowed = ['available', 'temporarily_unavailable', 'inactive'];
    $status = (string) ($_POST['availability_status'] ?? '');
    if (!in_array($status, $allowed, true)) {
        flash('Invalid availability status.', 'danger');
        redirect('/donor/dashboard');
    }

    db()->prepare('UPDATE donor_profiles SET availability_status = ? WHERE user_id = ?')->execute([$status, $user['id']]);
    audit_log('donor.availability.updated', 'user', (int) $user['id'], ['status' => $status]);
    flash('Availability updated.');
    redirect('/donor/dashboard');
}

function donor_respond(int $requestId): void
{
    $user = require_role('donor');
    require_csrf();
    $response = (string) ($_POST['response_status'] ?? '');
    if (!in_array($response, ['accepted', 'declined'], true)) {
        flash('Invalid response.', 'danger');
        redirect('/donor/dashboard');
    }

    $stmt = db()->prepare('
        SELECT m.id AS match_id, dp.id AS donor_id
        FROM matches m
        JOIN donor_profiles dp ON dp.id = m.donor_id
        WHERE m.request_id = ? AND dp.user_id = ?
    ');
    $stmt->execute([$requestId, $user['id']]);
    $match = $stmt->fetch();
    if (!$match) {
        http_response_code(404);
        exit('Request match not found.');
    }

    db()->beginTransaction();
    try {
        $stmt = db()->prepare('
            INSERT INTO donor_responses (request_id, donor_id, match_id, response_status, response_channel, responded_at)
            VALUES (?, ?, ?, ?, "portal", NOW())
            ON DUPLICATE KEY UPDATE response_status = VALUES(response_status), responded_at = NOW(), response_channel = "portal"
        ');
        $stmt->execute([$requestId, $match['donor_id'], $match['match_id'], $response]);

        db()->prepare('UPDATE matches SET status = ? WHERE id = ?')->execute([$response, $match['match_id']]);
        db()->commit();
    } catch (Throwable $e) {
        db()->rollBack();
        throw $e;
    }

    audit_log('donor.response.recorded', 'emergency_request', $requestId, ['response' => $response]);
    flash('Your response has been recorded.');
    redirect('/donor/dashboard');
}
