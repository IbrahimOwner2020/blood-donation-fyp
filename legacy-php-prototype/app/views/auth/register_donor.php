<section class="panel">
    <h1>Donor registration</h1>
    <?php if (!empty($errors['form'])): ?><p class="error"><?= e($errors['form']) ?></p><?php endif; ?>
    <form method="post" action="/register/donor">
        <?= csrf_field() ?>
        <div class="form-grid">
            <div class="field">
                <label for="full_name">Full name</label>
                <input id="full_name" name="full_name" required>
                <?php if (!empty($errors['full_name'])): ?><p class="error"><?= e($errors['full_name']) ?></p><?php endif; ?>
            </div>
            <div class="field">
                <label for="phone">Phone number</label>
                <input id="phone" name="phone" required placeholder="+255...">
                <?php if (!empty($errors['phone'])): ?><p class="error"><?= e($errors['phone']) ?></p><?php endif; ?>
            </div>
            <div class="field">
                <label for="email">Email</label>
                <input id="email" name="email" type="email">
            </div>
            <div class="field">
                <label for="password">Password</label>
                <input id="password" name="password" type="password" required>
            </div>
            <div class="field">
                <label for="date_of_birth">Date of birth</label>
                <input id="date_of_birth" name="date_of_birth" type="date">
            </div>
            <div class="field">
                <label for="blood_group">Blood group</label>
                <select id="blood_group" name="blood_group" required>
                    <option value="O">O</option><option value="A">A</option><option value="B">B</option><option value="AB">AB</option>
                </select>
            </div>
            <div class="field">
                <label for="rh_factor">Rh factor</label>
                <select id="rh_factor" name="rh_factor" required>
                    <option value="negative">Negative</option><option value="positive">Positive</option>
                </select>
            </div>
            <div class="field">
                <label for="region">Region</label>
                <input id="region" name="region" value="Dar es Salaam" required>
            </div>
            <div class="field">
                <label for="district">District</label>
                <input id="district" name="district" required>
            </div>
            <div class="field">
                <label for="preferred_radius_km">Preferred distance in km</label>
                <input id="preferred_radius_km" name="preferred_radius_km" type="number" min="1" value="25">
            </div>
        </div>
        <div class="field">
            <label><input type="checkbox" name="notification_sms" checked> Receive SMS notifications</label>
            <label><input type="checkbox" name="notification_email"> Receive email notifications</label>
            <label><input type="checkbox" name="consent" required> I consent to emergency donation communication and data processing</label>
        </div>
        <button type="submit">Create donor account</button>
    </form>
</section>

