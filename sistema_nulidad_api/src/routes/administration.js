import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { config } from '../config.js';
import { pool, withTransaction } from '../db.js';
import { ApiError } from '../errors.js';
import { hasPermission } from '../security/authorization.js';
import { parseId } from '../security/resource-access.js';

const router = Router();
const roleCodePattern = /^[a-z][a-z0-9_]{1,29}$/;
const catalogCodePattern = /^[a-z][a-z0-9_]{1,63}$/;

function requireAdminPermission(request, permission) {
  if (!['web', 'technical'].includes(request.auth.channel) || !hasPermission(request.auth.user, permission)) {
    throw new ApiError(403, 'administration_not_allowed', 'El perfil no puede realizar esta operación técnica.');
  }
}

function requiredText(value, minimum, maximum, message) {
  if (typeof value !== 'string') throw new ApiError(400, 'invalid_request', message);
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) throw new ApiError(400, 'invalid_request', message);
  return normalized;
}

async function audit(connection, request, actionCode, resourceType, resourceId, details) {
  await connection.execute(
    `INSERT INTO audit_events (
       actor_user_id, action_code, resource_type, resource_id, details, client_channel, ip_address
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      request.auth.user.id,
      actionCode,
      resourceType,
      String(resourceId),
      JSON.stringify(details),
      request.auth.channel === 'technical' ? 'api' : 'web',
      request.ip
    ]
  );
}

router.get('/overview', async (request, response, next) => {
  try {
    requireAdminPermission(request, 'system.health.read');
    const [[overview]] = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM users) AS user_count,
         (SELECT COUNT(*) FROM users WHERE account_status = 'active') AS active_user_count,
         (SELECT COUNT(*) FROM roles) AS role_count,
         (SELECT COUNT(*) FROM document_types WHERE is_active = TRUE) AS active_document_type_count,
         (SELECT COUNT(*) FROM schema_migrations) AS migration_count`
    );
    response.json({ overview });
  } catch (error) {
    next(error);
  }
});

router.get('/users', async (request, response, next) => {
  try {
    requireAdminPermission(request, 'user.manage');
    const [users] = await pool.execute(
      `SELECT user_record.id, user_record.full_name, user_record.email,
              user_record.account_status, user_record.created_at, user_record.updated_at,
              GROUP_CONCAT(active_role.role_code ORDER BY active_role.role_code SEPARATOR ',') AS role_codes
       FROM users user_record
       LEFT JOIN v_active_user_roles active_role ON active_role.user_id = user_record.id
       GROUP BY user_record.id
       ORDER BY (user_record.account_status = 'active') DESC, user_record.full_name`
    );
    response.json({ users: users.map((user) => ({
      ...user,
      roles: user.role_codes ? user.role_codes.split(',') : []
    })) });
  } catch (error) {
    next(error);
  }
});

