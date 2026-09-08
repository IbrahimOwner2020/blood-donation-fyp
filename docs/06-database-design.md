# Database Design

## Database

MariaDB relational database.

## Core Tables

### users
```text
id
name
email
password_hash
status
created_at
updated_at
```

### roles
```text
id
name
description
```

### permissions
```text
id
code
description
```

### user_roles
```text
user_id
role_id
```

### role_permissions
```text
role_id
permission_id
```

### donors
```text
id
donor_number
first_name
last_name
phone
email
blood_group_id
eligibility_status
active
created_at
updated_at
```

### blood_groups
```text
id
abo
rh
code
```

Seed values:
- A+
- A-
- B+
- B-
- AB+
- AB-
- O+
- O-

### donation_centres
```text
id
name
region
address
active
```

### donations
```text
id
donor_id
donation_centre_id
blood_group_id
donation_date
units
notes
created_by
created_at
```

### blood_inventory
Recommended prototype representation:
```text
id
donation_id nullable
blood_group_id
collection_date
expiry_date
status
facility_id nullable
created_at
updated_at
```

Possible statuses:
- AVAILABLE
- RESERVED
- ISSUED
- EXPIRED
- DISCARDED

### healthcare_facilities
```text
id
name
region
district
active
```

### blood_requests
```text
id
facility_id
blood_group_id
units_requested
priority
requested_at
required_at
status
fulfilled_units
created_by
created_at
updated_at
```

### demand_records
Used to produce consistent AI training data.
```text
id
facility_id nullable
blood_group_id
date
units_requested
units_issued
units_used nullable
unfulfilled_units nullable
source
created_at
```

### ai_predictions
```text
id
blood_group_id
facility_id nullable
forecast_start
forecast_end
predicted_units
model_name
model_version nullable
metrics_json nullable
created_at
```

### shortage_alerts
```text
id
blood_group_id
facility_id nullable
prediction_id
available_units
predicted_units
projected_gap
severity
status
created_at
resolved_at nullable
```

### notifications
```text
id
donor_id
alert_id nullable
channel
recipient
message
status
provider_message_id nullable
sent_at nullable
created_by
created_at
```

### activity_logs
```text
id
user_id nullable
action
entity_type
entity_id nullable
metadata_json nullable
ip_address nullable
created_at
```

## Indexes

Add indexes on:
- donor blood_group_id;
- donor phone/email where uniqueness applies;
- donations donor_id;
- donations donation_date;
- inventory blood_group_id + status;
- inventory expiry_date;
- blood_requests facility_id + status;
- demand_records date + blood_group_id;
- predictions blood_group_id + forecast_start;
- alerts status + severity;
- notifications donor_id + created_at;
- activity_logs user_id + created_at.

## Database Rules

- Use foreign keys.
- Normalize core transactional data.
- Use `created_at` / `updated_at` consistently.
- Prefer soft-deactivation for users/donors where deletion would destroy history.
- Never store plaintext passwords.
