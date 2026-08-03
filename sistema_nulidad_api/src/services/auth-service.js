import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { ApiError } from '../errors.js';
import { issueAccessToken, loadActiveUser } from '../security/auth.js';
import { isAllowedChannel } from '../security/authorization.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function authenticatePassword({ email, password, clientChannel, allowedChannels }) {
  if (
    typeof email !== 'string'
    || !emailPattern.test(email)
    || typeof password !== 'string'
    || typeof clientChannel !== 'string'
  ) {
    throw new ApiError(400, 'invalid_request', 'Correo, contraseña y canal de cliente son obligatorios.');
  }

  if (!allowedChannels.includes(clientChannel)) {
    throw new ApiError(400, 'invalid_channel', 'Canal de cliente no válido para esta API.');
  }

  const [users] = await pool.execute(
    `SELECT id, password_hash
     FROM users
     WHERE email = ? AND account_status = 'active'`,
    [email.trim().toLowerCase()]
  );
  const candidate = users[0];
  const passwordMatches = candidate?.password_hash?.startsWith('$2')
    ? await bcrypt.compare(password, candidate.password_hash)
    : false;

  if (!passwordMatches) {
    throw new ApiError(401, 'invalid_credentials', 'Correo o contraseña incorrectos.');
  }

  const user = await loadActiveUser(candidate.id, clientChannel);
  if (!user || !isAllowedChannel(user, clientChannel)) {
    throw new ApiError(403, 'channel_not_allowed', 'El perfil no puede iniciar sesión desde este canal.');
  }

  return {
    accessToken: issueAccessToken(user, clientChannel),
    user
  };
}

export function publicUser(user, { roles = user.roles, permissions = user.permissions } = {}) {
  return {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    roles,
    permissions
  };
}
