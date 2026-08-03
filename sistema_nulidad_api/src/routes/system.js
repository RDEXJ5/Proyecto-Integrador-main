import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../db.js';
import { ApiError } from '../errors.js';
import { config } from '../config.js';
import { requireSystemApiKey } from '../security/api-key.js';

const router = Router();
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const provisionableRoleCodes = new Set([
  'notary', 'judge', 'lawyer', 'prosecutor', 'defender', 'expert',
  'secretary', 'coordinator', 'auditor', 'party', 'witness'
]);

router.use(requireSystemApiKey);

router.get('/schema-status', async (_request, response, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT COUNT(*) AS tableCount
       FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'`
    );
    response.json({ database: 'juzgado_nulidad_documental', tableCount: rows[0].tableCount });
  } catch (error) {
    next(error);
  }
});

router.post('/bootstrap-admin', async (request, response, next) => {
  try {
    const { fullName, email, password } = request.body ?? {};
    if (typeof fullName !== 'string' || fullName.trim().length < 3 || typeof email !== 'string' || !emailPattern.test(email)) {
      throw new ApiError(400, 'invalid_request', 'Nombre y correo válidos son obligatorios.');
    }
    if (typeof password !== 'string' || password.length < config.minimumPasswordLength) {
      throw new ApiError(
        400,
        'weak_password',
        `La contraseña inicial debe tener al menos ${config.minimumPasswordLength} caracteres.`
      );
    }
    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(password, 12);
    const admin = await withTransaction(async (connection) => {
      const [existingAdmins] = await connection.execute(
        `SELECT 1 FROM v_active_user_roles WHERE role_code = 'admin' LIMIT 1`
      );
      if (existingAdmins.length > 0) {
        throw new ApiError(409, 'bootstrap_already_completed', 'Ya existe una cuenta administradora.');
      }
      const [result] = await connection.execute(
        'INSERT INTO users (full_name, email, password_hash) VALUES (?, ?, ?)',
        [fullName.trim(), normalizedEmail, passwordHash]
      );
      await connection.execute(
        "INSERT INTO user_roles (user_id, role_code) VALUES (?, 'admin')",
        [result.insertId]
      );
      await connection.execute(
        `INSERT INTO user_role_grants (
           user_id, role_code, grant_status, granted_by_user_id, grant_reason
         ) VALUES (?, 'admin', 'active', ?, 'Cuenta administradora inicial.')`,
        [result.insertId, result.insertId]
      );
      await connection.execute(
        `INSERT INTO audit_events (actor_user_id, action_code, resource_type, resource_id, details, client_channel)
         VALUES (?, 'system.bootstrap_admin', 'user', ?, JSON_OBJECT('source', 'system-api-key'), 'system')`,
        [result.insertId, String(result.insertId)]
      );
      return { id: result.insertId, fullName: fullName.trim(), email: normalizedEmail };
    });
    response.status(201).json({ admin });
  } catch (error) {
    next(error);
  }
});

router.post('/users', async (request, response, next) => {
  try {
    const { fullName, email, password, roleCode } = request.body ?? {};
    if (typeof fullName !== 'string' || fullName.trim().length < 3 || typeof email !== 'string' || !emailPattern.test(email)) {
      throw new ApiError(400, 'invalid_request', 'Nombre y correo válidos son obligatorios.');
    }
    if (typeof password !== 'string' || password.length < config.minimumPasswordLength) {
      throw new ApiError(
        400,
        'weak_password',
        `La contraseña debe tener al menos ${config.minimumPasswordLength} caracteres.`
      );
    }
    if (!provisionableRoleCodes.has(roleCode)) {
      throw new ApiError(400, 'invalid_role', 'El rol solicitado no puede aprovisionarse por esta ruta.');
    }
    const normalizedEmail = email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await withTransaction(async (connection) => {
      const [admins] = await connection.execute("SELECT 1 FROM v_active_user_roles WHERE role_code = 'admin' LIMIT 1");
      if (admins.length === 0) {
        throw new ApiError(409, 'bootstrap_required', 'Primero debe crearse la cuenta administradora inicial.');
      }
      const [result] = await connection.execute(
        'INSERT INTO users (full_name, email, password_hash) VALUES (?, ?, ?)',
        [fullName.trim(), normalizedEmail, passwordHash]
      );
      await connection.execute(
        'INSERT INTO user_roles (user_id, role_code) VALUES (?, ?)',
        [result.insertId, roleCode]
      );
      await connection.execute(
        `INSERT INTO user_role_grants (
           user_id, role_code, grant_status, grant_reason
         ) VALUES (?, ?, 'active', 'Cuenta aprovisionada mediante API de sistema.')`,
        [result.insertId, roleCode]
      );
      await connection.execute(
        `INSERT INTO audit_events (action_code, resource_type, resource_id, details, client_channel)
         VALUES ('system.user_provisioned', 'user', ?, JSON_OBJECT('role', ?, 'source', 'system-api-key'), 'system')`,
        [String(result.insertId), roleCode]
      );
      return { id: result.insertId, fullName: fullName.trim(), email: normalizedEmail, roleCode };
    });
    response.status(201).json({ user });
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') {
      return next(new ApiError(409, 'email_already_exists', 'El correo ya está registrado.'));
    }
    return next(error);
  }
});

export default router;
