import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics
} from 'prom-client';

const IDENTIFIER_SEGMENT = /^(?:\d+|[0-9a-f]{8}-[0-9a-f-]{27,}|[A-Za-z0-9_-]{33,})$/i;

export function normalizeMetricRoute(rawPath) {
  const path = String(rawPath ?? '').split('?', 1)[0] || '/';
  const normalized = path
    .split('/')
    .map((segment) => (IDENTIFIER_SEGMENT.test(segment) ? ':id' : segment))
    .join('/');
  return normalized.length <= 160 ? normalized : '/ruta-larga';
}

export function createHttpMetrics(serviceName) {
  const registry = new Registry();
  registry.setDefaultLabels({ service: serviceName });
  collectDefaultMetrics({
    register: registry,
    prefix: 'gdi_node_'
  });

  const requestCount = new Counter({
    name: 'gdi_http_requests_total',
    help: 'Total de solicitudes HTTP procesadas.',
    labelNames: ['method', 'route', 'status_class'],
    registers: [registry]
  });
  const requestDuration = new Histogram({
    name: 'gdi_http_request_duration_seconds',
    help: 'Duración de las solicitudes HTTP en segundos.',
    labelNames: ['method', 'route', 'status_class'],
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [registry]
  });

  function middleware(request, response, next) {
    if (request.path === '/metrics') return next();
    const started = process.hrtime.bigint();
    response.once('finish', () => {
      const labels = {
        method: request.method,
        route: normalizeMetricRoute(request.path),
        status_class: `${Math.floor(response.statusCode / 100)}xx`
      };
      const elapsedSeconds = Number(process.hrtime.bigint() - started) / 1_000_000_000;
      requestCount.inc(labels);
      requestDuration.observe(labels, elapsedSeconds);
    });
    next();
  }

  async function handler(_request, response, next) {
    try {
      response.set('Content-Type', registry.contentType);
      response.send(await registry.metrics());
    } catch (error) {
      next(error);
    }
  }

  return Object.freeze({ registry, middleware, handler });
}
