import type { ExtractedFields } from './documents'

export type ValidationRuleResult = {
  ruleName: string
  fieldName: string
  passed: boolean
  expectedValue?: string
  actualValue?: string
  message: string
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
  field: keyof ExtractedFields
  message: string
  check: (value: string, context?: ValidationContext) => boolean | Promise<boolean>
}

export type ValidationContext = {
  knownSchools: string[]
  allFields: ExtractedFields
  ocrConfidence: number
}
