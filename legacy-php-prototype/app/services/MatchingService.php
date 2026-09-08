<?php

declare(strict_types=1);

function blood_type(string $group, string $rh): string
{
    return $group . ($rh === 'positive' ? '+' : '-');
}

function compatible_donor_types(string $recipientGroup, string $recipientRh): array
{
    $recipient = blood_type($recipientGroup, $recipientRh);
    $stmt = db()->prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'compatibility_matrix'");
    $stmt->execute();
    $matrix = json_decode((string) $stmt->fetchColumn(), true);

    return $matrix[$recipient] ?? [];
}

function split_blood_type(string $type): array
{
    return [str_replace(['+', '-'], '', $type), str_ends_with($type, '+') ? 'positive' : 'negative'];
}

function haversine_km(?float $lat1, ?float $lon1, ?float $lat2, ?float $lon2): ?float
{
    if ($lat1 === null || $lon1 === null || $lat2 === null || $lon2 === null) {
        return null;
    }

    $earthRadius = 6371;
    $latDelta = deg2rad($lat2 - $lat1);
    $lonDelta = deg2rad($lon2 - $lon1);
    $a = sin($latDelta / 2) ** 2
        + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($lonDelta / 2) ** 2;

    return round($earthRadius * 2 * atan2(sqrt($a), sqrt(1 - $a)), 2);
}

function match_emergency_request(int $requestId): array
{
    $stmt = db()->prepare('
        SELECT er.*, h.name AS hospital_name, l.region, l.district, l.latitude AS hospital_latitude, l.longitude AS hospital_longitude
        FROM emergency_requests er
        JOIN hospitals h ON h.id = er.hospital_id
        JOIN locations l ON l.id = h.location_id
        WHERE er.id = ?
    ');
    $stmt->execute([$requestId]);
    $request = $stmt->fetch();
    if (!$request) {
        throw new RuntimeException('Emergency request not found.');
    }

    $compatibleTypes = compatible_donor_types($request['blood_group_needed'], $request['rh_factor_needed']);
    if (!$compatibleTypes) {
        return [];
    }

    $conditions = [];
    $params = [];
    foreach ($compatibleTypes as $type) {
        [$group, $rh] = split_blood_type($type);
        $conditions[] = '(dp.blood_group = ? AND dp.rh_factor = ?)';
        $params[] = $group;
        $params[] = $rh;
    }

    $cooldownDays = (int) setting_value('donor_cooldown_days', '90');
    $sql = '
        SELECT dp.id AS donor_id, dp.user_id, dp.blood_group, dp.rh_factor, dp.last_donation_date,
               dp.notification_sms, dp.notification_email, users.full_name, users.email, users.phone,
               l.region, l.district, l.latitude, l.longitude
        FROM donor_profiles dp
        JOIN users ON users.id = dp.user_id
        JOIN donor_locations dl ON dl.donor_id = dp.id AND dl.is_current = 1
        JOIN locations l ON l.id = dl.location_id
        LEFT JOIN donor_responses dr ON dr.request_id = ? AND dr.donor_id = dp.id
        WHERE users.status = "active"
          AND users.phone_verified_at IS NOT NULL
          AND dp.availability_status = "available"
          AND dp.consent_at IS NOT NULL
          AND dr.id IS NULL
          AND (' . implode(' OR ', $conditions) . ')
          AND (dp.last_donation_date IS NULL OR dp.last_donation_date <= DATE_SUB(CURDATE(), INTERVAL ? DAY))
          AND (l.region = ? OR l.district = ?)
    ';

    $stmt = db()->prepare($sql);
    $stmt->execute(array_merge(
        [$requestId],
        $params,
        [$cooldownDays, $request['region'], $request['district']]
    ));

    $donors = $stmt->fetchAll();
    $ranked = [];
    foreach ($donors as $donor) {
        $distance = haversine_km(
            $request['hospital_latitude'] !== null ? (float) $request['hospital_latitude'] : null,
            $request['hospital_longitude'] !== null ? (float) $request['hospital_longitude'] : null,
            $donor['latitude'] !== null ? (float) $donor['latitude'] : null,
            $donor['longitude'] !== null ? (float) $donor['longitude'] : null
        );
        $exact = $donor['blood_group'] === $request['blood_group_needed'] && $donor['rh_factor'] === $request['rh_factor_needed'];
        $score = ($exact ? 60 : 40) + ($distance === null ? 10 : max(0, 30 - min(30, $distance))) + 10;
        $donor['distance_km'] = $distance;
        $donor['match_score'] = round($score, 2);
        $donor['compatibility_type'] = $exact ? 'exact' : 'compatible';
        $ranked[] = $donor;
    }

    usort($ranked, fn (array $a, array $b): int => $b['match_score'] <=> $a['match_score']);

    db()->beginTransaction();
    try {
        $update = db()->prepare('UPDATE emergency_requests SET status = "active", submitted_at = COALESCE(submitted_at, NOW()) WHERE id = ?');
        $update->execute([$requestId]);

        $history = db()->prepare('INSERT INTO request_status_history (request_id, old_status, new_status, changed_by, notes) VALUES (?, ?, "active", ?, ?)');
        $history->execute([$requestId, $request['status'], current_user()['id'] ?? null, 'Matching executed']);

        $insert = db()->prepare('
            INSERT INTO matches (request_id, donor_id, compatibility_type, distance_km, match_score, rank_number)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE match_score = VALUES(match_score), distance_km = VALUES(distance_km), rank_number = VALUES(rank_number)
        ');

        foreach ($ranked as $index => $donor) {
            $insert->execute([
                $requestId,
                $donor['donor_id'],
                $donor['compatibility_type'],
                $donor['distance_km'],
                $donor['match_score'],
                $index + 1,
            ]);
        }

        db()->commit();
    } catch (Throwable $e) {
        db()->rollBack();
        throw $e;
    }

    queue_notifications_for_request($requestId);
    audit_log('request.matched', 'emergency_request', $requestId, ['matches' => count($ranked)]);

    return $ranked;
}

function setting_value(string $key, string $default = ''): string
{
    $stmt = db()->prepare('SELECT setting_value FROM system_settings WHERE setting_key = ?');
    $stmt->execute([$key]);
    $value = $stmt->fetchColumn();
    return $value === false ? $default : (string) $value;
}

