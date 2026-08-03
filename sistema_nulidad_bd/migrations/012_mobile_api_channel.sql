-- Migración 012: canal móvil separado sobre la misma base documental.
-- Es aditiva e idempotente. No elimina ni reemplaza información existente.

USE juzgado_nulidad_documental;

START TRANSACTION;

INSERT INTO permissions (code, description)
VALUES ('workspace.mobile.access', 'Acceder al espacio móvil personal para partes interesadas y testigos.')
ON DUPLICATE KEY UPDATE description = VALUES(description);

CREATE TABLE IF NOT EXISTS mobile_role_document_types (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  role_code VARCHAR(30) NOT NULL,
  document_type_code VARCHAR(64) NOT NULL,
  can_create BOOLEAN NOT NULL DEFAULT TRUE,
  can_version BOOLEAN NOT NULL DEFAULT TRUE,
  rule_status ENUM('active', 'revoked') NOT NULL DEFAULT 'active',
  grant_reason VARCHAR(1000) NOT NULL,
  granted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMP NULL,
  revocation_reason VARCHAR(1000) NULL,
  active_slot VARCHAR(10) GENERATED ALWAYS AS (
    CASE WHEN rule_status = 'active' THEN 'active' ELSE NULL END
  ) STORED,
  CONSTRAINT fk_mobile_document_role
    FOREIGN KEY (role_code) REFERENCES roles(code),
  CONSTRAINT fk_mobile_document_type
    FOREIGN KEY (document_type_code) REFERENCES document_types(code),
  CONSTRAINT uq_active_mobile_document_type
    UNIQUE (role_code, document_type_code, active_slot),
  CONSTRAINT chk_mobile_document_rule_revocation CHECK (
    (rule_status = 'active' AND revoked_at IS NULL AND revocation_reason IS NULL)
    OR
    (rule_status = 'revoked' AND revoked_at IS NOT NULL AND revocation_reason IS NOT NULL)
  ),
  INDEX idx_mobile_document_type (document_type_code, rule_status)
) ENGINE=InnoDB;

INSERT IGNORE INTO role_permission_grants (
  role_code, permission_code, grant_status, grant_reason
)
SELECT mobile_role.role_code, permission.permission_code, 'active',
       'Permiso requerido por la API móvil personal.'
FROM (
  SELECT 'party' AS role_code
  UNION ALL SELECT 'witness'
) mobile_role
CROSS JOIN (
  SELECT 'workspace.mobile.access' AS permission_code
  UNION ALL SELECT 'document.observation.respond'
) permission;

INSERT IGNORE INTO mobile_role_document_types (
  role_code, document_type_code, can_create, can_version, rule_status, grant_reason
)
VALUES
  ('party', 'personal_identification', TRUE, TRUE, 'active', 'Documento personal de una parte interesada.'),
  ('party', 'curp', TRUE, TRUE, 'active', 'Documento personal de una parte interesada.'),
  ('party', 'birth_certificate', TRUE, TRUE, 'active', 'Documento personal de una parte interesada.'),
  ('party', 'rfc', TRUE, TRUE, 'active', 'Documento personal de una parte interesada.'),
  ('party', 'proof_of_address', TRUE, TRUE, 'active', 'Documento personal de una parte interesada.'),
  ('party', 'libel', TRUE, TRUE, 'active', 'Relato propio de la parte interesada.'),
  ('witness', 'witness_identification', TRUE, TRUE, 'active', 'Identificación propia del testigo.'),
  ('witness', 'libel', TRUE, TRUE, 'active', 'Declaración o relato propio del testigo.');

COMMIT;

DELIMITER //

DROP TRIGGER IF EXISTS protect_mobile_document_type_identity//
CREATE TRIGGER protect_mobile_document_type_identity
BEFORE UPDATE ON mobile_role_document_types
FOR EACH ROW
BEGIN
  IF OLD.role_code <> NEW.role_code
     OR OLD.document_type_code <> NEW.document_type_code
     OR OLD.can_create <> NEW.can_create
     OR OLD.can_version <> NEW.can_version
     OR OLD.grant_reason <> NEW.grant_reason
     OR OLD.granted_at <> NEW.granted_at THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Mobile document type grant identity is immutable';
  END IF;

  IF OLD.rule_status = 'revoked'
     AND (
       NEW.rule_status <> 'revoked'
       OR NOT (OLD.revoked_at <=> NEW.revoked_at)
       OR NOT (OLD.revocation_reason <=> NEW.revocation_reason)
     ) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Revoked mobile document type grants are immutable';
  END IF;
END//

DROP TRIGGER IF EXISTS no_delete_mobile_document_type//
CREATE TRIGGER no_delete_mobile_document_type
BEFORE DELETE ON mobile_role_document_types
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: mobile document type grants cannot be deleted';
END//

DELIMITER ;

INSERT INTO schema_migrations (version_code, description)
VALUES (
  '012_mobile_api_channel',
  'Permisos y tipos documentales permitidos para la API móvil separada.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
