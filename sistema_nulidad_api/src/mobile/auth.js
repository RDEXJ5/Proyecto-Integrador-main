import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { config } from '../config.js';
import { pool, withTransaction } from '../db.js';
import { ApiError } from '../errors.js';
import { authenticate } from '../security/auth.js';
import { issueAccessToken, loadActiveUser } from '../security/auth.js';
import { requireMobileParticipant } from '../security/channel.js';
import { authenticatePassword, publicUser } from '../services/auth-service.js';
import { updateOwnProfile } from '../services/profile-service.js';
import { activeMobileRoleCodes } from './access.js';

const router = Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const registrationRoles = new Set(['party', 'witness']);
const mobilePermissions = new Set([
  'case.read.assigned',
  'document.read.assigned',
  'document.upload',
  'document.version.create',
  'document.observation.respond',
  'workspace.mobile.access'
]);

function mobilePublicUser(user) {
  const roleCodes = new Set(activeMobileRoleCodes(user));
  return publicUser(user, {
    roles: user.roles.filter((role) => roleCodes.has(role.code)),
    permissions: user.permissions.filter((permission) => mobilePermissions.has(permission))
  });
}

function requiredRegistrationText(value, minimum, maximum, message) {
  if (typeof value !== 'string') throw new ApiError(400, 'invalid_request', message);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    throw new ApiError(400, 'invalid_request', message);
  }
  return normalized;
}

router.post('/register', async (request, response, next) => {
  try {
    const fullName = requiredRegistrationText(
      request.body?.fullName,
      3,
      160,
      'El nombre debe contener entre 3 y 160 caracteres.'
    );
    const email = requiredRegistrationText(
      request.body?.email,
      5,
      255,
      'Indique un correo electrónico válido.'
    ).toLowerCase();
    if (!emailPattern.test(email)) {
      throw new ApiError(400, 'invalid_email', 'Indique un correo electrónico válido.');
    }
    const minimumLength = config.minimumPasswordLength;
    const password = request.body?.password;
    if (typeof password !== 'string' || password.length < minimumLength || password.length > 200) {
      throw new ApiError(
        400,
        'invalid_password',
        `La contraseña debe contener al menos ${minimumLength} caracteres.`
      );
    }
    const roleCode = request.body?.roleCode;
    if (!registrationRoles.has(roleCode)) {
      throw new ApiError(400, 'invalid_mobile_role', 'Seleccione Parte interesada o Testigo.');
    }

    let userId;
    try {
      userId = await withTransaction(async (connection) => {
        const [duplicates] = await connection.execute(
          'SELECT id FROM users WHERE email = ? LIMIT 1',
          [email]
        );
        if (duplicates.length > 0) {
          throw new ApiError(409, 'email_already_exists', 'Ya existe una cuenta con ese correo electrónico.');
        }
        const passwordHash = await bcrypt.hash(password, 12);
        const [inserted] = await connection.execute(
          `INSERT INTO users (full_name, email, password_hash, account_status)
           VALUES (?, ?, ?, 'active')`,
          [fullName, email, passwordHash]
        );
        await connection.execute(
          `INSERT INTO user_role_grants (
             user_id, role_code, grant_status, granted_by_user_id, grant_reason
           ) VALUES (?, ?, 'active', NULL, 'Autorregistro desde la aplicación móvil.')`,
          [inserted.insertId, roleCode]
        );
        await connection.execute(
          `INSERT INTO audit_events (
             actor_user_id, action_code, resource_type, resource_id,
             details, client_channel, ip_address
           ) VALUES (?, 'auth.mobile_registered', 'user', ?, ?, 'mobile', ?)`,
          [
            inserted.insertId,
            String(inserted.insertId),
            JSON.stringify({ roleCode }),
            request.ip
          ]
        );
        return inserted.insertId;
      });
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        throw new ApiError(409, 'email_already_exists', 'Ya existe una cuenta con ese correo electrónico.');
      }
      throw error;
    }

    const user = await loadActiveUser(userId, 'mobile');
    const accessToken = issueAccessToken(user, 'mobile');
    response.status(201).json({
      accessToken,
      tokenType: 'Bearer',
      expiresIn: process.env.JWT_EXPIRES_IN ?? '30m',
      user: mobilePublicUser(user)
    });
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (request, response, next) => {
  try {
    const { accessToken, user } = await authenticatePassword({
      email: request.body?.email,
      password: request.body?.password,
      clientChannel: 'mobile',
      allowedChannels: ['mobile']
    });
    response.json({
      accessToken,
      tokenType: 'Bearer',
      expiresIn: process.env.JWT_EXPIRES_IN ?? '30m',
      user: mobilePublicUser(user)
    });
  } catch (error) {
    next(error);
  }
});

router.get('/me', authenticate, requireMobileParticipant, (request, response) => {
  response.json({
    ...mobilePublicUser(request.auth.user),
    channel: 'mobile'
  });
});

router.patch('/me', authenticate, requireMobileParticipant, async (request, response, next) => {
  try {
    const { user, changed } = await updateOwnProfile({
      userId: request.auth.user.id,
      payload: request.body,
      clientChannel: 'mobile',
      ipAddress: request.ip
    });
    response.json({ user: mobilePublicUser(user), changed });
  } catch (error) {
    next(error);
  }
});

export default router;
