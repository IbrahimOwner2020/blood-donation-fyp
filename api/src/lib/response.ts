/**
 * Success / error JSON envelopes for /api/v1.
 * Shape: { data, error } per docs/04-api-specification.md.
 */

import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import { AppError, type ErrorCode, type ErrorDetail } from './errors'

export type ApiSuccessEnvelope<T> = {
    data: T
    error: null
}

export type ApiErrorBody = {
    code: ErrorCode
    message: string
    details: ErrorDetail[]
}

export type ApiErrorEnvelope = {
    data: null
    error: ApiErrorBody
}

export type ApiEnvelope<T> = ApiSuccessEnvelope<T> | ApiErrorEnvelope

export function success<T>(data: T): ApiSuccessEnvelope<T> {
    return {
        data,
        error: null,
    }
}

export function failure(
    code: ErrorCode,
    message: string,
    details: ErrorDetail[] = [],
): ApiErrorEnvelope {
    return {
        data: null,
        error: {
            code,
            message,
            details,
        },
    }
}

export function failureFromAppError(error: AppError): ApiErrorEnvelope {
    return failure(error.code, error.message, error.details ?? [])
}

/** Write a success envelope with optional status (default 200). */
export function jsonOk<T>(c: Context, data: T, status: ContentfulStatusCode = 200) {
    return c.json(success(data), status)
}

/** Write an error envelope from an AppError. */
export function jsonError(c: Context, error: AppError) {
    return c.json(failureFromAppError(error), error.status as ContentfulStatusCode)
}
