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
import { assertDocumentAccess, loadDocument, parseId } from '../security/resource-access.js';

const router = Router();
const observationTypes = new Set([
  'comment',
  'correction_required',
  'clarification_required',
  'legal_review'
]);

function requireWebPermission(request, permission, code, message) {
  if (request.auth.channel !== 'web' || !hasPermission(request.auth.user, permission)) {
    throw new ApiError(403, code, message);
  }
}

function requiredText(value, minimum, maximum, message) {
  if (typeof value !== 'string') throw new ApiError(400, 'invalid_request', message);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new ApiError(400, 'invalid_request', message);
  }
  return normalized;
}

async function loadVersionForDocument(executor, documentId, versionId, lock = false) {
  const [rows] = await executor.execute(
    `SELECT id, document_id, version_number
     FROM document_versions
     WHERE id = ? AND document_id = ?
     LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [versionId, documentId]
  );
  if (rows.length === 0) throw new ApiError(404, 'not_found', 'Recurso no encontrado.');
  return rows[0];
}

async function loadObservationForDocument(executor, documentId, observationId, lock = false) {
  const [rows] = await executor.execute(
    `SELECT
       observation_record.id,
       observation_record.document_version_id,
       observation_record.author_user_id,
       observation_record.observation_type,
       observation_record.body,
       observation_record.observation_status,
       observation_record.created_at,
       observation_record.resolved_at,
       observation_record.resolved_by_user_id,
       observation_record.resolution_note,
       version_record.version_number,
       version_record.document_id
     FROM document_observations observation_record
     JOIN document_versions version_record
       ON version_record.id = observation_record.document_version_id
     WHERE observation_record.id = ?
       AND version_record.document_id = ?
     LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
    [observationId, documentId]
  );
  if (rows.length === 0) throw new ApiError(404, 'not_found', 'Recurso no encontrado.');
  return rows[0];
}

async function listDocumentObservations(documentId) {
  const [observations] = await pool.execute(
    `SELECT
       observation_record.id,
       observation_record.document_version_id,
       version_record.version_number,
       observation_record.author_user_id,
       author_record.full_name AS author_name,
       observation_record.observation_type,
       observation_record.body,
       observation_record.observation_status,
       observation_record.created_at,
       observation_record.resolved_at,
       observation_record.resolved_by_user_id,
       resolver_record.full_name AS resolved_by_name,
       observation_record.resolution_note
     FROM document_observations observation_record
     JOIN document_versions version_record
       ON version_record.id = observation_record.document_version_id
     JOIN users author_record ON author_record.id = observation_record.author_user_id
     LEFT JOIN users resolver_record ON resolver_record.id = observation_record.resolved_by_user_id
     WHERE version_record.document_id = ?
     ORDER BY observation_record.created_at DESC, observation_record.id DESC`,
    [documentId]
  );
  if (observations.length === 0) return [];

  const placeholders = observations.map(() => '?').join(', ');
  const [responses] = await pool.execute(
    `SELECT
       response_record.id,
       response_record.document_observation_id,
       response_record.responder_user_id,
       responder_record.full_name AS responder_name,
       response_record.body,
       response_record.referenced_document_version_id,
       referenced_version.version_number AS referenced_version_number,
       response_record.created_at
     FROM document_observation_responses response_record
     JOIN users responder_record ON responder_record.id = response_record.responder_user_id
     LEFT JOIN document_versions referenced_version
       ON referenced_version.id = response_record.referenced_document_version_id
     WHERE response_record.document_observation_id IN (${placeholders})
     ORDER BY response_record.created_at ASC, response_record.id ASC`,
    observations.map((observation) => observation.id)
  );
  const responsesByObservation = new Map();
  for (const responseRecord of responses) {
    const existing = responsesByObservation.get(responseRecord.document_observation_id) ?? [];
    existing.push(responseRecord);
    responsesByObservation.set(responseRecord.document_observation_id, existing);
  }
  return observations.map((observation) => ({
    ...observation,
    responses: responsesByObservation.get(observation.id) ?? []
  }));
}

