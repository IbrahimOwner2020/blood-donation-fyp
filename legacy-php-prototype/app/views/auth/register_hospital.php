<section class="panel">
    <h1>Hospital registration</h1>
    <?php if (!empty($errors['form'])): ?><p class="error"><?= e($errors['form']) ?></p><?php endif; ?>
    <form method="post" action="/register/hospital">
        <?= csrf_field() ?>
        <div class="form-grid">
            <div class="field"><label for="hospital_name">Hospital name</label><input id="hospital_name" name="hospital_name" required></div>
            <div class="field"><label for="registration_number">Registration number</label><input id="registration_number" name="registration_number" required></div>
            <div class="field"><label for="full_name">Contact person</label><input id="full_name" name="full_name" required></div>
            <div class="field"><label for="job_title">Job title</label><input id="job_title" name="job_title"></div>
            <div class="field"><label for="phone">Phone number</label><input id="phone" name="phone" required placeholder="+255..."></div>
            <div class="field"><label for="email">Login email</label><input id="email" name="email" type="email"></div>
            <div class="field"><label for="official_email">Official hospital email</label><input id="official_email" name="official_email" type="email"></div>
            <div class="field"><label for="password">Password</label><input id="password" name="password" type="password" required></div>
            <div class="field"><label for="region">Region</label><input id="region" name="region" value="Dar es Salaam" required></div>
            <div class="field"><label for="district">District</label><input id="district" name="district" required></div>
            <div class="field"><label for="address">Address</label><input id="address" name="address"></div>
        </div>
        <button type="submit">Submit hospital registration</button>
    </form>
</section>

