# Authentication, Security, and RBAC

## Authentication

Recommended approach:
- email/username + password;
- Argon2id or bcrypt password hashing;
- secure HTTP-only session cookie;
- server-side session validation.

Local development: `cd api && bun run db:seed` creates idempotent demo users (Administrator, Manager, Blood Bank Staff) with Argon2id hashes. Credentials are placeholders in root `.env.example` / README — **local only**, never production secrets.

Re-running `bun run db:seed` inserts missing roles and permissions, **syncs** seeded `role_permissions` to `ROLE_PERMISSION_MAP` (drops stale grants), and removes the legacy `requests:update` permission. Use this after permission-map updates so existing DBs catch up.

## Roles

Seeded roles (canonical catalogue in `api/src/db/seed`):

### Administrator
- **all permissions** (super admin — every code in `PERMISSION_CODES`);
- create facilities and staff accounts;
- manage all users, roles, and role-permission mappings;
- system configuration;
- full operational access (donors, donations, inventory, requests, alerts, notifications, reports);
- view activity logs.

### Manager
- national (not facility-scoped) read access to donors, donations, inventory, requests, notifications, and reports;
- **approve** pending blood requests and **cancel** open requests (`requests:approve`);
- read shortage alerts (`alerts:read`);
- does **not** create requests, issue fulfilment, or update inventory.

### Blood Bank Staff
- donors, donations, inventory (including marking units issued);
- read blood requests and **issue** approved requests (`requests:issue` → PARTIAL / FULFILLED);
- notifications and reports;
- does **not** approve or create blood requests;
- does **not** see the alert monitoring page.

### Hospital Staff
- assigned to one healthcare facility (`users.facility_id`);
- create blood requests for that facility (`requests:create`);
- read own-facility inventory, requests, and reports;
- does **not** approve, issue, or update inventory status.

Facility-scoped user administration (create users / assign facility-safe roles within one facility) uses `users:manage:facility` and `roles:assign:facility` when granted; Hospital Staff is the only facility-assignable seeded role.

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
requests:approve
requests:issue

alerts:read
alerts:update

notifications:read
notifications:send

reports:read
```

### Blood request status permissions

| Next status | Permission |
| --- | --- |
| APPROVED, CANCELLED | `requests:approve` |
| PARTIAL, FULFILLED | `requests:issue` |

`PATCH /api/v1/blood-requests/:id` requires at least one of those codes, then enforces the matching code for the requested status.

## API Authorization

Use middleware such as:

```ts
requireAuth()
requirePermission('inventory:update')
```

Never rely on hiding frontend buttons as authorization.

Hospital Staff accounts are scoped by `users.facility_id`. The API must force their created requests (and related reads) into the actor's assigned facility and reject cross-facility access.

Admins with `roles:manage` can create custom roles and replace a role's permission mapping. Facility-scoped actors with `roles:assign:facility` can assign only roles whose permissions are within the facility-safe operational set (Hospital Staff).

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
