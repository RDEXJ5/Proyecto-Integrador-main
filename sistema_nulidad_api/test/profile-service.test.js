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

const { validateOwnProfileUpdate } = await import('../src/services/profile-service.js');

test('profile update normalizes the editable display name', () => {
  assert.deepEqual(
    validateOwnProfileUpdate({ fullName: '  María   del Carmen  ' }),
    { fullName: 'María del Carmen' }
  );
});

test('profile update rejects identity and authorization fields', () => {
  assert.throws(
    () => validateOwnProfileUpdate({ fullName: 'Nombre permitido', email: 'otro@example.test' }),
    (error) => error.code === 'profile_field_not_editable' && error.status === 400
  );
  assert.throws(
    () => validateOwnProfileUpdate({ roles: ['admin'] }),
    (error) => error.code === 'profile_field_not_editable' && error.status === 400
  );
});

test('profile update rejects missing or invalid names', () => {
  assert.throws(
    () => validateOwnProfileUpdate({ fullName: 'A' }),
    (error) => error.code === 'invalid_profile_name' && error.status === 400
  );
  assert.throws(
    () => validateOwnProfileUpdate({}),
    (error) => error.code === 'invalid_profile_name' && error.status === 400
  );
});
