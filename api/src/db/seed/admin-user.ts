/**
 * Idempotent System Administrator seed for production/demo bootstrap.
 * Does not update an existing user's password; it only ensures the admin role.
 */

import { eq } from 'drizzle-orm'

import { hashPassword } from '../../modules/auth/password'
import type { Db } from '../client'
import { roles, userRoles, users } from '../schema'

const ADMIN_ROLE_NAME = 'Administrator'

export interface SeedAdminUserInput {
  name: string
  email: string
  password: string
}

export interface SeedAdminUserResult {
  inserted: number
  skipped: number
  rolesAssigned: number
  rolesSkipped: number
  email: string
}

function readEnv(key: string): string | undefined {
  const value = process.env?.[key]?.trim()
  return value && value.length > 0 ? value : undefined
}

export function readAdminUserSeed(): SeedAdminUserInput {
  const email = readEnv('ADMIN_EMAIL') ?? readEnv('DEMO_ADMIN_EMAIL')
  const password = readEnv('ADMIN_PASSWORD') ?? readEnv('DEMO_ADMIN_PASSWORD')
  const name =
    readEnv('ADMIN_NAME') ?? readEnv('DEMO_ADMIN_NAME') ?? 'Administrator'

  if (!email) {
    throw new Error('ADMIN_EMAIL is required to seed the admin user')
  }

  if (!password) {
    throw new Error('ADMIN_PASSWORD is required to seed the admin user')
  }

  return { name, email, password }
}

export async function seedAdminUser(
  db: Db,
  input: SeedAdminUserInput = readAdminUserSeed(),
): Promise<SeedAdminUserResult> {
  const roleRows = await db
    .select({ id: roles.id })
    .from(roles)
    .where(eq(roles.name, ADMIN_ROLE_NAME))
    .limit(1)

  const roleId = roleRows?.[0]?.id
  if (roleId == null) {
    throw new Error(
      `Role "${ADMIN_ROLE_NAME}" missing — run roles/permissions seed first`,
    )
  }

  const existing = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, input.email))
    .limit(1)

  let userId = existing?.[0]?.id
  let inserted = 0
  let skipped = 0

  if (userId == null) {
    const passwordHash = await hashPassword(input.password)
    await db.insert(users).values({
      name: input.name,
      email: input.email,
      passwordHash,
      status: 'ACTIVE',
    })

    const created = await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(eq(users.email, input.email))
      .limit(1)

    userId = created?.[0]?.id
    if (userId == null) {
      throw new Error(`Failed to load seeded admin user ${input.email}`)
    }
    inserted = 1
  } else {
    skipped = 1
  }

  const existingMapping = await db
    .select({ userId: userRoles.userId, roleId: userRoles.roleId })
    .from(userRoles)
    .where(eq(userRoles.userId, userId))

  const hasAdminRole = (existingMapping ?? []).some(
    (row) => row.roleId === roleId,
  )

  if (!hasAdminRole) {
    await db.insert(userRoles).values({ userId, roleId })
  }

  return {
    inserted,
    skipped,
    rolesAssigned: hasAdminRole ? 0 : 1,
    rolesSkipped: hasAdminRole ? 1 : 0,
    email: input.email,
  }
}
