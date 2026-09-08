/**
 * Schema barrel — import from `../db/schema` or `../db`.
 * Table order reflects FK dependencies for readability only;
 * MariaDB applies FKs at DDL time via migration SQL.
 */

export * from './enums'
export * from './users'
export * from './rbac'
export * from './blood-groups'
export * from './donors'
export * from './donation-centres'
export * from './donations'
export * from './healthcare-facilities'
export * from './blood-inventory'
export * from './blood-requests'
export * from './demand-records'
export * from './ai-predictions'
export * from './shortage-alerts'
export * from './notifications'
export * from './activity-logs'
