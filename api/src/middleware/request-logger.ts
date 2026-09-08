/**
 * Structured request logging middleware with sensitive-field redaction hooks.
 */

import { createMiddleware } from 'hono/factory'

import { logRequest } from '../lib/logger'
import type { AppHonoEnv } from '../lib/types'

export type RequestLoggerOptions = {
    /** Additional keys to redact from any attached meta (beyond defaults). */
    extraSensitiveKeys?: string[]
    /** Skip logging for these path prefixes (e.g. noisy probes). Default: none. */
    skipPaths?: string[]
}

export function createRequestLogger(options: RequestLoggerOptions = {}) {
    const extraSensitiveKeys = options.extraSensitiveKeys ?? []
    const skipPaths = options.skipPaths ?? []

    return createMiddleware<AppHonoEnv>(async (c, next) => {
        const path = c.req.path ?? ''
        const shouldSkip = skipPaths.some((prefix) => path === prefix || path.startsWith(prefix))

        await next()

        if (shouldSkip) {
            return
        }

        const startedAt = c.get('requestStartedAt') ?? Date.now()
        const durationMs = Math.max(0, Date.now() - startedAt)

        logRequest(
            {
                requestId: c.get('requestId'),
                method: c.req.method,
                path,
                status: c.res?.status,
                durationMs,
            },
            extraSensitiveKeys,
        )
    })
}

/** Default request logger used by the API bootstrap. */
export const requestLoggerMiddleware = createRequestLogger()
