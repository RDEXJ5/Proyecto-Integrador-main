import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { pool } from '../db.js';
import { ApiError } from '../errors.js';
import { isAllowedChannel } from './authorization.js';

export async function loadActiveUser(userId, channel = null) {
  const [users] = await pool.execute(
    `SELECT id, full_name, email, account_status
     FROM users
     WHERE id = ? AND account_status = 'active'`,
    [userId]
  );
  if (users.length === 0) return null;

  const user = users[0];
  const [roles] = await pool.execute(
    `SELECT roles.code, roles.label, roles.channel
     FROM v_active_user_roles active_roles
     JOIN roles ON roles.code = active_roles.role_code
     WHERE active_roles.user_id = ?
       AND (? IS NULL OR roles.channel = ?)
     ORDER BY roles.code`,
    [user.id, channel, channel]
  );
  const [permissionRows] = await pool.execute(
    `SELECT DISTINCT active_permissions.permission_code
     FROM v_active_user_roles active_roles
     JOIN roles ON roles.code = active_roles.role_code
     JOIN v_active_role_permissions active_permissions
       ON active_permissions.role_code = active_roles.role_code
     WHERE active_roles.user_id = ?
       AND (? IS NULL OR roles.channel = ?)
     ORDER BY active_permissions.permission_code`,
    [user.id, channel, channel]
  );
  return {
    ...user,
    roles,
    permissions: permissionRows.map((entry) => entry.permission_code)
  };
}

export function issueAccessToken(user, channel) {
  return jwt.sign({ channel }, config.jwt.secret, {
    algorithm: 'HS256',
    subject: String(user.id),
    issuer: config.jwt.issuer,
    audience: config.jwt.audience,
    expiresIn: config.jwt.expiresIn
  });
}

export async function authenticate(request, _response, next) {
  const authorization = request.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return next(new ApiError(401, 'authentication_required', 'Se requiere un token de acceso.'));
  }

  try {
    const token = authorization.slice('Bearer '.length);
    const payload = jwt.verify(token, config.jwt.secret, {
      algorithms: ['HS256'],
      issuer: config.jwt.issuer,
      audience: config.jwt.audience
    });
    const userId = Number(payload.sub);
    if (!Number.isSafeInteger(userId) || userId <= 0 || typeof payload.channel !== 'string') {
      throw new Error('Invalid token payload');
    }
    const user = await loadActiveUser(userId, payload.channel);
    if (!user || !isAllowedChannel(user, payload.channel)) {
      return next(new ApiError(401, 'invalid_token', 'La sesión ya no es válida.'));
    }
    request.auth = { user, channel: payload.channel };
    return next();
  } catch {
    return next(new ApiError(401, 'invalid_token', 'El token no es válido o expiró.'));
  }
}
