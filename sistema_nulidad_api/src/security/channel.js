import { ApiError } from '../errors.js';
import { hasAnyRole } from './authorization.js';

export function requireChannel(expectedChannel) {
  const allowedChannels = Array.isArray(expectedChannel) ? expectedChannel : [expectedChannel];
  return (request, _response, next) => {
    if (!allowedChannels.includes(request.auth?.channel)) {
      return next(new ApiError(403, 'channel_not_allowed', 'La sesión no pertenece al canal requerido.'));
    }
    return next();
  };
}

export function requireMobileParticipant(request, _response, next) {
  if (
    request.auth?.channel !== 'mobile'
    || !hasAnyRole(request.auth.user, ['party', 'witness'])
  ) {
    return next(new ApiError(
      403,
      'mobile_access_not_allowed',
      'La API móvil está disponible únicamente para partes interesadas y testigos.'
    ));
  }
  return next();
}
