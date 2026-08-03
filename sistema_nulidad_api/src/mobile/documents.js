import { Router } from 'express';
import { pool, withTransaction } from '../db.js';
import { ApiError } from '../errors.js';
import { createNextDocumentVersion } from '../documents/document-service.js';
import { validateDocumentFile } from '../documents/file-security.js';
import { acceptSingleDocument } from '../middleware/document-upload.js';
import { hasPermission } from '../security/authorization.js';
import { loadCase, loadDocument, parseId } from '../security/resource-access.js';
import {
  assertMobileDocumentAccess,
  canVersionDocumentType,
  normalizeMobileUploadSource
} from './access.js';

const router = Router();

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

router.get('/:documentId', async (request, response, next) => {
  try {
    const document = await loadDocument(parseId(request.params.documentId));
    await assertMobileDocumentAccess(request.auth.user, document);
    const {
      owner_user_id,
      lawyer_user_id,
      judge_user_id,
      organizational_unit_id,
      case_visibility_status,
      ...safeDocument
    } = document;
    response.json({ document: safeDocument });
  } catch (error) {
    next(error);
  }
});

router.get('/:documentId/versions', async (request, response, next) => {
  try {
    const document = await loadDocument(parseId(request.params.documentId));
    await assertMobileDocumentAccess(request.auth.user, document);
    const [versions] = await pool.execute(
      `SELECT
         version_record.id,
         version_record.document_id,
         version_record.version_number,
         version_record.original_name,
         version_record.content_type,
         version_record.created_at,
         metadata_record.upload_source,
         metadata_record.client_channel,
         storage_record.size_bytes,
         storage_record.sha256,
         storage_record.storage_status,
         storage_record.compression_algorithm,
         policy_record.embedded_signature_policy,
         policy_record.platform_signature_policy,
         policy_record.requires_authorization,
         policy_record.requires_certification,
         workflow.authorization_status,
         workflow.certification_status,
         workflow.platform_signature_status
       FROM document_versions version_record
       JOIN document_version_metadata metadata_record
         ON metadata_record.document_version_id = version_record.id
       JOIN document_version_policies policy_record
         ON policy_record.document_version_id = version_record.id
       JOIN v_document_version_workflow_general workflow
         ON workflow.document_version_id = version_record.id
       LEFT JOIN storage_objects storage_record
         ON storage_record.id = (
           SELECT candidate.id
           FROM storage_objects candidate
           WHERE candidate.document_version_id = version_record.id
             AND candidate.object_role = 'original'
           ORDER BY candidate.created_at DESC, candidate.id DESC
           LIMIT 1
         )
       WHERE version_record.document_id = ?
       ORDER BY version_record.version_number DESC, version_record.id DESC`,
      [document.id]
    );
    response.json({ versions });
  } catch (error) {
    next(error);
  }
});

