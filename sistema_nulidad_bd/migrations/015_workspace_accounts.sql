-- Migración 015: cuentas definitivas para los espacios web de desarrollo.
-- Conserva la trazabilidad: las cuentas heredadas web.* se archivan y sus
-- relaciones activas se revocan; ninguna fila se elimina físicamente.

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE juzgado_nulidad_documental;

START TRANSACTION;

-- Contraseña de desarrollo para estas cuatro cuentas: 12345678.
-- El valor almacenado es un hash bcrypt; la contraseña nunca se guarda en claro.
INSERT INTO users (full_name, email, password_hash, account_status)
SELECT account_record.full_name, account_record.email,
       '$2b$12$1Cn0BsVvGRDQM.PbV9u36uwg/UnenECI/RliqX5LNioEu8QFwcC6C',
       'active'
FROM (
  SELECT 'Daniela Lisset Elizalde Ortiz' AS full_name,
         'daniela.elizalde@example.test' AS email
  UNION ALL
  SELECT 'Cintia Ailin Guzman Morales', 'cintia.guzman@example.test'
  UNION ALL
  SELECT 'Britany Itzel Corona Uribe', 'britany.corona@example.test'
  UNION ALL
  SELECT 'Jesus Alejandro Corona Sixtos', 'jesus.corona@example.test'
) account_record
WHERE NOT EXISTS (
  SELECT 1 FROM users user_record WHERE user_record.email = account_record.email
);

SET @workspace_actor_id := COALESCE(
  (SELECT id FROM users
   WHERE email = 'cristian05corona@gmail.com' AND account_status = 'active'
   LIMIT 1),
  (SELECT grant_record.user_id
   FROM user_role_grants grant_record
   JOIN users user_record ON user_record.id = grant_record.user_id
   WHERE grant_record.role_code = 'admin'
     AND grant_record.grant_status = 'active'
     AND user_record.account_status = 'active'
   ORDER BY grant_record.id
   LIMIT 1),
  (SELECT id FROM users WHERE email = 'britany.corona@example.test' LIMIT 1)
);

-- Compatibilidad con las consultas heredadas y concesiones revocables vigentes.
INSERT IGNORE INTO user_roles (user_id, role_code, assigned_by_user_id)
SELECT user_record.id, account_role.role_code, @workspace_actor_id
FROM (
  SELECT 'daniela.elizalde@example.test' AS email, 'lawyer' AS role_code
  UNION ALL SELECT 'cintia.guzman@example.test', 'judge'
  UNION ALL SELECT 'britany.corona@example.test', 'coordinator'
  UNION ALL SELECT 'jesus.corona@example.test', 'auditor'
) account_role
JOIN users user_record ON user_record.email = account_role.email;

INSERT INTO user_role_grants (
  user_id, role_code, grant_status, granted_by_user_id, grant_reason
)
SELECT
  user_record.id,
  account_role.role_code,
  'active',
  @workspace_actor_id,
  'Cuenta de desarrollo para un espacio de trabajo web.'
FROM (
  SELECT 'daniela.elizalde@example.test' AS email, 'lawyer' AS role_code
  UNION ALL SELECT 'cintia.guzman@example.test', 'judge'
  UNION ALL SELECT 'britany.corona@example.test', 'coordinator'
  UNION ALL SELECT 'jesus.corona@example.test', 'auditor'
) account_role
JOIN users user_record ON user_record.email = account_role.email
WHERE NOT EXISTS (
  SELECT 1
  FROM user_role_grants active_grant
  WHERE active_grant.user_id = user_record.id
    AND active_grant.role_code = account_role.role_code
    AND active_grant.grant_status = 'active'
);

-- Las cuentas operativas reciben los expedientes existentes para que sus
-- espacios puedan probarse inmediatamente. El auditor usa alcance global.
INSERT INTO case_assignments (
  case_id, user_id, assignment_type_code, assignment_scope,
  assignment_status, assignment_reason, assigned_by_user_id
)
SELECT
  case_record.id,
  user_record.id,
  account_assignment.assignment_type_code,
  account_assignment.assignment_scope,
  'active',
  'Asignación de desarrollo para comprobar el espacio de trabajo.',
  @workspace_actor_id
FROM cases case_record
CROSS JOIN (
  SELECT 'daniela.elizalde@example.test' AS email,
         'lawyer' AS assignment_type_code, 'full' AS assignment_scope
  UNION ALL
  SELECT 'cintia.guzman@example.test', 'judge', 'review'
  UNION ALL
  SELECT 'britany.corona@example.test', 'coordinator', 'procedural'
) account_assignment
JOIN users user_record ON user_record.email = account_assignment.email
WHERE @workspace_actor_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM case_assignments active_assignment
    WHERE active_assignment.case_id = case_record.id
      AND active_assignment.user_id = user_record.id
      AND active_assignment.assignment_type_code = account_assignment.assignment_type_code
      AND active_assignment.assignment_status = 'active'
  );

