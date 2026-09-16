import type { ExtractedFields } from './documents'

export type { ExtractedFields }

export type ValidationRuleResult = {
  ruleName: string
  fieldName: Extract<keyof ExtractedFields, string>
  passed: boolean
  expectedValue?: string
  actualValue?: any
  message: string
  severity?: 'error' | 'warning' | 'pass'
}

export type ValidationReport = {
  status: 'valid' | 'needs_review' | 'invalid'
  results: ValidationRuleResult[]
  passCount: number
  failCount: number
  totalRules: number
}

export type ValidationRule = {
  name: string
  field: Extract<keyof ExtractedFields, string>
  message: string
  severity: "error" | "warning"
  check: (value: string, context: ValidationContext) => boolean
}

export type ValidationContext = {
  knownSchools: string[]
  allFields: ExtractedFields
  ocrConfidence: number
}
