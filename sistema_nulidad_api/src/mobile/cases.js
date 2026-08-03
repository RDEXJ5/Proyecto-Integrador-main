import { Router } from 'express';
import { pool } from '../db.js';
import { ApiError } from '../errors.js';
import { createDocumentWithFirstVersion } from '../documents/document-service.js';
import { validateDocumentFile } from '../documents/file-security.js';
import { acceptSingleDocument } from '../middleware/document-upload.js';
import { hasPermission } from '../security/authorization.js';
import { loadCase, parseId } from '../security/resource-access.js';
import {
  activeMobileRoleCodes,
  assertMobileCaseAccess,
  canUploadDocumentType,
  normalizeMobileUploadSource
} from './access.js';

const router = Router();

router.get('/', async (request, response, next) => {
  try {
    const [cases] = await pool.execute(
      `SELECT
         case_record.id,
         case_record.folio,
         case_record.title,
         case_record.description,
         profile.lifecycle_status AS status,
         profile.confidentiality_level,
         profile.case_type_code,
         case_type.label AS case_type_label,
         legal_area.label AS legal_area_label,
         profile.current_stage_code,
         (SELECT stage_record.label
          FROM case_stage_definitions stage_record
          WHERE stage_record.case_type_code = profile.case_type_code
            AND stage_record.stage_code = profile.current_stage_code
          LIMIT 1) AS current_stage_label,
         case_record.opened_at,
         case_record.updated_at,
         (SELECT COUNT(*)
          FROM documents document_record
          WHERE document_record.case_id = case_record.id
            AND document_record.owner_user_id = ?
            AND document_record.lifecycle_status = 'active') AS own_document_count,
         (SELECT COUNT(*)
          FROM document_observations observation_record
          JOIN document_versions version_record
            ON version_record.id = observation_record.document_version_id
          JOIN documents document_record
            ON document_record.id = version_record.document_id
          WHERE document_record.case_id = case_record.id
            AND document_record.owner_user_id = ?
            AND observation_record.observation_status IN ('open', 'responded')) AS pending_observation_count
       FROM cases case_record
       JOIN case_profiles profile ON profile.case_id = case_record.id
       JOIN case_types case_type ON case_type.code = profile.case_type_code
       JOIN legal_areas legal_area ON legal_area.code = case_type.legal_area_code
       WHERE profile.visibility_status = 'visible'
         AND EXISTS (
           SELECT 1
           FROM case_participant_roles participant
           WHERE participant.case_id = case_record.id
             AND participant.user_id = ?
             AND participant.participation_status = 'active'
         )
       ORDER BY
         CASE profile.lifecycle_status
           WHEN 'active' THEN 0
           WHEN 'paused' THEN 1
           WHEN 'draft' THEN 2
           WHEN 'closed' THEN 3
           WHEN 'annulled' THEN 4
           WHEN 'archived' THEN 5
           ELSE 6
         END,
         case_record.updated_at DESC,
         case_record.id DESC`,
      [request.auth.user.id, request.auth.user.id, request.auth.user.id]
    );
    response.json({ cases });
  } catch (error) {
    next(error);
  }
});

router.get('/:caseId', async (request, response, next) => {
  try {
    const caseRecord = await loadCase(parseId(request.params.caseId));
    await assertMobileCaseAccess(request.auth.user, caseRecord);
    const {
      lawyer_user_id,
      judge_user_id,
      created_by_user_id,
      organizational_unit_id,
      ...safeCase
    } = caseRecord;
    response.json({ case: safeCase });
  } catch (error) {
    next(error);
  }
});

router.get('/:caseId/documents', async (request, response, next) => {
  try {
    const caseRecord = await loadCase(parseId(request.params.caseId));
    await assertMobileCaseAccess(request.auth.user, caseRecord);
    const [documents] = await pool.execute(
      `SELECT
         document_record.id,
         document_record.case_id,
         document_record.document_type_code,
         document_type.label AS document_type_label,
         document_record.title,
         document_record.description,
         document_record.contains_sensitive_data,
         document_record.lifecycle_status,
         document_record.created_at,
         (SELECT COUNT(*) FROM document_versions version_record
          WHERE version_record.document_id = document_record.id) AS version_count,
         (SELECT version_record.id FROM document_versions version_record
          WHERE version_record.document_id = document_record.id
          ORDER BY version_record.version_number DESC, version_record.id DESC
          LIMIT 1) AS latest_document_version_id,
         (SELECT version_record.version_number FROM document_versions version_record
          WHERE version_record.document_id = document_record.id
          ORDER BY version_record.version_number DESC, version_record.id DESC
          LIMIT 1) AS latest_version_number,
         (SELECT COUNT(*)
          FROM document_observations observation_record
          JOIN document_versions observed_version
            ON observed_version.id = observation_record.document_version_id
          WHERE observed_version.document_id = document_record.id
            AND observation_record.observation_status IN ('open', 'responded')) AS pending_observation_count
       FROM documents document_record
       JOIN document_types document_type ON document_type.code = document_record.document_type_code
       WHERE document_record.case_id = ?
         AND document_record.owner_user_id = ?
         AND document_record.lifecycle_status = 'active'
       ORDER BY pending_observation_count DESC, document_record.created_at DESC, document_record.id DESC`,
      [caseRecord.id, request.auth.user.id]
    );
    response.json({ documents });
  } catch (error) {
    next(error);
  }
});

