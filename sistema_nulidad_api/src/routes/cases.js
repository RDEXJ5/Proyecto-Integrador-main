import { Router } from 'express';
import { pool, withTransaction } from '../db.js';
import { ApiError } from '../errors.js';
import {
  canAccessOwnParticipantDocumentsOnly,
  canSeeHiddenLegalRecords,
  hasAnyRole,
  hasPermission,
  isTechnicalOnly
} from '../security/authorization.js';
import { assertCaseAccess, loadCase, parseId } from '../security/resource-access.js';
import { acceptSingleDocument } from '../middleware/document-upload.js';
import { validateDocumentFile } from '../documents/file-security.js';
import { createDocumentWithFirstVersion } from '../documents/document-service.js';

const router = Router();
const decisionTypes = new Set(['procedural_order', 'interim_resolution', 'final_judgment', 'other']);

function requiredDecisionText(value, minimum, maximum, message) {
  if (typeof value !== 'string') throw new ApiError(400, 'invalid_request', message);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new ApiError(400, 'invalid_request', message);
  }
  return normalized;
}

router.get('/', async (request, response, next) => {
  try {
    const { user } = request.auth;
    if (isTechnicalOnly(user)) {
      throw new ApiError(403, 'legal_data_not_allowed', 'El perfil técnico no consulta expedientes jurídicos.');
    }

    const auditAccess = hasPermission(user, 'case.read.audit');
    const participantAccess = hasAnyRole(user, ['party', 'witness']);
    const hiddenAccess = canSeeHiddenLegalRecords(user);

    const [cases] = await pool.execute(
      `SELECT
         case_record.id,
         case_record.folio,
         case_record.title,
         profile.lifecycle_status AS status,
         profile.visibility_status,
         profile.confidentiality_level,
         profile.case_type_code,
         case_type.label AS case_type_label,
         legal_area.code AS legal_area_code,
         legal_area.label AS legal_area_label,
         unit_record.code AS organizational_unit_code,
         unit_record.name AS organizational_unit_name,
         profile.current_stage_code,
         (SELECT stage_record.label
          FROM case_stage_definitions stage_record
          WHERE stage_record.case_type_code = profile.case_type_code
            AND stage_record.stage_code = profile.current_stage_code
          LIMIT 1) AS current_stage_label,
         case_record.opened_at,
         case_record.updated_at,
         (SELECT assignment_record.assignment_type_code
          FROM case_assignments assignment_record
          WHERE assignment_record.case_id = case_record.id
            AND assignment_record.user_id = ?
            AND assignment_record.assignment_status = 'active'
          ORDER BY assignment_record.assigned_at DESC, assignment_record.id DESC
          LIMIT 1) AS assignment_type_code,
         (SELECT assignment_type.label
          FROM case_assignments assignment_record
          JOIN case_assignment_types assignment_type
            ON assignment_type.code = assignment_record.assignment_type_code
          WHERE assignment_record.case_id = case_record.id
            AND assignment_record.user_id = ?
            AND assignment_record.assignment_status = 'active'
          ORDER BY assignment_record.assigned_at DESC, assignment_record.id DESC
          LIMIT 1) AS assignment_type_label,
         (SELECT assignment_record.assignment_scope
          FROM case_assignments assignment_record
          WHERE assignment_record.case_id = case_record.id
            AND assignment_record.user_id = ?
            AND assignment_record.assignment_status = 'active'
          ORDER BY assignment_record.assigned_at DESC, assignment_record.id DESC
          LIMIT 1) AS assignment_scope,
         (SELECT COUNT(*)
          FROM documents document_record
          WHERE document_record.case_id = case_record.id
            AND document_record.lifecycle_status = 'active') AS document_count,
         (SELECT COUNT(*)
          FROM document_observations observation_record
          JOIN document_versions version_record
            ON version_record.id = observation_record.document_version_id
          JOIN documents document_record
            ON document_record.id = version_record.document_id
          WHERE document_record.case_id = case_record.id
            AND observation_record.observation_status IN ('open', 'responded')) AS pending_observation_count
         ,(SELECT COUNT(*)
           FROM case_deadlines deadline_record
           WHERE deadline_record.case_id = case_record.id
             AND deadline_record.deadline_status = 'pending') AS pending_deadline_count
       FROM cases case_record
       JOIN case_profiles profile ON profile.case_id = case_record.id
       JOIN case_types case_type ON case_type.code = profile.case_type_code
       JOIN legal_areas legal_area ON legal_area.code = case_type.legal_area_code
       JOIN organizational_units unit_record ON unit_record.id = profile.organizational_unit_id
       WHERE
         (? = 1
          OR EXISTS (
            SELECT 1
            FROM case_assignments direct_assignment
            WHERE direct_assignment.case_id = case_record.id
              AND direct_assignment.user_id = ?
              AND direct_assignment.assignment_status = 'active'
          )
          OR (? = 1 AND EXISTS (
            SELECT 1
            FROM case_participant_roles participant
            WHERE participant.case_id = case_record.id
              AND participant.user_id = ?
              AND participant.participation_status = 'active'
          )))
         AND (? = 1 OR profile.visibility_status = 'visible')
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
      [
        user.id,
        user.id,
        user.id,
        auditAccess ? 1 : 0,
        user.id,
        participantAccess ? 1 : 0,
        user.id,
        hiddenAccess ? 1 : 0
      ]
    );
    response.json({ cases });
  } catch (error) {
    next(error);
  }
});

router.get('/:caseId', async (request, response, next) => {
  try {
    const caseRecord = await loadCase(parseId(request.params.caseId));
    await assertCaseAccess(request.auth.user, caseRecord);
    const {
      lawyer_user_id,
      judge_user_id,
      created_by_user_id,
      ...safeCase
    } = caseRecord;
    response.json({ case: safeCase });
  } catch (error) {
    next(error);
  }
});

router.get('/:caseId/people', async (request, response, next) => {
  try {
    const caseRecord = await loadCase(parseId(request.params.caseId));
    await assertCaseAccess(request.auth.user, caseRecord);
    if (!hasPermission(request.auth.user, 'case.people.read')) {
      throw new ApiError(
        403,
        'case_people_not_allowed',
        'El perfil no puede consultar las personas involucradas.'
      );
    }

    const [professionals] = await pool.execute(
      `SELECT
         assignment_record.id AS assignment_id,
         assignment_record.user_id,
         user_record.full_name,
         assignment_record.assignment_type_code,
         assignment_type.label AS assignment_type_label,
         assignment_record.assignment_scope,
         assignment_record.assigned_at,
         user_record.account_status
       FROM case_assignments assignment_record
       JOIN users user_record ON user_record.id = assignment_record.user_id
       JOIN case_assignment_types assignment_type
         ON assignment_type.code = assignment_record.assignment_type_code
       WHERE assignment_record.case_id = ?
         AND assignment_record.assignment_status = 'active'
       ORDER BY assignment_type.label, user_record.full_name`,
      [caseRecord.id]
    );
    const [participants] = await pool.execute(
      `SELECT
         participant_record.id AS participation_id,
         participant_record.user_id,
         user_record.full_name,
         participant_record.participant_role_code,
         participant_type.label AS participant_role_label,
         participant_record.joined_at,
         user_record.account_status
       FROM case_participant_roles participant_record
       JOIN users user_record ON user_record.id = participant_record.user_id
       JOIN case_participant_role_types participant_type
         ON participant_type.code = participant_record.participant_role_code
       WHERE participant_record.case_id = ?
         AND participant_record.participation_status = 'active'
       ORDER BY participant_type.label, user_record.full_name`,
      [caseRecord.id]
    );
    response.json({ people: { professionals, participants } });
  } catch (error) {
    next(error);
  }
});

router.get('/:caseId/decisions', async (request, response, next) => {
  try {
    const caseRecord = await loadCase(parseId(request.params.caseId));
    await assertCaseAccess(request.auth.user, caseRecord);
    const [decisions] = await pool.execute(
      `SELECT *
       FROM v_case_decision_history
       WHERE case_id = ?
       ORDER BY issued_at DESC, id DESC`,
      [caseRecord.id]
    );
    response.json({ decisions });
  } catch (error) {
    next(error);
  }
});

router.post('/:caseId/decisions', async (request, response, next) => {
  try {
    const { user } = request.auth;
    if (request.auth.channel !== 'web' || !hasPermission(user, 'decision.issue')) {
      throw new ApiError(403, 'decision_not_allowed', 'El perfil no puede emitir decisiones procesales.');
    }
    const caseRecord = await loadCase(parseId(request.params.caseId));
    await assertCaseAccess(user, caseRecord);
    if (caseRecord.status !== 'active') {
      throw new ApiError(409, 'case_not_active', 'Sólo se pueden emitir decisiones en expedientes activos.');
    }
    const decisionType = request.body?.decisionType;
    if (!decisionTypes.has(decisionType)) {
      throw new ApiError(400, 'invalid_decision_type', 'Seleccione un tipo de decisión válido.');
    }
    const outcomeCode = requiredDecisionText(
      request.body?.outcomeCode,
      2,
      80,
      'El resultado debe contener entre 2 y 80 caracteres.'
    );
    const title = requiredDecisionText(request.body?.title, 5, 240, 'El título debe contener entre 5 y 240 caracteres.');
    const reasoning = requiredDecisionText(
      request.body?.reasoning,
      10,
      12000,
      'La fundamentación debe contener entre 10 y 12000 caracteres.'
    );
    const documentVersionId = request.body?.documentVersionId
      ? parseId(request.body.documentVersionId)
      : null;
    const supersedesDecisionId = request.body?.supersedesDecisionId
      ? parseId(request.body.supersedesDecisionId)
      : null;

    const decision = await withTransaction(async (connection) => {
      if (supersedesDecisionId !== null) {
        const [previous] = await connection.execute(
          `SELECT id FROM case_decisions WHERE id = ? AND case_id = ? LIMIT 1 FOR UPDATE`,
          [supersedesDecisionId, caseRecord.id]
        );
        if (previous.length === 0) throw new ApiError(404, 'not_found', 'Recurso no encontrado.');
        const [alreadySuperseded] = await connection.execute(
          `SELECT id FROM case_decisions WHERE supersedes_decision_id = ? LIMIT 1`,
          [supersedesDecisionId]
        );
        if (alreadySuperseded.length > 0) {
          throw new ApiError(409, 'decision_already_superseded', 'La decisión ya fue sustituida por otra.');
        }
      }

      if (decisionType === 'final_judgment' && documentVersionId === null) {
        throw new ApiError(409, 'judgment_document_required', 'La sentencia final debe vincular una versión documental.');
      }
      if (documentVersionId !== null) {
        const [versions] = await connection.execute(
          `SELECT
             version_record.id,
             policy_record.requires_authorization,
             policy_record.requires_certification,
             policy_record.platform_signature_policy,
             workflow.authorization_status,
             workflow.certification_status,
             workflow.platform_signature_status,
             (SELECT COUNT(*) FROM document_observations observation_record
              WHERE observation_record.document_version_id = version_record.id
                AND observation_record.observation_status IN ('open', 'responded')) AS open_observation_count
           FROM document_versions version_record
           JOIN documents document_record ON document_record.id = version_record.document_id
           JOIN document_version_policies policy_record ON policy_record.document_version_id = version_record.id
           JOIN v_document_version_workflow_general workflow ON workflow.document_version_id = version_record.id
           WHERE version_record.id = ? AND document_record.case_id = ?
           LIMIT 1 FOR UPDATE`,
          [documentVersionId, caseRecord.id]
        );
        if (versions.length === 0) throw new ApiError(404, 'not_found', 'Recurso no encontrado.');
        const linked = versions[0];
        if (Number(linked.open_observation_count) > 0) {
          throw new ApiError(409, 'open_observations_pending', 'La versión vinculada aún tiene observaciones pendientes.');
        }
        if (decisionType === 'final_judgment') {
          if (linked.platform_signature_policy === 'required' && linked.platform_signature_status !== 'signed') {
            throw new ApiError(409, 'signature_required', 'La sentencia debe estar firmada antes de emitirse.');
          }
          if (linked.requires_authorization && linked.authorization_status !== 'approved') {
            throw new ApiError(409, 'authorization_required', 'La sentencia debe estar autorizada antes de emitirse.');
          }
          if (linked.requires_certification && linked.certification_status !== 'approved') {
            throw new ApiError(409, 'certification_required', 'La sentencia debe estar certificada antes de emitirse.');
          }
        }
      }

      const [inserted] = await connection.execute(
        `INSERT INTO case_decisions (
           case_id, document_version_id, decision_type, outcome_code, title,
           reasoning, issued_by_user_id, issued_role_code, supersedes_decision_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'judge', ?)`,
        [
          caseRecord.id,
          documentVersionId,
          decisionType,
          outcomeCode,
          title,
          reasoning,
          user.id,
          supersedesDecisionId
        ]
      );
      await connection.execute(
        `INSERT INTO audit_events (
           actor_user_id, action_code, resource_type, resource_id, details, client_channel, ip_address
         ) VALUES (?, 'case.decision_issued', 'case_decision', ?, ?, 'web', ?)`,
        [
          user.id,
          String(inserted.insertId),
          JSON.stringify({ caseId: caseRecord.id, decisionType, documentVersionId, supersedesDecisionId }),
          request.ip
        ]
      );
      return {
        id: inserted.insertId,
        caseId: caseRecord.id,
        documentVersionId,
        decisionType,
        outcomeCode,
        title,
        supersedesDecisionId
      };
    });
    response.status(201).json({ decision });
  } catch (error) {
    next(error);
  }
});

router.get('/:caseId/documents', async (request, response, next) => {
  try {
    const { user } = request.auth;
    const caseRecord = await loadCase(parseId(request.params.caseId));
    await assertCaseAccess(user, caseRecord);
    const participantOnly = canAccessOwnParticipantDocumentsOnly(user);
    const includeHistorical = canSeeHiddenLegalRecords(user);
    const [documents] = await pool.execute(
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
         (SELECT COUNT(*) FROM document_versions version_record
          WHERE version_record.document_id = document_record.id) AS version_count,
         (SELECT version_record.id FROM document_versions version_record
          WHERE version_record.document_id = document_record.id
          ORDER BY version_record.version_number DESC, version_record.id DESC
          LIMIT 1) AS latest_document_version_id,
         (SELECT version_record.version_number FROM document_versions version_record
          WHERE version_record.document_id = document_record.id
          ORDER BY version_record.version_number DESC, version_record.id DESC
          LIMIT 1) AS latest_version_number
       FROM documents document_record
       JOIN document_types document_type
         ON document_type.code = document_record.document_type_code
       WHERE document_record.case_id = ?
         AND (? = 0 OR document_record.owner_user_id = ?)
         AND (? = 1 OR document_record.lifecycle_status = 'active')
       ORDER BY document_record.created_at DESC`,
      [
        caseRecord.id,
        participantOnly ? 1 : 0,
        user.id,
        includeHistorical ? 1 : 0
      ]
    );
    response.json({ documents });
  } catch (error) {
    next(error);
  }
});

