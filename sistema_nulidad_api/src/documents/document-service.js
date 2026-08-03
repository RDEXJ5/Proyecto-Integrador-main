import { randomUUID } from 'node:crypto';
import { withTransaction } from '../db.js';
import { ApiError } from '../errors.js';
import { storeDocumentObject } from '../storage/minio.js';

function normalizeText(value, maximum, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ApiError(400, 'invalid_request', 'Faltan datos obligatorios del documento.');
    return null;
  }
  if (typeof value !== 'string') throw new ApiError(400, 'invalid_request', 'Los campos de texto no son válidos.');
  const normalized = value.trim();
  if ((required && normalized.length === 0) || normalized.length > maximum) {
    throw new ApiError(400, 'invalid_request', 'La longitud de los datos del documento no es válida.');
  }
  return normalized || null;
}

async function loadApplicableRule(connection, documentTypeCode, caseTypeCode, stageCode) {
  const [rows] = await connection.execute(
    `SELECT rule_record.*
     FROM document_type_rules rule_record
     WHERE rule_record.document_type_code = ?
       AND rule_record.rule_status = 'active'
       AND rule_record.effective_from <= CURRENT_TIMESTAMP
       AND (rule_record.effective_to IS NULL OR rule_record.effective_to > CURRENT_TIMESTAMP)
       AND (rule_record.case_type_code IS NULL OR rule_record.case_type_code = ?)
       AND (rule_record.stage_code IS NULL OR rule_record.stage_code = ?)
     ORDER BY
       (rule_record.case_type_code IS NOT NULL) DESC,
       (rule_record.stage_code IS NOT NULL) DESC,
       rule_record.priority ASC,
       rule_record.id DESC
     LIMIT 1`,
    [documentTypeCode, caseTypeCode, stageCode]
  );
  if (rows.length === 0) {
    throw new ApiError(422, 'document_policy_missing', 'El tipo documental no tiene una regla vigente para este expediente.');
  }
  return rows[0];
}

