-- Cuentas funcionales de desarrollo para los espacios de trabajo.
-- Cuentas web operativas: contraseña 12345678.
-- Cuenta administradora cristian05corona@gmail.com: contraseña 27098644.
-- Cuentas móviles de demostración: contraseña 2318.
-- No ejecutar en produccion.

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE juzgado_nulidad_documental;

-- INSERT IGNORE evita reactivar o sobrescribir cuentas dadas de baja.
INSERT IGNORE INTO users (full_name, email, password_hash, account_status) VALUES
  ('Cristian Erasto Corona Uribe', 'cristian05corona@gmail.com', '$2b$12$hEmJVXQudair56RJFHUTY.vRWfnY3knAwtryCE.uBxs7/6wHeaUKa', 'active'),
  ('Daniela Lisset Elizalde Ortiz', 'daniela.elizalde@example.test', '$2b$12$1Cn0BsVvGRDQM.PbV9u36uwg/UnenECI/RliqX5LNioEu8QFwcC6C', 'active'),
  ('Cintia Ailin Guzman Morales', 'cintia.guzman@example.test', '$2b$12$1Cn0BsVvGRDQM.PbV9u36uwg/UnenECI/RliqX5LNioEu8QFwcC6C', 'active'),
  ('Britany Itzel Corona Uribe', 'britany.corona@example.test', '$2b$12$1Cn0BsVvGRDQM.PbV9u36uwg/UnenECI/RliqX5LNioEu8QFwcC6C', 'active'),
  ('Jesus Alejandro Corona Sixtos', 'jesus.corona@example.test', '$2b$12$1Cn0BsVvGRDQM.PbV9u36uwg/UnenECI/RliqX5LNioEu8QFwcC6C', 'active'),
  ('Parte Integración Móvil', 'mobile.parte.20260731@example.test', '$2b$12$JrHnPoKfMe//V10/zOLi8OHEzZAze4l9mMQbaGzQE8jaiUx7nsQye', 'active'),
  ('Testigo Integración Móvil', 'mobile.testigo.20260731@example.test', '$2b$12$18f.9SEhQ1pDc5t4CUm9J.dE6l8TM8Hg30.ZNgIA.lWIvvQcCjAdW', 'active');

SET @development_admin_id := COALESCE(
  (SELECT id FROM users
   WHERE email = 'cristian05corona@gmail.com' AND account_status = 'active'
   LIMIT 1),
  (SELECT id FROM users
   WHERE email = 'admin.web@example.test' AND account_status = 'active'
   LIMIT 1),
  (SELECT id FROM users WHERE email = 'britany.corona@example.test' LIMIT 1)
);
SET @development_case_id := (
  SELECT id FROM cases ORDER BY id LIMIT 1
);
SET @development_case_creator_id := COALESCE(
  (SELECT created_by_user_id FROM cases WHERE id = @development_case_id),
  @development_admin_id
);

INSERT IGNORE INTO user_roles (user_id, role_code, assigned_by_user_id)
SELECT user_record.id, account_role.role_code, @development_admin_id
FROM (
  SELECT 'cristian05corona@gmail.com' AS email, 'admin' AS role_code
  UNION ALL SELECT 'daniela.elizalde@example.test', 'lawyer'
  UNION ALL SELECT 'cintia.guzman@example.test', 'judge'
  UNION ALL SELECT 'britany.corona@example.test', 'coordinator'
  UNION ALL SELECT 'jesus.corona@example.test', 'auditor'
  UNION ALL SELECT 'mobile.parte.20260731@example.test', 'party'
  UNION ALL SELECT 'mobile.testigo.20260731@example.test', 'witness'
) account_role
JOIN users user_record ON user_record.email = account_role.email;

INSERT INTO user_role_grants (
  user_id, role_code, grant_status, granted_by_user_id, grant_reason
)
SELECT
  user_record.id,
  account_role.role_code,
  'active',
  @development_admin_id,
  'Cuenta funcional creada por seed_workspace_users.sql.'
FROM (
  SELECT 'cristian05corona@gmail.com' AS email, 'admin' AS role_code
  UNION ALL SELECT 'daniela.elizalde@example.test', 'lawyer'
  UNION ALL SELECT 'cintia.guzman@example.test', 'judge'
  UNION ALL SELECT 'britany.corona@example.test', 'coordinator'
  UNION ALL SELECT 'jesus.corona@example.test', 'auditor'
  UNION ALL SELECT 'mobile.parte.20260731@example.test', 'party'
  UNION ALL SELECT 'mobile.testigo.20260731@example.test', 'witness'
) account_role
JOIN users user_record ON user_record.email = account_role.email
WHERE NOT EXISTS (
  SELECT 1 FROM user_role_grants active_grant
  WHERE active_grant.user_id = user_record.id
    AND active_grant.role_code = account_role.role_code
    AND active_grant.grant_status = 'active'
);

