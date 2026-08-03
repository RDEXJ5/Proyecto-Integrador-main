import { Router } from 'express';
import { pool, withTransaction } from '../db.js';
import { ApiError, notFound } from '../errors.js';
import { parseId } from '../security/resource-access.js';

const router = Router();

async function audit(connection, request, actionCode, invitation, details = {}) {
  await connection.execute(
    `INSERT INTO audit_events (
       actor_user_id, action_code, resource_type, resource_id,
       details, client_channel, ip_address
     ) VALUES (?, ?, 'case_participant_invitation', ?, ?, 'mobile', ?)`,
    [
      request.auth.user.id,
      actionCode,
      String(invitation.id),
      JSON.stringify({
        caseId: invitation.case_id,
        participantRoleCode: invitation.participant_role_code,
        ...details
      }),
      request.ip
    ]
  );
}

async function lockedInvitation(connection, invitationId, userId) {
  const [rows] = await connection.execute(
    `SELECT invitation_record.*, profile.visibility_status,
            EXISTS (
              SELECT 1 FROM v_active_user_roles active_role
              WHERE active_role.user_id = invitation_record.invited_user_id
                AND active_role.role_code = CASE
                  WHEN invitation_record.participant_role_code = 'witness' THEN 'witness'
                  ELSE 'party'
                END
            ) AS role_matches
     FROM case_participant_invitations invitation_record
     JOIN case_profiles profile ON profile.case_id = invitation_record.case_id
     WHERE invitation_record.id = ?
       AND invitation_record.invited_user_id = ?
     LIMIT 1 FOR UPDATE`,
    [invitationId, userId]
  );
  if (rows.length === 0) throw notFound();
  return rows[0];
}

function assertPending(invitation) {
  if (invitation.invitation_status !== 'pending') {
    throw new ApiError(409, 'invitation_already_answered', 'La invitación ya fue respondida.');
  }
}

router.get('/', async (request, response, next) => {
  try {
    const [invitations] = await pool.execute(
      `SELECT
         invitation_record.id,
         invitation_record.case_id,
         invitation_record.participant_role_code,
         participant_type.label AS participant_role_label,
         invitation_record.invitation_reason,
         invitation_record.invited_at,
         invitation_record.expires_at,
         case_record.folio,
         case_record.title AS case_title,
         case_type.label AS case_type_label,
         legal_area.label AS legal_area_label,
         sender.full_name AS invited_by_name
       FROM case_participant_invitations invitation_record
       JOIN cases case_record ON case_record.id = invitation_record.case_id
       JOIN case_profiles profile ON profile.case_id = case_record.id
       JOIN case_types case_type ON case_type.code = profile.case_type_code
       JOIN legal_areas legal_area ON legal_area.code = case_type.legal_area_code
       JOIN case_participant_role_types participant_type
         ON participant_type.code = invitation_record.participant_role_code
       JOIN users sender ON sender.id = invitation_record.invited_by_user_id
       WHERE invitation_record.invited_user_id = ?
         AND invitation_record.invitation_status = 'pending'
         AND invitation_record.expires_at > CURRENT_TIMESTAMP
         AND profile.visibility_status = 'visible'
       ORDER BY invitation_record.invited_at DESC, invitation_record.id DESC`,
      [request.auth.user.id]
    );
    response.json({ invitations });
  } catch (error) {
    next(error);
  }
});

router.post('/:invitationId/accept', async (request, response, next) => {
  try {
    const invitationId = parseId(request.params.invitationId);
    const result = await withTransaction(async (connection) => {
      const invitation = await lockedInvitation(connection, invitationId, request.auth.user.id);
      assertPending(invitation);
      if (new Date(invitation.expires_at).getTime() <= Date.now()) {
        await connection.execute(
          `UPDATE case_participant_invitations
           SET invitation_status = 'expired', responded_at = CURRENT_TIMESTAMP,
               response_ip_address = ?
           WHERE id = ? AND invitation_status = 'pending'`,
          [request.ip, invitation.id]
        );
        await audit(connection, request, 'case.invitation_expired', invitation);
        return { expired: true };
      }
      if (invitation.visibility_status !== 'visible') throw notFound();
      if (!invitation.role_matches) {
        throw new ApiError(409, 'invitation_role_mismatch', 'Tu perfil ya no corresponde con esta invitación.');
      }

      const [existing] = await connection.execute(
        `SELECT id FROM case_participant_roles
         WHERE case_id = ? AND user_id = ? AND participant_role_code = ?
           AND participation_status = 'active'
         LIMIT 1`,
        [invitation.case_id, request.auth.user.id, invitation.participant_role_code]
      );
      let participationId = existing[0]?.id;
      if (!participationId) {
        const [inserted] = await connection.execute(
          `INSERT INTO case_participant_roles (
             case_id, user_id, participant_role_code, participation_status,
             added_by_user_id, participation_reason
           ) VALUES (?, ?, ?, 'active', ?, ?)`,
          [
            invitation.case_id,
            request.auth.user.id,
            invitation.participant_role_code,
            invitation.invited_by_user_id,
            invitation.invitation_reason
          ]
        );
        participationId = inserted.insertId;
      }
      await connection.execute(
        `UPDATE case_participant_invitations
         SET invitation_status = 'accepted', responded_at = CURRENT_TIMESTAMP,
             response_ip_address = ?
         WHERE id = ? AND invitation_status = 'pending'`,
        [request.ip, invitation.id]
      );
      await audit(connection, request, 'case.invitation_accepted', invitation, { participationId });
      return {
        expired: false,
        invitationId: invitation.id,
        caseId: invitation.case_id,
        participationId
      };
    });
    if (result.expired) {
      throw new ApiError(409, 'invitation_expired', 'La invitación venció. Solicita una nueva invitación.');
    }
    response.json({ invitation: { id: result.invitationId, status: 'accepted' }, participation: result });
  } catch (error) {
    next(error);
  }
});

router.post('/:invitationId/decline', async (request, response, next) => {
  try {
    const invitationId = parseId(request.params.invitationId);
    const invitation = await withTransaction(async (connection) => {
      const current = await lockedInvitation(connection, invitationId, request.auth.user.id);
      assertPending(current);
      await connection.execute(
        `UPDATE case_participant_invitations
         SET invitation_status = 'declined', responded_at = CURRENT_TIMESTAMP,
             response_ip_address = ?
         WHERE id = ? AND invitation_status = 'pending'`,
        [request.ip, current.id]
      );
      await audit(connection, request, 'case.invitation_declined', current);
      return current;
    });
    response.json({ invitation: { id: invitation.id, status: 'declined' } });
  } catch (error) {
    next(error);
  }
});

export default router;
