/**
 * Shared Hono context variable types for convention middleware.
 */

import type { UserStatus } from '../db/schema/enums'

/** Authenticated user on the request context — never includes passwordHash. */
export type AuthUser = {
    id: number
    name: string
    email: string
    facilityId: number | null
    status: UserStatus
    createdAt: Date
    updatedAt: Date
}

export type AppVariables = {
    requestId: string
    requestStartedAt: number
    /** Set by requireAuth when a valid DB session exists. */
    user?: AuthUser
    /** Opaque session id from the HTTP-only cookie. */
    sessionId?: string
    /** Role names; set by attachUserAccess / requirePermission. */
    roles?: string[]
    /** Permission codes; set by attachUserAccess / requirePermission. */
    permissions?: string[]
}

export type AppEnvBindings = Record<string, never>

export type AppHonoEnv = {
    Variables: AppVariables
    Bindings: AppEnvBindings
}
