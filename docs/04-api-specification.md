# Hono API Specification

## Purpose

The Hono API contains all core business logic and is the single trusted backend used by the frontend.

## Suggested Structure

```text
api/src/
├── modules/
│   ├── auth/
│   ├── users/
│   ├── roles/
│   ├── donors/
│   ├── donations/
│   ├── inventory/
│   ├── blood-requests/
│   ├── facilities/
│   ├── donation-centres/
│   ├── predictions/
│   ├── alerts/
│   ├── notifications/
│   └── reports/
├── db/
├── middleware/
├── services/
├── lib/
└── index.ts
```

## API Conventions

Base path:

```text
/api/v1
```

Use JSON responses and standard HTTP status codes.

Common response form:

```json
{
  "data": {},
  "error": null
}
```

Error form:

```json
{
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request",
    "details": []
  }
}
```

## Auth Routes

```text
POST /auth/login
POST /auth/logout
GET  /auth/me
POST /auth/change-password
```

## Users and Roles

```text
GET    /users
POST   /users
GET    /users/:id
PATCH  /users/:id
DELETE /users/:id

GET    /roles
POST   /roles
PATCH  /roles/:id
```

## Donors

```text
GET    /donors
POST   /donors
GET    /donors/:id
PATCH  /donors/:id
DELETE /donors/:id
GET    /donors/:id/donations
GET    /donors/matches
```

Donor matching must be implemented on the API, not frontend.
Primary alert-scoped route: `GET /alerts/:id/matches` (blood group from alert; `alerts:read` + `donors:read`).
`GET /donors/matches` remains reserved for a blood-group query variant if needed.

## Donations

```text
GET  /donations
POST /donations
GET  /donations/:id
PATCH /donations/:id
```

Recording a donation may create or update inventory records depending on the selected inventory model.

## Inventory

```text
GET  /inventory
GET  /inventory/summary
GET  /inventory/:id
POST /inventory
PATCH /inventory/:id
GET  /inventory/expiring
GET  /inventory/low-stock
```

## Blood Requests

```text
GET  /blood-requests
POST /blood-requests
GET  /blood-requests/:id
PATCH /blood-requests/:id
```

Statuses:
- PENDING
- APPROVED
- PARTIAL
- FULFILLED
- CANCELLED

## Predictions

```text
POST /predictions/run
GET  /predictions
GET  /predictions/:id
GET  /predictions/latest
```

The API calls the AI service and persists the result.

## Shortage Alerts

```text
GET   /alerts
GET   /alerts/:id
GET   /alerts/:id/matches
PATCH /alerts/:id/status
POST  /alerts/recalculate
```

## Notifications

```text
GET  /notifications
POST /notifications/preview
POST /notifications/send
GET  /notifications/:id
```

## Reports

```text
GET /reports/inventory
GET /reports/donations
GET /reports/demand
GET /reports/predictions
GET /reports/notifications
```

## Dashboard

```text
GET /dashboard/summary
GET /dashboard/inventory-trend
GET /dashboard/donation-trend
GET /dashboard/demand-trend
GET /dashboard/predictions
GET /dashboard/alerts
```

## Business Rules

- All sensitive routes require authentication.
- Authorization must be permission-based.
- Audit significant writes.
- Do not trust frontend-derived shortage values.
- Do not trust frontend donor-matching results.
- Validate all input using Zod.
- Use transactions where multiple database records must remain consistent.
