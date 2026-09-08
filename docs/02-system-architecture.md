# System Architecture

## Architectural Style

Use a **modular monolith for the core application with an independent AI forecasting service**.

```text
Browser
   |
   v
React Router v7 Web
   |
   v
Hono + Bun API
   |          \
   |           \--> Python AI Service
   v
MariaDB
```

Supporting development/runtime containers:

```text
Docker Compose
├── web
├── api
├── ai-service
├── db
├── ollama       # optional local LLM/testing
└── mailpit      # development email
```

## Responsibility Boundary

### Web
Responsible for presentation only:
- pages and navigation;
- forms;
- charts;
- client-side validation for UX;
- API calls;
- loading/error states;
- session-aware UI.

The web application must not make authoritative decisions about shortage severity, donor eligibility, permissions, stock calculations, or prediction values.

### API
The API is the business-logic authority.

Owns:
- authentication and sessions;
- RBAC;
- users;
- donors;
- donations;
- inventory;
- blood requests;
- facilities and donation centres;
- shortage rules;
- donor matching;
- notification orchestration;
- reports;
- audit/activity logs;
- database operations;
- AI-service communication;
- persistence of forecasts.

### AI Service
Owns only prediction-related functionality:
- preprocessing;
- feature generation;
- model training;
- model evaluation;
- forecast generation;
- model artifact loading/saving.

It must not directly manage user credentials, donor contact data, notifications, or application permissions.

## Data Flow: Forecast

```text
Historical demand / donations / requests
              |
              v
           Hono API
              |
     prepare prediction dataset
              |
              v
       Python AI Service
              |
         forecast result
              |
              v
           Hono API
              |
      persist prediction
              |
 compare against current inventory
              |
      create shortage alert
              |
              v
         React dashboard
```

## Data Flow: Donor Notification

```text
Shortage Alert
     |
     v
Hono donor-matching logic
     |
potentially eligible donors
     |
authorized user selects/sends
     |
notification provider
     |
notification log
```

## Important Rule

The AI service should not be granted unrestricted access to the full production database. Hono should pass only the forecasting inputs required for a request.
