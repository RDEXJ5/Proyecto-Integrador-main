-- Actualización controlada de los datos creados por seed_test_data.sql.
-- No modifica binarios, versiones, autorizaciones ni firmas porque son
-- evidencias inmutables. Ejecutar solo en desarrollo o pruebas.

USE juzgado_nulidad_documental;

START TRANSACTION;

UPDATE cases
SET
  title = 'Expediente QA actualizado',
  description = 'Datos sintéticos actualizados para comprobar cambios permitidos.',
  updated_at = CURRENT_TIMESTAMP
WHERE folio = 'QA-NUL-2026-0001';

UPDATE users
SET full_name = 'Parte QA actualizada'
WHERE email = 'qa.parte@example.test';

INSERT INTO audit_events (actor_user_id, action_code, resource_type, resource_id, details, client_channel)
SELECT
  admin_user.id,
  'qa.case.updated',
  'case',
  CAST(case_record.id AS CHAR),
  JSON_OBJECT('title', 'Expediente QA actualizado', 'source', 'update_test_data.sql'),
  'system'
FROM cases case_record
JOIN users admin_user ON admin_user.email = 'qa.admin@example.test'
WHERE case_record.folio = 'QA-NUL-2026-0001'
  AND NOT EXISTS (
    SELECT 1 FROM audit_events audit_record
    WHERE audit_record.action_code = 'qa.case.updated'
      AND audit_record.resource_type = 'case'
      AND audit_record.resource_id = CAST(case_record.id AS CHAR)
  );

COMMIT;

SELECT folio, title, updated_at
FROM cases
WHERE folio = 'QA-NUL-2026-0001';