INSERT INTO user_unit_memberships (
  user_id, organizational_unit_id, membership_type,
  membership_status, membership_reason, granted_by_user_id
)
SELECT
  user_record.id,
  unit_record.id,
  account_membership.membership_type,
  'active',
  'Membresía de desarrollo para el alcance organizativo del espacio.',
  @workspace_actor_id
FROM (
  SELECT 'britany.corona@example.test' AS email, 'supervisor' AS membership_type
  UNION ALL SELECT 'jesus.corona@example.test', 'auditor'
) account_membership
JOIN users user_record ON user_record.email = account_membership.email
JOIN organizational_units unit_record ON unit_record.code = 'legacy_court'
WHERE @workspace_actor_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM user_unit_memberships active_membership
    WHERE active_membership.user_id = user_record.id
      AND active_membership.organizational_unit_id = unit_record.id
      AND active_membership.membership_type = account_membership.membership_type
      AND active_membership.membership_status = 'active'
  );

-- Retiro logico de todas las cuentas cuyo correo comienza con "web.".
UPDATE case_assignments assignment_record
JOIN users user_record ON user_record.id = assignment_record.user_id
SET assignment_record.assignment_status = 'revoked',
    assignment_record.ended_at = CURRENT_TIMESTAMP,
    assignment_record.ended_by_user_id = @workspace_actor_id,
    assignment_record.ending_reason = 'Cuenta heredada retirada por la migración 015.'
WHERE user_record.email LIKE 'web.%'
  AND assignment_record.assignment_status = 'active'
  AND @workspace_actor_id IS NOT NULL;

UPDATE user_unit_memberships membership_record
JOIN users user_record ON user_record.id = membership_record.user_id
SET membership_record.membership_status = 'revoked',
    membership_record.revoked_at = CURRENT_TIMESTAMP,
    membership_record.revoked_by_user_id = @workspace_actor_id,
    membership_record.revocation_reason = 'Cuenta heredada retirada por la migración 015.'
WHERE user_record.email LIKE 'web.%'
  AND membership_record.membership_status = 'active'
  AND @workspace_actor_id IS NOT NULL;

UPDATE case_participant_roles participant_record
JOIN users user_record ON user_record.id = participant_record.user_id
SET participant_record.participation_status = 'inactive',
    participant_record.ended_at = CURRENT_TIMESTAMP,
    participant_record.ended_by_user_id = @workspace_actor_id,
    participant_record.ending_reason = 'Cuenta heredada retirada por la migración 015.'
WHERE user_record.email LIKE 'web.%'
  AND participant_record.participation_status = 'active'
  AND @workspace_actor_id IS NOT NULL;

UPDATE user_role_grants grant_record
JOIN users user_record ON user_record.id = grant_record.user_id
SET grant_record.grant_status = 'revoked',
    grant_record.revoked_at = CURRENT_TIMESTAMP,
    grant_record.revoked_by_user_id = @workspace_actor_id,
    grant_record.revocation_reason = 'Cuenta heredada retirada por la migración 015.'
WHERE user_record.email LIKE 'web.%'
  AND grant_record.grant_status = 'active'
  AND @workspace_actor_id IS NOT NULL;

INSERT INTO user_status_changes (
  user_id, previous_status, new_status, reason, changed_by_user_id
)
SELECT
  user_record.id,
  user_record.account_status,
  'archived',
  'Cuenta heredada web.* retirada sin eliminar su historial.',
  @workspace_actor_id
FROM users user_record
WHERE user_record.email LIKE 'web.%'
  AND user_record.account_status <> 'archived'
  AND @workspace_actor_id IS NOT NULL;

UPDATE users
SET account_status = 'archived'
WHERE email LIKE 'web.%'
  AND account_status <> 'archived'
  AND @workspace_actor_id IS NOT NULL;

INSERT INTO audit_events (
  actor_user_id, action_code, resource_type,
  resource_id, details, client_channel
)
SELECT
  @workspace_actor_id,
  'workspace_accounts_replaced',
  'system',
  'workspace_accounts_015',
  JSON_OBJECT(
    'createdAccounts', 4,
    'legacyEmailPrefix', 'web.',
    'removalMode', 'logical'
  ),
  'system'
WHERE @workspace_actor_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM audit_events
    WHERE action_code = 'workspace_accounts_replaced'
      AND resource_id = 'workspace_accounts_015'
  );

INSERT INTO schema_migrations (version_code, description)
VALUES (
  '015_workspace_accounts',
  'Cuentas por espacio web y retiro lógico de las cuentas heredadas web.*.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);

COMMIT;