router.post('/:documentId/versions', acceptSingleDocument, async (request, response, next) => {
  try {
    const { user } = request.auth;
    if (!hasPermission(user, 'document.version.create')) {
      throw new ApiError(403, 'document_version_not_allowed', 'El perfil no puede crear versiones documentales.');
    }
    const document = await loadDocument(parseId(request.params.documentId));
    await assertMobileDocumentAccess(user, document);
    if (!await canVersionDocumentType(user, document.document_type_code)) {
      throw new ApiError(403, 'document_type_not_allowed', 'El tipo documental no admite nuevas versiones desde tu perfil móvil.');
    }
    if (document.lifecycle_status !== 'active' || document.case_status !== 'active') {
      throw new ApiError(409, 'document_not_active', 'El documento y su expediente deben estar activos.');
    }
    const caseRecord = await loadCase(document.case_id);
    const file = await validateDocumentFile(request.file);
    const uploadSource = normalizeMobileUploadSource(request.body?.uploadSource);
    const result = await createNextDocumentVersion({
      documentRecord: document,
      caseRecord,
      user,
      file,
      ipAddress: request.ip,
      uploadSource,
      clientChannel: 'mobile'
    });
    response.status(201).json({
      version: {
        id: result.versionId,
        documentId: document.id,
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

router.get('/:documentId/observations', async (request, response, next) => {
  try {
    const document = await loadDocument(parseId(request.params.documentId));
    await assertMobileDocumentAccess(request.auth.user, document);
    const [observations] = await pool.execute(
      `SELECT
         observation_record.id,
         observation_record.document_version_id,
         version_record.version_number,
         author_record.full_name AS author_name,
         observation_record.observation_type,
         observation_record.body,
         observation_record.observation_status,
         observation_record.created_at,
         observation_record.resolved_at,
         observation_record.resolution_note
       FROM document_observations observation_record
       JOIN document_versions version_record
         ON version_record.id = observation_record.document_version_id
       JOIN users author_record ON author_record.id = observation_record.author_user_id
       WHERE version_record.document_id = ?
       ORDER BY observation_record.created_at DESC, observation_record.id DESC`,
      [document.id]
    );

    if (observations.length === 0) {
      return response.json({ observations: [] });
    }
    const placeholders = observations.map(() => '?').join(', ');
    const [responses] = await pool.execute(
      `SELECT
         response_record.id,
         response_record.document_observation_id,
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
    for (const item of responses) {
      const current = responsesByObservation.get(item.document_observation_id) ?? [];
      current.push(item);
      responsesByObservation.set(item.document_observation_id, current);
    }
    return response.json({
      observations: observations.map((observation) => ({
        ...observation,
        responses: responsesByObservation.get(observation.id) ?? []
      }))
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/:documentId/observations/:observationId/responses', async (request, response, next) => {
  try {
    const { user } = request.auth;
    if (!hasPermission(user, 'document.observation.respond')) {
      throw new ApiError(403, 'observation_response_not_allowed', 'El perfil no puede responder observaciones.');
    }
    const document = await loadDocument(parseId(request.params.documentId));
    await assertMobileDocumentAccess(user, document);
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
    const referencedVersionId = rawReferencedVersionId
      ? parseId(rawReferencedVersionId)
      : null;

    const result = await withTransaction(async (connection) => {
      const [rows] = await connection.execute(
        `SELECT
           observation_record.id,
           observation_record.observation_status,
           version_record.version_number
         FROM document_observations observation_record
         JOIN document_versions version_record
           ON version_record.id = observation_record.document_version_id
         WHERE observation_record.id = ?
           AND version_record.document_id = ?
         LIMIT 1 FOR UPDATE`,
        [observationId, document.id]
      );
      if (rows.length === 0) throw new ApiError(404, 'not_found', 'Recurso no encontrado.');
      const observation = rows[0];
      if (!['open', 'responded'].includes(observation.observation_status)) {
        throw new ApiError(409, 'observation_not_open', 'La observación ya no admite respuestas.');
      }
      if (referencedVersionId !== null) {
        const version = await loadVersionForDocument(connection, document.id, referencedVersionId, true);
        if (version.version_number <= observation.version_number) {
          throw new ApiError(409, 'response_version_not_newer', 'La versión vinculada debe ser posterior a la observada.');
        }
      }
      const [inserted] = await connection.execute(
        `INSERT INTO document_observation_responses (
           document_observation_id, responder_user_id, body, referenced_document_version_id
         ) VALUES (?, ?, ?, ?)`,
        [observation.id, user.id, body, referencedVersionId]
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
         ) VALUES (?, 'document.observation_responded', 'document_observation', ?, ?, 'mobile', ?)`,
        [
          user.id,
          String(observation.id),
          JSON.stringify({
            documentId: document.id,
            responseId: inserted.insertId,
            referencedDocumentVersionId: referencedVersionId
          }),
          request.ip
        ]
      );
      return {
        responseId: inserted.insertId,
        observationId: observation.id,
        observationStatus: 'responded'
      };
    });
    response.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
