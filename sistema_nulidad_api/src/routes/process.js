import { Router } from 'express';
import { pool, withTransaction } from '../db.js';
import { ApiError } from '../errors.js';
import { hasPermission } from '../security/authorization.js';
import { assertCaseAccess, loadCase, parseId } from '../security/resource-access.js';
import { reserveNextCaseFolio } from '../services/case-folio-service.js';

const router = Router();
const assignmentScopes = new Set(['full', 'documental', 'procedural', 'review', 'audit']);
const deadlineStatuses = new Set(['completed', 'overdue', 'cancelled']);
const lifecycleStatuses = new Set(['draft', 'active', 'paused', 'closed', 'annulled', 'archived']);
const visibilityStatuses = new Set(['visible', 'hidden']);

function requireProcessPermission(request, permission) {
  if (request.auth.channel !== 'web' || !hasPermission(request.auth.user, permission)) {
    throw new ApiError(403, 'process_action_not_allowed', 'El perfil no puede realizar esta operación procesal.');
  }
}

function requireAnyProcessPermission(request, permissions) {
  if (
    request.auth.channel !== 'web'
    || !permissions.some((permission) => hasPermission(request.auth.user, permission))
  ) {
    throw new ApiError(403, 'process_action_not_allowed', 'El perfil no puede consultar estos datos de gestión procesal.');
  }
}

function requiredText(value, minimum, maximum, message) {
  if (typeof value !== 'string') throw new ApiError(400, 'invalid_request', message);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new ApiError(400, 'invalid_request', message);
  }
  return normalized;
}

function nullableText(value, maximum) {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, 1, maximum, `El texto no puede superar ${maximum} caracteres.`);
}

function mysqlTimestamp(value, message) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, 'invalid_date', message);
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

async function audit(connection, request, actionCode, resourceType, resourceId, details) {
  await connection.execute(
    `INSERT INTO audit_events (
       actor_user_id, action_code, resource_type, resource_id, details, client_channel, ip_address
     ) VALUES (?, ?, ?, ?, ?, 'web', ?)`,
    [request.auth.user.id, actionCode, resourceType, String(resourceId), JSON.stringify(details), request.ip]
  );
}

