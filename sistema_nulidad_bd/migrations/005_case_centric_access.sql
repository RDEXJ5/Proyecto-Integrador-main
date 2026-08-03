-- Migracion 005: acceso centrado en expedientes y consulta de personas involucradas.
-- Mantiene asignaciones, participantes e historial sin eliminacion fisica.

USE juzgado_nulidad_documental;

INSERT INTO permissions (code, description)
VALUES (
  'case.people.read',
  'Consultar responsables y participantes de un expediente autorizado.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT IGNORE INTO role_permission_grants (
  role_code,
  permission_code,
  grant_status,
  grant_reason
)
SELECT
  permitted_role.role_code,
  'case.people.read',
  'active',
  'Consulta minima de personas para revision, gestion procesal y auditoria.'
FROM (
  SELECT 'judge' AS role_code
  UNION ALL SELECT 'notary'
  UNION ALL SELECT 'secretary'
  UNION ALL SELECT 'coordinator'
  UNION ALL SELECT 'auditor'
) AS permitted_role;

INSERT INTO schema_migrations (version_code, description)
VALUES (
  '005_case_centric_access',
  'Consulta autorizada de personas y navegacion centrada en expedientes asignados.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);
