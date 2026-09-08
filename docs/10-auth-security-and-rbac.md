# Authentication, Security, and RBAC

## Authentication

Recommended approach:
- email/username + password;
- Argon2id or bcrypt password hashing;
- secure HTTP-only session cookie;
- server-side session validation.

Local development: `cd api && bun run db:seed` creates idempotent demo users (System Administrator + NBTS Blood Bank Officer) with Argon2id hashes. Credentials are placeholders in root `.env.example` / README — **local only**, never production secrets.

Re-running `bun run db:seed` inserts any **missing** `role_permissions` rows (does not delete existing mappings). Use this after permission-map updates so existing DBs catch up.

## Roles

Suggested initial roles:

### System Administrator
- **all permissions** (super admin — every code in `PERMISSION_CODES`);
- manage users and roles;
- system configuration;
- full operational access (donors, donations, inventory, requests, forecasts, alerts, notifications, reports);
- view activity logs.

### NBTS Blood Bank Officer
- donors;
- donations;
- inventory;
- blood requests;
- shortage alerts;
- notifications.

### Authorized Manager
- dashboards;
- forecasts;
- shortage alerts;
- reports;
- notification monitoring.

## Permission Examples

```text
users:manage
roles:manage
activity:read

donors:read
donors:create
donors:update

donations:read
donations:create

inventory:read
inventory:update

requests:read
requests:create
requests:update

predictions:read
predictions:run

alerts:read
alerts:update

notifications:read
notifications:send

reports:read
```

## API Authorization

Use middleware such as:

```ts
requireAuth()
requirePermission('inventory:update')
```

Never rely on hiding frontend buttons as authorization.

## Security Requirements

- Validate all request bodies.
- Use parameterized queries/ORM.
- Protect sessions from XSS/CSRF according to chosen session architecture.
- Rate-limit login attempts.
- Do not log passwords/tokens.
- Redact sensitive donor data from errors.
- Enforce unique user identities.
- Record significant administrative and data-changing actions.
- Back up database volumes.

### CSRF (cookie session model)

Implemented approach: **SameSite=Strict** HTTP-only session cookie plus **Origin/Referer allow-list** on unsafe methods (`APP_ORIGINS`).

Double-submit tokens were not used for MVP because the session id is already opaque and HttpOnly; SameSite=Strict blocks cross-site cookie attachment, and the Origin check adds defense-in-depth for browser clients. Non-browser clients that omit Origin and Referer are allowed.

## Audit Events

Audit at minimum:
- login/logout failures and successes as appropriate;
- user creation/update/deactivation;
- donor create/update;
- donation creation;
- inventory changes;
- blood request status changes;
- forecast execution;
- alert status changes;
- notifications sent.
