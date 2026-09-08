/**
 * Healthcare facilities module public surface (docs/04, TODO.md §5).
 */

export { facilitiesRoutes, FacilityAuditActions } from './routes'
export {
  facilityIdParamSchema,
  listFacilitiesQuerySchema,
  createFacilityBodySchema,
  patchFacilityBodySchema,
  type FacilityIdParam,
  type ListFacilitiesQuery,
  type CreateFacilityBody,
  type PatchFacilityBody,
} from './schemas'
export {
  toPublicFacility,
  toPublicFacilities,
  type FacilityRow,
  type PublicFacility,
} from './serialize'
export {
  listFacilities,
  getFacilityById,
  createFacility,
  patchFacility,
  type PatchFacilityResult,
} from './service'
