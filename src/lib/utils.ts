import { format, formatDistanceToNow } from 'date-fns'
import type { DocumentStatus } from '@/types'

export function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return format(d, 'MMM d, yyyy')
}

export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return format(d, 'MMM d, yyyy h:mm a')
}

export function formatRelative(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  return formatDistanceToNow(d, { addSuffix: true })
}

export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ')
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str
  return str.slice(0, maxLength) + '...'
}

export function getStatusColor(status: DocumentStatus): string {
  switch (status) {
    case 'submitted':
      return 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200'
    case 'extracted':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300'
    case 'validated':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
    case 'needs_review':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300'
    case 'corrected':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300'
    case 'approved':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300'
    case 'rejected':
      return 'bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300'
    default:
      return 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200'
  }
}

export function getStatusLabel(status: DocumentStatus): string {
  switch (status) {
    case 'submitted':
      return 'Submitted'
    case 'extracted':
      return 'Extracted'
    case 'validated':
      return 'Validated'
    case 'needs_review':
      return 'Needs Review'
    case 'corrected':
      return 'Corrected'
    case 'approved':
      return 'Approved'
    case 'rejected':
      return 'Rejected'
    default:
      return status
  }
}

export function isValidLrn(lrn: string): boolean {
  // LRN is exactly 12 digits
  return /^\d{12}$/.test(lrn)
}
