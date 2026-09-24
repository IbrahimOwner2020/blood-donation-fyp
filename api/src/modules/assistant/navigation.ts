import { z } from 'zod'

import type { PermissionCode } from '../../lib/permissions'

export const ASSISTANT_NAVIGATION_PATHS = [
  '/dashboard',
  '/my-donor-profile',
  '/donors',
  '/donations',
  '/inventory',
  '/blood-requests',
  '/notifications',
  '/reports',
  '/admin/users',
  '/admin/facilities',
  '/admin/activity',
] as const

export type AssistantNavigationPath = (typeof ASSISTANT_NAVIGATION_PATHS)[number]

export type AssistantNavigationTarget = {
  keywords: readonly string[]
  path: AssistantNavigationPath
  label: string
  permission?: PermissionCode
}

export const ASSISTANT_NAVIGATION_TARGETS: readonly AssistantNavigationTarget[] = [
  { keywords: ['dashboard', 'overview', 'home'], path: '/dashboard', label: 'dashboard', permission: 'reports:read' },
  { keywords: ['my donor profile', 'donor profile', 'profile'], path: '/my-donor-profile', label: 'donor profile' },
  { keywords: ['donor', 'donors'], path: '/donors', label: 'donors', permission: 'donors:read' },
  { keywords: ['donation', 'donations'], path: '/donations', label: 'donations', permission: 'donations:read' },
  { keywords: ['inventory', 'stock', 'units', 'alert', 'alerts'], path: '/inventory', label: 'inventory', permission: 'inventory:read' },
  { keywords: ['request', 'requests'], path: '/blood-requests', label: 'blood requests', permission: 'requests:read' },
  { keywords: ['notify', 'notification', 'notifications'], path: '/notifications', label: 'notifications', permission: 'notifications:read' },
  { keywords: ['report', 'reports', 'forecast', 'prediction'], path: '/reports', label: 'reports', permission: 'reports:read' },
  { keywords: ['users', 'user admin'], path: '/admin/users', label: 'users', permission: 'users:manage' },
  { keywords: ['facility', 'facilities'], path: '/admin/facilities', label: 'facilities', permission: 'facilities:read' },
  { keywords: ['activity', 'audit'], path: '/admin/activity', label: 'activity', permission: 'activity:read' },
]

export const assistantNavigationPathSchema = z.enum(ASSISTANT_NAVIGATION_PATHS)

const ASSISTANT_NAVIGATION_ALIASES: Readonly<Record<string, AssistantNavigationPath>> = {
  '/facilities': '/admin/facilities',
  '/alerts': '/inventory',
  '/predictions': '/reports',
}

export function findAssistantNavigationTarget(
  path: string,
): AssistantNavigationTarget | undefined {
  return ASSISTANT_NAVIGATION_TARGETS.find((target) => target.path === path)
}

export function resolveAssistantNavigationTarget(
  path: string,
): AssistantNavigationTarget | undefined {
  const canonicalPath = ASSISTANT_NAVIGATION_ALIASES[path] ?? path
  return findAssistantNavigationTarget(canonicalPath)
}
