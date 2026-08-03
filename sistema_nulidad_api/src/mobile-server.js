import { createMobileApp } from './mobile-app.js';
import { config } from './config.js';
import { pool } from './db.js';

const app = createMobileApp();
const server = app.listen(config.port, () => {
  console.log(`API móvil escuchando en el puerto ${config.port}`);
});

async function shutdown(signal) {
  console.log(`Se recibió ${signal}; cerrando la API móvil.`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
