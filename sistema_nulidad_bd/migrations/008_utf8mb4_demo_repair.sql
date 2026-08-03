-- Fuerza UTF-8 de cuatro bytes para nuevas conexiones de inicialización y
-- repara exclusivamente datos sintéticos de desarrollo que fueron cargados
-- anteriormente desde una consola con una codificación incorrecta.

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE juzgado_nulidad_documental;

UPDATE users
SET full_name = CASE email
  WHEN 'admin.web@example.test' THEN 'Administración Web QA'
  WHEN 'web.notario.20260731@example.test' THEN 'Notario Integración Web'
  WHEN 'web.juez.20260731@example.test' THEN 'Juez Integración Web'
  WHEN 'web.abogado.20260731@example.test' THEN 'Abogado Integración Web'
  WHEN 'web.fiscal.20260731@example.test' THEN 'Fiscal Integración Web'
  WHEN 'web.defensor.20260731@example.test' THEN 'Defensor Integración Web'
  WHEN 'web.perito.20260731@example.test' THEN 'Perito Integración Web'
  WHEN 'web.secretario.20260731@example.test' THEN 'Secretario Integración Web'
  WHEN 'web.coordinador.20260731@example.test' THEN 'Coordinador Integración Web'
  WHEN 'web.auditor.20260731@example.test' THEN 'Auditor Integración Web'
  WHEN 'mobile.parte.20260731@example.test' THEN 'Parte Integración Móvil'
  WHEN 'mobile.testigo.20260731@example.test' THEN 'Testigo Integración Móvil'
  ELSE full_name
END
WHERE email IN (
  'admin.web@example.test',
  'web.notario.20260731@example.test',
  'web.juez.20260731@example.test',
  'web.abogado.20260731@example.test',
  'web.fiscal.20260731@example.test',
  'web.defensor.20260731@example.test',
  'web.perito.20260731@example.test',
  'web.secretario.20260731@example.test',
  'web.coordinador.20260731@example.test',
  'web.auditor.20260731@example.test',
  'mobile.parte.20260731@example.test',
  'mobile.testigo.20260731@example.test'
);

UPDATE cases
SET description = 'Datos sintéticos para verificar versiones, autorización, firma y archivo profundo.'
WHERE folio = 'QA-NUL-2026-0001';

UPDATE documents AS document_record
JOIN cases AS case_record ON case_record.id = document_record.case_id
SET
  document_record.title = CASE document_record.document_type_code
    WHEN 'marriage_certificate' THEN 'Acta matrimonial QA'
    WHEN 'libel' THEN 'Libelo de la parte QA'
    WHEN 'judgment' THEN 'Resolución judicial QA'
    WHEN 'qa_evidence' THEN 'Evidencia archivada QA'
    ELSE document_record.title
  END,
  document_record.description = CASE document_record.document_type_code
    WHEN 'marriage_certificate' THEN 'Documento sintético: autorización notarial requerida, firma judicial no requerida.'
    WHEN 'libel' THEN 'Documento sintético: no requiere autorización ni firma.'
    WHEN 'judgment' THEN 'Documento sintético: requiere autorización notarial y firma judicial.'
    WHEN 'qa_evidence' THEN 'Documento sintético para comprobar el traslado a archivo profundo.'
    ELSE document_record.description
  END
WHERE case_record.folio = 'QA-NUL-2026-0001'
  AND document_record.id IN (1, 2, 3, 4);

UPDATE cases
SET
  title = 'Expediente general de validación web',
  description = 'Registro QA para validar gestión procesal sin limitar la plataforma a una materia.'
WHERE folio = 'QA-GEN-2026-0001';
