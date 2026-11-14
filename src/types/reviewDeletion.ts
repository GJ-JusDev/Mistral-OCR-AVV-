/**
-- AVV System — Review Queue Direct Deletion Type Definitions
-- Enforces typed contracts for direct review queue document deletion with confirmation phrase
-- and administrative audit logging.
 */

export const CONFIRMATION_PHRASE = "I am deleting this" as const;

export type RequiredConfirmationPhrase = typeof CONFIRMATION_PHRASE;

export interface DeleteReviewDocumentParams {
  documentId: string;
  confirmationPhrase: string;
}

export interface DeleteReviewDocumentResult {
  success?: boolean;
  error?: string;
  documentId?: string;
  archivedAt?: string;
}
