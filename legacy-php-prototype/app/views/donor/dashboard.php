<section class="panel">
    <h1>Donor dashboard</h1>
    <?php if ($profile): ?>
        <p>
            Blood type:
            <strong><?= e($profile['blood_group'] . ($profile['rh_factor'] === 'positive' ? '+' : '-')) ?></strong>
            in <?= e($profile['district']) ?>, <?= e($profile['region']) ?>.
        </p>
        <form method="post" action="/donor/availability" class="actions">
            <?= csrf_field() ?>
            <select name="availability_status">
                <?php foreach (['available', 'temporarily_unavailable', 'inactive'] as $status): ?>
                    <option value="<?= e($status) ?>" <?= $profile['availability_status'] === $status ? 'selected' : '' ?>><?= e(str_replace('_', ' ', $status)) ?></option>
                <?php endforeach; ?>
            </select>
            <button type="submit">Update availability</button>
        </form>
    <?php endif; ?>
</section>

<section class="panel">
    <h2>Open emergency requests</h2>
    <div class="table-wrap">
        <table>
            <thead><tr><th>Request</th><th>Hospital</th><th>Blood</th><th>Urgency</th><th>Required by</th><th>Action</th></tr></thead>
            <tbody>
                <?php foreach ($matches as $match): ?>
                    <tr>
                        <td><?= e($match['reference_number']) ?></td>
                        <td><?= e($match['hospital_name']) ?></td>
                        <td><?= e($match['blood_group_needed'] . ($match['rh_factor_needed'] === 'positive' ? '+' : '-')) ?></td>
                        <td><?= e($match['urgency_level']) ?></td>
                        <td><?= e($match['required_by']) ?></td>
                        <td>
                            <form method="post" action="/donor/requests/<?= e((string) $match['request_id']) ?>/respond" class="actions">
                                <?= csrf_field() ?>
                                <button name="response_status" value="accepted" type="submit">Accept</button>
                                <button class="secondary" name="response_status" value="declined" type="submit">Decline</button>
                            </form>
                        </td>
                    </tr>
                <?php endforeach; ?>
                <?php if (!$matches): ?><tr><td colspan="6">No open matched requests.</td></tr><?php endif; ?>
            </tbody>
        </table>
    </div>
</section>

<section class="panel">
    <h2>Recent request responses</h2>
    <div class="table-wrap">
        <table>
            <thead><tr><th>Request</th><th>Hospital</th><th>Blood</th><th>Urgency</th><th>Response</th><th>Time</th></tr></thead>
            <tbody>
                <?php foreach ($responses as $response): ?>
                    <tr>
                        <td><?= e($response['reference_number']) ?></td>
                        <td><?= e($response['hospital_name']) ?></td>
                        <td><?= e($response['blood_group_needed'] . ($response['rh_factor_needed'] === 'positive' ? '+' : '-')) ?></td>
                        <td><?= e($response['urgency_level']) ?></td>
                        <td><span class="badge"><?= e($response['response_status']) ?></span></td>
                        <td><?= e($response['responded_at']) ?></td>
                    </tr>
                <?php endforeach; ?>
                <?php if (!$responses): ?><tr><td colspan="6">No responses recorded yet.</td></tr><?php endif; ?>
            </tbody>
        </table>
    </div>
</section>
