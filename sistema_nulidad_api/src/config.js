import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}.`);
  return value;
}

function secret(name) {
  const value = required(name);
  if (value.startsWith('replace_with_') || value.length < 32) {
    throw new Error(`${name} debe reemplazarse por un secreto aleatorio de al menos 32 caracteres.`);
  }
  return value;
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? fallback, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('El puerto debe ser un entero positivo.');
  return parsed;
}

function booleanValue(value, fallback = false) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === 'true';
}

function encryptionKey(name) {
  const encoded = required(name);
  const decoded = Buffer.from(encoded, 'base64');
  if (decoded.length !== 32 || decoded.toString('base64') !== encoded) {
    throw new Error(`${name} debe ser una clave aleatoria de 32 bytes codificada en Base64.`);
  }
  return decoded;
}

const environment = process.env.NODE_ENV ?? 'development';
const jwtSecret = secret('JWT_SECRET');
const apiKey = secret('API_APPLICATION_KEY');
const platformSignatureSecret = secret('PLATFORM_SIGNATURE_SECRET');

export const config = Object.freeze({
  environment,
  minimumPasswordLength: environment === 'production' ? 12 : 4,
  port: positiveInteger(process.env.PORT, '3000'),
  db: {
    host: required('DB_HOST'),
    port: positiveInteger(process.env.DB_PORT, '3306'),
    database: required('DB_NAME'),
    user: required('DB_USER'),
    password: required('DB_PASSWORD')
  },
  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN ?? '30m',
    issuer: process.env.JWT_ISSUER ?? 'sistema-nulidad-api',
    audience: process.env.JWT_AUDIENCE ?? 'sistema-nulidad-clients'
  },
  apiKey,
  platformSignatureSecret,
  storage: {
    endPoint: required('MINIO_ENDPOINT'),
    port: positiveInteger(process.env.MINIO_PORT, '9000'),
    useSSL: booleanValue(process.env.MINIO_USE_SSL),
    accessKey: required('MINIO_ACCESS_KEY'),
    secretKey: required('MINIO_SECRET_KEY'),
    bucket: required('MINIO_BUCKET'),
    encryptionKey: encryptionKey('DOCUMENT_ENCRYPTION_KEY'),
    maxDocumentBytes: positiveInteger(process.env.MAX_DOCUMENT_BYTES, '26214400')
  },
  corsOrigins: (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
});
