import { withTransaction } from '../db.js';
import { ApiError } from '../errors.js';
import { loadActiveUser } from '../security/auth.js';

const editableFields = new Set(['fullName']);

export function validateOwnProfileUpdate(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ApiError(400, 'invalid_request', 'Escribe el nombre que deseas mostrar.');
  }

  const fields = Object.keys(payload);
  if (fields.some((field) => !editableFields.has(field))) {
    throw new ApiError(
      400,
      'profile_field_not_editable',
      'Desde Mi perfil solamente puedes modificar tu nombre visible.'
    );
  }

  if (typeof payload.fullName !== 'string') {
    throw new ApiError(400, 'invalid_profile_name', 'El nombre debe contener entre 3 y 160 caracteres.');
  }

  const fullName = payload.fullName.trim().replace(/\s+/g, ' ');
  if (fullName.length < 3 || fullName.length > 160) {
    throw new ApiError(400, 'invalid_profile_name', 'El nombre debe contener entre 3 y 160 caracteres.');
  }

  return { fullName };
}

export async function updateOwnProfile({ userId, payload, clientChannel, ipAddress }) {
  const { fullName } = validateOwnProfileUpdate(payload);
  const auditChannel = clientChannel === 'mobile' ? 'mobile' : 'web';

  const changed = await withTransaction(async (connection) => {
    const [users] = await connection.execute(
      `SELECT full_name
       FROM users
       WHERE id = ? AND account_status = 'active'
       FOR UPDATE`,
      [userId]
    );
    if (users.length === 0) {
      throw new ApiError(401, 'invalid_token', 'La sesión ya no es válida.');
    }

    const previousFullName = users[0].full_name;
    if (previousFullName === fullName) return false;

    await connection.execute(
      'UPDATE users SET full_name = ? WHERE id = ?',
      [fullName, userId]
    );
    await connection.execute(
      `INSERT INTO audit_events (
         actor_user_id, action_code, resource_type, resource_id,
         details, client_channel, ip_address
       ) VALUES (?, 'profile.updated', 'user', ?, ?, ?, ?)`,
      [
        userId,
        String(userId),
        JSON.stringify({ changedFields: ['fullName'], previousFullName, fullName }),
        auditChannel,
        ipAddress
      ]
    );
    return true;
  });

  const user = await loadActiveUser(userId, clientChannel);
  if (!user) throw new ApiError(401, 'invalid_token', 'La sesión ya no es válida.');
  return { user, changed };
}