router.get('/observations', async (request, response, next) => {
  try {
    const { user } = request.auth;
    if (isTechnicalOnly(user)) {
      throw new ApiError(403, 'legal_data_not_allowed', 'El perfil tecnico no consulta observaciones juridicas.');
    }
    const auditAccess = hasPermission(user, 'case.read.audit');
    const participantAccess = hasAnyRole(user, ['party', 'witness']);
    const participantOnly = canAccessOwnParticipantDocumentsOnly(user);
    const hiddenAccess = canSeeHiddenLegalRecords(user);

    const [observations] = await pool.execute(
      `SELECT DISTINCT
         observation_record.id,
         observation_record.document_version_id,
         observation_record.observation_type,
         observation_record.body,
         observation_record.observation_status,
         observation_record.created_at,
         version_record.version_number,
         document_record.id AS document_id,
         document_record.title AS document_title,
         case_record.id AS case_id,
         case_record.folio AS case_folio,
         author_record.full_name AS author_name,
         (SELECT COUNT(*)
          FROM document_observation_responses response_record
          WHERE response_record.document_observation_id = observation_record.id) AS response_count
       FROM document_observations observation_record
       JOIN document_versions version_record
         ON version_record.id = observation_record.document_version_id
       JOIN documents document_record ON document_record.id = version_record.document_id
       JOIN cases case_record ON case_record.id = document_record.case_id
       JOIN case_profiles profile ON profile.case_id = case_record.id
       JOIN users author_record ON author_record.id = observation_record.author_user_id
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
         AND (? = 0 OR document_record.owner_user_id = ?)
         AND (? = 1 OR profile.visibility_status = 'visible')
         AND (? = 1 OR document_record.lifecycle_status = 'active')
       ORDER BY observation_record.created_at DESC, observation_record.id DESC
       LIMIT 500`,
      [
        auditAccess ? 1 : 0,
        user.id,
        participantAccess ? 1 : 0,
        user.id,
        participantOnly ? 1 : 0,
        user.id,
        hiddenAccess ? 1 : 0,
        hiddenAccess ? 1 : 0
      ]
    );
    response.json({ observations });
  } catch (error) {
    next(error);
  }
});

router.get('/documents/:documentId/observations', async (request, response, next) => {
  try {
    const document = await loadDocument(parseId(request.params.documentId));
    await assertDocumentAccess(request.auth.user, document);
    const observations = await listDocumentObservations(document.id);
    response.json({ observations });
  } catch (error) {
    next(error);
  }
});

router.post('/documents/:documentId/versions/:versionId/observations', async (request, response, next) => {
  try {
    requireWebPermission(
      request,
      'document.observation.create',
      'observation_create_not_allowed',
      'El perfil no puede emitir observaciones documentales.'
    );
    const document = await loadDocument(parseId(request.params.documentId));
    await assertDocumentAccess(request.auth.user, document);
    if (document.lifecycle_status !== 'active' || document.case_status !== 'active') {
      throw new ApiError(409, 'document_not_active', 'El documento y su expediente deben estar activos.');
    }
    const version = await loadVersionForDocument(
      pool,
      document.id,
      parseId(request.params.versionId)
    );
    const observationType = request.body?.observationType;
    if (!observationTypes.has(observationType)) {
      throw new ApiError(400, 'invalid_observation_type', 'Seleccione un tipo de observacion valido.');
    }
    const body = requiredText(
      request.body?.body,
      5,
      3000,
      'La observacion debe contener entre 5 y 3000 caracteres.'
    );
    const observation = await withTransaction(async (connection) => {
      const [result] = await connection.execute(
        `INSERT INTO document_observations (
           document_version_id, author_user_id, observation_type, body, observation_status
         ) VALUES (?, ?, ?, ?, 'open')`,
        [version.id, request.auth.user.id, observationType, body]
      );
      await connection.execute(
        `INSERT INTO audit_events (
           actor_user_id, action_code, resource_type, resource_id, details, client_channel, ip_address
         ) VALUES (?, 'document.observation_created', 'document_observation', ?, ?, 'web', ?)`,
        [
          request.auth.user.id,
          String(result.insertId),
          JSON.stringify({
            documentId: document.id,
            documentVersionId: version.id,
            observationType
          }),
          request.ip
        ]
      );
      return {
        id: result.insertId,
        documentVersionId: version.id,
        observationType,
        observationStatus: 'open'
      };
    });
    response.status(201).json({ observation });
  } catch (error) {
    next(error);
  }
});

