<?php

declare(strict_types=1);

function queue_notifications_for_request(int $requestId): int
{
    $stmt = db()->prepare('
        SELECT er.reference_number, er.blood_group_needed, er.rh_factor_needed, er.urgency_level, er.required_by,
               h.name AS hospital_name, l.district, m.id AS match_id, m.donor_id,
               u.id AS user_id, u.email, u.phone, dp.notification_sms, dp.notification_email
        FROM matches m
        JOIN donor_profiles dp ON dp.id = m.donor_id
        JOIN users u ON u.id = dp.user_id
        JOIN emergency_requests er ON er.id = m.request_id
        JOIN hospitals h ON h.id = er.hospital_id
        JOIN locations l ON l.id = h.location_id
        WHERE m.request_id = ?
        ORDER BY m.rank_number ASC
        LIMIT ?
    ');
    $stmt->execute([$requestId, (int) setting_value('notification_batch_size', '10')]);
    $matches = $stmt->fetchAll();

    $insert = db()->prepare('
        INSERT INTO notifications (request_id, recipient_user_id, channel, template_key, subject, message, status, provider, next_attempt_at)
        SELECT ?, ?, ?, ?, ?, ?, "pending", ?, NOW()
        WHERE NOT EXISTS (
            SELECT 1 FROM notifications
            WHERE request_id = ? AND recipient_user_id = ? AND channel = ? AND template_key = ?
        )
    ');

    $queued = 0;
    foreach ($matches as $match) {
        $rh = $match['rh_factor_needed'] === 'positive' ? '+' : '-';
        $message = 'Emergency blood request ' . $match['reference_number'] . ': '
            . $match['blood_group_needed'] . $rh . ' needed at '
            . $match['hospital_name'] . ', ' . $match['district']
            . '. Urgency: ' . $match['urgency_level']
            . '. Please sign in to accept or decline before ' . $match['required_by'] . '.';

        foreach (notification_channels($match) as $channel) {
            $insert->execute([
                $requestId,
                $match['user_id'],
                $channel,
                'emergency_request',
                $channel === 'email' ? 'Emergency blood donation request' : null,
                $message,
                $channel === 'sms' ? 'development_sms' : 'development_email',
                $requestId,
                $match['user_id'],
                $channel,
                'emergency_request',
            ]);
            $queued += $insert->rowCount();
        }
    }

    return $queued;
}

function notification_channels(array $match): array
{
    $channels = [];
    if ((int) $match['notification_sms'] === 1 && $match['phone']) {
        $channels[] = 'sms';
    }
    if ((int) $match['notification_email'] === 1 && $match['email']) {
        $channels[] = 'email';
    }
    return $channels;
}

