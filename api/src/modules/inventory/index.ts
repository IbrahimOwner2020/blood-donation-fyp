/**
 * Inventory module public surface (docs/04 inventory/, TODO.md §4).
 */

export {
  inventoryRoutes,
  InventoryAuditActions,
  type InventoryAuditAction,
} from './routes'
export {
  DEFAULT_EXPIRING_WITHIN_DAYS,
  DEFAULT_LOW_STOCK_THRESHOLD,
} from './constants'
export {
  addUtcDays,
  classifyUnit,
  filterExpiringUnits,
  filterLowStock,
  isEffectivelyAvailable,
  isExpiringSoon,
  isPastExpiry,
  summarizeByBloodGroup,
  toDateOnlyString,
  utcTodayDateOnly,
  type BloodGroupInventoryCounts,
  type InventoryUnitSnapshot,
  type SummarizeOptions,
} from './availability'
export {
  bloodGroupCodeSchema,
  inventoryExpiringQuerySchema,
  inventoryIdParamSchema,
  inventoryLowStockQuerySchema,
  inventoryStatusSchema,
  inventorySummaryQuerySchema,
  listInventoryQuerySchema,
  updateInventoryBodySchema,
  type InventoryExpiringQuery,
  type InventoryIdParam,
  type InventoryLowStockQuery,
  type InventorySummaryQuery,
  type ListInventoryQuery,
  type UpdateInventoryBody,
} from './schemas'
export {
  toPublicBloodGroup,
  toPublicFacilitySummary,
  toPublicInventoryUnit,
  type BloodGroupRow,
  type FacilitySummaryRow,
  type InventoryRow,
  type PublicBloodGroup,
  type PublicFacilitySummary,
  type PublicInventoryUnit,
} from './serialize'
export {
  getInventoryById,
  getInventoryLowStock,
  getInventorySummary,
  listExpiringInventory,
  listInventory,
  updateInventoryUnit,
  type InventoryExpiringResult,
  type InventoryLowStockResult,
  type InventorySummaryResult,
  type ListInventoryResult,
  type UpdateInventoryResult,
} from './service'
export {
  INVENTORY_STATUS_TRANSITIONS,
  assertInventoryStatusTransition,
  canTransitionInventoryStatus,
  isTerminalInventoryStatus,
} from './status-machine'
