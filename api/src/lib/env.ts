/**
 * Environment loader with Zod parsing and safe development defaults.
 * Values from docs/15-environment-and-configuration.md.
 */

import { z } from 'zod'

const booleanFromString = z
    .union([z.boolean(), z.string()])
    .transform((value) => {
        if (typeof value === 'boolean') {
            return value
        }
        const normalized = value.trim().toLowerCase()
        return normalized === '1' || normalized === 'true' || normalized === 'yes'
    })

const envSchema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(3000),
    SESSION_SECRET: z.string().min(1).default('change-me'),
    /** Opaque DB session lifetime in seconds (default 7 days). */
    SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 7),
    DB_HOST: z.string().min(1).default('localhost'),
    DB_PORT: z.coerce.number().int().positive().default(3306),
    DB_NAME: z.string().min(1).default('nbts_blood_ai'),
    DB_USER: z.string().min(1).default('nbts'),
    DB_PASSWORD: z.string().default('change-me'),
    AI_SERVICE_URL: z.string().url().default('http://localhost:8000'),
    /** Internal URL AI-service can use to call API-owned assistant tools. */
    API_INTERNAL_BASE_URL: z.string().url().optional(),
    /** Shared secret for server-to-server daily AI analysis cron calls. */
    AI_ANALYSIS_CRON_SECRET: z.string().optional().default(''),
    /** Default / forecast / models timeout (~30s per docs/14). */
    AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    /** Training may run longer than forecast; keep separate from request timeout. */
    AI_TRAIN_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
    /** Health probes should fail fast when the AI service is down. */
    AI_HEALTH_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
    SMTP_HOST: z.string().min(1).default('localhost'),
    SMTP_PORT: z.coerce.number().int().positive().default(1025),
    SMTP_FROM: z.string().min(1).default('no-reply@nbts.local'),
    SMS_PROVIDER: z.string().min(1).default('mock'),
    COOKIE_SECURE: booleanFromString.default(false),
    SESSION_COOKIE_SAME_SITE: z
        .enum(['Strict', 'Lax', 'None', 'strict', 'lax', 'none'])
        .default('Strict')
        .transform((value) => {
            const normalized = value.trim().toLowerCase()
            if (normalized === 'none') {
                return 'None' as const
            }
            if (normalized === 'lax') {
                return 'Lax' as const
            }
            return 'Strict' as const
        }),
    /**
     * Comma-separated browser origins for CORS allow-list and CSRF Origin checks.
     * Must include the web app origin (Vite: 5173 default, 5174 if 5173 busy).
     * Example: http://localhost:5173,http://localhost:5174,http://localhost:3000
     */
    APP_ORIGINS: z
        .string()
        .default(
            'http://localhost:5173,http://localhost:5174,http://localhost:3000',
        ),
    /** Max POST /auth/login attempts per IP within the window (in-memory MVP). */
    LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
    /** Login rate-limit window in milliseconds (default 15 minutes). */
    LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
    OLLAMA_ENABLED: booleanFromString.default(false),
    OLLAMA_BASE_URL: z.string().url().default('http://localhost:11434'),
    /** Default matches local/Compose phi4 path; override via OLLAMA_MODEL. */
    OLLAMA_MODEL: z.string().min(1).default('phi4'),
    /**
     * Shortage severity thresholds (docs/08, docs/15 — API owns business thresholds).
     * Absolute projected gap (predicted − available) in units.
     */
    ALERT_SEVERITY_LOW_MIN: z.coerce.number().min(0).default(0.01),
    ALERT_SEVERITY_MEDIUM_MIN: z.coerce.number().min(0).default(10),
    ALERT_SEVERITY_HIGH_MIN: z.coerce.number().min(0).default(25),
    ALERT_SEVERITY_CRITICAL_MIN: z.coerce.number().min(0).default(50),
})

export type AppEnv = z.infer<typeof envSchema>

export type EnvSource = Record<string, string | undefined>

function readProcessEnv(): EnvSource {
    const bunEnv = typeof Bun !== 'undefined' ? Bun.env : undefined
    const processEnv =
        typeof process !== 'undefined' ? (process.env as EnvSource | undefined) : undefined
    return { ...(processEnv ?? {}), ...(bunEnv ?? {}) }
}

/**
 * Parse environment with safe defaults. Does not throw on missing optional vars.
 * Throws ZodError only when a provided value is invalid (e.g. non-numeric port).
 */
export function loadEnv(source: EnvSource = readProcessEnv()): AppEnv {
    const portFallback = source.API_PORT ?? source.PORT
    const result = envSchema.safeParse({
        ...source,
        API_PORT: portFallback,
    })

    if (!result.success) {
        const summary = (result.error.issues ?? [])
            .map((issue) => `${issue.path?.join('.') ?? 'env'}: ${issue.message}`)
            .join('; ')
        throw new Error(`Invalid environment configuration: ${summary || 'unknown error'}`)
    }

    return result.data
}

let cachedEnv: AppEnv | undefined

/** Cached singleton env for request path; call loadEnv() when you need a fresh parse. */
export function getEnv(): AppEnv {
    if (!cachedEnv) {
        cachedEnv = loadEnv()
    }
    return cachedEnv
}

/** Test helper to clear cached env. */
export function resetEnvCache(): void {
    cachedEnv = undefined
}
