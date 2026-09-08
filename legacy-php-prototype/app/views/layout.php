<?php $user = current_user(); $notice = flash(); ?>
<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title><?= e($title ?? app_name()) ?> | <?= e(app_name()) ?></title>
    <link rel="stylesheet" href="/assets/app.css">
</head>
<body>
    <header class="topbar">
        <div class="shell">
            <a class="brand" href="/"><?= e(app_name()) ?></a>
            <nav class="nav">
                <?php if ($user): ?>
                    <a href="/dashboard">Dashboard</a>
                    <span class="muted"><?= e($user['full_name']) ?></span>
                    <form method="post" action="/logout">
                        <?= csrf_field() ?>
                        <button class="secondary" type="submit">Logout</button>
                    </form>
                <?php else: ?>
                    <a href="/register/donor">Donor registration</a>
                    <a href="/register/hospital">Hospital registration</a>
                    <a href="/login">Login</a>
                <?php endif; ?>
            </nav>
        </div>
    </header>
    <main class="shell">
        <?php if ($notice): ?>
            <div class="alert <?= e($notice['type']) ?>"><?= e($notice['message']) ?></div>
        <?php endif; ?>
        <?php require $viewFile; ?>
    </main>
</body>
</html>

