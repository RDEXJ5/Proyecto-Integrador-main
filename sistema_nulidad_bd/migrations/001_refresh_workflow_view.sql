-- Migración compatible con una base ya creada con una versión anterior de
-- schema.sql. No elimina ni modifica documentos, versiones o auditorías.

USE juzgado_nulidad_documental;

CREATE OR REPLACE VIEW v_document_version_workflow AS
SELECT
  document_record.id AS document_id,
  version_record.id AS document_version_id,
  document_record.case_id,
  document_record.document_type_code,
  document_record.title,
  document_record.lifecycle_status,
  version_record.version_number,
  document_record.requires_notarial_authorization,
  document_record.requires_judicial_signature,
  CASE
    WHEN document_record.requires_notarial_authorization = FALSE THEN 'not_required'
    WHEN (
      SELECT authorization_record.decision
      FROM document_authorizations authorization_record
      WHERE authorization_record.document_version_id = version_record.id
      ORDER BY authorization_record.created_at DESC, authorization_record.id DESC
      LIMIT 1
    ) = 'authorized' THEN 'authorized'
    WHEN (
      SELECT authorization_record.decision
      FROM document_authorizations authorization_record
      WHERE authorization_record.document_version_id = version_record.id
      ORDER BY authorization_record.created_at DESC, authorization_record.id DESC
      LIMIT 1
    ) = 'rejected' THEN 'rejected'
    ELSE 'pending'
  END AS authorization_status,
  CASE
    WHEN document_record.requires_judicial_signature = FALSE THEN 'not_required'
    WHEN EXISTS (
      SELECT 1 FROM document_signatures signature_record
      WHERE signature_record.document_version_id = version_record.id
    ) THEN 'signed'
    WHEN document_record.requires_notarial_authorization = TRUE
         AND (
           SELECT authorization_record.decision
           FROM document_authorizations authorization_record
           WHERE authorization_record.document_version_id = version_record.id
           ORDER BY authorization_record.created_at DESC, authorization_record.id DESC
           LIMIT 1
         ) = 'rejected' THEN 'blocked_by_rejection'
    WHEN document_record.requires_notarial_authorization = TRUE
         AND COALESCE((
           SELECT authorization_record.decision
           FROM document_authorizations authorization_record
           WHERE authorization_record.document_version_id = version_record.id
           ORDER BY authorization_record.created_at DESC, authorization_record.id DESC
           LIMIT 1
         ), 'pending') <> 'authorized' THEN 'blocked_by_authorization'
    ELSE 'pending'
  END AS signature_status
FROM documents document_record
JOIN document_versions version_record ON version_record.document_id = document_record.id;
