import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { config } from './config.js';
import { pool } from './db.js';
import { ApiError } from './errors.js';
import { authenticate } from './security/auth.js';
import { requireMobileParticipant } from './security/channel.js';
import mobileAuthRouter from './mobile/auth.js';
import mobileCasesRouter from './mobile/cases.js';
import mobileDocumentsRouter from './mobile/documents.js';
import mobileInvitationsRouter from './mobile/invitations.js';
import { assertStorageReady } from './storage/minio.js';
import { createHttpMetrics } from './observability/metrics.js';

export function createMobileApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.environment === 'production' ? 1 : false);
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) return callback(null, true);
      return callback(new ApiError(403, 'origin_not_allowed', 'Origen no autorizado.'));
    },
    methods: ['GET', 'POST', 'PATCH'],
    allowedHeaders: ['Authorization', 'Content-Type']
  }));
  const metrics = createHttpMetrics('api-movil');
  app.use(metrics.middleware);
  app.get('/metrics', metrics.handler);
  app.use(express.json({ limit: '1mb', strict: true }));
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 200,
    skip: (request) => request.path === '/health' || request.path === '/metrics',
    standardHeaders: true,
    legacyHeaders: false,
    ipv6Subnet: 56
  }));

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    ipv6Subnet: 56
  });

  const registrationLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: true,
    legacyHeaders: false,
    ipv6Subnet: 56
  });

  app.get('/', (_request, response) => response.json({
    service: 'Expediente Íntegro · API móvil',
    status: 'ok',
    allowedProfiles: ['party', 'witness']
  }));
  app.get('/health', async (_request, response, next) => {
    try {
      await pool.query('SELECT 1');
      await assertStorageReady();
      response.json({ status: 'ok', database: 'reachable', storage: 'reachable', channel: 'mobile' });
    } catch (error) {
      next(error);
    }
  });

  app.use('/auth/login', loginLimiter);
  app.use('/auth/register', registrationLimiter);
  app.use('/auth', mobileAuthRouter);
  app.use('/invitations', authenticate, requireMobileParticipant, mobileInvitationsRouter);
  app.use('/cases', authenticate, requireMobileParticipant, mobileCasesRouter);
  app.use('/documents', authenticate, requireMobileParticipant, mobileDocumentsRouter);

  app.use((_request, _response, next) => next(new ApiError(404, 'not_found', 'Ruta no encontrada.')));
  app.use((error, _request, response, _next) => {
    if (error instanceof ApiError) {
      return response.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    if (config.environment !== 'test') console.error('Unhandled mobile API error', error);
    return response.status(500).json({ error: { code: 'internal_error', message: 'Error interno del servidor.' } });
  });
  return app;
}
