import type { AssistantActionProposal } from './service'

const DEFAULT_TTL_MS = 5 * 60 * 1000

type StoredAction = AssistantActionProposal & {
  userId: number
  sessionId: string
  expiresAt: number
}

export class AssistantActionStore {
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly actions = new Map<string, StoredAction>()

  constructor(options: { ttlMs?: number; now?: () => number } = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS
    this.now = options.now ?? Date.now
  }

  put(
    proposal: AssistantActionProposal,
    owner: { userId: number; sessionId: string },
  ): AssistantActionProposal {
    this.prune()
    this.actions.set(proposal.id, {
      ...proposal,
      userId: owner.userId,
      sessionId: owner.sessionId,
      expiresAt: this.now() + this.ttlMs,
    })
    return proposal
  }

  take(
    id: string,
    owner: { userId: number; sessionId: string },
  ): AssistantActionProposal | null {
    this.prune()
    const stored = this.actions.get(id)
    if (!stored) {
      return null
    }
    if (stored.userId !== owner.userId || stored.sessionId !== owner.sessionId) {
      return null
    }
    this.actions.delete(id)
    const { userId: _userId, sessionId: _sessionId, expiresAt: _expiresAt, ...proposal } = stored
    return proposal
  }

  prune(): void {
    const now = this.now()
    for (const [id, action] of this.actions.entries()) {
      if (action.expiresAt <= now) {
        this.actions.delete(id)
      }
    }
  }
}

export const assistantActionStore = new AssistantActionStore()
