-- Cuentas funcionales de desarrollo para todos los espacios de trabajo.
-- Contraseña general de desarrollo: 2318.
-- Cuenta cristian05corona@gmail.com: 27098644.
-- No ejecutar en producción.

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE juzgado_nulidad_documental;

INSERT INTO users (full_name, email, password_hash, account_status) VALUES
  ('Cristian Erasto Corona Uribe', 'cristian05corona@gmail.com', '$2b$12$hEmJVXQudair56RJFHUTY.vRWfnY3knAwtryCE.uBxs7/6wHeaUKa', 'active'),
  ('Fiscal Integración Web', 'web.fiscal.20260731@example.test', '$2b$12$k3WimeBwsR8A8sewxg.hve5nZfLYNV.31fS91RYlZo4cyzu1n4asu', 'active'),
  ('Defensor Integración Web', 'web.defensor.20260731@example.test', '$2b$12$aHjlWlhFJEEdsBy136N/9e3c0NVGmsZdKtQYMIVaMUKI4Mg0DdKgy', 'active'),
  ('Perito Integración Web', 'web.perito.20260731@example.test', '$2b$12$en7l1ZkpHkHXwtxpahNgUORw6/GVlkCUgOz5JyTiyVDUTybVQUUGK', 'active'),
  ('Secretario Integración Web', 'web.secretario.20260731@example.test', '$2b$12$5udP0k9RcoxhgDXPJyWBVOTl/gX8KQ.bLUuOObHR4TXTUmvgiWs2q', 'active'),
  ('Coordinador Integración Web', 'web.coordinador.20260731@example.test', '$2b$12$JsbMc9YezmreZwwl3X/equKzgnA69mbkZDQazRIJHSOiKqEvwSB3S', 'active'),
  ('Auditor Integración Web', 'web.auditor.20260731@example.test', '$2b$12$k8EslV5oejfSA7veO2vYiOf0TjgG4Ad9SR9AR.SoktoXeLa5Io18G', 'active'),
  ('Parte Integración Móvil', 'mobile.parte.20260731@example.test', '$2b$12$JrHnPoKfMe//V10/zOLi8OHEzZAze4l9mMQbaGzQE8jaiUx7nsQye', 'active'),
  ('Testigo Integración Móvil', 'mobile.testigo.20260731@example.test', '$2b$12$18f.9SEhQ1pDc5t4CUm9J.dE6l8TM8Hg30.ZNgIA.lWIvvQcCjAdW', 'active')
ON DUPLICATE KEY UPDATE
  full_name = VALUES(full_name),
  password_hash = VALUES(password_hash),
  account_status = 'active';

SET @development_admin_id := (
  SELECT id FROM users WHERE email = 'admin.web@example.test' LIMIT 1
);
SET @development_case_id := (
  SELECT id FROM cases ORDER BY id LIMIT 1
);
SET @development_case_creator_id := (
  SELECT created_by_user_id FROM cases WHERE id = @development_case_id
);

INSERT IGNORE INTO user_roles (user_id, role_code, assigned_by_user_id)
SELECT user_record.id, assignments.role_code, @development_admin_id
FROM (
  SELECT 'cristian05corona@gmail.com' email, 'admin' role_code
  UNION ALL SELECT 'web.fiscal.20260731@example.test', 'prosecutor'
  UNION ALL SELECT 'web.defensor.20260731@example.test', 'defender'
  UNION ALL SELECT 'web.perito.20260731@example.test', 'expert'
  UNION ALL SELECT 'web.secretario.20260731@example.test', 'secretary'
  UNION ALL SELECT 'web.coordinador.20260731@example.test', 'coordinator'
  UNION ALL SELECT 'web.auditor.20260731@example.test', 'auditor'
  UNION ALL SELECT 'mobile.parte.20260731@example.test', 'party'
  UNION ALL SELECT 'mobile.testigo.20260731@example.test', 'witness'
) assignments
JOIN users user_record ON user_record.email = assignments.email;

INSERT IGNORE INTO user_role_grants (
  user_id, role_code, grant_status,
  granted_by_user_id, grant_reason
)
SELECT
  user_record.id,
  assignments.role_code,
  'active',
  @development_admin_id,
  'Cuenta funcional creada por seed_workspace_users.sql.'
FROM (
  SELECT 'cristian05corona@gmail.com' email, 'admin' role_code
  UNION ALL SELECT 'web.fiscal.20260731@example.test', 'prosecutor'
  UNION ALL SELECT 'web.defensor.20260731@example.test', 'defender'
  UNION ALL SELECT 'web.perito.20260731@example.test', 'expert'
  UNION ALL SELECT 'web.secretario.20260731@example.test', 'secretary'
  UNION ALL SELECT 'web.coordinador.20260731@example.test', 'coordinator'
  UNION ALL SELECT 'web.auditor.20260731@example.test', 'auditor'
  UNION ALL SELECT 'mobile.parte.20260731@example.test', 'party'
  UNION ALL SELECT 'mobile.testigo.20260731@example.test', 'witness'
) assignments
JOIN users user_record ON user_record.email = assignments.email;

