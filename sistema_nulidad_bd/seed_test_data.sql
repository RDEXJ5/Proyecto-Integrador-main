-- Datos de prueba para juzgado_nulidad_documental.
-- Ejecutar SOLO en una base de desarrollo o pruebas: la política de retención
-- impide eliminar los registros creados.
-- Es idempotente: puede ejecutarse más de una vez sin duplicar el expediente.

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE juzgado_nulidad_documental;

START TRANSACTION;

-- Datos de catálogo exclusivos de QA. El esquema base ya carga los roles,
-- permisos y tipos necesarios para el sistema; estas filas prueban además las
-- tres tablas de configuración.
INSERT IGNORE INTO roles (code, label, channel, description) VALUES
  ('qa_auditor', 'Auditor de pruebas', 'technical', 'Rol exclusivo de los datos de prueba.');

INSERT IGNORE INTO permissions (code, description) VALUES
  ('qa.seed.verify', 'Consultar las comprobaciones generadas por los datos de prueba.');

INSERT IGNORE INTO role_permissions (role_code, permission_code) VALUES
  ('qa_auditor', 'qa.seed.verify');

INSERT IGNORE INTO document_types (
  code, label, description, owner_scope, requires_notarial_authorization,
  requires_judicial_signature, default_sensitive
) VALUES
  ('qa_evidence', 'Evidencia de pruebas', 'Tipo de documento exclusivo para verificar el esquema.', 'case', FALSE, FALSE, FALSE);

-- Ninguna contraseña en texto plano se almacena en este archivo. Estos hashes
-- son identificadores de prueba, no credenciales utilizables por la aplicación.
INSERT IGNORE INTO users (full_name, email, password_hash) VALUES
  ('Admin QA', 'qa.admin@example.test', SHA2('seed-only-qa-admin', 256)),
  ('Notario QA', 'qa.notario@example.test', SHA2('seed-only-qa-notario', 256)),
  ('Juez QA', 'qa.juez@example.test', SHA2('seed-only-qa-juez', 256)),
  ('Abogado QA', 'qa.abogado@example.test', SHA2('seed-only-qa-abogado', 256)),
  ('Parte QA', 'qa.parte@example.test', SHA2('seed-only-qa-parte', 256)),
  ('Testigo QA', 'qa.testigo@example.test', SHA2('seed-only-qa-testigo', 256)),
  ('Auditor QA', 'qa.auditor@example.test', SHA2('seed-only-qa-auditor', 256));

SET @qa_admin_id := (SELECT id FROM users WHERE email = 'qa.admin@example.test');
SET @qa_notary_id := (SELECT id FROM users WHERE email = 'qa.notario@example.test');
SET @qa_judge_id := (SELECT id FROM users WHERE email = 'qa.juez@example.test');
SET @qa_lawyer_id := (SELECT id FROM users WHERE email = 'qa.abogado@example.test');
SET @qa_party_id := (SELECT id FROM users WHERE email = 'qa.parte@example.test');
SET @qa_witness_id := (SELECT id FROM users WHERE email = 'qa.testigo@example.test');
SET @qa_auditor_id := (SELECT id FROM users WHERE email = 'qa.auditor@example.test');

INSERT IGNORE INTO user_roles (user_id, role_code) VALUES
  (@qa_admin_id, 'admin'),
  (@qa_notary_id, 'notary'),
  (@qa_judge_id, 'judge'),
  (@qa_lawyer_id, 'lawyer'),
  (@qa_party_id, 'party'),
  (@qa_witness_id, 'witness'),
  (@qa_auditor_id, 'qa_auditor');

INSERT INTO cases (folio, title, description, lawyer_user_id, judge_user_id, created_by_user_id)
SELECT
  'QA-NUL-2026-0001',
  'Expediente de prueba de nulidad matrimonial',
  'Datos sintéticos para verificar versiones, autorización, firma y archivo profundo.',
  @qa_lawyer_id, @qa_judge_id, @qa_admin_id