router.get('/catalogs', async (request, response, next) => {
  try {
    const requestedCaseId = request.query?.caseId;
    const managementPermissions = [
      'case.assign',
      'case.participant.manage',
      'case.stage.manage',
      'case.deadline.manage',
      'case.visibility.manage'
    ];
    let caseRecord = null;

    if (requestedCaseId !== undefined) {
      requireAnyProcessPermission(request, managementPermissions);
      caseRecord = await loadCase(parseId(requestedCaseId));
      await assertCaseAccess(request.auth.user, caseRecord);
    } else {
      requireProcessPermission(request, 'case.create');
    }

    let caseTypes = [];
    let units = [];
    if (hasPermission(request.auth.user, 'case.create')) {
      [caseTypes] = await pool.execute(
        `SELECT case_type.code, case_type.label, case_type.default_confidentiality,
                legal_area.label AS legal_area_label
         FROM case_types case_type
         JOIN legal_areas legal_area ON legal_area.code = case_type.legal_area_code
         WHERE case_type.is_active = TRUE AND legal_area.is_active = TRUE
         ORDER BY legal_area.label, case_type.label`
      );
      [units] = await pool.execute(
        `SELECT DISTINCT unit_record.id, unit_record.code, unit_record.name, unit_record.unit_type
         FROM organizational_units unit_record
         JOIN user_unit_memberships membership
           ON membership.organizational_unit_id = unit_record.id
          AND membership.user_id = ?
          AND membership.membership_status = 'active'
         WHERE unit_record.is_active = TRUE
         ORDER BY unit_record.name`,
        [request.auth.user.id]
      );
    }

    let assignmentCandidates = [];
    if (caseRecord && hasPermission(request.auth.user, 'case.assign')) {
      [assignmentCandidates] = await pool.execute(
        `SELECT DISTINCT user_record.id AS user_id, user_record.full_name, user_record.email,
                role_record.code AS role_code, role_record.label AS role_label,
                assignment_type.code AS assignment_type_code,
                assignment_type.label AS assignment_type_label
         FROM users user_record
         JOIN v_active_user_roles active_role ON active_role.user_id = user_record.id
         JOIN roles role_record ON role_record.code = active_role.role_code
         JOIN case_assignment_types assignment_type
           ON assignment_type.related_role_code = active_role.role_code
          AND assignment_type.is_active = TRUE
         WHERE user_record.account_status = 'active'
           AND NOT EXISTS (
             SELECT 1
             FROM case_assignments active_assignment
             WHERE active_assignment.case_id = ?
               AND active_assignment.user_id = user_record.id
               AND active_assignment.assignment_type_code = assignment_type.code
               AND active_assignment.assignment_status = 'active'
           )
         ORDER BY user_record.full_name, assignment_type.label`,
        [caseRecord.id]
      );
    }

    let participantCandidates = [];
    if (caseRecord && hasPermission(request.auth.user, 'case.participant.manage')) {
      [participantCandidates] = await pool.execute(
        `SELECT DISTINCT user_record.id AS user_id, user_record.full_name, user_record.email,
                active_role.role_code AS account_role_code,
                participant_type.code AS participant_role_code,
                participant_type.label AS participant_role_label
         FROM users user_record
         JOIN v_active_user_roles active_role ON active_role.user_id = user_record.id
         JOIN case_participant_role_types participant_type
           ON participant_type.is_active = TRUE
          AND (
            (active_role.role_code = 'witness' AND participant_type.code = 'witness')
            OR (active_role.role_code = 'party' AND participant_type.code <> 'witness')
          )
         WHERE user_record.account_status = 'active'
           AND active_role.role_code IN ('party', 'witness')
           AND NOT EXISTS (
             SELECT 1
             FROM case_participant_roles active_participant
             WHERE active_participant.case_id = ?
               AND active_participant.user_id = user_record.id
               AND active_participant.participant_role_code = participant_type.code
               AND active_participant.participation_status = 'active'
           )
           AND NOT EXISTS (
             SELECT 1
             FROM case_participant_invitations pending_invitation
             WHERE pending_invitation.case_id = ?
               AND pending_invitation.invited_user_id = user_record.id
               AND pending_invitation.participant_role_code = participant_type.code
               AND pending_invitation.invitation_status = 'pending'
               AND pending_invitation.expires_at > CURRENT_TIMESTAMP
           )
         ORDER BY user_record.full_name, participant_type.label`,
        [caseRecord.id, caseRecord.id]
      );
    }

    response.json({ catalogs: { caseTypes, units, assignmentCandidates, participantCandidates } });
  } catch (error) {
    next(error);
  }
});