router.get('/:caseId/document-types', async (request, response, next) => {
  try {
    const caseRecord = await loadCase(parseId(request.params.caseId));
    await assertMobileCaseAccess(request.auth.user, caseRecord);
    const roleCodes = activeMobileRoleCodes(request.auth.user);
    const placeholders = roleCodes.map(() => '?').join(', ');
    const [documentTypes] = await pool.execute(
      `SELECT DISTINCT
         document_type.code,
         document_type.label,
         document_type.description,
         document_type.default_sensitive,
         rule_record.embedded_signature_policy,
         rule_record.platform_signature_policy,
         rule_record.requires_authorization,
         rule_record.requires_certification,
         rule_record.analyzer_policy
       FROM mobile_role_document_types mobile_rule
       JOIN document_types document_type
         ON document_type.code = mobile_rule.document_type_code
        AND document_type.is_active = TRUE
       JOIN document_type_rules rule_record
         ON rule_record.id = (
           SELECT candidate.id
           FROM document_type_rules candidate
           WHERE candidate.document_type_code = document_type.code
             AND candidate.rule_status = 'active'
             AND candidate.effective_from <= CURRENT_TIMESTAMP
             AND (candidate.effective_to IS NULL OR candidate.effective_to > CURRENT_TIMESTAMP)
             AND (candidate.case_type_code IS NULL OR candidate.case_type_code = ?)
             AND (candidate.stage_code IS NULL OR candidate.stage_code = ?)
           ORDER BY
             (candidate.case_type_code IS NOT NULL) DESC,
             (candidate.stage_code IS NOT NULL) DESC,
             candidate.priority ASC,
             candidate.id DESC
           LIMIT 1
         )
       WHERE mobile_rule.role_code IN (${placeholders})
         AND mobile_rule.rule_status = 'active'
         AND mobile_rule.can_create = TRUE
       ORDER BY document_type.label`,
      [caseRecord.case_type_code, caseRecord.current_stage_code, ...roleCodes]
    );
    response.json({ documentTypes });
  } catch (error) {
    next(error);
  }
});

router.post('/:caseId/documents', acceptSingleDocument, async (request, response, next) => {
  try {
    const { user } = request.auth;
    if (!hasPermission(user, 'document.upload')) {
      throw new ApiError(403, 'document_upload_not_allowed', 'El perfil no puede cargar documentos.');
    }
    const caseRecord = await loadCase(parseId(request.params.caseId));
    await assertMobileCaseAccess(user, caseRecord);
    if (caseRecord.status !== 'active') {
      throw new ApiError(409, 'case_not_active', 'Sólo se pueden agregar documentos a expedientes activos.');
    }
    const documentTypeCode = request.body?.documentTypeCode;
    if (typeof documentTypeCode !== 'string' || !await canUploadDocumentType(user, documentTypeCode)) {
      throw new ApiError(403, 'document_type_not_allowed', 'El tipo documental no está habilitado para tu perfil móvil.');
    }
    const file = await validateDocumentFile(request.file);
    const uploadSource = normalizeMobileUploadSource(request.body?.uploadSource);
    const result = await createDocumentWithFirstVersion({
      caseRecord,
      user,
      file,
      fields: request.body ?? {},
      ipAddress: request.ip,
      uploadSource,
      clientChannel: 'mobile'
    });
    response.status(201).json({
      document: {
        id: result.documentId,
        caseId: result.caseId,
        documentTypeCode: result.documentTypeCode
      },
      version: {
        id: result.versionId,
        versionNumber: result.versionNumber,
        sha256: file.sha256,
        storageStatus: 'available',
        legalHold: true,
        uploadSource
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