WHERE NOT EXISTS (
  SELECT 1 FROM cases WHERE folio = 'QA-NUL-2026-0001'
);

SET @qa_case_id := (SELECT id FROM cases WHERE folio = 'QA-NUL-2026-0001');

INSERT INTO case_status_history (case_id, previous_status, new_status, reason, changed_by_user_id)
SELECT @qa_case_id, NULL, 'active', 'Apertura del expediente de pruebas.', @qa_admin_id
WHERE NOT EXISTS (
  SELECT 1 FROM case_status_history
  WHERE case_id = @qa_case_id AND new_status = 'active' AND reason = 'Apertura del expediente de pruebas.'
);

INSERT IGNORE INTO case_participants (case_id, user_id, participation_kind) VALUES
  (@qa_case_id, @qa_party_id, 'petitioner'),
  (@qa_case_id, @qa_witness_id, 'witness');

-- Se crean cuatro documentos para comprobar las tres combinaciones de política:
-- sin autorización/firma, con autorización sin firma y con ambas requeridas.
INSERT INTO documents (case_id, owner_user_id, document_type_code, title, description, created_by_user_id)
SELECT @qa_case_id, @qa_lawyer_id, 'marriage_certificate', 'Acta matrimonial QA',
       'Documento sintético: autorización notarial requerida, firma judicial no requerida.', @qa_lawyer_id
WHERE NOT EXISTS (
  SELECT 1 FROM documents
  WHERE case_id = @qa_case_id AND title = 'Acta matrimonial QA'
);

INSERT INTO documents (case_id, owner_user_id, document_type_code, title, description, created_by_user_id)
SELECT @qa_case_id, @qa_party_id, 'libel', 'Libelo de la parte QA',
       'Documento sintético: no requiere autorización ni firma.', @qa_party_id
WHERE NOT EXISTS (
  SELECT 1 FROM documents
  WHERE case_id = @qa_case_id AND title = 'Libelo de la parte QA'
);

INSERT INTO documents (case_id, owner_user_id, document_type_code, title, description, created_by_user_id)
SELECT @qa_case_id, @qa_judge_id, 'judgment', 'Resolución judicial QA',
       'Documento sintético: requiere autorización notarial y firma judicial.', @qa_judge_id
WHERE NOT EXISTS (
  SELECT 1 FROM documents
  WHERE case_id = @qa_case_id AND title = 'Resolución judicial QA'
);

INSERT INTO documents (case_id, owner_user_id, document_type_code, title, description, created_by_user_id)
SELECT @qa_case_id, @qa_lawyer_id, 'qa_evidence', 'Evidencia archivada QA',
       'Documento sintético para comprobar el traslado a archivo profundo.', @qa_lawyer_id
WHERE NOT EXISTS (
  SELECT 1 FROM documents
  WHERE case_id = @qa_case_id AND title = 'Evidencia archivada QA'
);

SET @qa_marriage_document_id := (SELECT id FROM documents WHERE case_id = @qa_case_id AND title = 'Acta matrimonial QA');
SET @qa_libel_document_id := (SELECT id FROM documents WHERE case_id = @qa_case_id AND title = 'Libelo de la parte QA');
SET @qa_judgment_document_id := (SELECT id FROM documents WHERE case_id = @qa_case_id AND title = 'Resolución judicial QA');
SET @qa_evidence_document_id := (SELECT id FROM documents WHERE case_id = @qa_case_id AND title = 'Evidencia archivada QA');

-- Los blobs son datos sintéticos cifrados. En producción se almacenaría aquí
-- el contenido comprimido y cifrado por el servicio de documentos.
INSERT INTO document_binary_objects (
  encrypted_content, sha256, original_size_bytes, stored_size_bytes,
  compression_algorithm, encryption_algorithm
)
SELECT UNHEX(SHA2('qa-marriage-v1', 256)), SHA2('qa-marriage-v1', 256), 32, 32, 'gzip', 'AES-256-GCM'
WHERE NOT EXISTS (SELECT 1 FROM document_binary_objects WHERE sha256 = SHA2('qa-marriage-v1', 256));