router.post('/cases', async (request, response, next) => {
  try {
    requireProcessPermission(request, 'case.create');
    const title = requiredText(request.body?.title, 5, 255, 'El título debe contener entre 5 y 255 caracteres.');
    const description = nullableText(request.body?.description, 8000);
    const caseTypeCode = requiredText(request.body?.caseTypeCode, 1, 50, 'Seleccione un tipo de expediente.');
    const organizationalUnitId = parseId(request.body?.organizationalUnitId);
    const confidentialityLevel = request.body?.confidentialityLevel;
    if (!['internal', 'confidential', 'restricted'].includes(confidentialityLevel)) {
      throw new ApiError(400, 'invalid_confidentiality', 'Seleccione un nivel de confidencialidad válido.');
    }
    const initialStatus = request.body?.initialStatus ?? 'active';
    if (!['draft', 'active'].includes(initialStatus)) {
      throw new ApiError(400, 'invalid_case_status', 'El estado inicial debe ser borrador o activo.');
    }
    const statusReason = requiredText(request.body?.statusReason, 5, 1000, 'Indique el motivo de apertura.');

    const caseRecord = await withTransaction(async (connection) => {
      const [catalogRows] = await connection.execute(
        `SELECT case_type.code, case_type.legal_area_code,
                (SELECT stage.stage_code FROM case_stage_definitions stage
                 WHERE stage.case_type_code = case_type.code AND stage.is_active = TRUE
                 ORDER BY stage.sequence_number LIMIT 1) AS initial_stage_code
         FROM case_types case_type
         JOIN user_unit_memberships membership
           ON membership.organizational_unit_id = ?
          AND membership.user_id = ?
          AND membership.membership_status = 'active'
         JOIN organizational_units unit_record
           ON unit_record.id = membership.organizational_unit_id AND unit_record.is_active = TRUE
         WHERE case_type.code = ? AND case_type.is_active = TRUE
         LIMIT 1`,
        [organizationalUnitId, request.auth.user.id, caseTypeCode]
      );
      if (catalogRows.length === 0) {
        throw new ApiError(403, 'case_catalog_not_allowed', 'El tipo o la unidad no están autorizados para tu cuenta.');
      }
      const initialStageCode = catalogRows[0].initial_stage_code;
      const legalAreaCode = catalogRows[0].legal_area_code;
      let folio;
      let inserted;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        folio = await reserveNextCaseFolio(connection, legalAreaCode);
        try {
          [inserted] = await connection.execute(
            `INSERT INTO cases (
               folio, title, description, status, lawyer_user_id, judge_user_id, created_by_user_id
             ) VALUES (?, ?, ?, 'active', NULL, NULL, ?)`,
            [folio, title, description, request.auth.user.id]
          );
          break;
        } catch (error) {
          if (error?.code !== 'ER_DUP_ENTRY') throw error;
        }
      }
      if (!inserted) {
        throw new ApiError(409, 'folio_generation_conflict', 'No fue posible reservar un folio único. Intenta nuevamente.');
      }
      const caseId = inserted.insertId;
      await connection.execute(
        `INSERT INTO case_profiles (
           case_id, case_type_code, organizational_unit_id, confidentiality_level,
           lifecycle_status, visibility_status, current_stage_code,
           status_reason, status_changed_by_user_id
         ) VALUES (?, ?, ?, ?, ?, 'visible', ?, ?, ?)`,
        [
          caseId,
          caseTypeCode,
          organizationalUnitId,
          confidentialityLevel,
          initialStatus,
          initialStageCode,
          statusReason,
          request.auth.user.id
        ]
      );
      await connection.execute(
        `INSERT INTO case_profile_status_history (
           case_id, previous_lifecycle_status, new_lifecycle_status,
           previous_visibility_status, new_visibility_status,
           reason, changed_by_user_id
         ) VALUES (?, NULL, ?, NULL, 'visible', ?, ?)`,
        [caseId, initialStatus, statusReason, request.auth.user.id]
      );
      if (initialStageCode) {
        await connection.execute(
          `INSERT INTO case_stage_transitions (
             case_id, previous_stage_code, new_stage_code, reason, changed_by_user_id
           ) VALUES (?, NULL, ?, ?, ?)`,
          [caseId, initialStageCode, statusReason, request.auth.user.id]
        );
      }
      const selfRole = request.auth.user.roles.find((role) => ['secretary', 'coordinator'].includes(role.code));
      if (!selfRole) throw new ApiError(403, 'process_role_required', 'Se requiere un rol procesal activo.');
      await connection.execute(
        `INSERT INTO case_assignments (
           case_id, user_id, assignment_type_code, assignment_scope,
           assignment_status, assignment_reason, assigned_by_user_id
         ) VALUES (?, ?, ?, 'procedural', 'active', ?, ?)`,
        [caseId, request.auth.user.id, selfRole.code, statusReason, request.auth.user.id]
      );
      await audit(connection, request, 'case.created', 'case', caseId, {
        folio,
        folioGeneration: 'automatic',
        legalAreaCode,
        caseTypeCode,
        organizationalUnitId,
        initialStatus,
        initialStageCode
      });
      return { id: caseId, folio, title, status: initialStatus, currentStageCode: initialStageCode };
    });
    response.status(201).json({ case: caseRecord });
  } catch (error) {
    next(error);
  }
});

