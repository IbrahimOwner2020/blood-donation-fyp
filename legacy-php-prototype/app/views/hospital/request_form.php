<section class="panel">
    <h1>Create emergency request</h1>
    <?php if (!empty($errors['form'])): ?><p class="error"><?= e($errors['form']) ?></p><?php endif; ?>
    <form method="post" action="/hospital/requests">
        <?= csrf_field() ?>
        <div class="form-grid">
            <div class="field"><label for="patient_reference">Patient reference</label><input id="patient_reference" name="patient_reference" required></div>
            <div class="field">
                <label for="blood_group_needed">Blood group needed</label>
                <select id="blood_group_needed" name="blood_group_needed" required>
                    <option value="O">O</option><option value="A">A</option><option value="B">B</option><option value="AB">AB</option>
                </select>
            </div>
            <div class="field">
                <label for="rh_factor_needed">Rh factor needed</label>
                <select id="rh_factor_needed" name="rh_factor_needed" required>
                    <option value="negative">Negative</option><option value="positive">Positive</option>
                </select>
            </div>
            <div class="field"><label for="units_needed">Units needed</label><input id="units_needed" name="units_needed" type="number" min="1" value="1" required></div>
            <div class="field">
                <label for="urgency_level">Urgency</label>
                <select id="urgency_level" name="urgency_level">
                    <option value="critical">Critical</option><option value="high" selected>High</option><option value="medium">Medium</option>
                </select>
            </div>
            <div class="field"><label for="reason_category">Reason</label><input id="reason_category" name="reason_category" required></div>
            <div class="field"><label for="required_by">Required by</label><input id="required_by" name="required_by" type="datetime-local" required></div>
        </div>
        <div class="field"><label for="notes">Coordination notes</label><textarea id="notes" name="notes"></textarea></div>
        <button type="submit">Create and match donors</button>
    </form>
</section>

