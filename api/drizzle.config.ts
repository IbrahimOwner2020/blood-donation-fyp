import { defineConfig } from 'drizzle-kit'

/**
 * Drizzle Kit config for MariaDB (MySQL dialect).
 * Credentials mirror docs/15-environment-and-configuration.md.
 * Local host overrides: use DB_HOST=127.0.0.1 when running outside Docker.
 */
export default defineConfig({
    dialect: 'mysql',
    schema: './src/db/schema/index.ts',
    out: './drizzle',
    strict: true,
    verbose: true,
    dbCredentials: {
        host: process.env.DB_HOST ?? '127.0.0.1',
        port: Number(process.env.DB_PORT ?? 3306),
        user: process.env.DB_USER ?? 'nbts',
        password: process.env.DB_PASSWORD ?? 'change-me',
        database: process.env.DB_NAME ?? 'nbts_blood_ai',
    },
})