router.get('/cases/:caseId', async (request, response, next) => {
  try {
    const caseRecord = await loadCase(parseId(request.params.caseId));
    await assertCaseAccess(request.auth.user, caseRecord);
    if (!hasPermission(request.auth.user, 'workspace.process.access')) {
      throw new ApiError(403, 'process_workspace_not_allowed', 'El perfil no puede consultar la gestión procesal.');
    }
    const [assignments] = await pool.execute(
      `SELECT assignment_record.id, assignment_record.user_id, user_record.full_name,
              assignment_record.assignment_type_code, assignment_type.label AS assignment_type_label,
              assignment_record.assignment_scope, assignment_record.assignment_status,
              assignment_record.assignment_reason, assignment_record.assigned_at,
              assignment_record.ended_at, assignment_record.ending_reason
       FROM case_assignments assignment_record
       JOIN users user_record ON user_record.id = assignment_record.user_id
       JOIN case_assignment_types assignment_type ON assignment_type.code = assignment_record.assignment_type_code
       WHERE assignment_record.case_id = ?
       ORDER BY (assignment_record.assignment_status = 'active') DESC, assignment_record.assigned_at DESC`,
      [caseRecord.id]
    );
    const [stages] = await pool.execute(
      `SELECT stage_code, label, sequence_number, is_terminal
       FROM case_stage_definitions
       WHERE case_type_code = ? AND is_active = TRUE
       ORDER BY sequence_number`,
      [caseRecord.case_type_code]
    );
    const [stageHistory] = await pool.execute(
      `SELECT transition_record.*, actor.full_name AS changed_by_name,
              stage_record.label AS new_stage_label
       FROM case_stage_transitions transition_record
       JOIN users actor ON actor.id = transition_record.changed_by_user_id
       LEFT JOIN case_stage_definitions stage_record
         ON stage_record.case_type_code = ?
        AND stage_record.stage_code = transition_record.new_stage_code
       WHERE transition_record.case_id = ?
       ORDER BY transition_record.changed_at DESC, transition_record.id DESC`,
      [caseRecord.case_type_code, caseRecord.id]
    );
    const [deadlines] = await pool.execute(
      `SELECT deadline_record.*, assignee.full_name AS assigned_user_name,
              creator.full_name AS created_by_name
       FROM case_deadlines deadline_record
       LEFT JOIN users assignee ON assignee.id = deadline_record.assigned_user_id
       JOIN users creator ON creator.id = deadline_record.created_by_user_id
       WHERE deadline_record.case_id = ?
       ORDER BY (deadline_record.deadline_status = 'pending') DESC, deadline_record.due_at`,
      [caseRecord.id]
    );
    const [participants] = await pool.execute(
      `SELECT participant_record.id, participant_record.user_id, user_record.full_name,
              participant_record.participant_role_code, participant_type.label AS participant_role_label,
              participant_record.participation_status, participant_record.participation_reason,
              participant_record.joined_at, participant_record.ended_at, participant_record.ending_reason
       FROM case_participant_roles participant_record
       JOIN users user_record ON user_record.id = participant_record.user_id
       JOIN case_participant_role_types participant_type ON participant_type.code = participant_record.participant_role_code
       WHERE participant_record.case_id = ?
       ORDER BY (participant_record.participation_status = 'active') DESC, participant_record.joined_at DESC`,
      [caseRecord.id]
    );
    const [invitations] = await pool.execute(
      `SELECT invitation_record.id, invitation_record.invited_user_id AS user_id,
              user_record.full_name, user_record.email,
              invitation_record.participant_role_code,
              participant_type.label AS participant_role_label,
              invitation_record.invitation_status, invitation_record.invitation_reason,
              invitation_record.invited_at, invitation_record.expires_at,
              invitation_record.responded_at, sender.full_name AS invited_by_name
       FROM case_participant_invitations invitation_record
       JOIN users user_record ON user_record.id = invitation_record.invited_user_id
       JOIN users sender ON sender.id = invitation_record.invited_by_user_id
       JOIN case_participant_role_types participant_type
         ON participant_type.code = invitation_record.participant_role_code
       WHERE invitation_record.case_id = ?
       ORDER BY (invitation_record.invitation_status = 'pending') DESC,
                invitation_record.invited_at DESC, invitation_record.id DESC`,
      [caseRecord.id]
    );
    response.json({ process: { assignments, stages, stageHistory, deadlines, participants, invitations } });
  } catch (error) {
    next(error);
  }
});

