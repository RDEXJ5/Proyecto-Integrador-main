-- Migracion 004: flujo inmutable de observaciones y respuestas documentales.
-- No elimina ni reemplaza registros existentes.

USE juzgado_nulidad_documental;

CREATE TABLE IF NOT EXISTS document_observation_responses (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_observation_id BIGINT UNSIGNED NOT NULL,
  responder_user_id BIGINT UNSIGNED NOT NULL,
  body VARCHAR(3000) NOT NULL,
  referenced_document_version_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_observation_response_observation
    FOREIGN KEY (document_observation_id) REFERENCES document_observations(id),
  CONSTRAINT fk_observation_response_responder
    FOREIGN KEY (responder_user_id) REFERENCES users(id),
  CONSTRAINT fk_observation_response_version
    FOREIGN KEY (referenced_document_version_id) REFERENCES document_versions(id),
  CONSTRAINT chk_observation_response_body
    CHECK (CHAR_LENGTH(TRIM(body)) BETWEEN 2 AND 3000),
  INDEX idx_observation_responses_observation (document_observation_id, created_at),
  INDEX idx_observation_responses_responder (responder_user_id, created_at)
) ENGINE=InnoDB;

INSERT IGNORE INTO role_permission_grants (
  role_code,
  permission_code,
  grant_status,
  grant_reason
)
SELECT
  reviewer_role.role_code,
  'document.observation.resolve',
  'active',
  'El perfil revisor puede cerrar una observacion respondida conservando su historial.'
FROM (
  SELECT 'judge' AS role_code
  UNION ALL SELECT 'notary'
) AS reviewer_role;

DELIMITER //

DROP TRIGGER IF EXISTS protect_observation_content//
CREATE TRIGGER protect_observation_content
BEFORE UPDATE ON document_observations
FOR EACH ROW
BEGIN
  IF OLD.document_version_id <> NEW.document_version_id
     OR OLD.author_user_id <> NEW.author_user_id
     OR OLD.observation_type <> NEW.observation_type
     OR OLD.body <> NEW.body
     OR OLD.created_at <> NEW.created_at THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Observation content is immutable';
  END IF;

  IF OLD.observation_status <> NEW.observation_status
     AND NOT (
       (OLD.observation_status = 'open' AND NEW.observation_status IN ('responded', 'withdrawn'))
       OR (OLD.observation_status = 'responded' AND NEW.observation_status = 'resolved')
     ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid observation status transition';
  END IF;

  IF OLD.observation_status = 'resolved'
     AND (
       NOT (OLD.resolved_at <=> NEW.resolved_at)
       OR NOT (OLD.resolved_by_user_id <=> NEW.resolved_by_user_id)
       OR NOT (OLD.resolution_note <=> NEW.resolution_note)
     ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Observation resolution is immutable';
  END IF;

  IF NEW.observation_status = 'resolved' THEN
    IF NEW.resolved_at IS NULL
       OR NEW.resolved_by_user_id IS NULL
       OR NEW.resolution_note IS NULL
       OR CHAR_LENGTH(TRIM(NEW.resolution_note)) < 2 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Resolved observations require actor, date and note';
    END IF;
  ELSEIF NEW.resolved_at IS NOT NULL
      OR NEW.resolved_by_user_id IS NOT NULL
      OR NEW.resolution_note IS NOT NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only resolved observations may contain resolution data';
  END IF;
END//

DROP TRIGGER IF EXISTS no_update_observation_response//
CREATE TRIGGER no_update_observation_response
BEFORE UPDATE ON document_observation_responses
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Observation responses are immutable';
END//

DROP TRIGGER IF EXISTS no_delete_observation_response//
CREATE TRIGGER no_delete_observation_response
BEFORE DELETE ON document_observation_responses
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: observation responses cannot be deleted';
END//

DELIMITER ;

INSERT INTO schema_migrations (version_code, description)
VALUES (
  '004_document_observation_workflow',
  'Respuestas inmutables, transiciones auditables y resolucion de observaciones.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
