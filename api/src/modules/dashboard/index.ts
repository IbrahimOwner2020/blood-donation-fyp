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
  dashboardPredictionsQuerySchema,
  dashboardSummaryQuerySchema,
  dashboardTrendQuerySchema,
  type DashboardAlertsQuery,
  type DashboardPredictionsQuery,
  type DashboardSummaryQuery,
  type DashboardTrendQuery,
} from './schemas'
export {
  getDashboardAlerts,
  getDashboardPredictions,
  getDashboardSummary,
  getDemandTrend,
  getDonationTrend,
  getInventoryTrend,
  type DashboardAlertsResult,
  type DashboardKpis,
  type DashboardPredictionsResult,
  type DashboardSummaryResult,
  type DashboardTrendResult,
} from './service'
