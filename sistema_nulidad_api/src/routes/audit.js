import { Router } from 'express';
import { pool } from '../db.js';
import { ApiError } from '../errors.js';
import { hasPermission } from '../security/authorization.js';

const router = Router();

const AUDIT_ACTION_LABELS = Object.freeze({
  'admin.document_type_created': 'Tipo documental creado',
  'admin.role_granted': 'Rol concedido',
  'admin.role_revoked': 'Rol revocado',
  'admin.user_created': 'Usuario creado',
  'admin.user_password_reset': 'Contraseña de usuario actualizada',
  'admin.user_status_changed': 'Estado de usuario modificado',
  'auth.login_succeeded': 'Inicio de sesión correcto',
  'auth.login_failed': 'Intento de inicio de sesión fallido',
  'auth.mobile_registered': 'Cuenta móvil creada',
  'case.created': 'Expediente creado',
  'case.assignment_created': 'Responsable asignado',
  'case.assignment_revoked': 'Asignación finalizada',
  'case.participant_added': 'Participante agregado',
  'case.participant_ended': 'Participación finalizada',
  'case.invitation_sent': 'Invitación enviada',
  'case.invitation_accepted': 'Invitación aceptada',
  'case.invitation_declined': 'Invitación rechazada',
  'case.invitation_expired': 'Invitación vencida',
  'case.stage_changed': 'Etapa procesal actualizada',
  'case.deadline_created': 'Plazo creado',
  'case.deadline_status_changed': 'Estado del plazo actualizado',
  'case.state_changed': 'Estado del expediente actualizado',
  'case.decision_issued': 'Decisión procesal emitida',
  'document.version_uploaded': 'Versión documental cargada',
  'document.content_viewed': 'Documento visualizado',
  'document.content_downloaded': 'Documento descargado',
  'document.observation_created': 'Observación creada',
  'document.observation_responded': 'Observación respondida',
  'document.observation_resolved': 'Observación resuelta',
  'document.review_recorded': 'Revisión documental registrada',
  'document.authorization_recorded': 'Autorización documental registrada',
  'document.certification_recorded': 'Certificación documental registrada',
  'document.integrity_signature_recorded': 'Firma de integridad registrada',
  'system.bootstrap_admin': 'Cuenta administradora inicial creada',
  'system.user_provisioned': 'Cuenta del sistema creada',
  development_workspace_accounts_seeded: 'Cuentas de prueba creadas',
  'qa.case.seeded': 'Expediente de prueba creado',
  'qa.case.updated': 'Expediente de prueba actualizado',
  'qa.judgment.signed': 'Resolución de prueba firmada'
});

const RESOURCE_LABELS = Object.freeze({
  case: 'Expediente',
  case_assignment: 'Asignación de expediente',
  case_participant_role: 'Participación en expediente',
  case_participant_invitation: 'Invitación a expediente',
  case_stage_transition: 'Cambio de etapa',
  case_deadline: 'Plazo procesal',
  case_decision: 'Decisión procesal',
  document: 'Documento',
  document_version: 'Versión documental',
  document_observation: 'Observación documental',
  document_action: 'Control documental',
  document_signature: 'Constancia de firma',
  document_type: 'Tipo documental',
  storage_object: 'Archivo almacenado',
  user: 'Usuario',
  user_role_grant: 'Asignación de rol',
  role: 'Rol',
  system: 'Sistema'
});

const CHANNEL_LABELS = Object.freeze({
  web: 'Sitio web',
  mobile: 'Aplicación móvil',
  api: 'Integración entre sistemas',
  system: 'Proceso automático'
});

function requireAudit(request, permission = 'audit.read') {
  if (request.auth.channel !== 'web' || !hasPermission(request.auth.user, permission)) {
    throw new ApiError(403, 'audit_not_allowed', 'El perfil no puede consultar la trazabilidad.');
  }
}

function boundedLimit(value, fallback = 200, maximum = 1000) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, maximum);
}

