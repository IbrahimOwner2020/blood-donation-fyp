# Four-Week Development Plan

The final proposal mentions a longer academic timeline, but this engineering plan is optimized for an intensive four-week implementation cycle.

## Week 1 — Foundation

### API
- initialize Bun + Hono;
- configure Drizzle + MariaDB;
- create schema/migrations;
- authentication;
- RBAC;
- user management;
- donor CRUD.

### Web
- initialize React Router v7;
- login;
- main layout;
- navigation;
- dashboard shell;
- donor screens.

### AI
- initialize FastAPI;
- health endpoint;
- define training/forecast schemas;
- prepare sample dataset.

### Docker
- first Compose environment;
- db volume;
- API/web/AI containers;
- Mailpit.

## Week 2 — Core Blood Operations

### API
- donation management;
- inventory management;
- expiry/stock queries;
- blood requests;
- low-stock logic.

### Web
- donation screens;
- inventory dashboard;
- request screens;
- blood-group summary charts.

### AI
- preprocessing pipeline;
- baseline forecast;
- first ML candidate;
- time-aware evaluation.

## Week 3 — Prediction + Notifications

### API
- AI-service client;
- prediction persistence;
- shortage calculation;
- alerts;
- donor matching;
- notification provider abstraction;
- mock SMS;
- Mailpit email.

### Web
- predictions page;
- shortage alerts;
- matching donors;
- notification preview/send;
- reporting charts.

### AI
- compare models;
- persist best model artifact;
- model metadata and metrics.

## Week 4 — Hardening and Defense

- complete dashboard;
- reports;
- audit logs;
- fix permissions;
- integration testing;
- Playwright E2E tests;
- AI evaluation report;
- sample/demo dataset;
- backups;
- production Docker Compose;
- documentation;
- screenshots;
- presentation/demo rehearsal.

## Priority Order

If time becomes limited, finish in this order:

1. authentication/RBAC;
2. donors;
3. donations;
4. inventory;
5. blood requests/demand data;
6. AI forecast;
7. shortage alerts;
8. donor notification;
9. dashboard/reports;
10. polish/stretch work.