router.get('/users/:userId', async (request, response, next) => {
  try {
    requireAdminPermission(request, 'user.manage');
    const userId = parseId(request.params.userId);
    const [users] = await pool.execute(
      `SELECT id, full_name, email, account_status, created_at, updated_at
       FROM users
       WHERE id = ?
       LIMIT 1`,
      [userId]
    );
    if (users.length === 0) throw new ApiError(404, 'not_found', 'Recurso no encontrado.');

    const [activeRoles] = await pool.execute(
      `SELECT grant_record.id AS grant_id, role_record.code, role_record.label,
              role_record.channel, role_record.description,
              grant_record.grant_reason, grant_record.granted_at,
              granter.full_name AS granted_by_name
       FROM user_role_grants grant_record
       JOIN roles role_record ON role_record.code = grant_record.role_code
       LEFT JOIN users granter ON granter.id = grant_record.granted_by_user_id
       WHERE grant_record.user_id = ? AND grant_record.grant_status = 'active'
       ORDER BY role_record.label`,
      [userId]
    );
    const [permissions] = await pool.execute(
      `SELECT DISTINCT active_permission.permission_code AS code,
              active_permission.description
       FROM v_active_user_roles active_role
       JOIN v_active_role_permissions active_permission
         ON active_permission.role_code = active_role.role_code
       WHERE active_role.user_id = ?
       ORDER BY active_permission.description`,
      [userId]
    );
    const [roleHistory] = await pool.execute(
      `SELECT grant_record.id, grant_record.role_code, role_record.label AS role_label,
              grant_record.grant_status, grant_record.grant_reason,
              grant_record.granted_at, granter.full_name AS granted_by_name,
              grant_record.revoked_at, grant_record.revocation_reason,
              revoker.full_name AS revoked_by_name
       FROM user_role_grants grant_record
       JOIN roles role_record ON role_record.code = grant_record.role_code
       LEFT JOIN users granter ON granter.id = grant_record.granted_by_user_id
       LEFT JOIN users revoker ON revoker.id = grant_record.revoked_by_user_id
       WHERE grant_record.user_id = ?
       ORDER BY grant_record.granted_at DESC, grant_record.id DESC`,
      [userId]
    );
    const [statusHistory] = await pool.execute(
      `SELECT status_change.id, status_change.previous_status,
              status_change.new_status, status_change.reason,
              status_change.changed_at, actor.full_name AS changed_by_name
       FROM user_status_changes status_change
       JOIN users actor ON actor.id = status_change.changed_by_user_id
       WHERE status_change.user_id = ?
       ORDER BY status_change.changed_at DESC, status_change.id DESC`,
      [userId]
    );
    const [unitMemberships] = await pool.execute(
      `SELECT membership.id, unit_record.code AS unit_code,
              unit_record.name AS unit_name, unit_record.unit_type,
              membership.membership_type, membership.membership_status,
              membership.membership_reason, membership.granted_at,
              granter.full_name AS granted_by_name,
              membership.revoked_at, membership.revocation_reason
       FROM user_unit_memberships membership
       JOIN organizational_units unit_record
         ON unit_record.id = membership.organizational_unit_id
       LEFT JOIN users granter ON granter.id = membership.granted_by_user_id
       WHERE membership.user_id = ?
       ORDER BY (membership.membership_status = 'active') DESC,
                membership.granted_at DESC, membership.id DESC`,
      [userId]
    );

    response.json({
      user: users[0],
      activeRoles,
      permissions,
      roleHistory,
      statusHistory,
      unitMemberships
    });
  } catch (error) {
    next(error);
  }
});

router.post('/users', async (request, response, next) => {
  try {
    requireAdminPermission(request, 'user.manage');
    const fullName = requiredText(request.body?.fullName, 3, 160, 'El nombre debe contener entre 3 y 160 caracteres.');
    const email = requiredText(request.body?.email, 5, 255, 'Indique un correo válido.').toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'invalid_email', 'Indique un correo válido.');
    const password = requiredText(
      request.body?.password,
      config.minimumPasswordLength,
      200,
      `La contraseña debe contener al menos ${config.minimumPasswordLength} caracteres.`
    );
    const roleCode = request.body?.roleCode;
    if (typeof roleCode !== 'string' || !roleCodePattern.test(roleCode)) throw new ApiError(400, 'invalid_role', 'Seleccione un rol válido.');
    const reason = requiredText(request.body?.reason, 5, 1000, 'Indique el motivo de creación.');
    const created = await withTransaction(async (connection) => {
      const [duplicates] = await connection.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
      if (duplicates.length > 0) throw new ApiError(409, 'email_already_exists', 'El correo ya está registrado.');
      const [roles] = await connection.execute('SELECT code FROM roles WHERE code = ? LIMIT 1', [roleCode]);
      if (roles.length === 0) throw new ApiError(400, 'invalid_role', 'Seleccione un rol válido.');
      const passwordHash = await bcrypt.hash(password, 12);
      const [inserted] = await connection.execute(
        `INSERT INTO users (full_name, email, password_hash, account_status)
         VALUES (?, ?, ?, 'active')`,
        [fullName, email, passwordHash]
      );
      await connection.execute(
        `INSERT INTO user_role_grants (
           user_id, role_code, grant_status, granted_by_user_id, grant_reason
         ) VALUES (?, ?, 'active', ?, ?)`,
        [inserted.insertId, roleCode, request.auth.user.id, reason]
      );
      await audit(connection, request, 'admin.user_created', 'user', inserted.insertId, { email, roleCode, reason });
      return { id: inserted.insertId, fullName, email, accountStatus: 'active', roles: [roleCode] };
    });
    response.status(201).json({ user: created });
  } catch (error) {
    next(error);
  }
});

