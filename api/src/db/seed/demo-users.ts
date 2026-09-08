/**
 * Idempotent demo users for local login (docs/10).
 * Hashes passwords with Argon2id via Bun.password (hashPassword helper).
 * Safe to re-run: skips existing emails; ensures role assignment if missing.
 */

import { eq, inArray } from 'drizzle-orm'

import { hashPassword } from '../../modules/auth/password'
import type { Db } from '../client'
import { roles, userRoles, users } from '../schema'
import { listDemoUserSeeds, type DemoUserSeed } from './demo-users-data'

export interface SeedDemoUsersResult {
    inserted: number
    skipped: number
    rolesAssigned: number
    rolesSkipped: number
    emails: string[]
}

function mappingKey(userId: number, roleId: number): string {
    return `${userId}:${roleId}`
}

/**
 * Seed demo admin (+ officer) with known local passwords.
 * Requires roles to exist (run seedRolesPermissions first).
 */
export async function seedDemoUsers(db: Db): Promise<SeedDemoUsersResult> {
    const seeds = listDemoUserSeeds()
    const emails = seeds.map((row) => row.email)

    const existingUsers = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(inArray(users.email, emails))

    const userIdByEmail = new Map<string, number>()
    for (const row of existingUsers ?? []) {
        if (row?.email != null && row?.id != null) {
            userIdByEmail.set(row.email, row.id)
        }
    }

    let inserted = 0
    let skipped = 0

    for (const seed of seeds) {
        const existingId = userIdByEmail.get(seed.email)
        if (existingId != null) {
            skipped += 1
            continue
        }

        const passwordHash = await hashPassword(seed.password)
        await db.insert(users).values({
            name: seed.name,
            email: seed.email,
            passwordHash,
            status: 'ACTIVE',
        })

        const created = await db
            .select({ id: users.id, email: users.email })
            .from(users)
            .where(eq(users.email, seed.email))
            .limit(1)

        const newId = created?.[0]?.id
        if (newId == null) {
            throw new Error(`Failed to load seeded user ${seed.email}`)
        }

        userIdByEmail.set(seed.email, newId)
        inserted += 1
    }

    const roleNames = [
        ...new Set(seeds.map((row: DemoUserSeed) => row.roleName)),
    ]
    const roleRows = await db
        .select({ id: roles.id, name: roles.name })
        .from(roles)
        .where(inArray(roles.name, roleNames))

    const roleIdByName = new Map<string, number>()
    for (const row of roleRows ?? []) {
        if (row?.name != null && row?.id != null) {
            roleIdByName.set(row.name, row.id)
        }
    }

    const userIds = [...userIdByEmail.values()]
    const existingMappings =
        userIds.length > 0
            ? await db
                .select({
                    userId: userRoles.userId,
                    roleId: userRoles.roleId,
                })
                .from(userRoles)
                .where(inArray(userRoles.userId, userIds))
            : []

    const existingMappingKeys = new Set(
        (existingMappings ?? [])
            .filter(
                (row): row is { userId: number; roleId: number } =>
                    row?.userId != null && row?.roleId != null,
            )
            .map((row) => mappingKey(row.userId, row.roleId)),
    )

    const mappingsToInsert: Array<{ userId: number; roleId: number }> = []
    let rolesSkipped = 0

    for (const seed of seeds) {
        const userId = userIdByEmail.get(seed.email)
        const roleId = roleIdByName.get(seed.roleName)

        if (userId == null || roleId == null) {
            if (roleId == null) {
                throw new Error(
                    `Role "${seed.roleName}" missing — run roles/permissions seed first`,
                )
            }
            continue
        }

        const key = mappingKey(userId, roleId)
        if (existingMappingKeys.has(key)) {
            rolesSkipped += 1
            continue
        }

        mappingsToInsert.push({ userId, roleId })
        existingMappingKeys.add(key)
    }

    if (mappingsToInsert.length > 0) {
        await db.insert(userRoles).values(mappingsToInsert)
    }

    return {
        inserted,
        skipped,
        rolesAssigned: mappingsToInsert.length,
        rolesSkipped,
        emails,
    }
}
