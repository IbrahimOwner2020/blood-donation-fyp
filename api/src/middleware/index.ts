export { requestIdMiddleware } from './request-id'
export { errorHandler } from './error-handler'
export {
    createRequestLogger,
    requestLoggerMiddleware,
    type RequestLoggerOptions,
} from './request-logger'
/** Session-only gate; does not load RBAC. */
export { requireAuth } from './require-auth'
/** RBAC: attach roles/permissions and gate by permission code. */
export {
    attachUserAccess,
    createRequirePermission,
    requirePermission,
    type RequirePermissionOptions,
} from './require-permission'
export {
    createRateLimit,
    createLoginRateLimit,
    clientIpKey,
    type RateLimitOptions,
    type RateLimitBucket,
    type RateLimitMiddleware,
} from './rate-limit'
export {
    createCsrfProtection,
    csrfProtection,
    parseTrustedOrigins,
    resolveRequestOrigin,
    isTrustedOrigin,
    type CsrfOptions,
} from './csrf'
export {
    createCorsMiddleware,
    corsMiddleware,
    type CorsOptions,
} from './cors'
