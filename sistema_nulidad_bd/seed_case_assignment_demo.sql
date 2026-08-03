-- Datos de desarrollo para comprobar el aislamiento por expediente.
-- Requiere ejecutar primero seed_workspace_users.sql.
-- No elimina registros: las asignaciones anteriores se revocan lógicamente.

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE juzgado_nulidad_documental;
START TRANSACTION;

SET @demo_actor_id := COALESCE(
  (SELECT id FROM users
   WHERE email = 'cristian05corona@gmail.com' AND account_status = 'active'
   LIMIT 1),
  (SELECT created_by_user_id FROM cases ORDER BY id LIMIT 1),
  (SELECT id FROM users WHERE email = 'britany.corona@example.test' LIMIT 1)
);
SET @demo_lawyer_id := (
  SELECT id FROM users WHERE email = 'daniela.elizalde@example.test' LIMIT 1
);
SET @demo_judge_id := (
  SELECT id FROM users WHERE email = 'cintia.guzman@example.test' LIMIT 1
);
SET @demo_unit_id := (
  SELECT id FROM organizational_units WHERE code = 'legacy_court' LIMIT 1
);
SET @original_case_id := (
  SELECT id FROM cases WHERE folio = 'QA-NUL-2026-0001' LIMIT 1
);

INSERT INTO cases (
  folio, title, description, status,
  lawyer_user_id, judge_user_id, created_by_user_id,
  opened_at
)
SELECT
  'DEMO-PEN-2026-0002',
  'Investigación penal de demostración',
  'Expediente de desarrollo asignado al equipo penal.',
  'active',
  @demo_lawyer_id,
  @demo_judge_id,
  @demo_actor_id,
  CURRENT_TIMESTAMP
WHERE @demo_lawyer_id IS NOT NULL
  AND @demo_judge_id IS NOT NULL
  AND @demo_actor_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM cases WHERE folio = 'DEMO-PEN-2026-0002'
  );

SET @penal_case_id := (
  SELECT id FROM cases WHERE folio = 'DEMO-PEN-2026-0002' LIMIT 1
);

INSERT IGNORE INTO case_profiles (
  case_id, case_type_code, organizational_unit_id,
  external_reference, jurisdiction, confidentiality_level,
  lifecycle_status, visibility_status, current_stage_code,
  status_reason, status_changed_by_user_id
)
SELECT
  @penal_case_id,
  'criminal_proceeding',
  @demo_unit_id,
  'DEMO-PENAL-02',
  'Jurisdicción de demostración',
  'restricted',
  'active',
  'visible',
  'evidence',
  'Expediente activo para comprobar asignaciones por caso.',
  @demo_actor_id
WHERE @penal_case_id IS NOT NULL;

INSERT INTO cases (
  folio, title, description, status,
  lawyer_user_id, judge_user_id, created_by_user_id,
  opened_at
)
SELECT
  'DEMO-CIV-2026-0003',
  'Controversia civil pausada de demostración',
  'Expediente pausado para comprobar la prioridad de los asuntos activos.',
  'paused',
  @demo_lawyer_id,
  @demo_judge_id,
  @demo_actor_id,
  CURRENT_TIMESTAMP
WHERE @demo_lawyer_id IS NOT NULL
  AND @demo_judge_id IS NOT NULL
  AND @demo_actor_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM cases WHERE folio = 'DEMO-CIV-2026-0003'
  );

SET @civil_case_id := (
  SELECT id FROM cases WHERE folio = 'DEMO-CIV-2026-0003' LIMIT 1
);

INSERT IGNORE INTO case_profiles (
  case_id, case_type_code, organizational_unit_id,
  external_reference, jurisdiction, confidentiality_level,
  lifecycle_status, visibility_status, current_stage_code,
  status_reason, status_changed_by_user_id
)
SELECT
  @civil_case_id,
  'civil_proceeding',
  @demo_unit_id,
  'DEMO-CIVIL-03',
  'Jurisdicción de demostración',
  'confidential',
  'paused',
  'visible',
  'review',
  'Expediente pausado para comprobar orden y estados.',
  @demo_actor_id
