-- Corrige exclusivamente la redacción de los expedientes sintéticos de desarrollo.
-- No modifica expedientes reales ni elimina información.

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE juzgado_nulidad_documental;

START TRANSACTION;

UPDATE cases
SET title = 'Investigación penal de demostración'
WHERE folio = 'DEMO-PEN-2026-0002';

UPDATE cases
SET title = 'Controversia civil pausada de demostración'
WHERE folio = 'DEMO-CIV-2026-0003';

UPDATE case_profiles AS profile
JOIN cases AS case_record ON case_record.id = profile.case_id
SET profile.jurisdiction = 'Jurisdicción de demostración'
WHERE case_record.folio IN ('DEMO-PEN-2026-0002', 'DEMO-CIV-2026-0003');

INSERT INTO schema_migrations (version_code, description)
VALUES (
  '009_spanish_demo_copy',
  'Corrige acentos y redacción visible de los expedientes sintéticos de desarrollo.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);

COMMIT;
