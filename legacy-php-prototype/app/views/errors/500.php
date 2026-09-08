<section class="panel">
    <h1>Server error</h1>
    <p>The application could not complete the request.</p>
    <?php if ((env_value('APP_ENV', 'local') ?? 'local') === 'local' && isset($error)): ?>
        <pre><?= e($error->getMessage()) ?></pre>
    <?php endif; ?>
</section>

