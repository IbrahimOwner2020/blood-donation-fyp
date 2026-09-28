# React Router v7 Frontend Specification

## Purpose

The frontend provides dashboards and workflow screens. It contains presentation logic but not authoritative business rules.

## Suggested Routes

```text
/login
/dashboard

/donors
/donors/new
/donors/:id
/donors/:id/edit

/donations
/donations/new

/inventory
/inventory/:id

/blood-requests
/blood-requests/new
/blood-requests/:id

/predictions
/predictions/:id

/alerts
/alerts/:id

/notifications
/notifications/new

/reports

/admin/users
/admin/roles
/admin/activity
```

## Main Layout

```text
┌───────────────────────────────────────────────┐
│ Top Bar / User Menu                           │
├────────────┬──────────────────────────────────┤
│ Sidebar    │ Page Content                     │
│            │                                  │
│ Dashboard  │                                  │
│ Donors     │                                  │
│ Donations  │                                  │
│ Inventory  │                                  │
│ Requests   │                                  │
│ Forecasts  │                                  │
│ Alerts     │                                  │
│ Notify     │                                  │
│ Reports    │                                  │
└────────────┴──────────────────────────────────┘
```

## Dashboard Requirements

### KPI Cards
- Total available blood units.
- Low-stock blood groups.
- Active shortage alerts.
- Donations this period.
- Notifications sent.

### Charts
- Blood-group inventory distribution.
- Donation trend.
- Usage/request trend.
- Predicted demand trend.
- Supply vs predicted demand.

### Alert Table
Columns:
- blood group;
- facility/service area if used;
- current supply;
- predicted demand;
- gap;
- severity;
- status.

## Donor Screens

Donor list filters:
- blood group;
- active/inactive;
- eligibility status;
- last donation date;
- donation centre/location where available.

Donor detail:
- personal/contact information;
- blood group;
- relevant eligibility information;
- donation history;
- notification history.

## Inventory Screens

Inventory summary by blood group.

Useful columns:
- blood group;
- available units;
- reserved units if implemented;
- expiring soon;
- expired;
- low-stock status.

## Prediction Screen

Must clearly distinguish:
- historical actual demand;
- forecast values;
- model used;
- forecast period;
- prediction generated date;
- model evaluation metrics where available.

## UX Rules

- All destructive actions require confirmation.
- Display permission errors clearly.
- Use server values for authoritative decisions.
- Use optimistic updates only for safe, reversible interactions.
- Always provide loading and empty states.

## AI Operations Assistant

`/assistant` is a protected staff workspace. Desktop uses conversation history,
conversation content, and an artifact panel. Smaller screens keep the
conversation full-screen and open artifacts in an accessible overlay. The
sidebar exposes the route only to staff with a supported permission; the global
floating assistant button is a shortcut to the full page rather than a second
chat implementation.

The page renders only API-validated blocks. LLM-composed answers use reusable
stack/grid/column sections containing narrative, KPI, comparison, table, chart,
ranking, status, timeline, notice, and recommendation blocks. Every displayed
data value has already been resolved by the API; the browser never interprets
model HTML or calculation expressions. Reports expose a composition-matching
PDF and a CSV action for each table. Conversational forms require an editable
review followed by a separate explicit confirmation.
English and Kiswahili are selectable per conversation. Expired, forbidden,
partial, empty, loading, cancellation, and failed-action states remain visible
and must not be represented as successful output.
