import type { ExtractedFields } from './documents'

export type { ExtractedFields }

export type ValidationRuleResult = {
  ruleName?: string
  rule_name?: string
  name?: string
  ruleId?: string
  fieldName?: Extract<keyof ExtractedFields, string> | string
  field_name?: string | null
  field?: string
  passed: boolean
  expectedValue?: string
  expected_value?: string | null
  actualValue?: any
  actual_value?: any
  message?: string | null
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
  message: string | ((value: string, context: ValidationContext) => string)
  severity: "error" | "warning" | ((value: string, context: ValidationContext) => "error" | "warning")
  check: (value: string, context: ValidationContext) => boolean
}

export type ValidationContext = {
  knownSchools: string[]
  allFields: ExtractedFields
  ocrConfidence?: number
}
