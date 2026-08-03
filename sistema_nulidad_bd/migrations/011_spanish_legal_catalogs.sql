-- Restablece en UTF-8 los catálogos jurídicos visibles.
-- No cambia identificadores, reglas documentales, asignaciones ni permisos.

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE juzgado_nulidad_documental;

START TRANSACTION;

INSERT INTO legal_areas (code, label, description) VALUES
  ('family', 'Familiar', 'Asuntos familiares, matrimoniales y de estado civil.'),
  ('criminal', 'Penal', 'Investigación, acusación, defensa y resolución de asuntos penales.'),
  ('civil', 'Civil', 'Controversias civiles y obligaciones entre particulares.'),
  ('commercial', 'Mercantil', 'Controversias y procedimientos de naturaleza mercantil.'),
  ('labor', 'Laboral', 'Conflictos y procedimientos en materia de trabajo.'),
  ('administrative', 'Administrativa', 'Procedimientos y controversias administrativas.'),
  ('constitutional', 'Constitucional', 'Control constitucional y protección de derechos.'),
  ('other', 'Otra', 'Materia configurable no incluida en los catálogos iniciales.')
ON DUPLICATE KEY UPDATE label = VALUES(label), description = VALUES(description);

INSERT INTO case_types (code, legal_area_code, label, description, default_confidentiality) VALUES
  ('matrimonial_nullity', 'family', 'Nulidad matrimonial', 'Procedimiento de nulidad matrimonial.', 'restricted'),
  ('family_proceeding', 'family', 'Procedimiento familiar', 'Asunto general de materia familiar.', 'restricted'),
  ('criminal_proceeding', 'criminal', 'Procedimiento penal', 'Asunto general de materia penal.', 'restricted'),
  ('civil_proceeding', 'civil', 'Procedimiento civil', 'Asunto general de materia civil.', 'confidential'),
  ('commercial_proceeding', 'commercial', 'Procedimiento mercantil', 'Asunto general de materia mercantil.', 'confidential'),
  ('labor_proceeding', 'labor', 'Procedimiento laboral', 'Asunto general de materia laboral.', 'confidential'),
  ('administrative_proceeding', 'administrative', 'Procedimiento administrativo', 'Asunto general de materia administrativa.', 'confidential'),
  ('constitutional_proceeding', 'constitutional', 'Procedimiento constitucional', 'Asunto general de materia constitucional.', 'restricted'),
  ('other_proceeding', 'other', 'Otro procedimiento', 'Tipo configurable para asuntos no catalogados.', 'confidential')
ON DUPLICATE KEY UPDATE
  legal_area_code = VALUES(legal_area_code),
  label = VALUES(label),
  description = VALUES(description),
  default_confidentiality = VALUES(default_confidentiality);

INSERT INTO organizational_units (code, name, unit_type)
VALUES ('legacy_court', 'Unidad jurisdiccional migrada', 'court')
ON DUPLICATE KEY UPDATE name = VALUES(name), unit_type = VALUES(unit_type);

INSERT INTO case_assignment_types (code, label, description, related_role_code) VALUES
  ('lawyer', 'Abogado responsable', 'Representación jurídica asignada.', 'lawyer'),
  ('prosecutor', 'Fiscal asignado', 'Intervención fiscal asignada.', 'prosecutor'),
  ('defender', 'Defensor asignado', 'Defensa jurídica asignada.', 'defender'),
  ('expert', 'Perito designado', 'Intervención pericial acotada al asunto.', 'expert'),
  ('judge', 'Juez asignado', 'Responsable de revisión y decisión judicial.', 'judge'),
  ('notary', 'Notario asignado', 'Responsable de autorización y certificación documental.', 'notary'),
  ('secretary', 'Secretario responsable', 'Operación procesal del expediente.', 'secretary'),
  ('coordinator', 'Coordinador responsable', 'Supervisión procesal de la unidad.', 'coordinator')
ON DUPLICATE KEY UPDATE
  label = VALUES(label), description = VALUES(description), related_role_code = VALUES(related_role_code);

INSERT INTO case_participant_role_types (code, label, description) VALUES
  ('petitioner', 'Promovente', 'Persona que promueve el asunto.'),
  ('respondent', 'Parte demandada', 'Persona frente a quien se promueve el asunto.'),
  ('witness', 'Testigo', 'Persona que aporta testimonio.'),
  ('victim', 'Víctima', 'Persona reconocida como víctima u ofendida.'),
  ('defendant', 'Imputado o acusado', 'Persona sujeta al procedimiento penal.'),
  ('complainant', 'Denunciante o querellante', 'Persona que presenta denuncia o querella.'),
  ('interested_party', 'Tercero interesado', 'Persona con interés jurídico reconocido.'),
  ('legal_representative', 'Representante legal', 'Representante de una parte o entidad.')
