USE juzgado_nulidad_documental;

-- El campo legado lawyer_user_id ya no puede ser obligatorio en una plataforma
-- general: un expediente puede iniciar sin abogado y recibir asignaciones luego.
ALTER TABLE cases
  MODIFY COLUMN lawyer_user_id BIGINT UNSIGNED NULL;

CREATE TABLE IF NOT EXISTS case_deadline_status_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_deadline_id BIGINT UNSIGNED NOT NULL,
  previous_status VARCHAR(30) NULL,
  new_status VARCHAR(30) NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  changed_by_user_id BIGINT UNSIGNED NOT NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_deadline_history_deadline FOREIGN KEY (case_deadline_id) REFERENCES case_deadlines(id),
  CONSTRAINT fk_deadline_history_actor FOREIGN KEY (changed_by_user_id) REFERENCES users(id),
  INDEX idx_deadline_history_deadline (case_deadline_id, changed_at, id)
) ENGINE=InnoDB;

INSERT INTO case_deadline_status_history (
  case_deadline_id, previous_status, new_status, reason, changed_by_user_id, changed_at
)
SELECT
  deadline_record.id,
  NULL,
  deadline_record.deadline_status,
  deadline_record.status_reason,
  deadline_record.created_by_user_id,
  deadline_record.created_at
FROM case_deadlines deadline_record
WHERE NOT EXISTS (
  SELECT 1 FROM case_deadline_status_history existing
  WHERE existing.case_deadline_id = deadline_record.id
);

DELIMITER //

DROP TRIGGER IF EXISTS no_update_deadline_status_history//
CREATE TRIGGER no_update_deadline_status_history
BEFORE UPDATE ON case_deadline_status_history
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Deadline status history is immutable';
END//

DROP TRIGGER IF EXISTS no_delete_deadline_status_history//
CREATE TRIGGER no_delete_deadline_status_history
BEFORE DELETE ON case_deadline_status_history
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: deadline status history cannot be deleted';
END//

DELIMITER ;

INSERT INTO schema_migrations (version_code, description)
VALUES (
  '007_process_management',
  'Gestión procesal de expedientes, asignaciones, etapas y plazos con historial permanente.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
