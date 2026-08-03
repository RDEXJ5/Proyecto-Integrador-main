USE juzgado_nulidad_documental;

-- Debe devolver diez tipos y sus políticas.
SELECT code, label, requires_notarial_authorization, requires_judicial_signature
FROM document_types
ORDER BY code;

-- La API debe usar esta vista para no solicitar firmas donde no corresponden.
SELECT
  document_id,
  document_version_id,
  document_type_code,
  authorization_status,
  signature_status
FROM v_document_version_workflow
ORDER BY document_version_id DESC;

-- Control de retención: estas operaciones deben fallar por los triggers.
-- DELETE FROM documents WHERE id = 1;
-- DELETE FROM document_versions WHERE id = 1;
