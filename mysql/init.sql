CREATE DATABASE IF NOT EXISTS control_documental
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE control_documental;

-- This schema intentionally has no DELETE trigger or cascading deletes. The
-- application uses status transitions and archival tiers to preserve evidence.
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    full_name VARCHAR(160) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('notary', 'judge', 'lawyer', 'party', 'witness', 'admin') NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cases (
    id INT AUTO_INCREMENT PRIMARY KEY,
    folio VARCHAR(40) NOT NULL UNIQUE,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    status ENUM('active', 'paused', 'closed', 'annulled') NOT NULL DEFAULT 'active',
    lawyer_id INT NOT NULL,
    judge_id INT NULL,
    created_by_id INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    archived_at TIMESTAMP NULL,
    CONSTRAINT fk_case_lawyer FOREIGN KEY (lawyer_id) REFERENCES users(id),
    CONSTRAINT fk_case_judge FOREIGN KEY (judge_id) REFERENCES users(id),
    CONSTRAINT fk_case_creator FOREIGN KEY (created_by_id) REFERENCES users(id),
    INDEX idx_cases_status (status)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS case_participants (
    id INT AUTO_INCREMENT PRIMARY KEY,
    case_id INT NOT NULL,
    user_id INT NOT NULL,
    kind ENUM('petitioner', 'respondent', 'witness') NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_participant_case FOREIGN KEY (case_id) REFERENCES cases(id),
    CONSTRAINT fk_participant_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT uq_case_participant UNIQUE (case_id, user_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS document_types (
    code VARCHAR(64) PRIMARY KEY,
    label VARCHAR(120) NOT NULL,
    description VARCHAR(500) NULL,
    requires_notarial_authorization BOOLEAN NOT NULL DEFAULT FALSE,
    requires_judicial_signature BOOLEAN NOT NULL DEFAULT FALSE,
    default_sensitive BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT chk_signature_requires_authorization
        CHECK (NOT requires_judicial_signature OR requires_notarial_authorization)
) ENGINE=InnoDB;

INSERT INTO document_types (
    code, label, description, requires_notarial_authorization,
    requires_judicial_signature, default_sensitive
) VALUES
    ('marriage_certificate', 'Acta matrimonial', 'Documento rector del expediente de nulidad.', TRUE, FALSE, TRUE),
    ('personal_identification', 'Identificación oficial', 'INE o documento oficial de la parte interesada.', TRUE, FALSE, TRUE),
    ('curp', 'CURP', 'Clave Única de Registro de Población.', TRUE, FALSE, TRUE),
    ('birth_certificate', 'Acta de nacimiento', 'Acta de nacimiento de una parte interesada.', TRUE, FALSE, TRUE),
    ('rfc', 'RFC', 'Constancia de Registro Federal de Contribuyentes.', TRUE, FALSE, TRUE),
    ('proof_of_address', 'Comprobante de domicilio', 'Documento de domicilio de una parte interesada.', TRUE, FALSE, TRUE),
    ('witness_identification', 'Identificación de testigo', 'Identificación oficial del testigo.', TRUE, FALSE, TRUE),
    ('libel', 'Libelo', 'Relato de hechos presentado por una parte o testigo.', FALSE, FALSE, TRUE),
    ('judgment', 'Resolución judicial', 'Resolución que requiere autorización notarial y firma judicial.', TRUE, TRUE, TRUE),
    ('other', 'Anexo u otro documento', 'Documento complementario sin firma judicial obligatoria.', FALSE, FALSE, TRUE)
ON DUPLICATE KEY UPDATE
    label = VALUES(label),
    description = VALUES(description),
    requires_notarial_authorization = VALUES(requires_notarial_authorization),
    requires_judicial_signature = VALUES(requires_judicial_signature),
    default_sensitive = VALUES(default_sensitive),
    is_active = TRUE;

CREATE TABLE IF NOT EXISTS documents (
    id INT AUTO_INCREMENT PRIMARY KEY,
    case_id INT NOT NULL,
    owner_id INT NOT NULL,
    kind VARCHAR(64) NOT NULL,
    requires_notarial_authorization BOOLEAN NOT NULL DEFAULT FALSE,
    requires_judicial_signature BOOLEAN NOT NULL DEFAULT FALSE,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    contains_sensitive_data BOOLEAN NOT NULL DEFAULT TRUE,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_document_case FOREIGN KEY (case_id) REFERENCES cases(id),
    CONSTRAINT fk_document_owner FOREIGN KEY (owner_id) REFERENCES users(id),
    CONSTRAINT fk_document_type FOREIGN KEY (kind) REFERENCES document_types(code),
    INDEX idx_documents_case (case_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS document_versions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    document_id INT NOT NULL,
    version_number INT NOT NULL,
    original_name VARCHAR(255) NOT NULL,
    stored_name VARCHAR(255) NOT NULL UNIQUE,
    content_type VARCHAR(120) NULL,
    size_bytes INT NOT NULL,
    sha256 CHAR(64) NOT NULL,
    compression VARCHAR(32) NOT NULL DEFAULT 'zlib+fernet',
    storage_tier VARCHAR(32) NOT NULL DEFAULT 'active',
    uploaded_by_id INT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    archived_at TIMESTAMP NULL,
    CONSTRAINT fk_version_document FOREIGN KEY (document_id) REFERENCES documents(id),
    CONSTRAINT fk_version_uploader FOREIGN KEY (uploaded_by_id) REFERENCES users(id),
    CONSTRAINT uq_document_version UNIQUE (document_id, version_number),
    INDEX idx_versions_digest (sha256)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS document_authorizations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    version_id INT NOT NULL,
    notary_id INT NOT NULL,
    decision ENUM('authorized', 'rejected') NOT NULL,
    note TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_authorization_version FOREIGN KEY (version_id) REFERENCES document_versions(id),
    CONSTRAINT fk_authorization_notary FOREIGN KEY (notary_id) REFERENCES users(id),
    INDEX idx_authorizations_version (version_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS document_signatures (
    id INT AUTO_INCREMENT PRIMARY KEY,
    version_id INT NOT NULL,
    signer_id INT NOT NULL,
    algorithm VARCHAR(60) NOT NULL,
    public_key TEXT NOT NULL,
    signature TEXT NOT NULL,
    signed_digest CHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_signature_version FOREIGN KEY (version_id) REFERENCES document_versions(id),
    CONSTRAINT fk_signature_user FOREIGN KEY (signer_id) REFERENCES users(id),
    UNIQUE KEY uq_signature_version (version_id),
    INDEX idx_signatures_version (version_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS audit_logs (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    actor_id INT NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(80) NOT NULL,
    resource_id VARCHAR(80) NOT NULL,
    details TEXT NULL,
    ip_address VARCHAR(45) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id),
    INDEX idx_audit_resource (resource_type, resource_id),
    INDEX idx_audit_created_at (created_at)
) ENGINE=InnoDB;

-- Defense in depth for the legal retention rule: even a database account with
-- DELETE privileges cannot remove evidentiary records through this schema.
DELIMITER //
CREATE TRIGGER prevent_user_delete BEFORE DELETE ON users
FOR EACH ROW BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: users cannot be deleted';
END//
CREATE TRIGGER prevent_case_delete BEFORE DELETE ON cases
FOR EACH ROW BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: cases cannot be deleted';
END//
CREATE TRIGGER prevent_participant_delete BEFORE DELETE ON case_participants
FOR EACH ROW BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: participants cannot be deleted';
END//
CREATE TRIGGER prevent_document_delete BEFORE DELETE ON documents
FOR EACH ROW BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: documents cannot be deleted';
END//
CREATE TRIGGER prevent_document_type_delete BEFORE DELETE ON document_types
FOR EACH ROW BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: document types cannot be deleted';
END//
CREATE TRIGGER prevent_version_delete BEFORE DELETE ON document_versions
FOR EACH ROW BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: versions cannot be deleted';
END//
CREATE TRIGGER prevent_authorization_delete BEFORE DELETE ON document_authorizations
FOR EACH ROW BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: authorizations cannot be deleted';
END//
CREATE TRIGGER prevent_signature_delete BEFORE DELETE ON document_signatures
FOR EACH ROW BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: signatures cannot be deleted';
END//
CREATE TRIGGER prevent_audit_delete BEFORE DELETE ON audit_logs
FOR EACH ROW BEGIN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Permanent retention: audit logs cannot be deleted';
END//
DELIMITER ;