router.post('/users/:userId/password', async (request, response, next) => {
  try {
    requireAdminPermission(request, 'user.manage');
    const userId = parseId(request.params.userId);
    const password = requiredText(
      request.body?.password,
      config.minimumPasswordLength,
      200,
      `La contraseña debe contener al menos ${config.minimumPasswordLength} caracteres.`
    );
    const reason = requiredText(request.body?.reason, 5, 1000, 'Indique el motivo del cambio de contraseña.');
    const passwordHash = await bcrypt.hash(password, 12);
    await withTransaction(async (connection) => {
      const [users] = await connection.execute(
        'SELECT id FROM users WHERE id = ? LIMIT 1 FOR UPDATE',
        [userId]
      );
      if (users.length === 0) throw new ApiError(404, 'not_found', 'Recurso no encontrado.');
      await connection.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
      await audit(connection, request, 'admin.user_password_reset', 'user', userId, { reason });
    });
    response.json({ user: { id: userId, passwordUpdated: true } });
  } catch (error) {
    next(error);
  }
});

router.post('/users/:userId/status', async (request, response, next) => {
  try {
    requireAdminPermission(request, 'user.manage');
    const userId = parseId(request.params.userId);
    if (userId === request.auth.user.id) throw new ApiError(409, 'self_status_change_not_allowed', 'No puedes cambiar el estado de tu propia cuenta.');
    const status = request.body?.status;
    if (!['active', 'suspended', 'archived'].includes(status)) throw new ApiError(400, 'invalid_user_status', 'Seleccione un estado válido.');
    const reason = requiredText(request.body?.reason, 5, 1000, 'Indique el motivo del cambio.');
    await withTransaction(async (connection) => {
      const [rows] = await connection.execute(
        'SELECT id, account_status FROM users WHERE id = ? LIMIT 1 FOR UPDATE',
        [userId]
      );
      if (rows.length === 0) throw new ApiError(404, 'not_found', 'Recurso no encontrado.');
      if (rows[0].account_status === status) throw new ApiError(409, 'user_status_unchanged', 'La cuenta ya tiene ese estado.');
      await connection.execute('UPDATE users SET account_status = ? WHERE id = ?', [status, userId]);
      await connection.execute(
        `INSERT INTO user_status_changes (
           user_id, previous_status, new_status, reason, changed_by_user_id
         ) VALUES (?, ?, ?, ?, ?)`,
        [userId, rows[0].account_status, status, reason, request.auth.user.id]
      );
      await audit(connection, request, 'admin.user_status_changed', 'user', userId, {
        previousStatus: rows[0].account_status, status, reason
      });
    });
    response.json({ user: { id: userId, accountStatus: status } });
  } catch (error) {
    next(error);
  }
});

router.get('/roles', async (request, response, next) => {
  try {
    requireAdminPermission(request, 'role.manage');
    const [roles] = await pool.execute('SELECT code, label, channel, description FROM roles ORDER BY label');
    const [permissions] = await pool.execute(
      `SELECT active_permission.role_code, active_permission.permission_code,
              active_permission.description
       FROM v_active_role_permissions active_permission
       ORDER BY active_permission.role_code, active_permission.permission_code`
    );
    response.json({ roles, permissions });
  } catch (error) {
    next(error);
  }
});

router.post('/users/:userId/roles', async (request, response, next) => {
  try {
    requireAdminPermission(request, 'role.manage');
    const userId = parseId(request.params.userId);
    const roleCode = request.body?.roleCode;
    if (typeof roleCode !== 'string' || !roleCodePattern.test(roleCode)) throw new ApiError(400, 'invalid_role', 'Seleccione un rol válido.');
    const reason = requiredText(request.body?.reason, 5, 1000, 'Indique el motivo de la concesión.');
    const grant = await withTransaction(async (connection) => {
      const [eligible] = await connection.execute(
        `SELECT user_record.id FROM users user_record JOIN roles role_record ON role_record.code = ?
         WHERE user_record.id = ? LIMIT 1`,
        [roleCode, userId]
      );
      if (eligible.length === 0) throw new ApiError(404, 'not_found', 'Usuario o rol no encontrado.');
      const [active] = await connection.execute(
        `SELECT id FROM user_role_grants
         WHERE user_id = ? AND role_code = ? AND grant_status = 'active' LIMIT 1`,
        [userId, roleCode]
      );
      if (active.length > 0) throw new ApiError(409, 'role_already_granted', 'El rol ya está activo para el usuario.');
      const [inserted] = await connection.execute(
        `INSERT INTO user_role_grants (
           user_id, role_code, grant_status, granted_by_user_id, grant_reason
         ) VALUES (?, ?, 'active', ?, ?)`,
        [userId, roleCode, request.auth.user.id, reason]
      );
      await audit(connection, request, 'admin.role_granted', 'user_role_grant', inserted.insertId, { userId, roleCode, reason });
      return { id: inserted.insertId, userId, roleCode, grantStatus: 'active' };
    });
    response.status(201).json({ grant });
  } catch (error) {
    next(error);
  }
});

