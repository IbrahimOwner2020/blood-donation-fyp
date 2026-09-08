<section class="panel">
    <h1>Hospital dashboard</h1>
    <?php if ($hospital): ?>
        <p><?= e($hospital['name']) ?> status: <span class="badge <?= $hospital['verification_status'] === 'verified' ? 'good' : 'warn' ?>"><?= e($hospital['verification_status']) ?></span></p>
        <?php if ($hospital['verification_status'] === 'verified'): ?>
            <a class="button" href="/hospital/requests/new">Create emergency request</a>
        <?php endif; ?>
    <?php endif; ?>
</section>

<section class="panel">
    <h2>Emergency requests</h2>
    <div class="table-wrap">
        <table>
            <thead><tr><th>Reference</th><th>Blood</th><th>Units</th><th>Urgency</th><th>Status</th><th>Required by</th></tr></thead>
            <tbody>
                <?php foreach ($requests as $request): ?>
                    <tr>
                        <td><a href="/hospital/requests/<?= e((string) $request['id']) ?>"><?= e($request['reference_number']) ?></a></td>
                        <td><?= e($request['blood_group_needed'] . ($request['rh_factor_needed'] === 'positive' ? '+' : '-')) ?></td>
                        <td><?= e((string) $request['units_needed']) ?></td>
                        <td><?= e($request['urgency_level']) ?></td>
                        <td><span class="badge"><?= e($request['status']) ?></span></td>
                        <td><?= e($request['required_by']) ?></td>
                    </tr>
                <?php endforeach; ?>
                <?php if (!$requests): ?><tr><td colspan="6">No emergency requests yet.</td></tr><?php endif; ?>
            </tbody>
        </table>
    </div>
</section>

