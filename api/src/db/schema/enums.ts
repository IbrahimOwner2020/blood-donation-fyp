/**
 * Shared MySQL/MariaDB enum value sets from docs/06 and docs/10.
 * Kept as const arrays so schema + app code can reuse without `any`.
 */

export const userStatuses = ['ACTIVE', 'INACTIVE'] as const
export type UserStatus = (typeof userStatuses)[number]

export const donorEligibilityStatuses = [
  'POTENTIALLY_ELIGIBLE',
  'TEMPORARILY_INELIGIBLE',
  'INELIGIBLE',
  'UNKNOWN',
] as const
export type DonorEligibilityStatus = (typeof donorEligibilityStatuses)[number]

export const donorSexes = ['MALE', 'FEMALE'] as const
export type DonorSex = (typeof donorSexes)[number]

export const donationCategories = [
  'VOLUNTARY',
  'FAMILY_REPLACEMENT',
] as const
export type DonationCategory = (typeof donationCategories)[number]

export const inventoryStatuses = [
  'AVAILABLE',
  'RESERVED',
  'ISSUED',
  'EXPIRED',
  'DISCARDED',
] as const
export type InventoryStatus = (typeof inventoryStatuses)[number]

export const bloodRequestStatuses = [
  'PENDING',
  'APPROVED',
  'PARTIAL',
  'FULFILLED',
  'CANCELLED',
] as const
export type BloodRequestStatus = (typeof bloodRequestStatuses)[number]

export const bloodRequestPriorities = [
  'LOW',
  'MEDIUM',
  'HIGH',
  'URGENT',
] as const
export type BloodRequestPriority = (typeof bloodRequestPriorities)[number]

export const demandSources = [
  'BLOOD_REQUEST',
  'MANUAL',
  'IMPORT',
  'SYSTEM',
] as const
export type DemandSource = (typeof demandSources)[number]

export const alertSeverities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const
export type AlertSeverity = (typeof alertSeverities)[number]

export const alertStatuses = [
  'OPEN',
  'ACKNOWLEDGED',
  'RESOLVED',
  'DISMISSED',
] as const
export type AlertStatus = (typeof alertStatuses)[number]

export const notificationChannels = ['SMS', 'EMAIL'] as const
export type NotificationChannel = (typeof notificationChannels)[number]

export const notificationStatuses = [
  'PENDING',
  'SENT',
  'FAILED',
  'CANCELLED',
] as const
export type NotificationStatus = (typeof notificationStatuses)[number]