router.post('/cases/:caseId/assignments', async (request, response, next) => {
  try {
    requireProcessPermission(request, 'case.assign');
    const caseRecord = await loadCase(parseId(request.params.caseId));
    await assertCaseAccess(request.auth.user, caseRecord);
    const userId = parseId(request.body?.userId);
    const assignmentTypeCode = requiredText(request.body?.assignmentTypeCode, 1, 40, 'Seleccione un tipo de asignación.');
    const assignmentScope = request.body?.assignmentScope;
    if (!assignmentScopes.has(assignmentScope)) throw new ApiError(400, 'invalid_assignment_scope', 'Seleccione un alcance válido.');
    const reason = requiredText(request.body?.reason, 5, 1000, 'Indique el motivo de la asignación.');
    const assignment = await withTransaction(async (connection) => {
      const [eligible] = await connection.execute(
        `SELECT assignment_type.code
         FROM case_assignment_types assignment_type
         JOIN v_active_user_roles active_role
           ON active_role.user_id = ?
          AND active_role.role_code = assignment_type.related_role_code
         JOIN users user_record ON user_record.id = active_role.user_id AND user_record.account_status = 'active'
         WHERE assignment_type.code = ? AND assignment_type.is_active = TRUE
         LIMIT 1`,
        [userId, assignmentTypeCode]
      );
      if (eligible.length === 0) throw new ApiError(409, 'assignment_role_mismatch', 'El usuario no tiene el rol requerido para esa asignación.');
      const [duplicates] = await connection.execute(
        `SELECT id FROM case_assignments
         WHERE case_id = ? AND user_id = ? AND assignment_type_code = ? AND assignment_status = 'active'
         LIMIT 1`,
        [caseRecord.id, userId, assignmentTypeCode]
      );
      if (duplicates.length > 0) throw new ApiError(409, 'assignment_already_active', 'La asignación ya está activa.');
      const [inserted] = await connection.execute(
        `INSERT INTO case_assignments (
           case_id, user_id, assignment_type_code, assignment_scope,
           assignment_status, assignment_reason, assigned_by_user_id
         ) VALUES (?, ?, ?, ?, 'active', ?, ?)`,
        [caseRecord.id, userId, assignmentTypeCode, assignmentScope, reason, request.auth.user.id]
      );
      await audit(connection, request, 'case.assignment_created', 'case_assignment', inserted.insertId, {
        caseId: caseRecord.id, userId, assignmentTypeCode, assignmentScope
      });
      return { id: inserted.insertId, caseId: caseRecord.id, userId, assignmentTypeCode, assignmentScope };
    });
    response.status(201).json({ assignment });
  } catch (error) {
    next(error);
  }
});

router.post('/cases/:caseId/invitations', async (request, response, next) => {
  try {
    requireProcessPermission(request, 'case.participant.manage');
    const caseRecord = await loadCase(parseId(request.params.caseId));
    await assertCaseAccess(request.auth.user, caseRecord);
    const userId = parseId(request.body?.userId);
    const participantRoleCode = requiredText(request.body?.participantRoleCode, 1, 40, 'Seleccione una calidad procesal.');
    const reason = requiredText(request.body?.reason, 5, 1000, 'Indique el motivo de participación.');
    const invitation = await withTransaction(async (connection) => {
      await connection.execute(
        `UPDATE case_participant_invitations
         SET invitation_status = 'expired', responded_at = CURRENT_TIMESTAMP
         WHERE case_id = ? AND invited_user_id = ? AND participant_role_code = ?
           AND invitation_status = 'pending' AND expires_at <= CURRENT_TIMESTAMP`,
        [caseRecord.id, userId, participantRoleCode]
      );
      const [eligible] = await connection.execute(
        `SELECT user_record.id, active_role.role_code
         FROM users user_record
         JOIN v_active_user_roles active_role ON active_role.user_id = user_record.id
         JOIN case_participant_role_types participant_type ON participant_type.code = ? AND participant_type.is_active = TRUE
         WHERE user_record.id = ? AND user_record.account_status = 'active'
           AND active_role.role_code = CASE
             WHEN participant_type.code = 'witness' THEN 'witness'
             ELSE 'party'
           END
         LIMIT 1`,
        [participantRoleCode, userId]
      );
      if (eligible.length === 0) {
        throw new ApiError(409, 'participant_not_eligible', 'La cuenta no corresponde con la calidad procesal seleccionada.');
      }
      const [activeParticipants] = await connection.execute(
        `SELECT id FROM case_participant_roles
         WHERE case_id = ? AND user_id = ? AND participant_role_code = ?
           AND participation_status = 'active' LIMIT 1`,
        [caseRecord.id, userId, participantRoleCode]
      );
      if (activeParticipants.length > 0) {
        throw new ApiError(409, 'participant_already_active', 'La participación ya está activa.');
      }
      const [pendingInvitations] = await connection.execute(
        `SELECT id FROM case_participant_invitations
         WHERE case_id = ? AND invited_user_id = ? AND participant_role_code = ?
           AND invitation_status = 'pending' LIMIT 1`,
        [caseRecord.id, userId, participantRoleCode]
      );
      if (pendingInvitations.length > 0) {
        throw new ApiError(409, 'invitation_already_pending', 'La persona ya tiene una invitación pendiente.');
      }
      const [inserted] = await connection.execute(
        `INSERT INTO case_participant_invitations (
           case_id, invited_user_id, participant_role_code, invitation_status,
           invited_by_user_id, invitation_reason, expires_at
         ) VALUES (?, ?, ?, 'pending', ?, ?, DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 30 DAY))`,
        [caseRecord.id, userId, participantRoleCode, request.auth.user.id, reason]
      );
      await audit(connection, request, 'case.invitation_sent', 'case_participant_invitation', inserted.insertId, {
        caseId: caseRecord.id, userId, participantRoleCode
      });
      return {
        id: inserted.insertId,
        caseId: caseRecord.id,
        userId,
        participantRoleCode,
        invitationStatus: 'pending'
      };
    });
    response.status(201).json({ invitation });
  } catch (error) {
    next(error);
  }
});

