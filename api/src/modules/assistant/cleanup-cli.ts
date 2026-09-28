import { closeDb, getDb } from '../../db'
import { cleanupExpiredAssistantData } from './persistence'

try {
  await cleanupExpiredAssistantData(getDb())
  console.log(JSON.stringify({ cleanup: 'assistant', status: 'ok' }))
} catch (error) {
  console.error(JSON.stringify({
    cleanup: 'assistant',
    status: 'failed',
    error: error instanceof Error ? error.message : 'unknown',
  }))
  process.exitCode = 1
} finally {
  await closeDb()
}
