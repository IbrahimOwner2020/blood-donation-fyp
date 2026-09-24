import { z } from 'zod'

import type { Db } from '../../db'
import { AppError } from '../../lib/errors'
import { listDonationCentres } from '../donation-centres/service'
import { PUBLIC_DONATION_KNOWLEDGE } from './knowledge'

export type PublicChatToolDescriptor = {
  name: string
  description: string
  mutates: false
  inputSchema: Record<string, unknown>
}

const guidanceInputSchema = z.object({
  topic: z.enum(['age', 'weight', 'waiting_period', 'location', 'safety', 'all']).optional().default('all'),
}).strict()

const centreSearchInputSchema = z.object({
  region: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().min(1).max(120).optional(),
  ),
}).strict()

const TOPIC_INDEX = {
  age: 0,
  weight: 1,
  waiting_period: 2,
  location: 3,
  safety: 4,
} as const

export function listPublicChatTools(): PublicChatToolDescriptor[] {
  return [
    {
      name: 'donation_guidance.lookup',
      description: 'Retrieve approved blood-donation guidance. Use this before answering factual eligibility, waiting-period, location, or safety questions.',
      mutates: false,
      inputSchema: {
        type: 'object',
        properties: {
          topic: { type: 'string', enum: ['age', 'weight', 'waiting_period', 'location', 'safety', 'all'] },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'donation_centres.search',
      description: 'Find active donation centres, optionally for an exact region. Returns public centre names, regions, and addresses only.',
      mutates: false,
      inputSchema: {
        type: 'object',
        properties: { region: { type: 'string', maxLength: 120 } },
        additionalProperties: false,
      },
    },
  ]
}

export async function callPublicChatTool(
  db: Db,
  name: string,
  rawArguments: Record<string, unknown>,
): Promise<unknown> {
  if (name === 'donation_guidance.lookup') {
    const { topic } = guidanceInputSchema.parse(rawArguments)
    const entries = topic === 'all'
      ? PUBLIC_DONATION_KNOWLEDGE
      : [PUBLIC_DONATION_KNOWLEDGE[TOPIC_INDEX[topic]]]
    return {
      topic,
      guidance: entries.map((entry) => ({ en: entry.en, sw: entry.sw })),
      medicalClearance: false,
      screeningRequired: true,
    }
  }

  if (name === 'donation_centres.search') {
    const { region } = centreSearchInputSchema.parse(rawArguments)
    const centres = await listDonationCentres(db, { active: true, region })
    const bounded = centres.slice(0, 10).map(({ id, name: centreName, region: centreRegion, address }) => ({
      id,
      name: centreName,
      region: centreRegion,
      address,
    }))
    return { centres: bounded, total: centres.length, truncated: centres.length > bounded.length }
  }

  throw AppError.badRequest('Unknown public chat tool')
}
