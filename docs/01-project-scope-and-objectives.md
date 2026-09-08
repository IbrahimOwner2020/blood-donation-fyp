# Project Scope and Objectives

This file defines the development boundary. Features outside this document are optional and must not delay the required system.

## General Objective

Design and implement an AI-Enhanced Blood Supply Prediction and Donor Notification System for Tanzania, using NBTS as the case study, to predict future blood requirements, improve blood inventory management, facilitate timely donor notification, reduce potential shortages and wastage, and support data-driven decision-making.

## Specific Objectives

1. Analyze existing blood collection, inventory management, demand monitoring, and donor communication processes at NBTS.
2. Identify functional and non-functional system requirements.
3. Design a centralized relational database for donor information, donations, blood inventory, blood requests, demand data, predictions, and notifications.
4. Develop a blood inventory management module for blood groups, available units, collection dates, expiry dates, and stock status.
5. Develop an AI prediction component using historical blood collection and utilization data to forecast future blood demand.
6. Develop an early-warning mechanism that identifies blood groups likely to experience shortages based on predicted demand and available inventory.
7. Develop donor management and notification functionality for potentially eligible registered donors when their blood group is required.
8. Develop dashboards and reports for inventory, donation trends, forecasts, shortage alerts, and donor activity.
9. Implement secure authentication, role-based access control, and activity logging.
10. Test and evaluate usability, prediction performance, security, reliability, and effectiveness.

## Required Functional Scope

### Donor Management
- Register donors.
- Store contact information.
- Store blood group.
- Maintain donation history.
- Track relevant donor eligibility information.
- Identify potentially eligible donors for notification.

### Blood Donation Management
- Record blood donations.
- Record donation dates.
- Record blood group.
- Record donation centre.
- Maintain donation history.

### Blood Inventory Management
- Track available blood units.
- Categorize by blood group.
- Record collection date.
- Record expiry date.
- Display current stock levels.
- Generate low-stock alerts.

### Blood Request Management
A lightweight module is required because blood requests appear in the approved data model and use cases.
- Record healthcare facility.
- Record blood group.
- Record units requested.
- Track date, priority, required date, and status.

### AI Blood Demand Prediction
- Identify demand patterns.
- Forecast future blood requirements.
- Predict potential shortages.
- Support blood collection planning.

### Donor Notification
- Find registered donors with required blood groups.
- Consider available eligibility information.
- Generate notifications.
- Send SMS and/or email where supported.
- Store notification history.

### Dashboard and Reporting
- Current inventory.
- Blood-group distribution.
- Donation trends.
- Blood usage trends.
- Predicted demand.
- Potential shortages.
- Donor activity.
- Notification statistics.

### Security
- Secure authentication.
- Role-based access control.
- Activity logs.
- Controlled donor data access.
- Secure database operations.

## Explicit Exclusions

The prototype will not implement:
- laboratory testing of blood;
- physical blood collection;
- blood-storage hardware control;
- automatic medical donor approval;
- medical or transfusion decisions;
- direct hospital transfusion control;
- nationwide deployment infrastructure;
- integration with every healthcare facility in Tanzania;
- automated clinical treatment decisions.

## Product Boundary

This is an information-management and decision-support platform. AI forecasts and recommends information. Authorized NBTS personnel remain responsible for operational and medical decisions.
