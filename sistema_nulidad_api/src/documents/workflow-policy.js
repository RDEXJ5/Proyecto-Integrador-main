import { ApiError } from '../errors.js';

export const DOCUMENT_ACTIONS = Object.freeze({
  review: Object.freeze({ permission: 'document.review', auditCode: 'document.review_recorded' }),
  authorize: Object.freeze({ permission: 'document.authorize', auditCode: 'document.authorization_recorded' }),
  certify: Object.freeze({ permission: 'document.certify', auditCode: 'document.certification_recorded' })
});

export const ACTION_OUTCOMES = new Set(['approved', 'rejected', 'returned']);

export function validateDocumentAction({ actionCode, outcome, policy, actorRoles, openObservationCount }) {
  const action = DOCUMENT_ACTIONS[actionCode];
  if (!action) {
    throw new ApiError(400, 'invalid_document_action', 'Seleccione una acción documental válida.');
  }
  if (!ACTION_OUTCOMES.has(outcome)) {
    throw new ApiError(400, 'invalid_action_outcome', 'Seleccione un resultado válido.');
  }
  if (actionCode === 'authorize') {
    if (!policy.requires_authorization) {
      throw new ApiError(409, 'authorization_not_required', 'El tipo documental no requiere autorización.');
    }
    if (!actorRoles.includes(policy.authorization_role_code)) {
      throw new ApiError(403, 'authorization_role_not_allowed', 'El rol activo no puede autorizar esta versión.');
    }
  }
  if (actionCode === 'certify') {
    if (!policy.requires_certification) {
      throw new ApiError(409, 'certification_not_required', 'El tipo documental no requiere certificación.');
    }
    if (!actorRoles.includes(policy.certification_role_code)) {
      throw new ApiError(403, 'certification_role_not_allowed', 'El rol activo no puede certificar esta versión.');
    }
  }
  if (outcome === 'approved' && Number(openObservationCount) > 0) {
    throw new ApiError(
      409,
      'open_observations_pending',
      'Resuelva las observaciones abiertas antes de aprobar la versión.'
    );
  }
}

export function validateApprovalPrerequisites({ actionCode, policy, latestActions, signatureStatus }) {
  if (!['authorize', 'certify'].includes(actionCode)) return;
  if (latestActions.review !== 'approved') {
    throw new ApiError(409, 'review_required', 'La versión debe tener una revisión aprobada antes de continuar.');
  }
  if (actionCode === 'certify') {
    if (policy.requires_authorization && latestActions.authorize !== 'approved') {
      throw new ApiError(409, 'authorization_required', 'La versión debe estar autorizada antes de certificarse.');
    }
    if (policy.platform_signature_policy === 'required' && signatureStatus !== 'signed') {
      throw new ApiError(409, 'signature_required', 'La versión debe completar sus firmas antes de certificarse.');
    }
  }
}

export function validateSignaturePolicy({ policy, actorRoles, latestActions, openObservationCount }) {
  if (policy.platform_signature_policy === 'none') {
    throw new ApiError(409, 'signature_not_required', 'El tipo documental no admite firma de plataforma.');
  }
  if (Number(openObservationCount) > 0) {
    throw new ApiError(409, 'open_observations_pending', 'Resuelva las observaciones abiertas antes de firmar.');
  }
  if (latestActions.review !== 'approved') {
    throw new ApiError(409, 'review_required', 'La versión debe tener una revisión aprobada antes de firmarse.');
  }
  if (policy.requires_authorization && latestActions.authorize !== 'approved') {
    throw new ApiError(409, 'authorization_required', 'La versión debe estar autorizada antes de firmarse.');
  }
  if (policy.allowed_signer_roles.length > 0
      && !policy.allowed_signer_roles.some((role) => actorRoles.includes(role))) {
    throw new ApiError(403, 'signer_role_not_allowed', 'El rol activo no está autorizado para firmar este tipo documental.');
  }
}