ON DUPLICATE KEY UPDATE label = VALUES(label), description = VALUES(description);

UPDATE case_stage_definitions
SET label = CASE stage_code
  WHEN 'intake' THEN 'Recepción y clasificación'
  WHEN 'filing' THEN 'Presentación y admisión'
  WHEN 'evidence' THEN 'Integración y pruebas'
  WHEN 'hearing' THEN 'Audiencia o revisión'
  WHEN 'decision' THEN 'Decisión o resolución'
  WHEN 'closed' THEN 'Concluido'
  ELSE label
END
WHERE stage_code IN ('intake', 'filing', 'evidence', 'hearing', 'decision', 'closed');

INSERT INTO document_types (
  code, label, description, owner_scope,
  requires_notarial_authorization, requires_judicial_signature, default_sensitive
) VALUES
  ('marriage_certificate', 'Acta matrimonial', 'Documento clave del proceso de nulidad.', 'case', TRUE, FALSE, TRUE),
  ('personal_identification', 'Identificación oficial', 'INE u otra identificación de una parte.', 'participant', TRUE, FALSE, TRUE),
  ('curp', 'CURP', 'Clave Única de Registro de Población.', 'participant', TRUE, FALSE, TRUE),
  ('birth_certificate', 'Acta de nacimiento', 'Acta de nacimiento de una parte.', 'participant', TRUE, FALSE, TRUE),
  ('rfc', 'RFC', 'Constancia de Registro Federal de Contribuyentes.', 'participant', TRUE, FALSE, TRUE),
  ('proof_of_address', 'Comprobante de domicilio', 'Comprobante de domicilio de una parte.', 'participant', TRUE, FALSE, TRUE),
  ('witness_identification', 'Identificación de testigo', 'INE u otra identificación del testigo.', 'participant', TRUE, FALSE, TRUE),
  ('libel', 'Libelo', 'Relato de hechos de una parte o testigo.', 'participant', FALSE, FALSE, TRUE),
  ('judgment', 'Resolución judicial', 'Resolución que exige autorización notarial y firma judicial.', 'case', TRUE, TRUE, TRUE),
  ('qa_evidence', 'Evidencia de pruebas', 'Tipo documental utilizado en las pruebas controladas del sistema.', 'case', FALSE, FALSE, TRUE),
  ('qa_general_record_2026', 'Registro general de pruebas', 'Tipo documental de prueba que no requiere firma, autorización ni certificación.', 'case', FALSE, FALSE, TRUE),
  ('other', 'Anexo u otro documento', 'Documento complementario del expediente.', 'case', FALSE, FALSE, TRUE),
  ('initial_filing', 'Escrito inicial', 'Promoción o escrito que inicia una actuación.', 'case', FALSE, FALSE, TRUE),
  ('answer_filing', 'Contestación', 'Escrito de contestación o respuesta procesal.', 'case', FALSE, FALSE, TRUE),
  ('evidence', 'Medio de prueba', 'Documento o archivo ofrecido como prueba.', 'case', FALSE, FALSE, TRUE),
  ('expert_report', 'Dictamen pericial', 'Dictamen elaborado por un perito asignado.', 'case', FALSE, FALSE, TRUE),
  ('judicial_resolution', 'Resolución judicial', 'Resolución que puede requerir firma judicial y certificación.', 'case', FALSE, FALSE, TRUE),
  ('procedural_order', 'Acuerdo procesal', 'Acuerdo o determinación de trámite.', 'case', FALSE, FALSE, TRUE),
  ('hearing_record', 'Acta de audiencia', 'Registro documental de una audiencia.', 'case', FALSE, FALSE, TRUE),
  ('notification', 'Notificación', 'Constancia o documento de notificación.', 'case', FALSE, FALSE, TRUE),
  ('official_request', 'Oficio', 'Comunicación oficial emitida dentro del expediente.', 'case', FALSE, FALSE, TRUE),
  ('certified_copy', 'Copia certificada', 'Copia que requiere certificación cuando la regla lo determine.', 'case', FALSE, FALSE, TRUE)
ON DUPLICATE KEY UPDATE label = VALUES(label), description = VALUES(description);

INSERT INTO schema_migrations (version_code, description)
VALUES (
  '011_spanish_legal_catalogs',
  'Restablece en UTF-8 la redacción visible de los catálogos jurídicos.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);

COMMIT;
