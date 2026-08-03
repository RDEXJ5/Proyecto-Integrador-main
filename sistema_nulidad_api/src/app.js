import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import { config } from './config.js';
import { pool } from './db.js';
import { ApiError } from './errors.js';
import authRouter from './routes/auth.js';
import casesRouter from './routes/cases.js';
import documentsRouter from './routes/documents.js';
import documentWorkflowRouter from './routes/document-workflow.js';
import processRouter from './routes/process.js';
import auditRouter from './routes/audit.js';
import administrationRouter from './routes/administration.js';
import observationsRouter from './routes/observations.js';
import systemRouter from './routes/system.js';
import { authenticate } from './security/auth.js';
import { requireChannel } from './security/channel.js';
import { openapiDocument } from './openapi.js';
import { assertStorageReady } from './storage/minio.js';
import { createHttpMetrics } from './observability/metrics.js';

export function createApp() {
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
    allowedHeaders: ['Authorization', 'Content-Type', 'X-API-Key']
  }));
  const metrics = createHttpMetrics('api-web');
  app.use(metrics.middleware);
  app.get('/metrics', metrics.handler);
  app.use(express.json({ limit: '1mb', strict: true }));
  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
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

  app.get('/openapi.json', (_request, response) => response.json(openapiDocument));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapiDocument, {
    explorer: true,
    customSiteTitle: 'Documentación · Sistema de Nulidad',
    swaggerOptions: { persistAuthorization: false, validatorUrl: null }
  }));
  app.get('/health', async (_request, response, next) => {
    try {
      await pool.query('SELECT 1');
      await assertStorageReady();
      response.json({ status: 'ok', database: 'reachable', storage: 'reachable' });
    } catch (error) {
      next(error);
    }
  });
  app.use('/auth/login', loginLimiter);
  app.use('/auth', authRouter);
  app.use('/system', systemRouter);
  const requireWebChannel = requireChannel('web');
  app.use('/cases', authenticate, requireWebChannel, casesRouter);
  app.use('/process', authenticate, requireWebChannel, processRouter);
  app.use('/audit', authenticate, requireWebChannel, auditRouter);
  app.use('/administration', authenticate, requireChannel(['web', 'technical']), administrationRouter);
  app.use('/', authenticate, requireWebChannel, observationsRouter);
  app.use('/documents', authenticate, requireWebChannel, documentWorkflowRouter);
  app.use('/documents', authenticate, requireWebChannel, documentsRouter);

  app.use((_request, _response, next) => next(new ApiError(404, 'not_found', 'Ruta no encontrada.')));
  app.use((error, _request, response, _next) => {
    if (error instanceof ApiError) {
      return response.status(error.status).json({ error: { code: error.code, message: error.message } });
    }
    if (config.environment !== 'test') console.error('Unhandled API error', error);
    return response.status(500).json({ error: { code: 'internal_error', message: 'Error interno del servidor.' } });
  });
  return app;
}
