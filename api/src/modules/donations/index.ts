/**
 * Donations module public surface (docs/04 donations/, TODO.md §4).
 */

export {
  donationRoutes,
  DonationAuditActions,
  type DonationAuditAction,
} from './routes'
export {
  bloodGroupCodeSchema,
  createDonationBodySchema,
  donationIdParamSchema,
  listDonationsQuerySchema,
  updateDonationBodySchema,
  type CreateDonationBody,
  type DonationIdParam,
  type ListDonationsQuery,
  type UpdateDonationBody,
} from './schemas'
export {
  toDateOnlyString,
  toPublicBloodGroup,
  toPublicDonation,
  toPublicDonationCentreSummary,
  toPublicDonationDonor,
  type BloodGroupRow,
  type CentreSummaryRow,
  type DonationRow,
  type DonorSummaryRow,
  type PublicBloodGroup,
  type PublicDonation,
  type PublicDonationCentreSummary,
  type PublicDonationDonor,
} from './serialize'
export {
  createDonation,
  getDonationById,
  listDonations,
  updateDonation,
  type ListDonationsResult,
} from './service'
export {
  BLOOD_UNIT_SHELF_LIFE_DAYS,
  computeExpiryDate,
} from './shelf-life'
