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
- `MockSmsProvider`
- `SmtpEmailProvider`
- future real SMS provider

## Development

Use Mailpit for email development.

For SMS, store simulated messages in the database or a development inbox route.

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
