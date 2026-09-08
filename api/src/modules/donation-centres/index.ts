/**
 * Donation centres module public surface (docs/04 donation-centres/).
 */

export { donationCentreRoutes } from './routes'
export {
  listDonationCentresQuerySchema,
  donationCentreIdParamSchema,
  createDonationCentreBodySchema,
  patchDonationCentreBodySchema,
  type ListDonationCentresQuery,
  type DonationCentreIdParam,
  type CreateDonationCentreBody,
  type PatchDonationCentreBody,
} from './schemas'
export {
  toPublicDonationCentre,
  toPublicDonationCentreList,
  type DonationCentreRow,
  type PublicDonationCentre,
} from './serialize'
export {
  listDonationCentres,
  getDonationCentreById,
  createDonationCentre,
  patchDonationCentre,
} from './service'
