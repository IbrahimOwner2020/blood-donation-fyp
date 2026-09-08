/**
 * Request logging helpers with sensitive-field redaction.
 * Passwords, tokens, and donor contact fields must not appear in logs
 * (docs/10-auth-security-and-rbac.md).
 */

const DEFAULT_SENSITIVE_KEYS = new Set([
    'password',
    'password_hash',
    'passwordhash',
    'token',
    'access_token',
    'refresh_token',
    'secret',
    'session_secret',
    'session_id',
    'sessionid',
    'nbts_session',
    'csrf',
    'csrf_token',
    'authorization',
    'cookie',
    'set_cookie',
    'phone',
    'phone_number',
    'email',
    'recipient',
    'to',
    'otp',
    'api_key',
    'db_password',
    'db_root_password',
])

const REDACTED = '[REDACTED]'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type RequestLogFields = {
    requestId?: string
    method?: string
    path?: string
    status?: number
    durationMs?: number
    message?: string
    error?: unknown
    meta?: Record<string, unknown>
}

function normalizeKey(key: string): string {
    return key
        .trim()
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
}

function isSensitiveKey(key: string, extraKeys: string[] = []): boolean {
    const normalized = normalizeKey(key)
    if (DEFAULT_SENSITIVE_KEYS.has(normalized)) {
        return true
    }
    return extraKeys.some((extra) => normalizeKey(extra) === normalized)
}

/**
 * Deep-clone and redact sensitive keys from plain objects/arrays.
 * Non-JSON values (functions, symbols) are omitted.
 */
export function redactSensitive(
    value: unknown,
    extraSensitiveKeys: string[] = [],
    seen: WeakSet<object> = new WeakSet(),
): unknown {
    if (value === null || value === undefined) {
        return value
    }

    if (typeof value !== 'object') {
        return value
    }

    if (seen.has(value as object)) {
        return '[Circular]'
    }
    seen.add(value as object)

    if (Array.isArray(value)) {
        return value.map((item) => redactSensitive(item, extraSensitiveKeys, seen))
    }

    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack,
        }
    }

    const output: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        if (isSensitiveKey(key, extraSensitiveKeys)) {
            output[key] = REDACTED
            continue
        }
        output[key] = redactSensitive(nested, extraSensitiveKeys, seen)
    }
    return output
}

function writeLog(level: LogLevel, fields: RequestLogFields, extraSensitiveKeys: string[] = []): void {
    const payload = redactSensitive(
        {
            level,
            time: new Date().toISOString(),
            requestId: fields.requestId,
            method: fields.method,
            path: fields.path,
            status: fields.status,
            durationMs: fields.durationMs,
            message: fields.message,
            error: fields.error,
            ...(fields.meta ?? {}),
        },
        extraSensitiveKeys,
    )

    const line = JSON.stringify(payload)
    if (level === 'error') {
        console.error(line)
        return
    }
    if (level === 'warn') {
        console.warn(line)
        return
    }
    console.log(line)
}

export function logRequest(fields: RequestLogFields, extraSensitiveKeys: string[] = []): void {
    writeLog('info', { message: 'request', ...fields }, extraSensitiveKeys)
}

export function logError(fields: RequestLogFields, extraSensitiveKeys: string[] = []): void {
    writeLog('error', { message: fields.message ?? 'error', ...fields }, extraSensitiveKeys)
}

export function logInfo(message: string, meta: Record<string, unknown> = {}): void {
    writeLog('info', { message, meta })
}

export function logWarn(message: string, meta: Record<string, unknown> = {}): void {
    writeLog('warn', { message, meta })
}

export function logDebug(message: string, meta: Record<string, unknown> = {}): void {
    writeLog('debug', { message, meta })
}
