import type { PermissionCode } from '../../lib/permissions'

const DEFAULT_TTL_MS = 2 * 60 * 1000

export type AssistantToolSession = {
  token: string
  userId: number
  sessionId: string
  permissions: readonly PermissionCode[]
  requestId: string | null
  expiresAt: number
}

export class AssistantToolSessionStore {
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly sessions = new Map<string, AssistantToolSession>()

  constructor(options: { ttlMs?: number; now?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.now = options.now ?? Date.now
  }

  create(input: {
    userId: number
    sessionId: string
    permissions: readonly PermissionCode[]
    requestId?: string | null
  }): AssistantToolSession {
    this.prune()
    const token = randomToken()
    const session: AssistantToolSession = {
      token,
      userId: input.userId,
      sessionId: input.sessionId,
      permissions: input.permissions,
      requestId: input.requestId ?? null,
      expiresAt: this.now() + this.ttlMs,
    }
    this.sessions.set(token, session)
    return session
  }

  get(token: string): AssistantToolSession | null {
    this.prune()
    const session = this.sessions.get(token)
    if (!session || session.expiresAt <= this.now()) {
      if (session) {
        this.sessions.delete(token)
      }
      return null
    }
    return session
  }

  prune(): void {
    const now = this.now()
    for (const [token, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) {
        this.sessions.delete(token)
      }
    }
  }
}

function randomToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `ast_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

export const assistantToolSessionStore = new AssistantToolSessionStore()
