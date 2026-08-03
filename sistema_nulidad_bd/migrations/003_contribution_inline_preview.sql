-- Migracion 003: vista previa web para perfiles de carga y seguimiento.
-- Es aditiva e idempotente. No concede el permiso de descarga.

USE juzgado_nulidad_documental;

START TRANSACTION;

INSERT IGNORE INTO role_permission_grants (
  role_code,
  permission_code,
  grant_status,
  grant_reason
)
SELECT
  contribution_role.role_code,
  'document.content.read.web',
  'active',
  'Vista previa en linea del documento; la descarga permanece restringida.'
FROM (
  SELECT 'lawyer' AS role_code
  UNION ALL SELECT 'prosecutor'
  UNION ALL SELECT 'defender'
  UNION ALL SELECT 'expert'
) AS contribution_role;

INSERT INTO schema_migrations (version_code, description)
VALUES (
  '003_contribution_inline_preview',
  'Permite vista previa web a perfiles de contribucion sin conceder descarga.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);

COMMIT;
