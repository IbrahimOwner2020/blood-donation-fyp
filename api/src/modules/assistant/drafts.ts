import { eq } from 'drizzle-orm'
import type { ZodTypeAny } from 'zod'

import type { Db } from '../../db/client'
import { bloodGroups, donationCentres, healthcareFacilities } from '../../db/schema'
import { createBloodRequestBodySchema } from '../blood-requests/schemas'
import { createDonationBodySchema } from '../donations/schemas'
import { createDonorBodySchema } from '../donors/schemas'
import type { AssistantBlock } from './schemas'

export type AssistantDraftWorkflow = 'donor.create' | 'donation.create' | 'blood_request.create'

type FieldDefinition = {
  name: string
  label: { en: string; sw: string }
  inputType: 'text' | 'number' | 'date' | 'datetime-local' | 'select' | 'checkbox'
  required: boolean
  options?: 'bloodGroups' | 'centres' | 'facilities' | Array<{ value: string; label: string }>
}

type WorkflowDefinition = {
  title: { en: string; sw: string }
  permission: 'donors:create' | 'donations:create' | 'requests:create'
  schema: ZodTypeAny
  fields: FieldDefinition[]
}

const WORKFLOWS: Record<AssistantDraftWorkflow, WorkflowDefinition> = {
  'donor.create': {
    title: { en: 'Register donor', sw: 'Sajili mfadhili' },
    permission: 'donors:create',
    schema: createDonorBodySchema,
    fields: [
      { name: 'firstName', label: { en: 'First name', sw: 'Jina la kwanza' }, inputType: 'text', required: true },
      { name: 'lastName', label: { en: 'Last name', sw: 'Jina la mwisho' }, inputType: 'text', required: true },
      { name: 'phone', label: { en: 'Phone', sw: 'Simu' }, inputType: 'text', required: true },
      { name: 'email', label: { en: 'Email', sw: 'Barua pepe' }, inputType: 'text', required: true },
      { name: 'dateOfBirth', label: { en: 'Date of birth', sw: 'Tarehe ya kuzaliwa' }, inputType: 'date', required: true },
      { name: 'sex', label: { en: 'Sex', sw: 'Jinsia' }, inputType: 'select', required: true, options: [{ value: 'MALE', label: 'Male / Mwanaume' }, { value: 'FEMALE', label: 'Female / Mwanamke' }] },
      { name: 'address', label: { en: 'Address', sw: 'Anwani' }, inputType: 'text', required: true },
      { name: 'weightKg', label: { en: 'Weight (kg)', sw: 'Uzito (kg)' }, inputType: 'number', required: true },
      { name: 'bloodGroupId', label: { en: 'Blood group', sw: 'Kundi la damu' }, inputType: 'select', required: true, options: 'bloodGroups' },
      { name: 'smsConsent', label: { en: 'SMS consent', sw: 'Ridhaa ya SMS' }, inputType: 'checkbox', required: false },
      { name: 'emailConsent', label: { en: 'Email consent', sw: 'Ridhaa ya barua pepe' }, inputType: 'checkbox', required: false },
    ],
  },
  'donation.create': {
    title: { en: 'Record donation', sw: 'Rekodi mchango wa damu' },
    permission: 'donations:create',
    schema: createDonationBodySchema,
    fields: [
      { name: 'donorId', label: { en: 'Donor ID', sw: 'Namba ya mfadhili' }, inputType: 'number', required: true },
      { name: 'donationCentreId', label: { en: 'Donation centre', sw: 'Kituo cha uchangiaji' }, inputType: 'select', required: true, options: 'centres' },
      { name: 'bloodGroupId', label: { en: 'Blood group', sw: 'Kundi la damu' }, inputType: 'select', required: true, options: 'bloodGroups' },
      { name: 'donationDate', label: { en: 'Donation date', sw: 'Tarehe ya mchango' }, inputType: 'date', required: true },
      { name: 'weightKgAtDonation', label: { en: 'Weight at donation (kg)', sw: 'Uzito wakati wa mchango (kg)' }, inputType: 'number', required: true },
      { name: 'units', label: { en: 'Units', sw: 'Vipimo' }, inputType: 'number', required: true },
      { name: 'facilityId', label: { en: 'Facility', sw: 'Kituo cha afya' }, inputType: 'select', required: false, options: 'facilities' },
      { name: 'notes', label: { en: 'Notes', sw: 'Maelezo' }, inputType: 'text', required: false },
    ],
  },
  'blood_request.create': {
    title: { en: 'Create blood request', sw: 'Tengeneza ombi la damu' },
    permission: 'requests:create',
    schema: createBloodRequestBodySchema,
    fields: [
      { name: 'facilityId', label: { en: 'Facility', sw: 'Kituo cha afya' }, inputType: 'select', required: true, options: 'facilities' },
      { name: 'bloodGroupId', label: { en: 'Blood group', sw: 'Kundi la damu' }, inputType: 'select', required: true, options: 'bloodGroups' },
      { name: 'unitsRequested', label: { en: 'Units requested', sw: 'Vipimo vinavyoombwa' }, inputType: 'number', required: true },
      { name: 'priority', label: { en: 'Priority', sw: 'Kipaumbele' }, inputType: 'select', required: false, options: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((value) => ({ value, label: value })) },
      { name: 'requestedAt', label: { en: 'Requested at', sw: 'Muda wa ombi' }, inputType: 'datetime-local', required: true },
      { name: 'requiredAt', label: { en: 'Required at', sw: 'Muda unaohitajika' }, inputType: 'datetime-local', required: false },
    ],
  },
}

