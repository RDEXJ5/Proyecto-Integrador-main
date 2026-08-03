import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { createHttpMetrics, normalizeMetricRoute } from '../src/observability/metrics.js';

test('normaliza identificadores para impedir etiquetas de alta cardinalidad', () => {
  assert.equal(normalizeMetricRoute('/documents/127/versions/9/content'), '/documents/:id/versions/:id/content');
  assert.equal(
    normalizeMetricRoute('/invitations/123e4567-e89b-12d3-a456-426614174000/accept?secret=value'),
    '/invitations/:id/accept'
  );
});

test('expone métricas HTTP sin registrar la consulta de Prometheus', async (context) => {
  const app = express();
  const metrics = createHttpMetrics('api-prueba');
  app.use(metrics.middleware);
  app.get('/documents/:id', (_request, response) => response.json({ ok: true }));
  app.get('/metrics', metrics.handler);

  const server = app.listen(0, '127.0.0.1');
  context.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();

  await fetch(`http://127.0.0.1:${port}/documents/42`);
  const response = await fetch(`http://127.0.0.1:${port}/metrics`);
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /gdi_http_requests_total/);
  assert.match(body, /route="\/documents\/:id"/);
  assert.doesNotMatch(body, /route="\/metrics"/);
  assert.doesNotMatch(body, /documents\/42/);
});
