/**
 * Zod validation helpers for Hono handlers.
 * Throws AppError VALIDATION_ERROR on failure — caught by error middleware.
 */

import type { Context } from 'hono'
import type { ZodError, ZodType } from 'zod'

import { AppError, type ErrorDetail } from './errors'

export type ValidationTarget = 'json' | 'query' | 'param'

function zodIssuesToDetails(error: ZodError): ErrorDetail[] {
    return (error.issues ?? []).map((issue) => ({
        path: issue.path?.length ? issue.path.map(String).join('.') : undefined,
        message: issue.message ?? 'Invalid value',
        code: issue.code,
    }))
}

/**
 * Parse unknown input with a Zod schema.
 * Prefer this in handlers for body/query/params already extracted.
 */
export function parseWithSchema<T>(schema: ZodType<T>, input: unknown, label = 'request'): T {
    const result = schema.safeParse(input)
    if (!result.success) {
        throw AppError.validation(`Invalid ${label}`, zodIssuesToDetails(result.error))
    }
    return result.data
}

/**
 * Read and validate JSON body against a Zod schema.
 */
export async function parseJsonBody<T>(c: Context, schema: ZodType<T>): Promise<T> {
    let body: unknown
    try {
        body = await c.req.json()
    } catch {
        throw AppError.validation('Invalid JSON body', [
            { message: 'Request body must be valid JSON' },
        ])
    }
    return parseWithSchema(schema, body, 'body')
}

/**
 * Validate query string object against a Zod schema.
 */
export function parseQuery<T>(c: Context, schema: ZodType<T>): T {
    return parseWithSchema(schema, c.req.query(), 'query')
}

/**
 * Validate route params against a Zod schema.
 */
export function parseParams<T>(c: Context, schema: ZodType<T>): T {
    return parseWithSchema(schema, c.req.param(), 'params')
}

/**
 * Factory middleware-style helper: validates a target and stores result on context.
 * Usage in a route: `await validateRequest(c, 'json', schema)` then use return value.
 */
export async function validateRequest<T>(
    c: Context,
    target: ValidationTarget,
    schema: ZodType<T>,
): Promise<T> {
    if (target === 'json') {
        return parseJsonBody(c, schema)
    }
    if (target === 'query') {
        return parseQuery(c, schema)
    }
    return parseParams(c, schema)
}
