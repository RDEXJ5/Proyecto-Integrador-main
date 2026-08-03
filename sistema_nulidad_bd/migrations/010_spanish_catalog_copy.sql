-- Restablece en UTF-8 la redacción visible de roles y permisos conocidos.
-- Los identificadores internos y las concesiones de acceso no se modifican.

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE juzgado_nulidad_documental;

START TRANSACTION;

INSERT INTO roles (code, label, channel, description) VALUES
  ('admin', 'Administración TI', 'technical', 'Opera la plataforma sin intervenir en las decisiones jurídicas.'),
  ('auditor', 'Auditor', 'web', 'Consulta la trazabilidad y la evidencia histórica en modo de solo lectura.'),
  ('coordinator', 'Coordinador', 'web', 'Supervisa la gestión procesal dentro de su unidad.'),
  ('defender', 'Defensor', 'web', 'Aporta documentos y da seguimiento a la defensa asignada.'),
  ('expert', 'Perito', 'web', 'Carga dictámenes y atiende observaciones de los expedientes designados.'),
  ('judge', 'Juez', 'web', 'Consulta expedientes activos y firma las resoluciones que lo requieren.'),
  ('lawyer', 'Abogado', 'web', 'Gestiona únicamente los expedientes de sus clientes.'),
  ('notary', 'Notario', 'web', 'Autoriza y certifica documentos cotejados.'),
  ('party', 'Parte interesada', 'mobile', 'Consulta sus documentos personales y su propio escrito.'),
  ('prosecutor', 'Fiscal', 'web', 'Aporta documentos y da seguimiento a los asuntos donde fue asignado.'),
  ('qa_auditor', 'Auditor de pruebas', 'technical', 'Rol exclusivo para comprobar los datos de prueba.'),
  ('secretary', 'Secretario', 'web', 'Opera expedientes, asignaciones, etapas y plazos.'),
  ('witness', 'Testigo', 'mobile', 'Consulta su identificación y declaración propias.')
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  channel = VALUES(channel),
  description = VALUES(description);

INSERT INTO permissions (code, description) VALUES
  ('analysis.read', 'Consultar resultados autorizados del análisis documental.'),
  ('analysis.request', 'Solicitar reconocimiento de texto, clasificación o análisis de firmas.'),
  ('audit.read', 'Consultar la bitácora de trazabilidad.'),
  ('audit.report', 'Generar reportes a partir de eventos históricos.'),
  ('case.assign', 'Asignar responsables a un expediente.'),
  ('case.classify', 'Clasificar un expediente por materia, tipo y confidencialidad.'),
  ('case.create', 'Crear un expediente sin eliminar ni sobrescribir otro.'),
  ('case.create.own', 'Crear expedientes propios o institucionales.'),
  ('case.deadline.manage', 'Crear, completar o cancelar plazos conservando el historial.'),
  ('case.participant.manage', 'Registrar o inactivar participantes sin eliminarlos.'),
  ('case.people.read', 'Consultar responsables y participantes de un expediente autorizado.'),
  ('case.read.assigned', 'Consultar los expedientes permitidos por asignación.'),
  ('case.read.audit', 'Consultar metadatos históricos de expedientes para auditoría.'),
  ('case.read.unit', 'Consultar expedientes autorizados dentro de una unidad organizativa.'),
  ('case.stage.manage', 'Registrar cambios de etapa procesal.'),
  ('case.visibility.manage', 'Ocultar o reactivar lógicamente un expediente.'),
  ('catalog.manage', 'Gestionar catálogos mediante activación y desactivación lógica.'),
  ('configuration.manage', 'Gestionar la configuración técnica de la plataforma.'),
  ('decision.issue', 'Emitir una decisión dentro de un expediente asignado.'),
  ('document.authorize', 'Registrar una autorización notarial.'),
  ('document.certify', 'Certificar una versión documental cuando su política lo requiera.'),
  ('document.content.read.web', 'Abrir el archivo original desde el sitio web.'),
  ('document.create', 'Registrar un documento y su primera versión.'),
  ('document.download.web', 'Descargar un archivo original desde el sitio web.'),
  ('document.observation.create', 'Emitir observaciones sobre una versión documental.'),
  ('document.observation.resolve', 'Resolver una observación de forma auditable.'),
  ('document.observation.respond', 'Responder observaciones sobre documentos aportados.'),
  ('document.read.assigned', 'Consultar los datos documentales de expedientes asignados.'),
  ('document.review', 'Registrar la revisión de una versión documental.'),
  ('document.sign', 'Registrar una firma judicial.'),
  ('document.upload', 'Cargar un archivo existente y registrar su tipo y origen.'),
  ('document.version.create', 'Registrar una nueva versión sin sobrescritura.'),
  ('qa.seed.verify', 'Consultar las comprobaciones generadas por los datos de prueba.'),
  ('role.manage', 'Otorgar o revocar roles y permisos conservando el historial.'),
  ('storage.object.create', 'Registrar archivos en el almacenamiento privado.'),
  ('storage.object.read', 'Consultar archivos después de validar el acceso correspondiente.'),
  ('system.health.read', 'Consultar el estado del servicio, la base de datos y el almacenamiento.'),
  ('user.manage', 'Crear, suspender y reactivar cuentas sin eliminarlas.'),
  ('workspace.administration.access', 'Acceder al espacio de administración técnica.'),
  ('workspace.audit.access', 'Acceder al espacio de auditoría.'),
  ('workspace.contribution.access', 'Acceder al espacio de carga y seguimiento.'),
  ('workspace.process.access', 'Acceder al espacio de gestión procesal.'),
  ('workspace.review.access', 'Acceder al espacio de revisión y decisión.')
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO schema_migrations (version_code, description)
VALUES (
  '010_spanish_catalog_copy',
  'Restablece en UTF-8 la redacción visible de los catálogos de roles y permisos.'
)
ON DUPLICATE KEY UPDATE description = VALUES(description);

COMMIT;