router.post('/cases/:caseId/participants/:participationId/end', async (request, response, next) => {
  try {
    requireProcessPermission(request, 'case.participant.manage');
    const caseRecord = await loadCase(parseId(request.params.caseId));
    await assertCaseAccess(request.auth.user, caseRecord);
    const participationId = parseId(request.params.participationId);
    const reason = requiredText(request.body?.reason, 5, 1000, 'Indique el motivo de finalización.');
    await withTransaction(async (connection) => {
      const [rows] = await connection.execute(
        `SELECT id FROM case_participant_roles
         WHERE id = ? AND case_id = ? AND participation_status = 'active'
         LIMIT 1 FOR UPDATE`,
        [participationId, caseRecord.id]
      );
      if (rows.length === 0) throw new ApiError(404, 'not_found', 'Recurso no encontrado.');
      await connection.execute(
        `UPDATE case_participant_roles
         SET participation_status = 'inactive', ended_at = CURRENT_TIMESTAMP,
             ended_by_user_id = ?, ending_reason = ?
         WHERE id = ? AND participation_status = 'active'`,
        [request.auth.user.id, reason, participationId]
      );
      await audit(connection, request, 'case.participant_ended', 'case_participant_role', participationId, { caseId: caseRecord.id, reason });
    });
    response.json({ participation: { id: participationId, participationStatus: 'inactive' } });
  } catch (error) {
    next(error);
  }
});

router.post('/cases/:caseId/assignments/:assignmentId/end', async (request, response, next) => {
  try {
    requireProcessPermission(request, 'case.assign');
    const caseRecord = await loadCase(parseId(request.params.caseId));
    await assertCaseAccess(request.auth.user, caseRecord);
    const assignmentId = parseId(request.params.assignmentId);
    const reason = requiredText(request.body?.reason, 5, 1000, 'Indique el motivo de finalización.');
    await withTransaction(async (connection) => {
      const [rows] = await connection.execute(
        `SELECT id FROM case_assignments
         WHERE id = ? AND case_id = ? AND assignment_status = 'active'
         LIMIT 1 FOR UPDATE`,
        [assignmentId, caseRecord.id]
      );
      if (rows.length === 0) throw new ApiError(404, 'not_found', 'Recurso no encontrado.');
      await connection.execute(
        `UPDATE case_assignments
         SET assignment_status = 'revoked', ended_at = CURRENT_TIMESTAMP,
             ended_by_user_id = ?, ending_reason = ?
         WHERE id = ? AND assignment_status = 'active'`,
        [request.auth.user.id, reason, assignmentId]
      );
      await audit(connection, request, 'case.assignment_revoked', 'case_assignment', assignmentId, { caseId: caseRecord.id, reason });
    });
    response.json({ assignment: { id: assignmentId, assignmentStatus: 'revoked' } });
  } catch (error) {
    next(error);
  }
});

