USE juzgado_nulidad_documental;

-- Las decisiones procesales se agregan como hechos inmutables. Una resolución
-- posterior puede sustituir a otra mediante supersedes_decision_id, pero el
-- registro anterior nunca se actualiza ni se elimina.
CREATE TABLE IF NOT EXISTS case_decisions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  document_version_id BIGINT UNSIGNED NULL,
  decision_type ENUM(
    'procedural_order',
    'interim_resolution',
    'final_judgment',
    'other'
  ) NOT NULL,
  outcome_code VARCHAR(80) NOT NULL,
  title VARCHAR(240) NOT NULL,
  reasoning TEXT NOT NULL,
  issued_by_user_id BIGINT UNSIGNED NOT NULL,
  issued_role_code VARCHAR(30) NOT NULL,
  supersedes_decision_id BIGINT UNSIGNED NULL,
  issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_case_decision_case FOREIGN KEY (case_id) REFERENCES cases(id),
  CONSTRAINT fk_case_decision_version FOREIGN KEY (document_version_id) REFERENCES document_versions(id),
  CONSTRAINT fk_case_decision_issuer FOREIGN KEY (issued_by_user_id) REFERENCES users(id),
  CONSTRAINT fk_case_decision_role FOREIGN KEY (issued_role_code) REFERENCES roles(code),
  CONSTRAINT fk_case_decision_superseded FOREIGN KEY (supersedes_decision_id) REFERENCES case_decisions(id),
  INDEX idx_case_decisions_history (case_id, issued_at, id),
  INDEX idx_case_decisions_version (document_version_id)
) ENGINE=InnoDB;

DELIMITER //

DROP TRIGGER IF EXISTS no_update_case_decision//
CREATE TRIGGER no_update_case_decision
BEFORE UPDATE ON case_decisions
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Case decisions are immutable; issue a superseding decision';
END//

DROP TRIGGER IF EXISTS no_delete_case_decision//
CREATE TRIGGER no_delete_case_decision
BEFORE DELETE ON case_decisions
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Permanent retention: case decisions cannot be deleted';
END//

DELIMITER ;

-- Una política opcional o condicional no debe bloquear el expediente como si
-- la firma fuera obligatoria. Sólo "required" produce un estado pendiente.
CREATE OR REPLACE VIEW v_document_version_workflow_general AS
SELECT
  document_record.id AS document_id,
  version_record.id AS document_version_id,
  document_record.case_id,
  document_record.document_type_code,
  document_record.title,
  document_record.lifecycle_status,
  version_record.version_number,
  metadata_record.upload_source,
  policy_record.embedded_signature_policy,
  policy_record.platform_signature_policy,
  policy_record.requires_authorization,
  policy_record.requires_certification,
  policy_record.minimum_platform_signatures,
  CASE
    WHEN policy_record.embedded_signature_policy = 'none' THEN 'not_required'
    ELSE COALESCE((
      SELECT analysis_job.job_status
      FROM document_analysis_jobs analysis_job
      WHERE analysis_job.document_version_id = version_record.id
        AND analysis_job.analysis_type = 'signature_detection'
      ORDER BY analysis_job.requested_at DESC, analysis_job.id DESC
      LIMIT 1
    ), 'pending')
  END AS signature_analysis_status,
  CASE
    WHEN policy_record.requires_authorization = FALSE THEN 'not_required'
    ELSE COALESCE((
      SELECT action_record.outcome
      FROM document_actions action_record
      WHERE action_record.document_version_id = version_record.id
        AND action_record.action_code = 'authorize'
      ORDER BY action_record.created_at DESC, action_record.id DESC
      LIMIT 1
    ), 'pending')
  END AS authorization_status,
  CASE
    WHEN policy_record.requires_certification = FALSE THEN 'not_required'
    ELSE COALESCE((
      SELECT action_record.outcome
      FROM document_actions action_record
      WHERE action_record.document_version_id = version_record.id
        AND action_record.action_code = 'certify'
      ORDER BY action_record.created_at DESC, action_record.id DESC
      LIMIT 1
    ), 'pending')
  END AS certification_status,
  CASE
    WHEN policy_record.platform_signature_policy = 'none' THEN 'not_required'
    WHEN (
      SELECT COUNT(*)
      FROM document_signature_records signature_record
      WHERE signature_record.document_version_id = version_record.id
        AND signature_record.verification_status = 'valid'
    ) >= policy_record.minimum_platform_signatures THEN 'signed'
    WHEN policy_record.platform_signature_policy = 'required' THEN 'pending'
    ELSE 'optional'
  END AS platform_signature_status,
  COALESCE((
    SELECT storage_record.storage_provider
    FROM storage_objects storage_record
    WHERE storage_record.document_version_id = version_record.id
      AND storage_record.object_role = 'original'
    ORDER BY storage_record.created_at DESC, storage_record.id DESC
    LIMIT 1
  ), 'legacy_database') AS storage_provider,
  COALESCE((
    SELECT storage_record.storage_status
    FROM storage_objects storage_record
    WHERE storage_record.document_version_id = version_record.id
      AND storage_record.object_role = 'original'
    ORDER BY storage_record.created_at DESC, storage_record.id DESC
    LIMIT 1
  ), 'available') AS storage_status
FROM documents document_record
JOIN document_versions version_record ON version_record.document_id = document_record.id
JOIN document_version_policies policy_record ON policy_record.document_version_id = version_record.id
JOIN document_version_metadata metadata_record ON metadata_record.document_version_id = version_record.id;

CREATE OR REPLACE VIEW v_case_decision_history AS
SELECT
  decision_record.id,
  decision_record.case_id,
  decision_record.document_version_id,
  version_record.version_number AS document_version_number,
  document_record.id AS document_id,
  document_record.title AS document_title,
  decision_record.decision_type,
  decision_record.outcome_code,
  decision_record.title,
  decision_record.reasoning,
  decision_record.issued_by_user_id,
  issuer.full_name AS issued_by_name,
  decision_record.issued_role_code,
  decision_record.supersedes_decision_id,
  EXISTS (
    SELECT 1
    FROM case_decisions replacement
    WHERE replacement.supersedes_decision_id = decision_record.id
  ) AS is_superseded,
  decision_record.issued_at
FROM case_decisions decision_record
JOIN users issuer ON issuer.id = decision_record.issued_by_user_id
LEFT JOIN document_versions version_record ON version_record.id = decision_record.document_version_id
LEFT JOIN documents document_record ON document_record.id = version_record.document_id;

INSERT INTO schema_migrations (version_code, description)
VALUES (
  '006_review_decision_workflow',
  'Flujo inmutable de revisión documental, firmas de integridad y decisiones procesales.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
