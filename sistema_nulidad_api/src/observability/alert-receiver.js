import http from 'node:http';

const port = Number.parseInt(process.env.PORT ?? '9094', 10);

function respond(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    return respond(response, 200, { status: 'ok', service: 'receptor-alertas' });
  }
  if (request.method !== 'POST' || request.url !== '/alerts') {
    return respond(response, 404, { status: 'not_found' });
  }

  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => {
    body += chunk;
    if (body.length > 1_000_000) request.destroy();
  });
  request.on('end', () => {
    try {
      const notification = JSON.parse(body || '{}');
      const safeAlerts = (notification.alerts ?? []).map((alert) => ({
        status: alert.status,
        alertname: alert.labels?.alertname,
        severity: alert.labels?.severity,
        service: alert.labels?.service ?? alert.labels?.job,
        summary: alert.annotations?.summary
      }));
      console.log(JSON.stringify({
        event: 'monitoring.alert_notification',
        status: notification.status,
        receiver: notification.receiver,
        alerts: safeAlerts
      }));
      return respond(response, 200, { accepted: safeAlerts.length });
    } catch {
      return respond(response, 400, { error: 'invalid_json' });
    }
  });
  return undefined;
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Receptor interno de alertas activo en el puerto ${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
