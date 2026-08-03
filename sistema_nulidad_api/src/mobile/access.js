import { pool } from '../db.js';
import { notFound } from '../errors.js';
import { hasAnyRole } from '../security/authorization.js';

export const MOBILE_ROLE_CODES = Object.freeze(['party', 'witness']);

export function activeMobileRoleCodes(user) {
  return (user.roles ?? [])
    .map((role) => role.code)
    .filter((roleCode) => MOBILE_ROLE_CODES.includes(roleCode));
}

export function isMobileParticipant(user) {
  return hasAnyRole(user, MOBILE_ROLE_CODES);
}

export async function assertMobileCaseAccess(user, caseRecord) {
  if (caseRecord.visibility_status !== 'visible') throw notFound();
  const [rows] = await pool.execute(
    `SELECT 1
     FROM case_participant_roles
     WHERE case_id = ?
       AND user_id = ?
       AND participation_status = 'active'
     LIMIT 1`,
    [caseRecord.id, user.id]
  );
  if (rows.length === 0) throw notFound();
}

export async function assertMobileDocumentAccess(user, documentRecord) {
  if (
    documentRecord.lifecycle_status !== 'active'
    || documentRecord.case_status === 'archived'
    || documentRecord.case_visibility_status !== 'visible'
    || Number(documentRecord.owner_user_id) !== Number(user.id)
  ) {
    throw notFound();
  }
  await assertMobileCaseAccess(user, {
    id: documentRecord.case_id,
    visibility_status: documentRecord.case_visibility_status
  });
}

export async function canUploadDocumentType(user, documentTypeCode) {
  return hasMobileDocumentTypeCapability(user, documentTypeCode, 'can_create');
}

export async function canVersionDocumentType(user, documentTypeCode) {
  return hasMobileDocumentTypeCapability(user, documentTypeCode, 'can_version');
}

async function hasMobileDocumentTypeCapability(user, documentTypeCode, capability) {
  const roleCodes = activeMobileRoleCodes(user);
  if (roleCodes.length === 0) return false;
  const placeholders = roleCodes.map(() => '?').join(', ');
  const [rows] = await pool.execute(
    `SELECT 1
     FROM mobile_role_document_types
     WHERE role_code IN (${placeholders})
       AND document_type_code = ?
       AND rule_status = 'active'
       AND ${capability} = TRUE
     LIMIT 1`,
    [...roleCodes, documentTypeCode]
  );
  return rows.length > 0;
}

export function normalizeMobileUploadSource(value) {
  return value === 'mobile_camera' ? 'mobile_camera' : 'mobile_file';
}