WHERE @civil_case_id IS NOT NULL;

-- Las cuentas heredadas quedan sin acceso activo al expediente original.
UPDATE case_assignments assignment_record
JOIN users user_record ON user_record.id = assignment_record.user_id
SET assignment_record.assignment_status = 'revoked',
    assignment_record.ended_at = CURRENT_TIMESTAMP,
    assignment_record.ended_by_user_id = @demo_actor_id,
    assignment_record.ending_reason = 'Reasignación de datos de desarrollo por expediente.'
WHERE assignment_record.case_id = @original_case_id
  AND assignment_record.assignment_status = 'active'
  AND user_record.email LIKE 'web.%'
  AND @demo_actor_id IS NOT NULL;

INSERT INTO case_assignments (
  case_id, user_id, assignment_type_code, assignment_scope,
  assignment_status, assignment_reason, assigned_by_user_id
)
SELECT
  target_case.case_id,
  user_record.id,
  target_case.assignment_type_code,
  target_case.assignment_scope,
  'active',
  'Asignación diferenciada para comprobar aislamiento por expediente.',
  @demo_actor_id
FROM (
  SELECT @penal_case_id AS case_id, 'daniela.elizalde@example.test' AS email,
         'lawyer' AS assignment_type_code, 'full' AS assignment_scope
  UNION ALL SELECT @penal_case_id, 'cintia.guzman@example.test', 'judge', 'review'
  UNION ALL SELECT @penal_case_id, 'britany.corona@example.test', 'coordinator', 'procedural'
  UNION ALL SELECT @civil_case_id, 'daniela.elizalde@example.test', 'lawyer', 'full'
  UNION ALL SELECT @civil_case_id, 'cintia.guzman@example.test', 'judge', 'review'
  UNION ALL SELECT @civil_case_id, 'britany.corona@example.test', 'coordinator', 'procedural'
) target_case
JOIN users user_record ON user_record.email = target_case.email
WHERE target_case.case_id IS NOT NULL
  AND @demo_actor_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM case_assignments active_assignment
    WHERE active_assignment.case_id = target_case.case_id
      AND active_assignment.user_id = user_record.id
      AND active_assignment.assignment_type_code = target_case.assignment_type_code
      AND active_assignment.assignment_status = 'active'
  );

INSERT INTO case_participant_roles (
  case_id, user_id, participant_role_code,
  participation_status, added_by_user_id, participation_reason
)
SELECT
  @penal_case_id,
  user_record.id,
  mobile_participant.participant_role_code,
  'active',
  @demo_actor_id,
  'Participante de desarrollo del expediente penal.'
FROM (
  SELECT 'mobile.parte.20260731@example.test' AS email,
         'victim' AS participant_role_code
  UNION ALL SELECT 'mobile.testigo.20260731@example.test', 'witness'
) mobile_participant
JOIN users user_record ON user_record.email = mobile_participant.email
WHERE @penal_case_id IS NOT NULL
  AND @demo_actor_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM case_participant_roles active_participant
    WHERE active_participant.case_id = @penal_case_id
      AND active_participant.user_id = user_record.id
      AND active_participant.participant_role_code = mobile_participant.participant_role_code
      AND active_participant.participation_status = 'active'
  );

COMMIT;

SELECT
  case_record.folio,
  profile.lifecycle_status,
  user_record.email,
  assignment_record.assignment_type_code
FROM case_assignments assignment_record
JOIN cases case_record ON case_record.id = assignment_record.case_id
JOIN case_profiles profile ON profile.case_id = case_record.id
JOIN users user_record ON user_record.id = assignment_record.user_id
WHERE assignment_record.assignment_status = 'active'
  AND user_record.email IN (
    'daniela.elizalde@example.test',
    'cintia.guzman@example.test',
    'britany.corona@example.test'
  )
ORDER BY user_record.email, profile.lifecycle_status, case_record.folio;
