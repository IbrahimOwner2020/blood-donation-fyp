/**
 * Central Hono onError handler — maps AppError / unknown errors to { data, error }.
 */

import type { ErrorHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { AppError, ErrorCodes } from '../lib/errors'
import { logError } from '../lib/logger'
import { failure, failureFromAppError } from '../lib/response'
import type { AppHonoEnv } from '../lib/types'

function getRequestId(c: Parameters<ErrorHandler<AppHonoEnv>>[1]): string | undefined {
    try {
        return c.get('requestId')
    } catch {
        return undefined
    }
}

export const errorHandler: ErrorHandler<AppHonoEnv> = (err, c) => {
    const requestId = getRequestId(c)
    const path = c.req?.path
    const method = c.req?.method

    if (AppError.isAppError(err)) {
        if (err.status >= 500) {
            logError({
                requestId,
                method,
                path,
                status: err.status,
                message: err.message,
                error: err,
            })
        }
        return c.json(failureFromAppError(err), err.status as ContentfulStatusCode)
    }

    logError({
        requestId,
        method,
        path,
        status: 500,
        message: err instanceof Error ? err.message : 'Unhandled error',
        error: err,
    })

    const isProduction = (typeof Bun !== 'undefined' ? Bun.env?.NODE_ENV : undefined) === 'production'
    const message = isProduction
        ? 'Internal server error'
        : err instanceof Error
          ? err.message
          : 'Internal server error'

    return c.json(failure(ErrorCodes.INTERNAL_ERROR, message), 500)
}