router.post('/documents/:documentId/observations/:observationId/responses', async (request, response, next) => {
  try {
    requireWebPermission(
      request,
      'document.observation.respond',
      'observation_response_not_allowed',
      'El perfil no puede responder observaciones documentales.'
    );
    const document = await loadDocument(parseId(request.params.documentId));
    await assertDocumentAccess(request.auth.user, document);
    if (document.lifecycle_status !== 'active' || document.case_status !== 'active') {
      throw new ApiError(409, 'document_not_active', 'El documento y su expediente deben estar activos.');
    }
    const observationId = parseId(request.params.observationId);
    const body = requiredText(
      request.body?.body,
      2,
      3000,
      'La respuesta debe contener entre 2 y 3000 caracteres.'
    );
    const rawReferencedVersionId = request.body?.referencedDocumentVersionId;
    const referencedVersionId = rawReferencedVersionId === undefined || rawReferencedVersionId === null || rawReferencedVersionId === ''
      ? null
      : parseId(rawReferencedVersionId);

    const result = await withTransaction(async (connection) => {
      const observation = await loadObservationForDocument(
        connection,
        document.id,
        observationId,
        true
      );
      if (!['open', 'responded'].includes(observation.observation_status)) {
        throw new ApiError(409, 'observation_not_open', 'La observacion ya no admite respuestas.');
      }
      if (referencedVersionId !== null) {
        const referencedVersion = await loadVersionForDocument(
          connection,
          document.id,
          referencedVersionId,
          true
        );
        if (referencedVersion.version_number <= observation.version_number) {
          throw new ApiError(
            409,
            'response_version_not_newer',
            'La version vinculada debe ser posterior a la version observada.'
          );
        }
      }
      const [responseResult] = await connection.execute(
        `INSERT INTO document_observation_responses (
           document_observation_id, responder_user_id, body, referenced_document_version_id
         ) VALUES (?, ?, ?, ?)`,
        [observation.id, request.auth.user.id, body, referencedVersionId]
      );
      if (observation.observation_status === 'open') {
        await connection.execute(
          `UPDATE document_observations
           SET observation_status = 'responded'
           WHERE id = ? AND observation_status = 'open'`,
          [observation.id]
        );
      }
      await connection.execute(
        `INSERT INTO audit_events (
           actor_user_id, action_code, resource_type, resource_id, details, client_channel, ip_address
         ) VALUES (?, 'document.observation_responded', 'document_observation', ?, ?, 'web', ?)`,
        [
          request.auth.user.id,
          String(observation.id),
          JSON.stringify({
            documentId: document.id,
            responseId: responseResult.insertId,
            referencedDocumentVersionId: referencedVersionId
          }),
          request.ip
        ]
      );
      return {
        responseId: responseResult.insertId,
        observationId: observation.id,
        observationStatus: 'responded'
      };
    });
    response.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/documents/:documentId/observations/:observationId/resolve', async (request, response, next) => {
  try {
    requireWebPermission(
      request,
      'document.observation.resolve',
      'observation_resolve_not_allowed',
      'El perfil no puede resolver observaciones documentales.'
    );
    const document = await loadDocument(parseId(request.params.documentId));
    await assertDocumentAccess(request.auth.user, document);
    const observationId = parseId(request.params.observationId);
    const resolutionNote = requiredText(
      request.body?.resolutionNote,
      2,
      2000,
      'La nota de resolucion debe contener entre 2 y 2000 caracteres.'
    );
    const observation = await withTransaction(async (connection) => {
      const current = await loadObservationForDocument(
        connection,
        document.id,
        observationId,
        true
      );
      if (current.observation_status !== 'responded') {
        throw new ApiError(
          409,
          'observation_not_responded',
          'La observacion debe tener una respuesta antes de resolverse.'
        );
      }
      await connection.execute(
        `UPDATE document_observations
         SET observation_status = 'resolved',
             resolved_at = CURRENT_TIMESTAMP,
             resolved_by_user_id = ?,
             resolution_note = ?
         WHERE id = ? AND observation_status = 'responded'`,
        [request.auth.user.id, resolutionNote, current.id]
      );
      await connection.execute(
        `INSERT INTO audit_events (
           actor_user_id, action_code, resource_type, resource_id, details, client_channel, ip_address
         ) VALUES (?, 'document.observation_resolved', 'document_observation', ?, ?, 'web', ?)`,
        [
          request.auth.user.id,
          String(current.id),
          JSON.stringify({ documentId: document.id, resolutionNote }),
          request.ip
        ]
      );
      return { id: current.id, observationStatus: 'resolved' };
    });
    response.json({ observation });
  } catch (error) {
    next(error);
  }
});

export default router;