INSERT INTO document_binary_objects (
  encrypted_content, sha256, original_size_bytes, stored_size_bytes,
  compression_algorithm, encryption_algorithm
)
SELECT UNHEX(SHA2('qa-libel-v1', 256)), SHA2('qa-libel-v1', 256), 32, 32, 'gzip', 'AES-256-GCM'
WHERE NOT EXISTS (SELECT 1 FROM document_binary_objects WHERE sha256 = SHA2('qa-libel-v1', 256));

INSERT INTO document_binary_objects (
  encrypted_content, sha256, original_size_bytes, stored_size_bytes,
  compression_algorithm, encryption_algorithm
)
SELECT UNHEX(SHA2('qa-judgment-v1', 256)), SHA2('qa-judgment-v1', 256), 32, 32, 'gzip', 'AES-256-GCM'
WHERE NOT EXISTS (SELECT 1 FROM document_binary_objects WHERE sha256 = SHA2('qa-judgment-v1', 256));

INSERT INTO document_binary_objects (
  encrypted_content, sha256, original_size_bytes, stored_size_bytes,
  compression_algorithm, encryption_algorithm
)
SELECT UNHEX(SHA2('qa-evidence-v1', 256)), SHA2('qa-evidence-v1', 256), 32, 32, 'zstd', 'AES-256-GCM'
WHERE NOT EXISTS (SELECT 1 FROM document_binary_objects WHERE sha256 = SHA2('qa-evidence-v1', 256));

SET @qa_marriage_binary_id := (SELECT id FROM document_binary_objects WHERE sha256 = SHA2('qa-marriage-v1', 256) ORDER BY id LIMIT 1);
SET @qa_libel_binary_id := (SELECT id FROM document_binary_objects WHERE sha256 = SHA2('qa-libel-v1', 256) ORDER BY id LIMIT 1);
SET @qa_judgment_binary_id := (SELECT id FROM document_binary_objects WHERE sha256 = SHA2('qa-judgment-v1', 256) ORDER BY id LIMIT 1);
SET @qa_evidence_binary_id := (SELECT id FROM document_binary_objects WHERE sha256 = SHA2('qa-evidence-v1', 256) ORDER BY id LIMIT 1);

INSERT IGNORE INTO document_versions (
  document_id, version_number, binary_object_id, original_name, content_type, uploaded_by_user_id
) VALUES
  (@qa_marriage_document_id, 1, @qa_marriage_binary_id, 'acta_matrimonial_qa.pdf', 'application/pdf', @qa_lawyer_id),
  (@qa_libel_document_id, 1, @qa_libel_binary_id, 'libelo_parte_qa.pdf', 'application/pdf', @qa_party_id),
  (@qa_judgment_document_id, 1, @qa_judgment_binary_id, 'resolucion_qa.pdf', 'application/pdf', @qa_judge_id),
  (@qa_evidence_document_id, 1, @qa_evidence_binary_id, 'evidencia_qa.pdf', 'application/pdf', @qa_lawyer_id);

SET @qa_marriage_version_id := (SELECT id FROM document_versions WHERE document_id = @qa_marriage_document_id AND version_number = 1);
SET @qa_judgment_version_id := (SELECT id FROM document_versions WHERE document_id = @qa_judgment_document_id AND version_number = 1);

INSERT INTO document_authorizations (document_version_id, notary_user_id, decision, note)
SELECT @qa_marriage_version_id, @qa_notary_id, 'authorized', 'Cotejo de acta matrimonial de prueba.'
WHERE NOT EXISTS (
  SELECT 1 FROM document_authorizations
  WHERE document_version_id = @qa_marriage_version_id AND decision = 'authorized'
);

