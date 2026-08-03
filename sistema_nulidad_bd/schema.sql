-- Base de datos autónoma para el Sistema Integral de Gestión y Control Documental.
-- Motor objetivo: MySQL 8.4+ / InnoDB / utf8mb4.
-- Ejecución: mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS juzgado_nulidad_documental
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE juzgado_nulidad_documental;

CREATE TABLE roles (
  code VARCHAR(30) PRIMARY KEY,
  label VARCHAR(100) NOT NULL,
  channel ENUM('web', 'mobile', 'technical') NOT NULL,
  description VARCHAR(300) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE permissions (
  code VARCHAR(60) PRIMARY KEY,
  description VARCHAR(300) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE role_permissions (
  role_code VARCHAR(30) NOT NULL,
  permission_code VARCHAR(60) NOT NULL,
  PRIMARY KEY (role_code, permission_code),
  CONSTRAINT fk_role_permission_role FOREIGN KEY (role_code) REFERENCES roles(code),
  CONSTRAINT fk_role_permission_permission FOREIGN KEY (permission_code) REFERENCES permissions(code)
) ENGINE=InnoDB;

CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name VARCHAR(160) NOT NULL,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  account_status ENUM('active', 'suspended', 'archived') NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE user_roles (
  user_id BIGINT UNSIGNED NOT NULL,
  role_code VARCHAR(30) NOT NULL,
  assigned_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  assigned_by_user_id BIGINT UNSIGNED NULL,
  PRIMARY KEY (user_id, role_code),
  CONSTRAINT fk_user_role_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_user_role_role FOREIGN KEY (role_code) REFERENCES roles(code),
  CONSTRAINT fk_user_role_assigned_by FOREIGN KEY (assigned_by_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE cases (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  folio VARCHAR(40) NOT NULL UNIQUE,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  status ENUM('active', 'paused', 'closed', 'annulled') NOT NULL DEFAULT 'active',
  lawyer_user_id BIGINT UNSIGNED NOT NULL,
  judge_user_id BIGINT UNSIGNED NULL,
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  opened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMP NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_case_lawyer FOREIGN KEY (lawyer_user_id) REFERENCES users(id),
  CONSTRAINT fk_case_judge FOREIGN KEY (judge_user_id) REFERENCES users(id),
  CONSTRAINT fk_case_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  INDEX idx_cases_status (status),
  INDEX idx_cases_lawyer (lawyer_user_id),
  INDEX idx_cases_judge (judge_user_id)
) ENGINE=InnoDB;

CREATE TABLE case_status_history (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  previous_status ENUM('active', 'paused', 'closed', 'annulled') NULL,
  new_status ENUM('active', 'paused', 'closed', 'annulled') NOT NULL,
  reason VARCHAR(1000) NULL,
  changed_by_user_id BIGINT UNSIGNED NOT NULL,
  changed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_case_history_case FOREIGN KEY (case_id) REFERENCES cases(id),
  CONSTRAINT fk_case_history_actor FOREIGN KEY (changed_by_user_id) REFERENCES users(id),
  INDEX idx_case_history_case (case_id, changed_at)
) ENGINE=InnoDB;

CREATE TABLE case_participants (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  participation_kind ENUM('petitioner', 'respondent', 'witness') NOT NULL,
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_participant_case FOREIGN KEY (case_id) REFERENCES cases(id),
  CONSTRAINT fk_participant_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT uq_case_participant UNIQUE (case_id, user_id),
  INDEX idx_participant_user (user_id)
) ENGINE=InnoDB;

-- La política del tipo se aplica a nuevos documentos. Cada documento almacena
-- una instantánea de la política para no reinterpretar expedientes históricos.
CREATE TABLE document_types (
  code VARCHAR(64) PRIMARY KEY,
  label VARCHAR(120) NOT NULL,
  description VARCHAR(500) NOT NULL,
  owner_scope ENUM('participant', 'case') NOT NULL,
  requires_notarial_authorization BOOLEAN NOT NULL DEFAULT FALSE,
  requires_judicial_signature BOOLEAN NOT NULL DEFAULT FALSE,
  default_sensitive BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_type_signature_requires_authorization
    CHECK (NOT requires_judicial_signature OR requires_notarial_authorization)
) ENGINE=InnoDB;

CREATE TABLE document_binary_objects (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  encrypted_content LONGBLOB NOT NULL,
  sha256 CHAR(64) NOT NULL,
  original_size_bytes BIGINT UNSIGNED NOT NULL,
  stored_size_bytes BIGINT UNSIGNED NOT NULL,
  compression_algorithm VARCHAR(50) NOT NULL,
  encryption_algorithm VARCHAR(80) NOT NULL,
  storage_tier ENUM('active', 'deep_archive') NOT NULL DEFAULT 'active',
  stored_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMP NULL,
  INDEX idx_binary_object_digest (sha256),
  CONSTRAINT chk_binary_sizes CHECK (original_size_bytes > 0 AND stored_size_bytes > 0)
) ENGINE=InnoDB;

CREATE TABLE documents (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  case_id BIGINT UNSIGNED NOT NULL,
  owner_user_id BIGINT UNSIGNED NOT NULL,
  document_type_code VARCHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  -- NULL permite que el trigger aplique el valor por defecto del tipo documental.
  contains_sensitive_data BOOLEAN NULL DEFAULT NULL,
  requires_notarial_authorization BOOLEAN NOT NULL DEFAULT FALSE,
  requires_judicial_signature BOOLEAN NOT NULL DEFAULT FALSE,
  lifecycle_status ENUM('active', 'archived') NOT NULL DEFAULT 'active',
  created_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  archived_at TIMESTAMP NULL,
  CONSTRAINT fk_document_case FOREIGN KEY (case_id) REFERENCES cases(id),
  CONSTRAINT fk_document_owner FOREIGN KEY (owner_user_id) REFERENCES users(id),
  CONSTRAINT fk_document_type FOREIGN KEY (document_type_code) REFERENCES document_types(code),
  CONSTRAINT fk_document_creator FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  CONSTRAINT chk_document_signature_requires_authorization
    CHECK (NOT requires_judicial_signature OR requires_notarial_authorization),
  INDEX idx_documents_case (case_id),
  INDEX idx_documents_owner (owner_user_id),
  INDEX idx_documents_type (document_type_code)
) ENGINE=InnoDB;

CREATE TABLE document_versions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_id BIGINT UNSIGNED NOT NULL,
  version_number INT UNSIGNED NOT NULL,
  binary_object_id BIGINT UNSIGNED NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  content_type VARCHAR(120) NOT NULL,
  uploaded_by_user_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_version_document FOREIGN KEY (document_id) REFERENCES documents(id),
  CONSTRAINT fk_version_binary FOREIGN KEY (binary_object_id) REFERENCES document_binary_objects(id),
  CONSTRAINT fk_version_uploader FOREIGN KEY (uploaded_by_user_id) REFERENCES users(id),
  CONSTRAINT uq_document_version UNIQUE (document_id, version_number),
  CONSTRAINT uq_version_binary_object UNIQUE (binary_object_id),
  INDEX idx_versions_document (document_id, version_number)
) ENGINE=InnoDB;

CREATE TABLE document_authorizations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_version_id BIGINT UNSIGNED NOT NULL,
  notary_user_id BIGINT UNSIGNED NOT NULL,
  decision ENUM('authorized', 'rejected') NOT NULL,
  note VARCHAR(2000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_authorization_version FOREIGN KEY (document_version_id) REFERENCES document_versions(id),
  CONSTRAINT fk_authorization_notary FOREIGN KEY (notary_user_id) REFERENCES users(id),
  INDEX idx_authorization_version (document_version_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE document_signatures (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_version_id BIGINT UNSIGNED NOT NULL,
  judge_user_id BIGINT UNSIGNED NOT NULL,
  algorithm VARCHAR(80) NOT NULL,
  public_key TEXT NOT NULL,
  signature_value TEXT NOT NULL,
  signed_digest CHAR(64) NOT NULL,
  signed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_signature_version FOREIGN KEY (document_version_id) REFERENCES document_versions(id),
  CONSTRAINT fk_signature_judge FOREIGN KEY (judge_user_id) REFERENCES users(id),
  CONSTRAINT uq_signature_per_version UNIQUE (document_version_id)
) ENGINE=InnoDB;

CREATE TABLE audit_events (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NULL,
  action_code VARCHAR(100) NOT NULL,
  resource_type VARCHAR(80) NOT NULL,
  resource_id VARCHAR(100) NOT NULL,
  details JSON NULL,
  client_channel ENUM('web', 'mobile', 'api', 'system') NOT NULL,
  ip_address VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users(id),
  INDEX idx_audit_resource (resource_type, resource_id, created_at),
  INDEX idx_audit_actor (actor_user_id, created_at)
) ENGINE=InnoDB;

INSERT INTO roles (code, label, channel, description) VALUES
  ('admin', 'Administración TI', 'technical', 'Opera la plataforma sin intervenir en las decisiones jurídicas.'),
  ('notary', 'Notario', 'web', 'Autoriza y certifica documentos cotejados.'),
  ('judge', 'Juez', 'web', 'Consulta expedientes activos y firma resoluciones que lo requieren.'),
  ('lawyer', 'Abogado', 'web', 'Gestiona únicamente los expedientes de sus clientes.'),
  ('party', 'Parte interesada', 'mobile', 'Consulta sus documentos personales y su propio libelo.'),
  ('witness', 'Testigo', 'mobile', 'Consulta su identificación y declaración propias.')
ON DUPLICATE KEY UPDATE label = VALUES(label), channel = VALUES(channel), description = VALUES(description);

INSERT INTO permissions (code, description) VALUES
  ('case.read.assigned', 'Consultar los expedientes permitidos por asignación.'),
  ('case.create.own', 'Crear expedientes propios o institucionales.'),
  ('document.create', 'Registrar un documento y su primera versión.'),
  ('document.version.create', 'Registrar una nueva versión sin sobrescritura.'),
  ('document.authorize', 'Registrar autorización notarial.'),
  ('document.sign', 'Registrar firma judicial.'),
  ('document.content.read.web', 'Abrir contenido original solamente en web.'),
  ('document.download.web', 'Descargar un archivo original desde la versión web.'),
  ('audit.read', 'Consultar bitácora de trazabilidad.')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('admin', 'case.read.assigned'), ('admin', 'case.create.own'), ('admin', 'document.create'),
  ('admin', 'document.version.create'), ('admin', 'audit.read'),
  ('notary', 'case.read.assigned'), ('notary', 'case.create.own'), ('notary', 'document.create'),
  ('notary', 'document.version.create'), ('notary', 'document.authorize'),
  ('notary', 'document.content.read.web'), ('notary', 'document.download.web'), ('notary', 'audit.read'),
  ('judge', 'case.read.assigned'), ('judge', 'document.sign'), ('judge', 'document.content.read.web'),
  ('judge', 'document.download.web'),
  ('lawyer', 'case.read.assigned'), ('lawyer', 'case.create.own'), ('lawyer', 'document.create'),
  ('lawyer', 'document.version.create'),
  ('party', 'case.read.assigned'), ('party', 'document.create'), ('party', 'document.version.create'),
  ('witness', 'case.read.assigned'), ('witness', 'document.create'), ('witness', 'document.version.create')
ON DUPLICATE KEY UPDATE permission_code = VALUES(permission_code);

INSERT INTO document_types (
  code, label, description, owner_scope, requires_notarial_authorization,
  requires_judicial_signature, default_sensitive
) VALUES
  ('marriage_certificate', 'Acta matrimonial', 'Documento clave del proceso de nulidad.', 'case', TRUE, FALSE, TRUE),
  ('personal_identification', 'Identificación oficial', 'INE u otra identificación de una parte.', 'participant', TRUE, FALSE, TRUE),
  ('curp', 'CURP', 'Clave Única de Registro de Población.', 'participant', TRUE, FALSE, TRUE),
  ('birth_certificate', 'Acta de nacimiento', 'Acta de nacimiento de una parte.', 'participant', TRUE, FALSE, TRUE),
  ('rfc', 'RFC', 'Constancia de Registro Federal de Contribuyentes.', 'participant', TRUE, FALSE, TRUE),
  ('proof_of_address', 'Comprobante de domicilio', 'Comprobante de domicilio de una parte.', 'participant', TRUE, FALSE, TRUE),
  ('witness_identification', 'Identificación de testigo', 'INE u otra identificación del testigo.', 'participant', TRUE, FALSE, TRUE),
  ('libel', 'Libelo', 'Relato de hechos de una parte o testigo.', 'participant', FALSE, FALSE, TRUE),
  ('judgment', 'Resolución judicial', 'Resolución que exige autorización notarial y firma judicial.', 'case', TRUE, TRUE, TRUE),
  ('other', 'Anexo u otro documento', 'Documento complementario del expediente.', 'case', FALSE, FALSE, TRUE)
ON DUPLICATE KEY UPDATE
  label = VALUES(label), description = VALUES(description), owner_scope = VALUES(owner_scope),
  requires_notarial_authorization = VALUES(requires_notarial_authorization),
  requires_judicial_signature = VALUES(requires_judicial_signature),
  default_sensitive = VALUES(default_sensitive), is_active = TRUE;

DELIMITER //

CREATE TRIGGER set_document_policy_before_insert
BEFORE INSERT ON documents
FOR EACH ROW
BEGIN
  DECLARE policy_authorization BOOLEAN;
  DECLARE policy_signature BOOLEAN;
  DECLARE policy_sensitive BOOLEAN;

  SELECT requires_notarial_authorization, requires_judicial_signature, default_sensitive
    INTO policy_authorization, policy_signature, policy_sensitive
  FROM document_types
  WHERE code = NEW.document_type_code AND is_active = TRUE;

  SET NEW.requires_notarial_authorization = policy_authorization;
  SET NEW.requires_judicial_signature = policy_signature;
  IF NEW.contains_sensitive_data IS NULL THEN
    SET NEW.contains_sensitive_data = policy_sensitive;
  END IF;
END//

CREATE TRIGGER prevent_document_policy_rewrite
BEFORE UPDATE ON documents
FOR EACH ROW
BEGIN
  IF OLD.case_id <> NEW.case_id
     OR OLD.owner_user_id <> NEW.owner_user_id
     OR OLD.document_type_code <> NEW.document_type_code
     OR OLD.requires_notarial_authorization <> NEW.requires_notarial_authorization
     OR OLD.requires_judicial_signature <> NEW.requires_judicial_signature THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Document identity and policy snapshot are immutable';
  END IF;
END//

CREATE TRIGGER validate_document_authorization
BEFORE INSERT ON document_authorizations
FOR EACH ROW
BEGIN
  DECLARE requires_authorization BOOLEAN;
  DECLARE is_notary INT DEFAULT 0;

  SELECT document_record.requires_notarial_authorization
    INTO requires_authorization
  FROM document_versions version_record
  JOIN documents document_record ON document_record.id = version_record.document_id
  WHERE version_record.id = NEW.document_version_id;

  IF requires_authorization = FALSE THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This document type does not require notarial authorization';
  END IF;

  SELECT COUNT(*) INTO is_notary
  FROM user_roles
  WHERE user_id = NEW.notary_user_id AND role_code = 'notary';

  IF is_notary = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Authorization must be issued by a notary';
  END IF;
END//

CREATE TRIGGER validate_document_signature
BEFORE INSERT ON document_signatures
FOR EACH ROW
BEGIN
  DECLARE requires_authorization BOOLEAN;
  DECLARE requires_signature BOOLEAN;
  DECLARE case_is_active BOOLEAN;
  DECLARE latest_authorization VARCHAR(20) DEFAULT NULL;
  DECLARE is_judge INT DEFAULT 0;

  SELECT document_record.requires_notarial_authorization,
         document_record.requires_judicial_signature,
         case_record.status = 'active'
    INTO requires_authorization, requires_signature, case_is_active
  FROM document_versions version_record
  JOIN documents document_record ON document_record.id = version_record.document_id
  JOIN cases case_record ON case_record.id = document_record.case_id
  WHERE version_record.id = NEW.document_version_id;

  IF requires_signature = FALSE THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'This document type does not require a judicial signature';
  END IF;
  IF case_is_active = FALSE THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Only active cases can receive a judicial signature';
  END IF;

  IF requires_authorization = TRUE THEN
    SELECT decision INTO latest_authorization
    FROM document_authorizations
    WHERE document_version_id = NEW.document_version_id
    ORDER BY created_at DESC, id DESC
    LIMIT 1;
    IF latest_authorization IS NULL OR latest_authorization <> 'authorized' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Notarial authorization is required before signature';
    END IF;
  END IF;

  SELECT COUNT(*) INTO is_judge
  FROM user_roles
  WHERE user_id = NEW.judge_user_id AND role_code = 'judge';
  IF is_judge = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Signature must be issued by a judge';
  END IF;
END//

CREATE TRIGGER prevent_binary_update
BEFORE UPDATE ON document_binary_objects
FOR EACH ROW
BEGIN
  -- El binario y sus metadatos criptogrÃ¡ficos son inmutables; solo puede
  -- cambiar la ubicaciÃ³n de almacenamiento para pasar a archivo profundo.
  IF NOT (OLD.encrypted_content <=> NEW.encrypted_content)
     OR OLD.sha256 <> NEW.sha256
     OR OLD.original_size_bytes <> NEW.original_size_bytes
     OR OLD.stored_size_bytes <> NEW.stored_size_bytes
     OR OLD.compression_algorithm <> NEW.compression_algorithm
     OR OLD.encryption_algorithm <> NEW.encryption_algorithm THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Stored document binary content is immutable';
  END IF;
END//

CREATE TRIGGER prevent_case_history_update BEFORE UPDATE ON case_status_history
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Case status history is immutable'; END//
CREATE TRIGGER prevent_participant_update BEFORE UPDATE ON case_participants
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Case participation records are immutable'; END//
CREATE TRIGGER prevent_authorization_update BEFORE UPDATE ON document_authorizations
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Document authorizations are immutable'; END//
CREATE TRIGGER prevent_signature_update BEFORE UPDATE ON document_signatures
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Document signatures are immutable'; END//
CREATE TRIGGER prevent_audit_update BEFORE UPDATE ON audit_events
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit events are immutable'; END//
CREATE TRIGGER prevent_user_role_update BEFORE UPDATE ON user_roles
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'User role assignments are immutable'; END//

CREATE TRIGGER prevent_version_rewrite
BEFORE UPDATE ON document_versions
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Document versions are immutable; create a new version instead';
END//

CREATE TRIGGER prevent_role_delete BEFORE DELETE ON roles
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: roles cannot be deleted'; END//
CREATE TRIGGER prevent_permission_delete BEFORE DELETE ON permissions
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: permissions cannot be deleted'; END//
CREATE TRIGGER prevent_role_permission_delete BEFORE DELETE ON role_permissions
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: role permissions cannot be deleted'; END//
CREATE TRIGGER prevent_user_delete BEFORE DELETE ON users
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: users cannot be deleted'; END//
CREATE TRIGGER prevent_user_role_delete BEFORE DELETE ON user_roles
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: user role assignments cannot be deleted'; END//
CREATE TRIGGER prevent_case_delete BEFORE DELETE ON cases
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: cases cannot be deleted'; END//
CREATE TRIGGER prevent_case_history_delete BEFORE DELETE ON case_status_history
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: case history cannot be deleted'; END//
CREATE TRIGGER prevent_participant_delete BEFORE DELETE ON case_participants
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: participants cannot be deleted'; END//
CREATE TRIGGER prevent_type_delete BEFORE DELETE ON document_types
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: document types cannot be deleted'; END//
CREATE TRIGGER prevent_binary_delete BEFORE DELETE ON document_binary_objects
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: binary objects cannot be deleted'; END//
CREATE TRIGGER prevent_document_delete BEFORE DELETE ON documents
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: documents cannot be deleted'; END//
CREATE TRIGGER prevent_version_delete BEFORE DELETE ON document_versions
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: versions cannot be deleted'; END//
CREATE TRIGGER prevent_authorization_delete BEFORE DELETE ON document_authorizations
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: authorizations cannot be deleted'; END//
CREATE TRIGGER prevent_signature_delete BEFORE DELETE ON document_signatures
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: signatures cannot be deleted'; END//
CREATE TRIGGER prevent_audit_delete BEFORE DELETE ON audit_events
FOR EACH ROW BEGIN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: audit events cannot be deleted'; END//

DELIMITER ;

-- Vista de consulta para UI/API: nunca exige una firma cuando el tipo no la requiere.
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