async function insertVersionPolicy(connection, versionId, documentTypeCode, rule) {
  const snapshot = {
    ruleCode: rule.rule_code,
    documentTypeCode,
    embeddedSignaturePolicy: rule.embedded_signature_policy,
    platformSignaturePolicy: rule.platform_signature_policy,
    minimumPlatformSignatures: rule.minimum_platform_signatures,
    signerMatchPolicy: rule.signer_match_policy,
    requiresAuthorization: Boolean(rule.requires_authorization),
    authorizationRoleCode: rule.authorization_role_code,
    requiresCertification: Boolean(rule.requires_certification),
    certificationRoleCode: rule.certification_role_code,
    analyzerPolicy: rule.analyzer_policy
  };
  await connection.execute(
    `INSERT INTO document_version_policies (
       document_version_id, document_type_rule_id, document_type_code,
       embedded_signature_policy, platform_signature_policy,
       minimum_platform_signatures, signer_match_policy,
       requires_authorization, authorization_role_code,
       requires_certification, certification_role_code,
       analyzer_policy, policy_snapshot
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      versionId, rule.id, documentTypeCode,
      rule.embedded_signature_policy, rule.platform_signature_policy,
      rule.minimum_platform_signatures, rule.signer_match_policy,
      rule.requires_authorization, rule.authorization_role_code,
      rule.requires_certification, rule.certification_role_code,
      rule.analyzer_policy, JSON.stringify(snapshot)
    ]
  );
}

const validUploadOrigins = new Set(['web_file', 'mobile_file', 'mobile_camera', 'legacy_database']);
const validClientChannels = new Set(['web', 'mobile', 'api', 'system']);

function normalizeOrigin(uploadSource, clientChannel) {
  if (!validUploadOrigins.has(uploadSource) || !validClientChannels.has(clientChannel)) {
    throw new ApiError(400, 'invalid_upload_origin', 'El origen de la versión documental no es válido.');
  }
  if (clientChannel === 'web' && uploadSource !== 'web_file') {
    throw new ApiError(400, 'invalid_upload_origin', 'El canal web sólo admite archivos seleccionados desde el equipo.');
  }
  if (clientChannel === 'mobile' && !['mobile_file', 'mobile_camera'].includes(uploadSource)) {
    throw new ApiError(400, 'invalid_upload_origin', 'Seleccione un origen móvil válido.');
  }
  return { uploadSource, clientChannel };
}

async function insertVersionMetadata(connection, versionId, ipAddress, uploadSource, clientChannel) {
  await connection.execute(
    `INSERT INTO document_version_metadata (
       document_version_id, upload_source, client_channel, upload_ip_address
     ) VALUES (?, ?, ?, ?)`,
    [versionId, uploadSource, clientChannel, ipAddress]
  );
}

async function registerStoredObject({ context, file, objectKey, stored }) {
  return withTransaction(async (connection) => {
    const retainUntil = new Date();
    retainUntil.setUTCFullYear(retainUntil.getUTCFullYear() + 10);
    const [storageResult] = await connection.execute(
      `INSERT INTO storage_objects (
         document_version_id, object_role, storage_provider, bucket_name, object_key,
         provider_version_id, original_filename, detected_mime_type, size_bytes, sha256,
         storage_status, compression_algorithm, encryption_algorithm,
         retention_mode, retain_until, legal_hold, created_by_user_id, available_at
       ) VALUES (?, 'original', 'minio', ?, ?, ?, ?, ?, ?, ?, 'available', ?, ?,
                 'compliance', ?, TRUE, ?, CURRENT_TIMESTAMP)`,
      [
        context.versionId, stored.bucketName, objectKey, stored.providerVersionId,
        file.originalName, file.detectedMimeType, file.sizeBytes, file.sha256,
        stored.compressionAlgorithm, stored.encryptionAlgorithm,
        retainUntil, context.userId
      ]
    );
    if (context.rule.analyzer_policy === 'automatic' && context.rule.embedded_signature_policy !== 'none') {
      await connection.execute(
        `INSERT INTO document_analysis_jobs (
           document_version_id, analysis_type, provider_code, job_status, requested_by_user_id
         ) VALUES (?, 'signature_detection', 'external_signature_api', 'queued', ?)`,
        [context.versionId, context.userId]
      );
    }
    await connection.execute(
      `INSERT INTO audit_events (
         actor_user_id, action_code, resource_type, resource_id, details, client_channel, ip_address
         ) VALUES (?, 'document.version_uploaded', 'document_version', ?, ?, ?, ?)`,
      [
        context.userId,
        String(context.versionId),
        JSON.stringify({
          documentId: context.documentId,
          versionNumber: context.versionNumber,
          documentTypeCode: context.documentTypeCode,
          sha256: file.sha256,
          storageObjectId: storageResult.insertId,
          source: context.uploadSource
        }),
        context.clientChannel,
        context.ipAddress
      ]
    );
    return storageResult.insertId;
  });
}

async function persistObject(context, file) {
  const objectKey = `cases/${context.caseId}/documents/${context.documentId}/versions/${context.versionNumber}-${randomUUID()}.edoc`;
  const stored = await storeDocumentObject({ objectKey, file });
  const storageObjectId = await registerStoredObject({ context, file, objectKey, stored });
  return { ...context, storageObjectId, storage: stored };
}

export async function createDocumentWithFirstVersion({
  caseRecord,
  user,
  file,
  fields,
  ipAddress,
  uploadSource = 'web_file',
  clientChannel = 'web'
}) {
  const origin = normalizeOrigin(uploadSource, clientChannel);
  const documentTypeCode = normalizeText(fields.documentTypeCode, 64, true);
  const title = normalizeText(fields.title, 255) ?? file.originalName;
  const description = normalizeText(fields.description, 4000);
  const context = await withTransaction(async (connection) => {
    const [types] = await connection.execute(
      'SELECT code FROM document_types WHERE code = ? AND is_active = TRUE',
      [documentTypeCode]
    );
    if (types.length === 0) throw new ApiError(400, 'invalid_document_type', 'El tipo documental no está activo.');
    const rule = await loadApplicableRule(
      connection,
      documentTypeCode,
      caseRecord.case_type_code,
      caseRecord.current_stage_code
    );
    const [documentResult] = await connection.execute(
      `INSERT INTO documents (
         case_id, owner_user_id, document_type_code, title, description,
         contains_sensitive_data, created_by_user_id
       ) VALUES (?, ?, ?, ?, ?, NULL, ?)`,
      [caseRecord.id, user.id, documentTypeCode, title, description, user.id]
    );
    const [versionResult] = await connection.execute(
      `INSERT INTO document_versions (
         document_id, version_number, binary_object_id, original_name, content_type, uploaded_by_user_id
       ) VALUES (?, 1, NULL, ?, ?, ?)`,
      [documentResult.insertId, file.originalName, file.detectedMimeType, user.id]
    );
    await insertVersionPolicy(connection, versionResult.insertId, documentTypeCode, rule);
    await insertVersionMetadata(
      connection,
      versionResult.insertId,
      ipAddress,
      origin.uploadSource,
      origin.clientChannel
    );
    return {
      caseId: caseRecord.id,
      documentId: documentResult.insertId,
      documentTypeCode,
      versionId: versionResult.insertId,
      versionNumber: 1,
      userId: user.id,
      ipAddress,
      ...origin,
      rule
    };
  });
  return persistObject(context, file);
}

export async function createNextDocumentVersion({
  documentRecord,
  caseRecord,
  user,
  file,
  ipAddress,
  uploadSource = 'web_file',
  clientChannel = 'web'
}) {
  const origin = normalizeOrigin(uploadSource, clientChannel);
  const context = await withTransaction(async (connection) => {
    const [lockedDocuments] = await connection.execute(
      'SELECT id, document_type_code FROM documents WHERE id = ? FOR UPDATE',
      [documentRecord.id]
    );
    if (lockedDocuments.length === 0) throw new ApiError(404, 'not_found', 'Recurso no encontrado.');
    const [latestVersions] = await connection.execute(
      'SELECT COALESCE(MAX(version_number), 0) AS latest FROM document_versions WHERE document_id = ?',
      [documentRecord.id]
    );
    const versionNumber = Number(latestVersions[0].latest) + 1;
    const rule = await loadApplicableRule(
      connection,
      documentRecord.document_type_code,
      caseRecord.case_type_code,
      caseRecord.current_stage_code
    );
    const [versionResult] = await connection.execute(
      `INSERT INTO document_versions (
         document_id, version_number, binary_object_id, original_name, content_type, uploaded_by_user_id
       ) VALUES (?, ?, NULL, ?, ?, ?)`,
      [documentRecord.id, versionNumber, file.originalName, file.detectedMimeType, user.id]
    );
    await insertVersionPolicy(connection, versionResult.insertId, documentRecord.document_type_code, rule);
    await insertVersionMetadata(
      connection,
      versionResult.insertId,
      ipAddress,
      origin.uploadSource,
      origin.clientChannel
    );
    return {
      caseId: documentRecord.case_id,
      documentId: documentRecord.id,
      documentTypeCode: documentRecord.document_type_code,
      versionId: versionResult.insertId,
      versionNumber,
      userId: user.id,
      ipAddress,
      ...origin,
      rule
    };
  });
  return persistObject(context, file);
}
