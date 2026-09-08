/**
 * Public user DTO — never includes passwordHash.
 */

import type { UserStatus } from '../../db/schema/enums'

export type PublicUser = {
  id: number
  name: string
  email: string
  status: UserStatus
  createdAt: Date
  updatedAt: Date
}

export type UserRow = {
  id: number
  name: string
  email: string
  passwordHash: string
  status: UserStatus
  createdAt: Date
  updatedAt: Date
}

/** Strip passwordHash (and any other secrets) before API responses. */
export function toPublicUser(user: UserRow | null | undefined): PublicUser | null {
  if (!user) {
    return null
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }
}
