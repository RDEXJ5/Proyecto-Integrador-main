import crypto from 'node:crypto';
import { config } from '../config.js';
import { ApiError } from '../errors.js';

function matchesApiKey(value) {
  if (typeof value !== 'string') return false;
  const supplied = Buffer.from(value);
  const expected = Buffer.from(config.apiKey);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}

export function requireSystemApiKey(request, _response, next) {
  if (!matchesApiKey(request.get('X-API-Key'))) {
    return next(new ApiError(401, 'invalid_api_key', 'No se autorizó el sistema solicitante.'));
  }
  return next();
}
