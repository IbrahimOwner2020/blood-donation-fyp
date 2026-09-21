# Authentication, Security, and RBAC

## Authentication

Recommended approach:
- email/username + password;
- Argon2id or bcrypt password hashing;
- secure HTTP-only session cookie;
- server-side session validation.

Local development: `cd api && bun run db:seed` creates idempotent demo users (System Administrator + NBTS Blood Bank Officer) with Argon2id hashes. Credentials are placeholders in root `.env.example` / README — **local only**, never production secrets.

Re-running `bun run db:seed` inserts any **missing** roles, permissions, and `role_permissions` rows (does not delete existing mappings). Use this after permission-map updates so existing DBs catch up.

## Roles

Seeded roles:

### System Administrator
- **all permissions** (super admin — every code in `PERMISSION_CODES`);
- create facilities and facility manager accounts;
- manage all users, roles, and role-permission mappings;
- system configuration;
- full operational access (donors, donations, inventory, requests, forecasts, alerts, notifications, reports);
- view activity logs.

### Facility Manager
- assigned to one healthcare facility;
- create, update, and deactivate users only for that facility;
- assign only facility-safe roles;
- run facility operational workflows.

### Donor Manager
- donor record read/create/update;
- donation visibility;
- reporting visibility.

### Blood Collector
- donor lookup;
- donation recording;
- inventory visibility.

### Blood Bank Manager
- donors, donations, inventory, requests, alerts, notifications, and reports.

### Doctor
- facility request creation/status workflows;
- inventory visibility and usage status updates.

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
users:manage:facility
roles:manage
roles:assign:facility
activity:read

facilities:read
facilities:create
facilities:update

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

Facility managers are scoped by `users.facility_id`. The API must force their created users into the actor's assigned facility and reject reads, updates, deactivation, or role assignments for users outside that facility.

Admins with `roles:manage` can create custom roles and replace a role's permission mapping. Facility managers cannot create or edit roles; with `roles:assign:facility`, they can assign only roles whose permissions are within the facility-safe operational set.

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
