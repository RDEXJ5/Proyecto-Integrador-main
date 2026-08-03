import { pool } from '../db.js';
import { notFound } from '../errors.js';
import {
  canAccessOwnParticipantDocumentsOnly,
  canSeeHiddenLegalRecords,
  hasAnyRole,
  hasPermission,
  isTechnicalOnly
} from './authorization.js';

export function parseId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw notFound();
  return id;
}

export async function loadCase(caseId) {
  const [rows] = await pool.execute(
    `SELECT
       case_record.id,
       case_record.folio,
       case_record.title,
       case_record.description,
       profile.lifecycle_status AS status,
       profile.visibility_status,
       profile.confidentiality_level,
       profile.case_type_code,
       case_type.label AS case_type_label,
       legal_area.code AS legal_area_code,
       legal_area.label AS legal_area_label,
       profile.organizational_unit_id,
       unit_record.code AS organizational_unit_code,
       unit_record.name AS organizational_unit_name,
       profile.current_stage_code,
       (SELECT stage_record.label
        FROM case_stage_definitions stage_record
        WHERE stage_record.case_type_code = profile.case_type_code
          AND stage_record.stage_code = profile.current_stage_code
        LIMIT 1) AS current_stage_label,
       case_record.lawyer_user_id,
       case_record.judge_user_id,
       case_record.created_by_user_id,
       case_record.opened_at,
       case_record.archived_at,
       case_record.updated_at
     FROM cases case_record
     JOIN case_profiles profile ON profile.case_id = case_record.id
     JOIN case_types case_type ON case_type.code = profile.case_type_code
     JOIN legal_areas legal_area ON legal_area.code = case_type.legal_area_code
     JOIN organizational_units unit_record ON unit_record.id = profile.organizational_unit_id
     WHERE case_record.id = ?`,
    [caseId]
  );
  if (rows.length === 0) throw notFound();
  return rows[0];
}

export async function assertCaseAccess(user, caseRecord) {
  if (isTechnicalOnly(user)) throw notFound();
  if (caseRecord.visibility_status === 'hidden' && !canSeeHiddenLegalRecords(user)) {
    throw notFound();
  }

  if (hasPermission(user, 'case.read.audit')) return;

  const [directAssignments] = await pool.execute(
    `SELECT 1
     FROM case_assignments
     WHERE case_id = ? AND user_id = ? AND assignment_status = 'active'
     LIMIT 1`,
    [caseRecord.id, user.id]
  );
  if (directAssignments.length > 0) return;

  if (hasAnyRole(user, ['party', 'witness'])) {
    const [participants] = await pool.execute(
      `SELECT 1
       FROM case_participant_roles
       WHERE case_id = ? AND user_id = ? AND participation_status = 'active'
       LIMIT 1`,
      [caseRecord.id, user.id]
    );
    if (participants.length > 0) return;
  }

  // Un 404 evita revelar que existe un identificador no autorizado.
  throw notFound();
}

export async function loadDocument(documentId) {
  const [rows] = await pool.execute(
    `SELECT
       document_record.id,
       document_record.case_id,
       document_record.owner_user_id,
       document_record.document_type_code,
       document_type.label AS document_type_label,
       document_record.title,
       document_record.description,
       document_record.contains_sensitive_data,
       document_record.lifecycle_status,
       document_record.created_at,
       document_record.archived_at,
       profile.lifecycle_status AS case_status,
       profile.visibility_status AS case_visibility_status,
       profile.organizational_unit_id,
       case_record.lawyer_user_id,
       case_record.judge_user_id
     FROM documents document_record
     JOIN document_types document_type ON document_type.code = document_record.document_type_code
     JOIN cases case_record ON case_record.id = document_record.case_id
     JOIN case_profiles profile ON profile.case_id = case_record.id
     WHERE document_record.id = ?`,
    [documentId]
  );
  if (rows.length === 0) throw notFound();
  return rows[0];
}

export async function assertDocumentAccess(user, documentRecord) {
  await assertCaseAccess(user, {
    id: documentRecord.case_id,
    visibility_status: documentRecord.case_visibility_status,
    organizational_unit_id: documentRecord.organizational_unit_id
  });

  if (documentRecord.lifecycle_status !== 'active' && !canSeeHiddenLegalRecords(user)) {
    throw notFound();
  }

  if (
    canAccessOwnParticipantDocumentsOnly(user)
    && Number(documentRecord.owner_user_id) !== Number(user.id)
  ) {
    throw notFound();
  }
}
