import { createHmac, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { pool, withTransaction } from '../db.js';
import { ApiError } from '../errors.js';
import { hasPermission } from '../security/authorization.js';
import { assertDocumentAccess, loadDocument, parseId } from '../security/resource-access.js';
import {
  DOCUMENT_ACTIONS,
  validateApprovalPrerequisites,
  validateDocumentAction,
  validateSignaturePolicy
} from '../documents/workflow-policy.js';

const router = Router();

function requireWebPermission(request, permission, code, message) {
  if (request.auth.channel !== 'web' || !hasPermission(request.auth.user, permission)) {
    throw new ApiError(403, code, message);
  }
}

function requiredNote(value) {
  if (typeof value !== 'string') {
    throw new ApiError(400, 'invalid_note', 'La justificación es obligatoria.');
  }
  const note = value.trim();
  if (note.length < 5 || note.length > 2000) {
    throw new ApiError(400, 'invalid_note', 'La justificación debe contener entre 5 y 2000 caracteres.');
  }
  return note;
}

function actorRoleCodes(user) {
  return (user.roles ?? []).map((role) => role.code);
}

async function loadWorkflowState(executor, documentId, versionId, lock = false) {
  const [rows] = await executor.execute(
    `SELECT
       version_record.id,
       version_record.document_id,
       version_record.version_number,
       version_record.original_name,
       policy_record.document_type_rule_id,
       policy_record.document_type_code,
       policy_record.platform_signature_policy,
       policy_record.minimum_platform_signatures,
       policy_record.requires_authorization,
       policy_record.authorization_role_code,
       policy_record.requires_certification,
       policy_record.certification_role_code,
       storage_record.sha256,
       (SELECT COUNT(*)
        FROM document_observations observation_record
        WHERE observation_record.document_version_id = version_record.id
          AND observation_record.observation_status IN ('open', 'responded')) AS open_observation_count,
       COALESCE((SELECT action_record.outcome
         FROM document_actions action_record
         WHERE action_record.document_version_id = version_record.id
           AND action_record.action_code = 'review'
         ORDER BY action_record.created_at DESC, action_record.id DESC LIMIT 1), 'pending') AS review_status,
       COALESCE((SELECT action_record.outcome
         FROM document_actions action_record
         WHERE action_record.document_version_id = version_record.id
           AND action_record.action_code = 'authorize'
         ORDER BY action_record.created_at DESC, action_record.id DESC LIMIT 1), 'pending') AS authorization_status,
       COALESCE((SELECT action_record.outcome
         FROM document_actions action_record
         WHERE action_record.document_version_id = version_record.id
           AND action_record.action_code = 'certify'
         ORDER BY action_record.created_at DESC, action_record.id DESC LIMIT 1), 'pending') AS certification_status,
       CASE
         WHEN policy_record.platform_signature_policy = 'none' THEN 'not_required'
         WHEN (SELECT COUNT(*) FROM document_signature_records signature_record
               WHERE signature_record.document_version_id = version_record.id
                 AND signature_record.verification_status = 'valid') >= policy_record.minimum_platform_signatures
           THEN 'signed'
         ELSE 'pending'
       END AS signature_status
     FROM document_versions version_record
     JOIN document_version_policies policy_record
       ON policy_record.document_version_id = version_record.id
     LEFT JOIN storage_objects storage_record
       ON storage_record.id = (
         SELECT candidate.id FROM storage_objects candidate
         WHERE candidate.document_version_id = version_record.id
           AND candidate.object_role = 'original'
         ORDER BY candidate.created_at DESC, candidate.id DESC LIMIT 1
       )
     WHERE version_record.id = ? AND version_record.document_id = ?
     LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [versionId, documentId]
  );
  if (rows.length === 0) throw new ApiError(404, 'not_found', 'Recurso no encontrado.');
  const state = rows[0];
  const [signerRows] = state.document_type_rule_id
    ? await executor.execute(
      `SELECT role_code
       FROM document_rule_signer_roles
       WHERE document_type_rule_id = ?
       ORDER BY role_code`,
      [state.document_type_rule_id]
    )
    : [[]];
  return { ...state, allowed_signer_roles: signerRows.map((row) => row.role_code) };
}

async function listWorkflowHistory(documentId) {
  const [actions] = await pool.execute(
    `SELECT
       action_record.id,
       action_record.document_version_id,
       version_record.version_number,
       action_record.action_code,
       action_record.outcome,
       action_record.actor_user_id,
       actor.full_name AS actor_name,
       action_record.actor_role_code,
       action_record.note,
       action_record.created_at
     FROM document_actions action_record
     JOIN document_versions version_record ON version_record.id = action_record.document_version_id
     JOIN users actor ON actor.id = action_record.actor_user_id
     WHERE version_record.document_id = ?
     ORDER BY action_record.created_at DESC, action_record.id DESC`,
    [documentId]
  );
  const [signatures] = await pool.execute(
    `SELECT
       signature_record.id,
       signature_record.document_version_id,
       version_record.version_number,
       signature_record.signer_user_id,
       signer.full_name AS signer_name,
       signature_record.signer_role_code,
       signature_record.signature_kind,
       signature_record.algorithm,
       signature_record.signed_digest,
       signature_record.verification_status,
       signature_record.signed_at,
       signature_record.recorded_at
     FROM document_signature_records signature_record
     JOIN document_versions version_record ON version_record.id = signature_record.document_version_id
     LEFT JOIN users signer ON signer.id = signature_record.signer_user_id
     WHERE version_record.document_id = ?
     ORDER BY signature_record.recorded_at DESC, signature_record.id DESC`,
    [documentId]
  );
  return { actions, signatures };
}

router.get('/:documentId/workflow', async (request, response, next) => {
  try {
    const document = await loadDocument(parseId(request.params.documentId));
    await assertDocumentAccess(request.auth.user, document);
    response.json(await listWorkflowHistory(document.id));
  } catch (error) {
    next(error);
  }
});

router.post('/:documentId/versions/:versionId/actions', async (request, response, next) => {
  try {
    const actionCode = request.body?.actionCode;
    const definition = DOCUMENT_ACTIONS[actionCode];
    if (!definition) throw new ApiError(400, 'invalid_document_action', 'Seleccione una acción documental válida.');
    requireWebPermission(
      request,
      definition.permission,
      'document_action_not_allowed',
      'El perfil no puede registrar esta acción documental.'
    );
    const document = await loadDocument(parseId(request.params.documentId));
    await assertDocumentAccess(request.auth.user, document);
    if (document.lifecycle_status !== 'active' || document.case_status !== 'active') {
      throw new ApiError(409, 'document_not_active', 'El documento y su expediente deben estar activos.');
    }
    const versionId = parseId(request.params.versionId);
    const outcome = request.body?.outcome;
    const note = requiredNote(request.body?.note);
    const roles = actorRoleCodes(request.auth.user);
    const result = await withTransaction(async (connection) => {
      const state = await loadWorkflowState(connection, document.id, versionId, true);
      validateDocumentAction({
        actionCode,
        outcome,
        policy: state,
        actorRoles: roles,
        openObservationCount: state.open_observation_count
      });
      if (outcome === 'approved') {
        validateApprovalPrerequisites({
          actionCode,
          policy: state,
          latestActions: {
            review: state.review_status,
            authorize: state.authorization_status,
            certify: state.certification_status
          },
          signatureStatus: state.signature_status
        });
      }
      const actorRole = actionCode === 'authorize'
        ? state.authorization_role_code
        : actionCode === 'certify'
          ? state.certification_role_code
          : roles.includes('judge') ? 'judge' : roles.includes('notary') ? 'notary' : roles[0];
      const [inserted] = await connection.execute(
        `INSERT INTO document_actions (
           document_version_id, action_code, outcome, actor_user_id, actor_role_code, note
         ) VALUES (?, ?, ?, ?, ?, ?)`,
        [state.id, actionCode, outcome, request.auth.user.id, actorRole, note]
      );
      await connection.execute(
        `INSERT INTO audit_events (
           actor_user_id, action_code, resource_type, resource_id, details, client_channel, ip_address
         ) VALUES (?, ?, 'document_action', ?, ?, 'web', ?)`,
        [
          request.auth.user.id,
          definition.auditCode,
          String(inserted.insertId),
          JSON.stringify({ documentId: document.id, documentVersionId: state.id, actionCode, outcome }),
          request.ip
        ]
      );
      return {
        id: inserted.insertId,
        documentVersionId: state.id,
        actionCode,
        outcome,
        actorRoleCode: actorRole,
        note
      };
    });
    response.status(201).json({ action: result });
  } catch (error) {
    next(error);
  }
});

router.post('/:documentId/versions/:versionId/signatures', async (request, response, next) => {
  try {
    requireWebPermission(
      request,
      'document.sign',
      'document_signature_not_allowed',
      'El perfil no puede firmar versiones documentales.'
    );
    if (request.body?.confirmation !== true) {
      throw new ApiError(400, 'signature_confirmation_required', 'Confirme expresamente la firma de integridad.');
    }
    const document = await loadDocument(parseId(request.params.documentId));
    await assertDocumentAccess(request.auth.user, document);
    if (document.lifecycle_status !== 'active' || document.case_status !== 'active') {
      throw new ApiError(409, 'document_not_active', 'El documento y su expediente deben estar activos.');
    }
    const versionId = parseId(request.params.versionId);
    const roles = actorRoleCodes(request.auth.user);
    const result = await withTransaction(async (connection) => {
      const state = await loadWorkflowState(connection, document.id, versionId, true);
      if (!state.sha256) {
        throw new ApiError(409, 'document_digest_unavailable', 'La versión no tiene una huella íntegra disponible.');
      }
      validateSignaturePolicy({
        policy: state,
        actorRoles: roles,
        latestActions: { review: state.review_status, authorize: state.authorization_status },
        openObservationCount: state.open_observation_count
      });
      const signerRole = state.allowed_signer_roles.find((role) => roles.includes(role))
        ?? (roles.includes('judge') ? 'judge' : roles[0]);
      const [duplicates] = await connection.execute(
        `SELECT id, signature_value
         FROM document_signature_records
         WHERE document_version_id = ?
           AND signer_user_id = ?
           AND signer_role_code = ?
           AND verification_status = 'valid'
         LIMIT 1`,
        [state.id, request.auth.user.id, signerRole]
      );
      if (duplicates.length > 0) {
        throw new ApiError(409, 'version_already_signed', 'El usuario ya firmó esta versión con el mismo rol.');
      }
      const signedAt = new Date().toISOString();
      const payload = `${state.sha256}:${state.id}:${request.auth.user.id}:${signerRole}:${signedAt}`;
      const signatureValue = createHmac('sha256', config.platformSignatureSecret)
        .update(payload)
        .digest('hex');
      const verificationValue = createHmac('sha256', config.platformSignatureSecret)
        .update(payload)
        .digest('hex');
      const valid = timingSafeEqual(Buffer.from(signatureValue, 'hex'), Buffer.from(verificationValue, 'hex'));
      const [inserted] = await connection.execute(
        `INSERT INTO document_signature_records (
           document_version_id, signer_user_id, signer_role_code,
           signature_kind, algorithm, signature_value, signed_digest,
           verification_status, verification_details, signed_at
         ) VALUES (?, ?, ?, 'platform_digital', 'HMAC-SHA256', ?, ?, ?, ?, ?)`,
        [
          state.id,
          request.auth.user.id,
          signerRole,
          signatureValue,
          state.sha256,
          valid ? 'valid' : 'invalid',
          JSON.stringify({
            attestationType: 'authenticated_integrity',
            documentId: document.id,
            documentVersionId: state.id,
            signedAt
          }),
          signedAt.slice(0, 19).replace('T', ' ')
        ]
      );
      await connection.execute(
        `INSERT INTO audit_events (
           actor_user_id, action_code, resource_type, resource_id, details, client_channel, ip_address
         ) VALUES (?, 'document.integrity_signature_recorded', 'document_signature', ?, ?, 'web', ?)`,
        [
          request.auth.user.id,
          String(inserted.insertId),
          JSON.stringify({ documentId: document.id, documentVersionId: state.id, signerRole, signedDigest: state.sha256 }),
          request.ip
        ]
      );
      return {
        id: inserted.insertId,
        documentVersionId: state.id,
        signerRoleCode: signerRole,
        signedDigest: state.sha256,
        verificationStatus: valid ? 'valid' : 'invalid',
        signedAt
      };
    });
    response.status(201).json({ signature: result });
  } catch (error) {
    next(error);
  }
});

export default router;
