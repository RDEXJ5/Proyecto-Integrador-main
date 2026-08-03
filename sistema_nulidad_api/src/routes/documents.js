import { Router } from 'express';
import { createHash } from 'node:crypto';
import { pool } from '../db.js';
import { ApiError } from '../errors.js';
import { acceptSingleDocument } from '../middleware/document-upload.js';
import { validateDocumentFile } from '../documents/file-security.js';
import { createNextDocumentVersion } from '../documents/document-service.js';
import { readDocumentObject } from '../storage/minio.js';
import { hasPermission } from '../security/authorization.js';
import { assertDocumentAccess, loadCase, loadDocument, parseId } from '../security/resource-access.js';

const router = Router();

router.get('/:documentId', async (request, response, next) => {
  try {
    const document = await loadDocument(parseId(request.params.documentId));
    await assertDocumentAccess(request.auth.user, document);
    const {
      case_status,
      case_visibility_status,
      organizational_unit_id,
      lawyer_user_id,
      judge_user_id,
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
    await assertDocumentAccess(request.auth.user, document);
    const [versions] = await pool.execute(
      `SELECT
         workflow.document_id,
         workflow.document_version_id,
         workflow.document_type_code,
         workflow.title,
         workflow.lifecycle_status,
         workflow.version_number,
         workflow.upload_source,
         workflow.embedded_signature_policy,
         workflow.platform_signature_policy,
         workflow.minimum_platform_signatures,
         workflow.requires_authorization AS requires_notarial_authorization,
         workflow.platform_signature_policy = 'required' AS requires_judicial_signature,
         workflow.platform_signature_policy <> 'none' AS allows_platform_signature,
         workflow.requires_certification,
         workflow.signature_analysis_status,
         COALESCE((
           SELECT action_record.outcome
           FROM document_actions action_record
           WHERE action_record.document_version_id = workflow.document_version_id
             AND action_record.action_code = 'review'
           ORDER BY action_record.created_at DESC, action_record.id DESC
           LIMIT 1
         ), 'pending') AS review_status,
         workflow.authorization_status,
         workflow.certification_status,
         workflow.platform_signature_status AS signature_status,
         workflow.storage_provider,
         workflow.storage_status,
         version_record.original_name,
         version_record.content_type,
         storage_record.sha256,
         storage_record.size_bytes
         ,(SELECT COUNT(*)
           FROM document_observations observation_record
           WHERE observation_record.document_version_id = workflow.document_version_id
             AND observation_record.observation_status IN ('open', 'responded')) AS open_observation_count
       FROM v_document_version_workflow_general workflow
       JOIN document_versions version_record
         ON version_record.id = workflow.document_version_id
       LEFT JOIN storage_objects storage_record
         ON storage_record.id = (
           SELECT candidate.id
           FROM storage_objects candidate
           WHERE candidate.document_version_id = workflow.document_version_id
             AND candidate.object_role = 'original'
           ORDER BY candidate.created_at DESC, candidate.id DESC
           LIMIT 1
         )
       WHERE workflow.document_id = ?
       ORDER BY workflow.version_number DESC`,
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
    if (request.auth.channel !== 'web' || !hasPermission(user, 'document.version.create')) {
      throw new ApiError(403, 'document_version_not_allowed', 'El perfil no puede crear versiones desde la web.');
    }
    const document = await loadDocument(parseId(request.params.documentId));
    await assertDocumentAccess(user, document);
    if (document.lifecycle_status !== 'active' || document.case_status !== 'active') {
      throw new ApiError(409, 'document_not_active', 'El documento y su expediente deben estar activos.');
    }
    const caseRecord = await loadCase(document.case_id);
    const file = await validateDocumentFile(request.file);
    const result = await createNextDocumentVersion({
      documentRecord: document,
      caseRecord,
      user,
      file,
      ipAddress: request.ip
    });
    response.status(201).json({
      version: {
        id: result.versionId,
        documentId: result.documentId,
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

router.get('/:documentId/versions/:versionId/content', async (request, response, next) => {
  try {
    const { user } = request.auth;
    if (request.auth.channel !== 'web' || !hasPermission(user, 'document.content.read.web')) {
      throw new ApiError(403, 'document_content_not_allowed', 'El perfil no puede abrir archivos originales.');
    }
    const wantsDownload = request.query.download === '1' || request.query.download === 'true';
    if (wantsDownload && !hasPermission(user, 'document.download.web')) {
      throw new ApiError(403, 'document_download_not_allowed', 'El perfil no puede descargar archivos originales.');
    }
    const document = await loadDocument(parseId(request.params.documentId));
    await assertDocumentAccess(user, document);
    const versionId = parseId(request.params.versionId);
    const [rows] = await pool.execute(
      `SELECT
         version_record.id,
         version_record.original_name,
         version_record.content_type,
         storage_record.bucket_name,
         storage_record.object_key,
         storage_record.provider_version_id,
         storage_record.sha256,
         storage_record.storage_status,
         storage_record.storage_provider
       FROM document_versions version_record
       JOIN storage_objects storage_record
         ON storage_record.document_version_id = version_record.id
        AND storage_record.object_role = 'original'
       WHERE version_record.id = ?
         AND version_record.document_id = ?
       ORDER BY storage_record.created_at DESC, storage_record.id DESC
       LIMIT 1`,
      [versionId, document.id]
    );
    if (rows.length === 0) throw new ApiError(404, 'not_found', 'Recurso no encontrado.');
    const stored = rows[0];
    if (stored.storage_provider !== 'minio' || stored.storage_status !== 'available') {
      throw new ApiError(409, 'document_content_unavailable', 'Esta versión todavía no está disponible en el almacenamiento privado.');
    }
    const content = await readDocumentObject({
      bucketName: stored.bucket_name,
      objectKey: stored.object_key,
      providerVersionId: stored.provider_version_id
    });
    const digest = createHash('sha256').update(content).digest('hex');
    if (digest !== stored.sha256) {
      throw new ApiError(500, 'storage_integrity_failed', 'La huella del archivo no coincide con el registro inmutable.');
    }
    await pool.execute(
      `INSERT INTO audit_events (
         actor_user_id, action_code, resource_type, resource_id, details, client_channel, ip_address
       ) VALUES (?, ?, 'document_version', ?, ?, 'web', ?)`,
      [
        user.id,
        wantsDownload ? 'document.content_downloaded' : 'document.content_viewed',
        String(versionId),
        JSON.stringify({
          documentId: document.id,
          originalName: stored.original_name,
          sha256: stored.sha256
        }),
        request.ip
      ]
    );
    const encodedName = encodeURIComponent(stored.original_name).replace(
      /[!'()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );
    response.set({
      'Content-Type': stored.content_type,
      'Content-Length': String(content.length),
      'Content-Disposition': `${wantsDownload ? 'attachment' : 'inline'}; filename*=UTF-8''${encodedName}`,
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache'
    });
    response.send(content);
  } catch (error) {
    next(error);
  }
});

export default router;
