# Notification System

## Required Channels
- SMS where supported.
- Email where supported.

## Provider Abstraction

Create a common interface in the API:

```ts
interface NotificationProvider {
  send(input: NotificationInput): Promise<NotificationResult>
}
```

Implementations:
- `MockSmsProvider` (default when `SMS_PROVIDER=mock`)
- `NextSmsProvider` (when `SMS_PROVIDER=nextsms`) — NextSMS single-destination HTTP API
- `BeemSmsProvider` (when `SMS_PROVIDER=beem`) — Beem Africa `POST /v1/send`
- `SmtpEmailProvider`

## Development

Use Mailpit for email development.

For SMS, keep `SMS_PROVIDER=mock` locally unless you intentionally send through a live gateway.

- **NextSMS:** Basic auth maps account **username** → `NEXTSMS_API_KEY` and **password** → `NEXTSMS_API_SECRET`; `NEXTSMS_SENDER_ID` must be registered on the account. Prefer the NextSMS test URL for sandbox sends (see `.env.example`).
- **Beem:** API key → `BEEM_API_KEY`, secret key → `BEEM_API_SECRET`; `BEEM_SENDER_ID` is the registered `source_addr`. Default endpoint is `https://apisms.beem.africa/v1/send`.

## Notification Workflow

```text
Shortage Alert
  -> Potential donor list
  -> Authorized user chooses recipients
  -> Preview message
  -> API validates permission
  -> Provider sends message
  -> Notification record updated
  -> Activity log created
```

## Notification Data

Store:
- donor;
- channel;
- destination;
- message;
- status;
- created by;
- created time;
- sent time;
- provider identifier/error where applicable.

## Statuses

```text
PENDING
SENT
FAILED
```

Delivery confirmation can be added later only if supported by the provider.

## Privacy

Do not expose donor phone numbers or emails in logs accessible to unauthorized users.
