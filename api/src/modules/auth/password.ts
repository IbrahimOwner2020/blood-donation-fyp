/**
 * Password hashing — Argon2id via Bun.password (docs/10).
 *
 * Choice: Bun's built-in `Bun.password` with algorithm `argon2id`.
 * No extra native dependency is required on the Bun runtime. Hashes are
 * PHC-format strings compatible with `Bun.password.verify`.
 * Never return password hashes through API responses.
 */

export type HashPasswordOptions = {
  /** Memory cost in KiB (Bun default is fine for most deployments). */
  memoryCost?: number
  /** Time cost / iterations. */
  timeCost?: number
}

const DEFAULT_MEMORY_COST = 19_456
const DEFAULT_TIME_COST = 2

/**
 * Hash a plaintext password with Argon2id.
 */
export async function hashPassword(
  password: string,
  options: HashPasswordOptions = {},
): Promise<string> {
  const trimmed = password ?? ''
  if (!trimmed) {
    throw new Error('Password must not be empty')
  }

  return Bun.password.hash(trimmed, {
    algorithm: 'argon2id',
    memoryCost: options.memoryCost ?? DEFAULT_MEMORY_COST,
    timeCost: options.timeCost ?? DEFAULT_TIME_COST,
  })
}

/**
 * Verify plaintext against a stored Argon2id (or Bun-compatible) hash.
 * Returns false on mismatch or invalid inputs — never throws for bad passwords.
 */
export async function verifyPassword(
  password: string,
  passwordHash: string | null | undefined,
): Promise<boolean> {
  if (!password || !passwordHash) {
    return false
  }

  try {
    return await Bun.password.verify(password, passwordHash)
  } catch {
    return false
  }
}