export function detectDraftWorkflow(message: string): AssistantDraftWorkflow | null {
  const text = message.toLowerCase()
  if (/\b(register|create|add|sajili|ongeza)\b/.test(text) && /\b(donor|mfadhili)\b/.test(text)) return 'donor.create'
  if (/\b(record|create|add|rekodi|ongeza)\b/.test(text) && /\b(donation|mchango)\b/.test(text)) return 'donation.create'
  if (/\b(create|add|request|tengeneza|omba)\b/.test(text) && /\b(blood request|request|ombi|maombi)\b/.test(text)) return 'blood_request.create'
  return null
}

export function workflowPermission(workflow: AssistantDraftWorkflow) {
  return WORKFLOWS[workflow].permission
}

export function extractDraftValues(workflow: AssistantDraftWorkflow, message: string): Record<string, unknown> {
  const values: Record<string, unknown> = {}
  const bloodGroup = message.toUpperCase().match(/(^|[^A-Z0-9])((?:AB|A|B|O)[+-])(?=$|[^A-Z0-9])/)?.[2]
  if (bloodGroup) values.bloodGroup = bloodGroup
  const units = Number(message.match(/\b(\d+)\s*(?:unit|units|kipimo|vipimo)\b/i)?.[1] ?? 0)
  if (units > 0) values[workflow === 'blood_request.create' ? 'unitsRequested' : 'units'] = units
  const email = message.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]
  if (email) values.email = email
  const phone = message.match(/(?:\+?255|0)\s*\d(?:[\s-]*\d){8}/)?.[0]
  if (phone) values.phone = phone.replace(/[\s-]/g, '')
  return values
}

function normalizeValues(workflow: AssistantDraftWorkflow, input: Record<string, unknown>) {
  const values = { ...input }
  for (const key of ['bloodGroupId', 'weightKg', 'weightKgAtDonation', 'donorId', 'donationCentreId', 'units', 'facilityId', 'unitsRequested']) {
    if (typeof values[key] === 'string' && values[key] !== '') values[key] = Number(values[key])
    if (values[key] === '') delete values[key]
  }
  for (const key of ['smsConsent', 'emailConsent']) {
    if (typeof values[key] === 'string') values[key] = values[key] === 'true' || values[key] === '1' || values[key] === 'on'
  }
  if (workflow === 'donation.create') values.newDonor = undefined
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
}

export function validateDraftValues(workflow: AssistantDraftWorkflow, input: Record<string, unknown>) {
  const values = normalizeValues(workflow, input)
  const parsed = WORKFLOWS[workflow].schema.safeParse(values)
  if (parsed.success) return { success: true as const, values: parsed.data as Record<string, unknown>, missingFields: [], errors: {} }
  const errors: Record<string, string> = {}
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? 'form')
    if (!errors[key]) errors[key] = issue.message
  }
  const required = WORKFLOWS[workflow].fields.filter((field) => field.required).map((field) => field.name)
  const missingFields = required.filter((key) => values[key] === undefined || values[key] === null || values[key] === '')
  return { success: false as const, values, missingFields, errors }
}

export async function buildDraftFormBlock(
  db: Db,
  input: {
    draftId: string
    workflow: AssistantDraftWorkflow
    values: Record<string, unknown>
    missingFields: string[]
    errors?: Record<string, string> | null
    language: 'en' | 'sw'
  },
): Promise<AssistantBlock> {
  const definition = WORKFLOWS[input.workflow]
  const [groups, centres, facilities] = await Promise.all([
    db.select({ id: bloodGroups.id, code: bloodGroups.code }).from(bloodGroups),
    db.select({ id: donationCentres.id, name: donationCentres.name }).from(donationCentres).where(eq(donationCentres.active, true)),
    db.select({ id: healthcareFacilities.id, name: healthcareFacilities.name }).from(healthcareFacilities).where(eq(healthcareFacilities.active, true)),
  ])
  const optionSets = {
    bloodGroups: groups.map((item) => ({ value: String(item.id), label: item.code })),
    centres: centres.map((item) => ({ value: String(item.id), label: item.name })),
    facilities: facilities.map((item) => ({ value: String(item.id), label: item.name })),
  }
  return {
    type: 'form',
    draftId: input.draftId,
    workflow: input.workflow,
    title: definition.title[input.language],
    missingFields: input.missingFields,
    fields: definition.fields.map((field) => ({
      name: field.name,
      label: field.label[input.language],
      inputType: field.inputType,
      required: field.required,
      value: input.values[field.name],
      ...(field.options
        ? { options: typeof field.options === 'string' ? optionSets[field.options] : field.options }
        : {}),
      ...(input.errors?.[field.name] ? { error: input.errors[field.name] } : {}),
    })),
  }
}