INSERT INTO case_assignments (
  case_id, user_id, assignment_type_code, assignment_scope,
  assignment_status, assignment_reason, assigned_by_user_id
)
SELECT
  @development_case_id,
  user_record.id,
  account_assignment.assignment_type_code,
  account_assignment.assignment_scope,
  'active',
  'Asignación funcional para probar el espacio de trabajo.',
  @development_case_creator_id
FROM (
  SELECT 'daniela.elizalde@example.test' AS email,
         'lawyer' AS assignment_type_code, 'full' AS assignment_scope
  UNION ALL SELECT 'cintia.guzman@example.test', 'judge', 'review'
  UNION ALL SELECT 'britany.corona@example.test', 'coordinator', 'procedural'
) account_assignment
JOIN users user_record ON user_record.email = account_assignment.email
WHERE @development_case_id IS NOT NULL
  AND @development_case_creator_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM case_assignments active_assignment
    WHERE active_assignment.case_id = @development_case_id
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
  'Membresía funcional para probar el alcance por unidad.',
  @development_admin_id
FROM (
  SELECT 'britany.corona@example.test' AS email, 'supervisor' AS membership_type
  UNION ALL SELECT 'jesus.corona@example.test', 'auditor'
) account_membership
JOIN users user_record ON user_record.email = account_membership.email
JOIN organizational_units unit_record ON unit_record.code = 'legacy_court'
WHERE @development_admin_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM user_unit_memberships active_membership
    WHERE active_membership.user_id = user_record.id
      AND active_membership.organizational_unit_id = unit_record.id
      AND active_membership.membership_type = account_membership.membership_type
      AND active_membership.membership_status = 'active'
  );

-- Compatibilidad temporal con la API movil y el registro generalizado.
INSERT IGNORE INTO case_participants (case_id, user_id, participation_kind)
SELECT @development_case_id, user_record.id, mobile_account.participation_kind
FROM (
  SELECT 'mobile.parte.20260731@example.test' AS email,
         'petitioner' AS participation_kind
  UNION ALL SELECT 'mobile.testigo.20260731@example.test', 'witness'
) mobile_account
JOIN users user_record ON user_record.email = mobile_account.email
WHERE @development_case_id IS NOT NULL;

INSERT INTO case_participant_roles (
  case_id, user_id, participant_role_code,
  participation_status, added_by_user_id, participation_reason
)
SELECT
  @development_case_id,
  user_record.id,
  mobile_account.participant_role_code,
  'active',
  @development_case_creator_id,
  'Participación funcional para pruebas del canal móvil.'
FROM (
  SELECT 'mobile.parte.20260731@example.test' AS email,
         'petitioner' AS participant_role_code
  UNION ALL SELECT 'mobile.testigo.20260731@example.test', 'witness'
) mobile_account
JOIN users user_record ON user_record.email = mobile_account.email
WHERE @development_case_id IS NOT NULL
  AND @development_case_creator_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM case_participant_roles active_participant
    WHERE active_participant.case_id = @development_case_id
      AND active_participant.user_id = user_record.id
      AND active_participant.participant_role_code = mobile_account.participant_role_code
      AND active_participant.participation_status = 'active'
  );

INSERT INTO audit_events (
  actor_user_id, action_code, resource_type,
  resource_id, details, client_channel
)
SELECT
  @development_admin_id,
  'development_workspace_accounts_seeded',
  'system',
  'workspace_accounts_20260803',
  JSON_OBJECT('workspaceAccounts', 4, 'passwordPolicy', 'development-only'),
  'system'
WHERE @development_admin_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM audit_events
    WHERE action_code = 'development_workspace_accounts_seeded'
      AND resource_id = 'workspace_accounts_20260803'
  );

SELECT
  user_record.full_name,
  user_record.email,
  role_record.label AS role_name,
  role_record.channel,
  user_record.account_status
FROM users user_record
JOIN user_role_grants role_grant
  ON role_grant.user_id = user_record.id
 AND role_grant.grant_status = 'active'
JOIN roles role_record ON role_record.code = role_grant.role_code
WHERE user_record.email IN (
  'daniela.elizalde@example.test',
  'cintia.guzman@example.test',
  'britany.corona@example.test',
  'jesus.corona@example.test',
  'mobile.parte.20260731@example.test',
  'mobile.testigo.20260731@example.test'
)
ORDER BY role_record.channel, role_record.code;
