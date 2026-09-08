<section class="grid">
    <?php foreach ($counts as $label => $value): ?>
        <div class="card">
            <div class="stat"><?= e((string) $value) ?></div>
            <div class="muted"><?= e(str_replace('_', ' ', $label)) ?></div>
        </div>
    <?php endforeach; ?>
</section>

<section class="panel">
    <div class="actions">
        <h2>Hospitals</h2>
        <a class="button secondary" href="/admin/reports/requests.csv">Export requests CSV</a>
    </div>
    <div class="table-wrap">
        <table>
            <thead><tr><th>Name</th><th>Registration</th><th>Location</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
                <?php foreach ($hospitals as $hospital): ?>
                    <tr>
                        <td><?= e($hospital['name']) ?></td>
                        <td><?= e($hospital['registration_number']) ?></td>
                        <td><?= e($hospital['district'] . ', ' . $hospital['region']) ?></td>
                        <td><span class="badge"><?= e($hospital['verification_status']) ?></span></td>
                        <td>
                            <?php if ($hospital['verification_status'] === 'pending'): ?>
                                <form method="post" action="/admin/hospitals/<?= e((string) $hospital['id']) ?>/verify" class="actions">
                                    <?= csrf_field() ?>
                                    <button type="submit">Verify</button>
                                </form>
                                <form method="post" action="/admin/hospitals/<?= e((string) $hospital['id']) ?>/reject" class="actions">
                                    <?= csrf_field() ?>
                                    <button class="warning" type="submit">Reject</button>
                                </form>
                            <?php else: ?>
                                <span class="muted">No action</span>
                            <?php endif; ?>
                        </td>
                    </tr>
                <?php endforeach; ?>
                <?php if (!$hospitals): ?><tr><td colspan="5">No hospitals registered yet.</td></tr><?php endif; ?>
            </tbody>
        </table>
    </div>
</section>

<section class="panel">
    <h2>Recent audit events</h2>
    <div class="table-wrap">
        <table>
            <thead><tr><th>Action</th><th>Entity</th><th>When</th></tr></thead>
            <tbody>
                <?php foreach ($auditLogs as $log): ?>
                    <tr><td><?= e($log['action']) ?></td><td><?= e($log['entity_type'] . '#' . $log['entity_id']) ?></td><td><?= e($log['created_at']) ?></td></tr>
                <?php endforeach; ?>
                <?php if (!$auditLogs): ?><tr><td colspan="3">No audit events yet.</td></tr><?php endif; ?>
            </tbody>
        </table>
    </div>
</section>