INSERT IGNORE INTO case_assignments (
  case_id, user_id, assignment_type_code, assignment_scope,
  assignment_status, assignment_reason,
  assigned_by_user_id
)
SELECT
  @development_case_id,
  user_record.id,
  assignments.assignment_type_code,
  assignments.assignment_scope,
  'active',
  'Asignación funcional para pruebas de espacios de trabajo.',
  @development_case_creator_id
FROM (
  SELECT 'web.abogado.20260731@example.test' email, 'lawyer' assignment_type_code, 'full' assignment_scope
  UNION ALL SELECT 'web.juez.20260731@example.test', 'judge', 'review'
  UNION ALL SELECT 'web.notario.20260731@example.test', 'notary', 'review'
  UNION ALL SELECT 'web.fiscal.20260731@example.test', 'prosecutor', 'full'
  UNION ALL SELECT 'web.defensor.20260731@example.test', 'defender', 'full'
  UNION ALL SELECT 'web.perito.20260731@example.test', 'expert', 'documental'
  UNION ALL SELECT 'web.secretario.20260731@example.test', 'secretary', 'procedural'
  UNION ALL SELECT 'web.coordinador.20260731@example.test', 'coordinator', 'procedural'
) assignments
JOIN users user_record ON user_record.email = assignments.email
WHERE @development_case_id IS NOT NULL;

INSERT IGNORE INTO user_unit_memberships (
  user_id, organizational_unit_id, membership_type,
  membership_status, membership_reason,
  granted_by_user_id
)
SELECT
  user_record.id,
  unit_record.id,
  memberships.membership_type,
  'active',
  'Membresía funcional para pruebas de alcance por unidad.',
  COALESCE(@development_admin_id, @development_case_creator_id)
FROM (
  SELECT 'web.secretario.20260731@example.test' email, 'member' membership_type
  UNION ALL SELECT 'web.coordinador.20260731@example.test', 'supervisor'
  UNION ALL SELECT 'web.auditor.20260731@example.test', 'auditor'
) memberships
JOIN users user_record ON user_record.email = memberships.email
JOIN organizational_units unit_record ON unit_record.code = 'legacy_court';

-- Compatibilidad temporal con la API móvil actual y registro generalizado.
INSERT IGNORE INTO case_participants (
  case_id, user_id, participation_kind
)
SELECT @development_case_id, user_record.id, participants.participation_kind
FROM (
  SELECT 'mobile.parte.20260731@example.test' email, 'petitioner' participation_kind
  UNION ALL SELECT 'mobile.testigo.20260731@example.test', 'witness'
) participants
JOIN users user_record ON user_record.email = participants.email
WHERE @development_case_id IS NOT NULL;

INSERT IGNORE INTO case_participant_roles (
  case_id, user_id, participant_role_code,
  participation_status, added_by_user_id,
  participation_reason
)
SELECT
  @development_case_id,
  user_record.id,
  participants.participant_role_code,
  'active',
  @development_case_creator_id,
  'Participación funcional para pruebas del canal móvil.'
FROM (
  SELECT 'mobile.parte.20260731@example.test' email, 'petitioner' participant_role_code
  UNION ALL SELECT 'mobile.testigo.20260731@example.test', 'witness'
) participants
JOIN users user_record ON user_record.email = participants.email
WHERE @development_case_id IS NOT NULL;

INSERT INTO audit_events (
  actor_user_id, action_code, resource_type,
  resource_id, details, client_channel
)
SELECT
  @development_admin_id,
  'development_workspace_accounts_seeded',
  'system',
  'workspace_accounts_20260731',
  JSON_OBJECT('accounts', 8, 'passwordPolicy', 'development-only'),
  'system'
WHERE NOT EXISTS (
  SELECT 1 FROM audit_events
  WHERE action_code = 'development_workspace_accounts_seeded'
    AND resource_id = 'workspace_accounts_20260731'
);

SELECT
  user_record.email,
  role_record.code AS role_code,
  role_record.channel,
  user_record.account_status
FROM users user_record
JOIN user_roles user_role ON user_role.user_id = user_record.id
JOIN roles role_record ON role_record.code = user_role.role_code
WHERE user_record.email IN (
  'web.fiscal.20260731@example.test',
  'web.defensor.20260731@example.test',
  'web.perito.20260731@example.test',
  'web.secretario.20260731@example.test',
  'web.coordinador.20260731@example.test',
  'web.auditor.20260731@example.test',
  'mobile.parte.20260731@example.test',
  'mobile.testigo.20260731@example.test'
)
ORDER BY role_record.channel, role_record.code;
