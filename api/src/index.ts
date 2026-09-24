import { Hono } from 'hono'

import { getEnv } from './lib/env'
import { jsonOk } from './lib/response'
import type { AppHonoEnv } from './lib/types'
import {
    corsMiddleware,
    csrfProtection,
    errorHandler,
    requestIdMiddleware,
    requestLoggerMiddleware,
} from './middleware'
import { activityLogRoutes } from './modules/activity-logs'
import { assistantRoutes } from './modules/assistant'
import { authRoutes } from './modules/auth'
import { bloodRequestRoutes } from './modules/blood-requests'
import { donationCentreRoutes } from './modules/donation-centres'
import { donationRoutes } from './modules/donations'
import { donorRoutes } from './modules/donors'
import { facilitiesRoutes } from './modules/facilities'
import { inventoryRoutes } from './modules/inventory'
import { inventoryAlertRoutes } from './modules/inventory-alerts'
import { meDonorRoutes } from './modules/me-donor'
import { notificationRoutes } from './modules/notifications'
import { reportRoutes } from './modules/reports'
import { roleRoutes, userRoutes } from './modules/users'
import { publicChatRoutes } from './modules/public-chat'

const env = getEnv()

const app = new Hono<AppHonoEnv>()

/** CORS first so preflight/OPTIONS succeed before other middleware. */
app.use('*', corsMiddleware)
app.use('*', requestIdMiddleware)
app.use('*', requestLoggerMiddleware)
app.onError(errorHandler)

app.get('/', (c) => {
    return jsonOk(c, {
        service: 'blood-donation-management-system',
        status: 'ok',
    })
})

app.get('/health', (c) => {
    return jsonOk(c, {
        service: 'api',
        status: 'ok',
    })
})

/** Versioned API mount — domain modules register here later. */
const v1 = new Hono<AppHonoEnv>()

/** CSRF: Origin/Referer allow-list on unsafe methods (pairs with SameSite=Strict cookies). */
v1.use('*', csrfProtection)

v1.get('/health', (c) => {
    return jsonOk(c, {
        service: 'api',
        status: 'ok',
        version: 'v1',
    })
})

v1.route('/public/chat', publicChatRoutes)

v1.route('/auth', authRoutes)
v1.route('/me/donor', meDonorRoutes)
v1.route('/users', userRoutes)
v1.route('/roles', roleRoutes)
/** Activity / audit log list — owned by activity-logs (activity:read). */
v1.route('/activity-logs', activityLogRoutes)
v1.route('/donation-centres', donationCentreRoutes)
/** Donor CRUD + soft deactivate — owned by donors-api. */
v1.route('/donors', donorRoutes)
/** Donation recording + create-path inventory units — owned by donations-api. */
v1.route('/donations', donationRoutes)
/** Inventory list/summary/expiry + status PATCH — owned by inventory-api. */
v1.route('/inventory', inventoryRoutes)
v1.route('/inventory-alerts', inventoryAlertRoutes)
/** Healthcare facilities — owned by facilities-api (do not collide with other domain mounts). */
v1.route('/facilities', facilitiesRoutes)
/** Blood requests + status machine — owned by blood-requests-api (demand_records is separate). */
v1.route('/blood-requests', bloodRequestRoutes)
/** Donor notification preview/send/history — owned by notifications-api. */
v1.route('/notifications', notificationRoutes)
/** Operational reports — owned by reports-api-web (not /dashboard/*). */
v1.route('/reports', reportRoutes)
/** Permissioned app assistant — proposes then confirms API-owned actions. */
v1.route('/assistant', assistantRoutes)

app.route('/api/v1', v1)

export default {
    port: env.API_PORT,
    fetch: app.fetch,
}

export { app, v1, env }
