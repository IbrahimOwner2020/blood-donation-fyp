<?php

declare(strict_types=1);

function api_request_responses(int $requestId): void
{
    $user = require_role('hospital_staff');
    $hospital = hospital_for_user((int) $user['id']);
    $stmt = db()->prepare('
        SELECT dr.response_status, dr.responded_at, u.full_name,
               CASE WHEN dr.response_status = "accepted" THEN u.phone ELSE NULL END AS phone
        FROM donor_responses dr
        JOIN donor_profiles dp ON dp.id = dr.donor_id
        JOIN users u ON u.id = dp.user_id
        JOIN emergency_requests er ON er.id = dr.request_id
        WHERE dr.request_id = ? AND er.hospital_id = ?
        ORDER BY dr.responded_at DESC
    ');
    $stmt->execute([$requestId, $hospital['id'] ?? 0]);
    json_response(['responses' => $stmt->fetchAll()]);
}