router.get('/:caseId/document-types', async (request, response, next) => {
  try {
    const caseRecord = await loadCase(parseId(request.params.caseId));
    await assertCaseAccess(request.auth.user, caseRecord);
    const [documentTypes] = await pool.execute(
      `SELECT
         document_type.code,
         document_type.label,
         document_type.description,
         document_type.owner_scope,
         document_type.default_sensitive,
         rule_record.embedded_signature_policy,
         rule_record.platform_signature_policy,
         rule_record.requires_authorization,
         rule_record.requires_certification,
         rule_record.analyzer_policy
       FROM document_types document_type
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
       WHERE document_type.is_active = TRUE
       ORDER BY document_type.label`,
      [caseRecord.case_type_code, caseRecord.current_stage_code]
    );
    response.json({ documentTypes });
  } catch (error) {
    next(error);
  }
});

router.post('/:caseId/documents', acceptSingleDocument, async (request, response, next) => {
  try {
    const { user } = request.auth;
    if (request.auth.channel !== 'web' || !hasPermission(user, 'document.upload')) {
      throw new ApiError(403, 'document_upload_not_allowed', 'El perfil no puede cargar documentos desde la web.');
    }
    const caseRecord = await loadCase(parseId(request.params.caseId));
    await assertCaseAccess(user, caseRecord);
    if (caseRecord.status !== 'active') {
      throw new ApiError(409, 'case_not_active', 'Sólo se pueden agregar documentos a expedientes activos.');
    }
    const file = await validateDocumentFile(request.file);
    const result = await createDocumentWithFirstVersion({
      caseRecord,
      user,
      file,
      fields: request.body ?? {},
      ipAddress: request.ip
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
        storageObjectId: result.storageObjectId,
        storageProvider: 'minio',
        storageStatus: 'available',
        legalHold: true
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
