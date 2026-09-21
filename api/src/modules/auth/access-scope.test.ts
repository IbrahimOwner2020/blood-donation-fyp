import { describe, expect, test } from 'bun:test'

import {
  FACILITY_MANAGER_ROLE,
  HOSPITAL_STAFF_ROLE,
  isFacilityAssignableRoleName,
  isFacilityManager,
  hasRole,
  isHospitalStaff,
  requireAssignedFacilityId,
  requireHospitalFacilityId,
} from './access-scope'

const activeUser = {
  id: 10,
  name: 'Hospital User',
  email: 'hospital@example.local',
  facilityId: 3,
  status: 'ACTIVE' as const,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
}

describe('hospital facility scope', () => {
  test('detects the Hospital Staff role', () => {
    expect(hasRole([HOSPITAL_STAFF_ROLE], HOSPITAL_STAFF_ROLE)).toBe(true)
    expect(isHospitalStaff(['Registered Donor'])).toBe(false)
  })

  test('detects Facility Manager and facility-assignable role names', () => {
    expect(isFacilityManager([FACILITY_MANAGER_ROLE])).toBe(true)
    expect(isFacilityAssignableRoleName('Doctor')).toBe(true)
    expect(isFacilityAssignableRoleName('System Administrator')).toBe(false)
    expect(isFacilityAssignableRoleName('Facility Manager')).toBe(false)
  })

  test('returns facility id only for hospital users', () => {
    expect(requireHospitalFacilityId(activeUser, [HOSPITAL_STAFF_ROLE])).toBe(3)
    expect(requireHospitalFacilityId(activeUser, ['System Administrator'])).toBeUndefined()
  })

  test('rejects hospital users without assigned facility', () => {
    expect(() =>
      requireHospitalFacilityId(
        { ...activeUser, facilityId: null },
        [HOSPITAL_STAFF_ROLE],
      ),
    ).toThrow('Hospital staff account is not assigned to a facility')
  })

  test('requires any scoped account to have an assigned facility', () => {
    expect(requireAssignedFacilityId(activeUser)).toBe(3)
    expect(() =>
      requireAssignedFacilityId({ ...activeUser, facilityId: null }),
    ).toThrow('Account is not assigned to a facility')
  })
})
