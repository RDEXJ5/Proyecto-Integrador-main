-- Datos de desarrollo para comprobar aislamiento por expediente.
-- Requiere ejecutar primero seed_workspace_users.sql.
-- No elimina registros: las asignaciones anteriores se revocan logicamente.

USE juzgado_nulidad_documental;
START TRANSACTION;

SET @demo_actor_id := (
  SELECT created_by_user_id FROM cases ORDER BY id LIMIT 1
);
SET @demo_lawyer_id := (
  SELECT id FROM users WHERE email = 'web.abogado.20260731@example.test' LIMIT 1
);
SET @demo_judge_id := (
  SELECT id FROM users WHERE email = 'web.juez.20260731@example.test' LIMIT 1
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

-- Las asignaciones de demostración que no corresponden al caso matrimonial
-- se conservan como revocadas en lugar de borrarse.
UPDATE case_assignments assignment_record
JOIN users user_record ON user_record.id = assignment_record.user_id
SET
  assignment_record.assignment_status = 'revoked',
  assignment_record.ended_at = CURRENT_TIMESTAMP,
  assignment_record.ended_by_user_id = @demo_actor_id,
  assignment_record.ending_reason = 'Reasignación de datos de desarrollo por expediente.'
WHERE assignment_record.case_id = @original_case_id
  AND assignment_record.assignment_status = 'active'
  AND user_record.email IN (
    'web.fiscal.20260731@example.test',
    'web.defensor.20260731@example.test',
    'web.perito.20260731@example.test',
    'web.coordinador.20260731@example.test'
  );

INSERT IGNORE INTO case_assignments (
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
  SELECT @penal_case_id case_id, 'web.juez.20260731@example.test' email, 'judge' assignment_type_code, 'review' assignment_scope
  UNION ALL SELECT @penal_case_id, 'web.fiscal.20260731@example.test', 'prosecutor', 'full'
  UNION ALL SELECT @penal_case_id, 'web.defensor.20260731@example.test', 'defender', 'full'
  UNION ALL SELECT @penal_case_id, 'web.perito.20260731@example.test', 'expert', 'documental'
  UNION ALL SELECT @penal_case_id, 'web.secretario.20260731@example.test', 'secretary', 'procedural'
  UNION ALL SELECT @civil_case_id, 'web.juez.20260731@example.test', 'judge', 'review'
  UNION ALL SELECT @civil_case_id, 'web.notario.20260731@example.test', 'notary', 'review'
  UNION ALL SELECT @civil_case_id, 'web.coordinador.20260731@example.test', 'coordinator', 'procedural'
) target_case
JOIN users user_record ON user_record.email = target_case.email
WHERE target_case.case_id IS NOT NULL;

INSERT IGNORE INTO case_participant_roles (
  case_id, user_id, participant_role_code,
  participation_status, added_by_user_id, participation_reason
)
SELECT
  @penal_case_id,
  user_record.id,
  participant_record.participant_role_code,
  'active',
  @demo_actor_id,
  'Participante de desarrollo del expediente penal.'
FROM (
  SELECT 'mobile.parte.20260731@example.test' email, 'victim' participant_role_code
  UNION ALL SELECT 'mobile.testigo.20260731@example.test', 'witness'
) participant_record
JOIN users user_record ON user_record.email = participant_record.email
WHERE @penal_case_id IS NOT NULL;

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
  AND user_record.email LIKE 'web.%20260731@example.test'
ORDER BY user_record.email, profile.lifecycle_status, case_record.folio;