router.post('/cases/:caseId/stages', async (request, response, next) => {
  try {
    requireProcessPermission(request, 'case.stage.manage');
    const caseRecord = await loadCase(parseId(request.params.caseId));
    await assertCaseAccess(request.auth.user, caseRecord);
    const stageCode = requiredText(request.body?.stageCode, 1, 64, 'Seleccione una etapa.');
    const reason = requiredText(request.body?.reason, 5, 1000, 'Indique el motivo de la transición.');
    const transition = await withTransaction(async (connection) => {
      const [profiles] = await connection.execute(
        `SELECT current_stage_code FROM case_profiles WHERE case_id = ? LIMIT 1 FOR UPDATE`,
        [caseRecord.id]
      );
      const [stages] = await connection.execute(
        `SELECT stage_code FROM case_stage_definitions
         WHERE case_type_code = ? AND stage_code = ? AND is_active = TRUE LIMIT 1`,
        [caseRecord.case_type_code, stageCode]
      );
      if (stages.length === 0) throw new ApiError(409, 'stage_not_allowed', 'La etapa no pertenece al tipo de expediente.');
      const previousStage = profiles[0].current_stage_code;
      if (previousStage === stageCode) throw new ApiError(409, 'stage_already_current', 'El expediente ya se encuentra en esa etapa.');
      const [inserted] = await connection.execute(
        `INSERT INTO case_stage_transitions (
           case_id, previous_stage_code, new_stage_code, reason, changed_by_user_id
         ) VALUES (?, ?, ?, ?, ?)`,
        [caseRecord.id, previousStage, stageCode, reason, request.auth.user.id]
      );
      await connection.execute('UPDATE case_profiles SET current_stage_code = ? WHERE case_id = ?', [stageCode, caseRecord.id]);
      await audit(connection, request, 'case.stage_changed', 'case_stage_transition', inserted.insertId, {
        caseId: caseRecord.id, previousStage, stageCode
      });
      return { id: inserted.insertId, previousStageCode: previousStage, newStageCode: stageCode };
    });
    response.status(201).json({ transition });
  } catch (error) {
    next(error);
  }
});

