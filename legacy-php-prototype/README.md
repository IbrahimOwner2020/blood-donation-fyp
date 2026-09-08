# Automated Emergency Blood Matching Platform

Dependency-free PHP 8 + PDO starter for the final year project specification in
`automated_emergency_blood_matching_platform_spec.md`.

## Setup

1. Create a MySQL or MariaDB database.
2. Copy `.env.example` to `.env` and update the database credentials.
3. Run migrations:

```sh
php database/migrate.php
```

4. Create the first admin account:

```sh
php database/create_admin.php "Admin User" admin@example.com +255700000000 "change-this-password"
```

5. Start the PHP development server from the repository root:

```sh
php -S localhost:8000 -t public
```

6. Open `http://localhost:8000`.

## Implemented MVP Foundation

- Donor and hospital registration.
- Login, logout, sessions, CSRF protection, role checks, and audit logging.
- Standalone SQL migration runner with migration tracking.
- Core schema for users, roles, hospitals, donors, emergency requests, matches,
  responses, notifications, donations, settings, and audit logs.
- Admin dashboard with hospital verification and request CSV export.
- Hospital dashboard with verified-only emergency request creation.
- ABO/Rh-compatible donor matching with region/district fallback and optional
  Haversine distance scoring when coordinates exist.
- Notification queue records instead of inline SMS/email delivery.
- Development cron stub at `cron/process_notifications.php`.

## Notes

The app intentionally avoids Composer dependencies for this kickoff. PDF reports,
SMTP delivery, SMS provider integrations, and richer testing tools can be added
after the core request-to-match workflow is stable.

