/**
 * AVV System — Audit Event Type Definitions
 * 
 * Strict data contract for administrative activity monitoring and audit trails
 * conforming to DepEd accountability and Philippine Data Privacy Act principles.
 */

export type AuditCategory =
  | "AUTHENTICATION"
  | "REGISTRATION"
  | "USER_MANAGEMENT"
  | "DOCUMENT"
  | "OCR"
  | "COMPARISON"
  | "ACADEMIC"
  | "ATTENDANCE"
  | "REMEDIAL"
  | "ELIGIBILITY"
  | "REVIEW"
  | "REPORT"
  | "SECURITY"
  | "SYSTEM";

export type AuditAction =
  // Authentication
  | "AUTH_LOGIN_SUCCESS"
  | "AUTH_LOGIN_FAILED"
  | "AUTH_LOGOUT"
  | "AUTH_PENDING_REJECTED"
  | "AUTH_DECLINED_REJECTED"
  // Registration & User Management
  | "REGISTRATION_SUBMITTED"
  | "ACCOUNT_APPROVED"
  | "ACCOUNT_DECLINED"
  | "ACCOUNT_DELETED"
  | "USER_ROLE_CHANGED"
  | "USER_PRC_ACCESSED"
  | "TEACHER_REGISTRY_CREATED"
  | "TEACHER_REGISTRY_UPDATED"
  | "TEACHER_REGISTRY_DEACTIVATED"
  | "TEACHER_REGISTRY_ACTIVATED"
  | "TEACHER_REGISTRY_VERIFIED"
  | "TEACHER_REGISTRY_IMPORTED"
  | "REGISTRATION_MATCH_EVALUATED"
  | "ACCOUNT_AUTO_APPROVED"
  | "ACCOUNT_EARLY_APPROVED"
  | "ACCOUNT_EARLY_APPROVAL_DENIED"
  | "EMAIL_VERIFICATION_CHECKED"
  // Document Operations
  | "DOCUMENT_UPLOADED"
  | "DOCUMENT_REPLACED"
  | "DOCUMENT_DELETED"
  | "DOCUMENT_CLASSIFICATION_FAILED"
  | "REVIEW_QUEUE_DOCUMENT_DELETED"
  // Deletion Request & Archival Operations
  | "DELETION_REQUESTED"
  | "DELETION_APPROVED"
  | "DELETION_REJECTED"
  | "DELETION_COMPLETED"
  | "DELETION_FAILED"
  // OCR Operations
  | "OCR_PROCESSING_STARTED"
  | "OCR_PROCESSING_COMPLETED"
  | "OCR_PROCESSING_FAILED"
  | "OCR_FALLBACK_TRIGGERED"
  // Comparison Operations
  | "COMPARISON_COMPLETED"
  | "COMPARISON_DISCREPANCY_FLAGGED"
  // Academic & Review Operations
  | "REVIEW_APPROVED"
  | "REVIEW_REJECTED"
  | "GRADE_CORRECTED"
  | "STUDENT_RECORD_CREATED"
  | "STUDENT_RECORD_UPDATED"
  | "ATTENDANCE_RECORD_UPDATED"
  | "REMEDIAL_RECORD_UPDATED"
  | "ELIGIBILITY_DECISION"
  // Security & Audit
  | "UNAUTHORIZED_ACCESS_DENIED"
  | "AUDIT_LOGS_EXPORTED"
  | "SYSTEM_CONFIGURATION_CHANGED";

export type AuditOutcome = "SUCCESS" | "FAILURE" | "DENIED" | "WARNING";

export interface AuditEvent {
  id: string;
  created_at: string; // ISO 8601 UTC string
  actor_user_id?: string | null;
  actor_email?: string | null;
  actor_role: string;
  actor_school_id?: string | null;
  actor_school_name?: string | null;
  category: AuditCategory;
  action: AuditAction;
  target_type?: string | null;
  target_id?: string | null;
  target_label?: string | null;
  outcome: AuditOutcome;
  details?: Record<string, any>;
  reason?: string | null;
  request_id?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
  persisted?: boolean;
  dbError?: string | null;
}

export interface LogAuditParams {
  category: AuditCategory;
  action: AuditAction;
  outcome: AuditOutcome;
  actorUserId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  actorSchoolId?: string | null;
  actorSchoolName?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  targetLabel?: string | null;
  details?: Record<string, any>;
  reason?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface AuditLogFilters {
  searchQuery?: string;
  category?: AuditCategory | "ALL";
  action?: AuditAction | "ALL";
  outcome?: AuditOutcome | "ALL";
  actorUserId?: string;
  targetId?: string;
  startDate?: string; // ISO date string
  endDate?: string;   // ISO date string
}

export interface AuditPaginationParams {
  page?: number;
  pageSize?: number;
}

export interface AuditLogsQueryResult {
  logs: AuditEvent[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  storageSource: "database" | "memory_fallback";
  isDegraded: boolean;
  summaryMetrics: {
    totalEvents: number;
    successCount: number;
    failureCount: number;
    deniedCount: number;
    securityEventsCount: number;
  };
}
