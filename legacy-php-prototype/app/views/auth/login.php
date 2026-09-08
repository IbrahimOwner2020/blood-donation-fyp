<section class="panel">
    <h1>Login</h1>
    <form method="post" action="/login">
        <?= csrf_field() ?>
        <div class="field">
            <label for="login">Email or phone</label>
            <input id="login" name="login" required>
        </div>
        <div class="field">
            <label for="password">Password</label>
            <input id="password" name="password" type="password" required>
        </div>
        <button type="submit">Login</button>
    </form>
</section>

