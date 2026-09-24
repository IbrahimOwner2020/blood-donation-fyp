/**
 * Canonical API error codes and AppError for the { data, error } envelope.
 * See docs/04-api-specification.md.
 */

export const ErrorCodes = {
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    BAD_REQUEST: 'BAD_REQUEST',
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    NOT_FOUND: 'NOT_FOUND',
    CONFLICT: 'CONFLICT',
    RATE_LIMITED: 'RATE_LIMITED',
    PUBLIC_CHAT_UNAVAILABLE: 'PUBLIC_CHAT_UNAVAILABLE',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes]

export type ErrorDetail = {
    path?: string
    message: string
    code?: string
}

export type AppErrorOptions = {
    code?: ErrorCode
    status?: number
    details?: ErrorDetail[]
    cause?: unknown
}

const DEFAULT_STATUS_BY_CODE: Record<ErrorCode, number> = {
    VALIDATION_ERROR: 400,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    RATE_LIMITED: 429,
    PUBLIC_CHAT_UNAVAILABLE: 503,
    INTERNAL_ERROR: 500,
}

export class AppError extends Error {
    readonly code: ErrorCode
    readonly status: number
    readonly details: ErrorDetail[]

    constructor(message: string, options: AppErrorOptions = {}) {
        super(message, options.cause !== undefined ? { cause: options.cause } : undefined)
        this.name = 'AppError'
        this.code = options.code ?? ErrorCodes.INTERNAL_ERROR
        this.status = options.status ?? DEFAULT_STATUS_BY_CODE[this.code] ?? 500
        this.details = options.details ?? []
    }

    static validation(message = 'Invalid request', details: ErrorDetail[] = []): AppError {
        return new AppError(message, {
            code: ErrorCodes.VALIDATION_ERROR,
            status: 400,
            details,
        })
    }

    static badRequest(message = 'Bad request', details: ErrorDetail[] = []): AppError {
        return new AppError(message, {
            code: ErrorCodes.BAD_REQUEST,
            status: 400,
            details,
        })
    }

    static unauthorized(message = 'Unauthorized'): AppError {
        return new AppError(message, {
            code: ErrorCodes.UNAUTHORIZED,
            status: 401,
        })
    }

    static forbidden(message = 'Forbidden'): AppError {
        return new AppError(message, {
            code: ErrorCodes.FORBIDDEN,
            status: 403,
        })
    }

    static notFound(message = 'Not found'): AppError {
        return new AppError(message, {
            code: ErrorCodes.NOT_FOUND,
            status: 404,
        })
    }

    static conflict(message = 'Conflict', details: ErrorDetail[] = []): AppError {
        return new AppError(message, {
            code: ErrorCodes.CONFLICT,
            status: 409,
            details,
        })
    }

    static rateLimited(message = 'Too many requests. Try again later.'): AppError {
        return new AppError(message, {
            code: ErrorCodes.RATE_LIMITED,
            status: 429,
        })
    }

    static publicChatUnavailable(
        message = 'The donation assistant is temporarily unavailable. Please try again shortly.',
        cause?: unknown,
    ): AppError {
        return new AppError(message, {
            code: ErrorCodes.PUBLIC_CHAT_UNAVAILABLE,
            status: 503,
            cause,
        })
    }

    static internal(message = 'Internal server error', cause?: unknown): AppError {
        return new AppError(message, {
            code: ErrorCodes.INTERNAL_ERROR,
            status: 500,
            cause,
        })
    }

    static isAppError(value: unknown): value is AppError {
        return value instanceof AppError
    }
}
