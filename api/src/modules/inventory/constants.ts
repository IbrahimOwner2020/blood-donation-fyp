/**
 * Prototype inventory thresholds (docs/08, docs/15 — API owns business thresholds).
 * Query params may override per request; these are safe defaults.
 */

/** Available (non-expired) units at or below this count → low-stock. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5

/** Units with expiry in [asOf, asOf + N] days are "expiring soon". */
export const DEFAULT_EXPIRING_WITHIN_DAYS = 7
