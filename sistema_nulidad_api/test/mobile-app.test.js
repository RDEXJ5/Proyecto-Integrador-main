import test from 'node:test';
import assert from 'node:assert/strict';

const environment = {
  NODE_ENV: 'test',
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_NAME: 'test',
  DB_USER: 'test',
  DB_PASSWORD: '2318',
  JWT_SECRET: 'test_jwt_secret_with_more_than_32_characters',
  API_APPLICATION_KEY: 'test_api_key_with_more_than_32_characters',
  PLATFORM_SIGNATURE_SECRET: 'test_signature_secret_more_than_32_characters',
  MINIO_ENDPOINT: '127.0.0.1',
  MINIO_PORT: '9000',
  MINIO_USE_SSL: 'false',
  MINIO_ACCESS_KEY: 'test-access',
  MINIO_SECRET_KEY: 'test-secret',
  MINIO_BUCKET: 'test-bucket',
  DOCUMENT_ENCRYPTION_KEY: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  MAX_DOCUMENT_BYTES: '26214400',
  CORS_ORIGINS: 'http://127.0.0.1:19006'
};
for (const [name, value] of Object.entries(environment)) process.env[name] ??= value;

async function withMobileServer(work) {
  const { createMobileApp } = await import('../src/mobile-app.js');
  const server = createMobileApp().listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  try {
    const address = server.address();
    await work(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('mobile API publishes only a personal mobile service description', async () => {
  await withMobileServer(async (baseUrl) => {
    const response = await fetch(baseUrl);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.status, 'ok');
    assert.deepEqual(payload.allowedProfiles, ['party', 'witness']);
  });
});

test('mobile case routes require a bearer token', async () => {
  await withMobileServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/cases`);
    const payload = await response.json();
    assert.equal(response.status, 401);
    assert.equal(payload.error.code, 'authentication_required');
  });
});

test('mobile login validates its public request before querying credentials', async () => {
  await withMobileServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'correo-invalido', password: '' })
    });
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.error.code, 'invalid_request');
  });
});

test('mobile registration validates identity and password before writing data', async () => {
  await withMobileServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Usuario de prueba',
        email: 'usuario@example.test',
        password: '23',
        roleCode: 'party'
      })
    });
    const payload = await response.json();
    assert.equal(response.status, 400);
    assert.equal(payload.error.code, 'invalid_password');
  });
});

test('mobile invitations require an authenticated participant', async () => {
  await withMobileServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/invitations`);
    const payload = await response.json();
    assert.equal(response.status, 401);
    assert.equal(payload.error.code, 'authentication_required');
  });
});