-- Se conserva el rechazo inicial y una autorización posterior para demostrar
-- que las decisiones no se sobrescriben.
INSERT INTO document_authorizations (document_version_id, notary_user_id, decision, note)
SELECT @qa_judgment_version_id, @qa_notary_id, 'rejected', 'Primera revisión de QA: información incompleta.'
WHERE NOT EXISTS (
  SELECT 1 FROM document_authorizations
  WHERE document_version_id = @qa_judgment_version_id AND decision = 'rejected'
);

INSERT INTO document_authorizations (document_version_id, notary_user_id, decision, note)
SELECT @qa_judgment_version_id, @qa_notary_id, 'authorized', 'Segunda revisión de QA: documento validado.'
WHERE NOT EXISTS (
  SELECT 1 FROM document_authorizations
  WHERE document_version_id = @qa_judgment_version_id AND decision = 'authorized'
);

INSERT IGNORE INTO document_signatures (
  document_version_id, judge_user_id, algorithm, public_key, signature_value, signed_digest
) VALUES (
  @qa_judgment_version_id, @qa_judge_id, 'RSA-SHA256',
  'QA-PUBLIC-KEY-NO-VALIDA', 'QA-SIGNATURE-NO-VALIDA', SHA2('qa-judgment-v1', 256)
);

-- Única actualización permitida sobre el binario: moverlo a archivo profundo.
UPDATE document_binary_objects
SET storage_tier = 'deep_archive', archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP)
WHERE id = @qa_evidence_binary_id AND storage_tier <> 'deep_archive';

UPDATE documents
SET lifecycle_status = 'archived', archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP)
WHERE id = @qa_evidence_document_id AND lifecycle_status <> 'archived';

INSERT INTO audit_events (actor_user_id, action_code, resource_type, resource_id, details, client_channel)
SELECT @qa_admin_id, 'qa.case.seeded', 'case', CAST(@qa_case_id AS CHAR),
       JSON_OBJECT('folio', 'QA-NUL-2026-0001', 'source', 'seed_test_data.sql'), 'system'
WHERE NOT EXISTS (
  SELECT 1 FROM audit_events
  WHERE action_code = 'qa.case.seeded' AND resource_type = 'case' AND resource_id = CAST(@qa_case_id AS CHAR)
);

INSERT INTO audit_events (actor_user_id, action_code, resource_type, resource_id, details, client_channel)
SELECT @qa_judge_id, 'qa.judgment.signed', 'document_version', CAST(@qa_judgment_version_id AS CHAR),
       JSON_OBJECT('document_type', 'judgment', 'source', 'seed_test_data.sql'), 'web'
WHERE NOT EXISTS (
  SELECT 1 FROM audit_events
  WHERE action_code = 'qa.judgment.signed' AND resource_type = 'document_version'
    AND resource_id = CAST(@qa_judgment_version_id AS CHAR)
);

COMMIT;

-- Resumen esperado: cuatro documentos y cuatro versiones; la resolución está
-- autorizada y firmada, mientras que el libelo no requiere ninguna de las dos.
SELECT
  document_type_code,
  title,
  version_number,
  authorization_status,
  signature_status,
  lifecycle_status
FROM v_document_version_workflow
WHERE document_id IN (
  @qa_marriage_document_id,
  @qa_libel_document_id,
  @qa_judgment_document_id,
  @qa_evidence_document_id
)
ORDER BY document_id;

SELECT
  (SELECT COUNT(*) FROM users WHERE email LIKE 'qa.%@example.test') AS qa_users,
  (SELECT COUNT(*) FROM case_participants WHERE case_id = @qa_case_id) AS qa_participants,
  (SELECT COUNT(*) FROM document_authorizations WHERE document_version_id IN (@qa_marriage_version_id, @qa_judgment_version_id)) AS qa_authorizations,
  (SELECT COUNT(*) FROM document_signatures WHERE document_version_id = @qa_judgment_version_id) AS qa_signatures,
  (SELECT COUNT(*) FROM audit_events WHERE action_code LIKE 'qa.%') AS qa_audit_events;