router.post('/users/:userId/roles/:roleCode/revoke', async (request, response, next) => {
  try {
    requireAdminPermission(request, 'role.manage');
    const userId = parseId(request.params.userId);
    const roleCode = request.params.roleCode;
    if (!roleCodePattern.test(roleCode)) throw new ApiError(404, 'not_found', 'Recurso no encontrado.');
    if (userId === request.auth.user.id && roleCode === 'admin') {
      throw new ApiError(409, 'self_admin_revoke_not_allowed', 'No puedes revocar tu propio rol administrador.');
    }
    const reason = requiredText(request.body?.reason, 5, 1000, 'Indique el motivo de la revocación.');
    const grantId = await withTransaction(async (connection) => {
      const [rows] = await connection.execute(
        `SELECT id FROM user_role_grants
         WHERE user_id = ? AND role_code = ? AND grant_status = 'active'
         ORDER BY granted_at DESC, id DESC LIMIT 1 FOR UPDATE`,
        [userId, roleCode]
      );
      if (rows.length === 0) throw new ApiError(404, 'not_found', 'Recurso no encontrado.');
      await connection.execute(
        `UPDATE user_role_grants
         SET grant_status = 'revoked', revoked_at = CURRENT_TIMESTAMP,
             revoked_by_user_id = ?, revocation_reason = ?
         WHERE id = ? AND grant_status = 'active'`,
        [request.auth.user.id, reason, rows[0].id]
      );
      await audit(connection, request, 'admin.role_revoked', 'user_role_grant', rows[0].id, { userId, roleCode, reason });
      return rows[0].id;
    });
    response.json({ grant: { id: grantId, userId, roleCode, grantStatus: 'revoked' } });
  } catch (error) {
    next(error);
  }
});

router.get('/catalogs', async (request, response, next) => {
  try {
    requireAdminPermission(request, 'catalog.manage');
    const [legalAreas] = await pool.execute('SELECT * FROM legal_areas ORDER BY label');
    const [caseTypes] = await pool.execute('SELECT * FROM case_types ORDER BY label');
    const [documentTypes] = await pool.execute(
      `SELECT document_type.code, document_type.label, document_type.description,
              document_type.owner_scope, document_type.default_sensitive,
              document_type.is_active, rule_record.rule_code,
              rule_record.embedded_signature_policy, rule_record.platform_signature_policy,
              rule_record.requires_authorization, rule_record.requires_certification,
              rule_record.analyzer_policy
       FROM document_types document_type
       LEFT JOIN document_type_rules rule_record
         ON rule_record.id = (
           SELECT candidate.id FROM document_type_rules candidate
           WHERE candidate.document_type_code = document_type.code AND candidate.rule_status = 'active'
           ORDER BY candidate.priority, candidate.id DESC LIMIT 1
         )
       ORDER BY document_type.label`
    );
    response.json({ catalogs: { legalAreas, caseTypes, documentTypes } });
  } catch (error) {
    next(error);
  }
});

