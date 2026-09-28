/**
 * Dashboard module public surface (docs/04 Dashboard, TODO.md §9).
 */

export { dashboardRoutes } from './routes'
export {
  DEFAULT_DASHBOARD_PERIOD_DAYS,
  MAX_TREND_DAYS,
  addUtcDays,
  bucketTrendByDate,
  fillTrendRange,
  filterTrendToPeriod,
  inclusiveDaySpan,
  isValidDateOnly,
  resolvePeriod,
  sumTrendUnits,
  toDateOnlyString,
  utcTodayDateOnly,
  type DateOnlyPeriod,
  type TrendBucketInput,
  type TrendPoint,
} from './aggregate'
export {
  bloodGroupCodeSchema,
  dashboardAlertsQuerySchema,
  dashboardSummaryQuerySchema,
  dashboardTrendQuerySchema,
  type DashboardAlertsQuery,
  type DashboardSummaryQuery,
  type DashboardTrendQuery,
} from './schemas'
export {
  getDashboardAlerts,
  getDashboardSummary,
  getDemandTrend,
  getDonationTrend,
  getInventoryTrend,
  type DashboardAlertsResult,
  type DashboardKpis,
  type DashboardSummaryResult,
  type DashboardTrendResult,
} from './service'
