/**
 * Assigns a request id (from X-Request-Id or generated) and echoes it on the response.
 */

import { createMiddleware } from 'hono/factory'

import type { AppHonoEnv } from '../lib/types'

const REQUEST_ID_HEADER = 'X-Request-Id'

function createRequestId(): string {
    if (typeof crypto?.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

export const requestIdMiddleware = createMiddleware<AppHonoEnv>(async (c, next) => {
    const incoming = c.req.header(REQUEST_ID_HEADER)?.trim()
    const requestId = incoming && incoming.length > 0 ? incoming : createRequestId()

    c.set('requestId', requestId)
    c.set('requestStartedAt', Date.now())
    c.header(REQUEST_ID_HEADER, requestId)

    await next()
})
