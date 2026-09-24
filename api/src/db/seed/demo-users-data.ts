/**
 * Demo users for local/dev seeding only.
 * Passwords come from env (see root `.env.example`); never commit real secrets.
 * Defaults match README placeholders — change before any shared/staging use.
 */

import type { RoleName } from './permission-codes'

export interface DemoUserSeed {
    name: string
    email: string
    /** Plaintext used only at seed time; stored as Argon2id hash. */
    password: string
    roleName: RoleName
}

function readEnv(key: string, fallback: string): string {
    const value = process.env?.[key]?.trim()
    return value && value.length > 0 ? value : fallback
}

/**
 * Local-only demo accounts. Emails are unique keys for idempotent upsert-skip.
 */
export function listDemoUserSeeds(): DemoUserSeed[] {
    return [
        {
            name: 'Demo Administrator',
            email: readEnv('DEMO_ADMIN_EMAIL', 'admin@nbts.local'),
            password: readEnv('DEMO_ADMIN_PASSWORD', 'ChangeMe-Admin-Local-Only!'),
            roleName: 'Administrator',
        },
        {
            name: 'Demo Blood Bank Staff',
            email: readEnv('DEMO_OFFICER_EMAIL', 'officer@nbts.local'),
            password: readEnv(
                'DEMO_OFFICER_PASSWORD',
                'ChangeMe-Officer-Local-Only!',
            ),
            roleName: 'Blood Bank Staff',
        },
    ]
}
