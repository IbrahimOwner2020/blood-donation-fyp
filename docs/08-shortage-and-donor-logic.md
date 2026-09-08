# Shortage Detection and Donor Matching

## Shortage Detection

The AI predicts demand. Shortage detection is deterministic application logic.

Basic calculation:

```text
projected_gap = predicted_demand - expected_available_supply
```

For the prototype, expected available supply may begin as:

```text
expected_available_supply = count/current units marked AVAILABLE and not expired
```

Later, if reservations/expected incoming supply are implemented:

```text
expected_supply = available - reserved + expected_incoming - expected_expiring
```

## Severity

Severity thresholds should be configuration-driven.

Example:
- INFO: no shortage, monitoring only.
- LOW: small projected gap.
- MEDIUM: moderate projected gap.
- HIGH: significant projected gap.
- CRITICAL: severe shortage or near-zero supply.

Avoid hardcoding academic assumptions permanently. Store configurable thresholds.

## Alert Lifecycle

```text
OPEN
ACKNOWLEDGED
RESOLVED
DISMISSED
```

## Donor Matching

The system identifies **potentially eligible** registered donors. It does not medically approve them.

Minimum match rules:
- required blood group;
- donor active;
- donor not marked permanently unavailable/ineligible;
- contact information available;
- available eligibility-related records permit notification.

Possible later filters:
- last donation date;
- donation centre/service area;
- temporary deferral status.

## Donor Selection Rule

Hono returns matches. An authorized user decides whether to send notifications.

```text
Alert
  -> Blood group
  -> Hono matching query
  -> Potential donors
  -> User review
  -> Send notification
```
