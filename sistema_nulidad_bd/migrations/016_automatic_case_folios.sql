-- Migración 016: secuencias transaccionales para folios automáticos.
-- El folio final se genera en la API con el formato AREA-AAAA-NNNNNN.

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE juzgado_nulidad_documental;

CREATE TABLE IF NOT EXISTS case_folio_sequences (
  legal_area_code VARCHAR(30) NOT NULL,
  folio_year SMALLINT UNSIGNED NOT NULL,
  last_value BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (legal_area_code, folio_year),
  CONSTRAINT fk_case_folio_sequence_area
    FOREIGN KEY (legal_area_code) REFERENCES legal_areas(code),
  CONSTRAINT chk_case_folio_sequence_year
    CHECK (folio_year BETWEEN 2000 AND 9999),
  CONSTRAINT chk_case_folio_sequence_value
    CHECK (last_value > 0)
) ENGINE=InnoDB;

DELIMITER //

DROP TRIGGER IF EXISTS protect_case_folio_sequence_update//
CREATE TRIGGER protect_case_folio_sequence_update
BEFORE UPDATE ON case_folio_sequences
FOR EACH ROW
BEGIN
  IF NEW.legal_area_code <> OLD.legal_area_code
     OR NEW.folio_year <> OLD.folio_year THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Case folio sequence identity is immutable';
  END IF;

  IF NEW.last_value <= OLD.last_value THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Case folio sequence cannot decrease';
  END IF;
END//

DROP TRIGGER IF EXISTS no_delete_case_folio_sequence//
CREATE TRIGGER no_delete_case_folio_sequence
BEFORE DELETE ON case_folio_sequences
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'Permanent retention: case folio sequences cannot be deleted';
END//

DELIMITER ;

INSERT INTO schema_migrations (version_code, description)
VALUES (
  '016_automatic_case_folios',
  'Secuencias anuales y transaccionales para generar folios automáticos por materia.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