router.post('/document-types', async (request, response, next) => {
  try {
    requireAdminPermission(request, 'catalog.manage');
    const code = request.body?.code;
    if (typeof code !== 'string' || !catalogCodePattern.test(code)) throw new ApiError(400, 'invalid_catalog_code', 'Use un código en minúsculas con guiones bajos.');
    const label = requiredText(request.body?.label, 3, 120, 'La etiqueta debe contener entre 3 y 120 caracteres.');
    const description = requiredText(request.body?.description, 5, 500, 'La descripción debe contener entre 5 y 500 caracteres.');
    const ownerScope = request.body?.ownerScope;
    if (!['participant', 'case'].includes(ownerScope)) throw new ApiError(400, 'invalid_owner_scope', 'Seleccione un alcance válido.');
    const embeddedPolicy = request.body?.embeddedSignaturePolicy;
    const platformPolicy = request.body?.platformSignaturePolicy;
    const policies = ['none', 'optional', 'required', 'conditional'];
    if (!policies.includes(embeddedPolicy) || !policies.includes(platformPolicy)) throw new ApiError(400, 'invalid_signature_policy', 'Seleccione políticas de firma válidas.');
    const requiresAuthorization = request.body?.requiresAuthorization === true;
    const requiresCertification = request.body?.requiresCertification === true;
    const analyzerPolicy = request.body?.analyzerPolicy;
    if (!['skip', 'on_demand', 'automatic'].includes(analyzerPolicy)) throw new ApiError(400, 'invalid_analyzer_policy', 'Seleccione una política de análisis válida.');
    const signerRoles = Array.isArray(request.body?.signerRoles) ? [...new Set(request.body.signerRoles)] : [];
    if (platformPolicy === 'required' && signerRoles.length === 0) throw new ApiError(400, 'signer_role_required', 'Una firma obligatoria requiere al menos un rol firmante.');
    const result = await withTransaction(async (connection) => {
      const [duplicates] = await connection.execute('SELECT code FROM document_types WHERE code = ? LIMIT 1', [code]);
      if (duplicates.length > 0) throw new ApiError(409, 'document_type_exists', 'El tipo documental ya existe; crea una nueva regla para modificar su política.');
      if (signerRoles.length > 0) {
        const placeholders = signerRoles.map(() => '?').join(',');
        const [roles] = await connection.execute(`SELECT code FROM roles WHERE code IN (${placeholders})`, signerRoles);
        if (roles.length !== signerRoles.length) throw new ApiError(400, 'invalid_signer_role', 'Uno de los roles firmantes no existe.');
      }
      await connection.execute(
        `INSERT INTO document_types (
           code, label, description, owner_scope,
           requires_notarial_authorization, requires_judicial_signature,
           default_sensitive, is_active
         ) VALUES (?, ?, ?, ?, ?, ?, ?, TRUE)`,
        [
          code, label, description, ownerScope,
          requiresAuthorization ? 1 : 0,
          0,
          request.body?.defaultSensitive === false ? 0 : 1
        ]
      );
      const ruleCode = `${code}_v1`;
      const [inserted] = await connection.execute(
        `INSERT INTO document_type_rules (
           rule_code, document_type_code, embedded_signature_policy,
           platform_signature_policy, minimum_platform_signatures,
           requires_authorization, authorization_role_code,
           requires_certification, certification_role_code,
           analyzer_policy, priority, rule_status, created_by_user_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 100, 'active', ?)`,
        [
          ruleCode, code, embeddedPolicy, platformPolicy,
          platformPolicy === 'none' ? 0 : 1,
          requiresAuthorization ? 1 : 0,
          requiresAuthorization ? 'notary' : null,
          requiresCertification ? 1 : 0,
          requiresCertification ? 'notary' : null,
          analyzerPolicy,
          request.auth.user.id
        ]
      );
      for (const signerRole of signerRoles) {
        await connection.execute(
          `INSERT INTO document_rule_signer_roles (document_type_rule_id, role_code, minimum_signatures)
           VALUES (?, ?, 1)`,
          [inserted.insertId, signerRole]
        );
      }
      await audit(connection, request, 'admin.document_type_created', 'document_type', code, { ruleCode, signerRoles });
      return { code, label, ruleCode };
    });
    response.status(201).json({ documentType: result });
  } catch (error) {
    next(error);
  }
});

router.get('/configuration', async (request, response, next) => {
  try {
    requireAdminPermission(request, 'configuration.manage');
    response.json({
      configuration: {
        environment: config.environment,
        jwtExpiresIn: config.jwt.expiresIn,
        jwtIssuer: config.jwt.issuer,
        jwtAudience: config.jwt.audience,
        storageProvider: 'minio',
        storageBucket: config.storage.bucket,
        maxDocumentBytes: config.storage.maxDocumentBytes,
        objectRetention: 'compliance-10-years',
        permanentDatabaseRetention: true,
        secretsExposed: false
      }
    });
  } catch (error) {
    next(error);
  }
});

export default router;