router.post('/cases/:caseId/deadlines', async (request, response, next) => {
  try {
    requireProcessPermission(request, 'case.deadline.manage');
    const caseRecord = await loadCase(parseId(request.params.caseId));
    await assertCaseAccess(request.auth.user, caseRecord);
    const title = requiredText(request.body?.title, 3, 200, 'El título del plazo debe contener entre 3 y 200 caracteres.');
    const description = nullableText(request.body?.description, 1000);
    const dueAt = mysqlTimestamp(request.body?.dueAt, 'Indique una fecha de vencimiento válida.');
    const assignedUserId = request.body?.assignedUserId ? parseId(request.body.assignedUserId) : null;
    const reason = requiredText(request.body?.reason, 5, 1000, 'Indique el motivo de creación del plazo.');
    const deadline = await withTransaction(async (connection) => {
      if (assignedUserId !== null) {
        const [assigned] = await connection.execute(
          `SELECT id FROM case_assignments
           WHERE case_id = ? AND user_id = ? AND assignment_status = 'active' LIMIT 1`,
          [caseRecord.id, assignedUserId]
        );
        if (assigned.length === 0) throw new ApiError(409, 'deadline_assignee_not_assigned', 'El responsable debe tener una asignación activa.');
      }
      const [inserted] = await connection.execute(
        `INSERT INTO case_deadlines (
           case_id, stage_code, title, description, due_at, assigned_user_id,
           deadline_status, status_reason, created_by_user_id
         ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        [
          caseRecord.id,
          caseRecord.current_stage_code,
          title,
          description,
          dueAt,
          assignedUserId,
          reason,
          request.auth.user.id
        ]
      );
      await connection.execute(
        `INSERT INTO case_deadline_status_history (
           case_deadline_id, previous_status, new_status, reason, changed_by_user_id
         ) VALUES (?, NULL, 'pending', ?, ?)`,
        [inserted.insertId, reason, request.auth.user.id]
      );
      await audit(connection, request, 'case.deadline_created', 'case_deadline', inserted.insertId, { caseId: caseRecord.id, dueAt });
      return { id: inserted.insertId, caseId: caseRecord.id, title, dueAt, deadlineStatus: 'pending' };
    });
    response.status(201).json({ deadline });
  } catch (error) {
    next(error);
  }
});

router.post('/cases/:caseId/deadlines/:deadlineId/status', async (request, response, next) => {
  try {
    requireProcessPermission(request, 'case.deadline.manage');
    const caseRecord = await loadCase(parseId(request.params.caseId));
    await assertCaseAccess(request.auth.user, caseRecord);
    const deadlineId = parseId(request.params.deadlineId);
    const status = request.body?.status;
    if (!deadlineStatuses.has(status)) throw new ApiError(400, 'invalid_deadline_status', 'Seleccione un estado final válido.');
    const reason = requiredText(request.body?.reason, 5, 1000, 'Indique el motivo del cambio de estado.');
    await withTransaction(async (connection) => {
      const [rows] = await connection.execute(
        `SELECT id, deadline_status FROM case_deadlines
         WHERE id = ? AND case_id = ? LIMIT 1 FOR UPDATE`,
        [deadlineId, caseRecord.id]
      );
      if (rows.length === 0) throw new ApiError(404, 'not_found', 'Recurso no encontrado.');
      if (rows[0].deadline_status !== 'pending') throw new ApiError(409, 'deadline_already_final', 'El plazo ya tiene un estado final.');
      await connection.execute(
        `UPDATE case_deadlines
         SET deadline_status = ?, status_reason = ?,
             completed_at = CASE WHEN ? = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_at END
         WHERE id = ? AND deadline_status = 'pending'`,
        [status, reason, status, deadlineId]
      );
      await connection.execute(
        `INSERT INTO case_deadline_status_history (
           case_deadline_id, previous_status, new_status, reason, changed_by_user_id
         ) VALUES (?, 'pending', ?, ?, ?)`,
        [deadlineId, status, reason, request.auth.user.id]
      );
      await audit(connection, request, 'case.deadline_status_changed', 'case_deadline', deadlineId, { caseId: caseRecord.id, status, reason });
    });
    response.json({ deadline: { id: deadlineId, deadlineStatus: status } });
  } catch (error) {
    next(error);
  }
});

router.post('/cases/:caseId/state', async (request, response, next) => {
  try {
    const managesVisibility = hasPermission(request.auth.user, 'case.visibility.manage');
    const managesStage = hasPermission(request.auth.user, 'case.stage.manage');
    if (request.auth.channel !== 'web' || (!managesVisibility && !managesStage)) {
      throw new ApiError(403, 'case_state_not_allowed', 'El perfil no puede cambiar el estado del expediente.');
    }
    const caseRecord = await loadCase(parseId(request.params.caseId));
    await assertCaseAccess(request.auth.user, caseRecord);
    const lifecycleStatus = request.body?.lifecycleStatus;
    const visibilityStatus = request.body?.visibilityStatus;
    if (!lifecycleStatuses.has(lifecycleStatus) || !visibilityStatuses.has(visibilityStatus)) {
      throw new ApiError(400, 'invalid_case_state', 'Seleccione estados válidos.');
    }
    if (visibilityStatus === 'hidden' && !managesVisibility) {
      throw new ApiError(403, 'case_visibility_not_allowed', 'El perfil no puede ocultar expedientes.');
    }
    const reason = requiredText(request.body?.reason, 5, 1000, 'Indique el motivo del cambio de estado.');
    await withTransaction(async (connection) => {
      await connection.execute(
        `UPDATE case_profiles
         SET lifecycle_status = ?, visibility_status = ?, status_reason = ?,
             status_changed_by_user_id = ?,
             hidden_at = CASE WHEN ? = 'hidden' THEN CURRENT_TIMESTAMP ELSE NULL END,
             hidden_by_user_id = CASE WHEN ? = 'hidden' THEN ? ELSE NULL END
         WHERE case_id = ?`,
        [
          lifecycleStatus,
          visibilityStatus,
          reason,
          request.auth.user.id,
          visibilityStatus,
          visibilityStatus,
          request.auth.user.id,
          caseRecord.id
        ]
      );
      await audit(connection, request, 'case.state_changed', 'case', caseRecord.id, { lifecycleStatus, visibilityStatus, reason });
    });
    response.json({ case: { id: caseRecord.id, status: lifecycleStatus, visibilityStatus } });
  } catch (error) {
    next(error);
  }
});

export default router;
