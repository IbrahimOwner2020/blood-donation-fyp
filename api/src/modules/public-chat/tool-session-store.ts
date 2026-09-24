const DEFAULT_TTL_MS = 2 * 60 * 1000

export type PublicChatToolSession = {
  token: string
  requestId: string | null
  expiresAt: number
}

export class PublicChatToolSessionStore {
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly sessions = new Map<string, PublicChatToolSession>()

  constructor(options: { ttlMs?: number; now?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.now = options.now ?? Date.now
  }

  create(input: { requestId?: string | null } = {}): PublicChatToolSession {
    this.prune()
    const token = randomToken()
    const session: PublicChatToolSession = {
      token,
      requestId: input.requestId ?? null,
      expiresAt: this.now() + this.ttlMs,
    }
    this.sessions.set(token, session)
    return session
  }

  get(token: string): PublicChatToolSession | null {
    this.prune()
    const session = this.sessions.get(token)
    if (!session || session.expiresAt <= this.now()) {
      if (session) this.sessions.delete(token)
      return null
    }
    return session
  }

  prune(): void {
    const now = this.now()
    for (const [token, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) this.sessions.delete(token)
    }
  }
}

function randomToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `pct_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

export const publicChatToolSessionStore = new PublicChatToolSessionStore()
