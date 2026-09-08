/**
 * Demand records module public surface (TODO.md §5, docs/06, docs/14).
 */

export { demandRoutes, DemandAuditActions } from './routes'
export {
  bloodGroupCodeSchema,
  demandSourceSchema,
  exportDemandFormatSchema,
  exportDemandQuerySchema,
  listDemandRecordsQuerySchema,
  syncDemandBodySchema,
  type ExportDemandQuery,
  type ListDemandRecordsQuery,
  type SyncDemandBody,
} from './schemas'
export {
  toAiHistoryPoints,
  toAiTrainingSeries,
  toDateOnlyString,
  toPublicBloodGroupSummary,
  toPublicDemandRecord,
  type BloodGroupJoinRow,
  type DemandRecordRow,
  type PublicBloodGroupSummary,
  type PublicDemandRecord,
} from './serialize'
export {
  aggregateDemandBuckets,
  collapseBucketsByDateAndGroup,
  DEMAND_SYNC_STATUSES,
  demandBucketKey,
  isDemandSyncStatus,
  type DemandBucket,
  type DemandRequestInput,
} from './aggregate'
export {
  exportDemandSeries,
  listDemandRecords,
  syncDemandFromBloodRequests,
  type ExportDemandHistoryResult,
  type ExportDemandResult,
  type ExportDemandSeriesResult,
  type ListDemandRecordsResult,
  type SyncDemandResult,
} from './service'