function csvCell(value) {
  const text = value === null || value === undefined
    ? ''
    : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

async function listEvents(limit, actionPrefix = null) {
  const parameters = [];
  let condition = '';
  if (actionPrefix) {
    condition = 'WHERE audit_record.action_code LIKE ?';
    parameters.push(`${actionPrefix}%`);
  }
  const [events] = await pool.execute(
    `SELECT audit_record.id, audit_record.action_code, audit_record.resource_type,
            audit_record.resource_id, audit_record.details, audit_record.client_channel,
            audit_record.ip_address, audit_record.created_at,
            audit_record.actor_user_id, actor.full_name AS actor_name, actor.email AS actor_email
     FROM audit_events audit_record
     LEFT JOIN users actor ON actor.id = audit_record.actor_user_id
     ${condition}
     ORDER BY audit_record.created_at DESC, audit_record.id DESC
     LIMIT ${limit}`,
    parameters
  );
  return events;
}

router.get('/overview', async (request, response, next) => {
  try {
    requireAudit(request);
    const [[counts]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM audit_events) AS event_count,
         (SELECT COUNT(*) FROM document_versions) AS version_count,
         (SELECT COUNT(*) FROM document_signature_records) AS signature_count,
         (SELECT COUNT(*) FROM case_decisions) AS decision_count`
    );
    const events = await listEvents(20);
    response.json({ overview: counts, events });
  } catch (error) {
    next(error);
  }
});

router.get('/events', async (request, response, next) => {
  try {
    requireAudit(request);
    response.json({ events: await listEvents(boundedLimit(request.query.limit)) });
  } catch (error) {
    next(error);
  }
});

router.get('/access', async (request, response, next) => {
  try {
    requireAudit(request);
    const limit = boundedLimit(request.query.limit);
    const [events] = await pool.execute(
      `SELECT audit_record.id, audit_record.action_code, audit_record.resource_type,
              audit_record.resource_id, audit_record.details, audit_record.client_channel,
              audit_record.ip_address, audit_record.created_at,
              actor.full_name AS actor_name, actor.email AS actor_email
       FROM audit_events audit_record
       LEFT JOIN users actor ON actor.id = audit_record.actor_user_id
       WHERE audit_record.action_code IN (
         'document.content_viewed', 'document.content_downloaded',
         'auth.login_succeeded', 'auth.login_failed'
       )
       ORDER BY audit_record.created_at DESC, audit_record.id DESC
       LIMIT ${limit}`
    );
    response.json({ events });
  } catch (error) {
    next(error);
  }
});

router.get('/versions', async (request, response, next) => {
  try {
    requireAudit(request);
    const limit = boundedLimit(request.query.limit);
    const [versions] = await pool.execute(
      `SELECT case_record.folio AS case_folio, document_record.id AS document_id,
              document_record.title AS document_title, document_record.document_type_code,
              document_type.label AS document_type_label,
              version_record.id AS document_version_id, version_record.version_number,
              version_record.original_name, version_record.content_type, version_record.created_at,
              metadata_record.upload_source, metadata_record.client_channel,
              storage_record.storage_provider, storage_record.storage_status,
              storage_record.size_bytes, storage_record.sha256
       FROM document_versions version_record
       JOIN documents document_record ON document_record.id = version_record.document_id
       JOIN document_types document_type ON document_type.code = document_record.document_type_code
       JOIN cases case_record ON case_record.id = document_record.case_id
       JOIN document_version_metadata metadata_record ON metadata_record.document_version_id = version_record.id
       LEFT JOIN storage_objects storage_record
         ON storage_record.id = (
           SELECT candidate.id FROM storage_objects candidate
           WHERE candidate.document_version_id = version_record.id AND candidate.object_role = 'original'
           ORDER BY candidate.created_at DESC, candidate.id DESC LIMIT 1
         )
       ORDER BY version_record.created_at DESC, version_record.id DESC
       LIMIT ${limit}`
    );
    response.json({ versions });
  } catch (error) {
    next(error);
  }
});

router.get('/signatures', async (request, response, next) => {
  try {
    requireAudit(request);
    const limit = boundedLimit(request.query.limit);
    const [signatures] = await pool.execute(
      `SELECT case_record.folio AS case_folio, document_record.title AS document_title,
              signature_record.id, signature_record.document_version_id,
              version_record.version_number, signer.full_name AS signer_name,
              signature_record.signer_role_code, signature_record.signature_kind,
              signature_record.algorithm, signature_record.signed_digest,
              signature_record.verification_status, signature_record.signed_at,
              signature_record.recorded_at
       FROM document_signature_records signature_record
       JOIN document_versions version_record ON version_record.id = signature_record.document_version_id
       JOIN documents document_record ON document_record.id = version_record.document_id
       JOIN cases case_record ON case_record.id = document_record.case_id
       LEFT JOIN users signer ON signer.id = signature_record.signer_user_id
       ORDER BY signature_record.recorded_at DESC, signature_record.id DESC
       LIMIT ${limit}`
    );
    response.json({ signatures });
  } catch (error) {
    next(error);
  }
});

router.get('/report.csv', async (request, response, next) => {
  try {
    requireAudit(request, 'audit.report');
    const events = await listEvents(boundedLimit(request.query.limit, 500, 5000));
    const header = [
      'identificador', 'fecha', 'responsable', 'correo', 'acción',
      'elemento_afectado', 'identificador_del_elemento', 'origen',
      'dirección_ip', 'detalles_técnicos'
    ];
    const rows = events.map((event) => [
      event.id,
      event.created_at,
      event.actor_name,
      event.actor_email,
      AUDIT_ACTION_LABELS[event.action_code] ?? event.action_code,
      RESOURCE_LABELS[event.resource_type] ?? event.resource_type,
      event.resource_id,
      CHANNEL_LABELS[event.client_channel] ?? event.client_channel,
      event.ip_address,
      event.details
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
    response.set({
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="reporte-auditoria.csv"',
      'Cache-Control': 'private, no-store, max-age=0'
    });
    response.send(`\uFEFF${csv}`);
  } catch (error) {
    next(error);
  }
});

export default router;
