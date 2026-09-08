<section class="panel">
    <h1><?= e($request['reference_number']) ?></h1>
    <p>
        Needed: <strong><?= e($request['blood_group_needed'] . ($request['rh_factor_needed'] === 'positive' ? '+' : '-')) ?></strong>,
        <?= e((string) $request['units_needed']) ?> units,
        status <span class="badge"><?= e($request['status']) ?></span>.
    </p>
</section>

<section class="panel">
    <h2>Matching results</h2>
    <div class="table-wrap">
        <table>
            <thead><tr><th>Rank</th><th>Donor</th><th>Blood</th><th>Score</th><th>Distance</th><th>Response</th><th>Contact</th></tr></thead>
            <tbody>
                <?php foreach ($matches as $match): ?>
                    <tr>
                        <td><?= e((string) $match['rank_number']) ?></td>
                        <td><?= e($match['full_name']) ?></td>
                        <td><?= e($match['blood_group'] . ($match['rh_factor'] === 'positive' ? '+' : '-')) ?></td>
                        <td><?= e((string) $match['match_score']) ?></td>
                        <td><?= e($match['distance_km'] === null ? 'District match' : $match['distance_km'] . ' km') ?></td>
                        <td><span class="badge"><?= e($match['response_status'] ?? $match['status']) ?></span></td>
                        <td><?= ($match['response_status'] ?? '') === 'accepted' ? e($match['phone']) : '<span class="muted">Hidden until accepted</span>' ?></td>
                    </tr>
                <?php endforeach; ?>
                <?php if (!$matches): ?><tr><td colspan="7">No compatible donors found yet.</td></tr><?php endif; ?>
            </tbody>
        </table>
    </div>
</section>

<script>
setInterval(async () => {
    const response = await fetch('/api/hospital/requests/<?= e((string) $request['id']) ?>/responses', {headers: {'Accept': 'application/json'}});
    if (!response.ok) return;
    const data = await response.json();
    console.log('Latest donor responses', data.responses);
}, 10000);
</script>

