/**
 * Donors module public surface (docs/04 donors/, TODO.md §3).
 */

export {
  donorRoutes,
  DonorAuditActions,
  type DonorAuditAction,
} from './routes'
export {
  bloodGroupCodeSchema,
  createDonorBodySchema,
  donorEligibilityStatusSchema,
  donorIdParamSchema,
  listDonorsQuerySchema,
  updateDonorBodySchema,
  type CreateDonorBody,
  type DonorIdParam,
  type ListDonorsQuery,
  type UpdateDonorBody,
} from './schemas'
export {
  toPublicBloodGroup,
  toPublicDonor,
  type BloodGroupRow,
  type DonorRow,
  type PublicBloodGroup,
  type PublicDonor,
} from './serialize'
export {
  createDonor,
  deactivateDonor,
  getDonorById,
  listDonors,
  updateDonor,
  type ListDonorsResult,
} from './service'
