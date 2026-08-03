import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateApprovalPrerequisites,
  validateDocumentAction,
  validateSignaturePolicy
} from '../src/documents/workflow-policy.js';

const basePolicy = Object.freeze({
  requires_authorization: 1,
  authorization_role_code: 'notary',
  requires_certification: 1,
  certification_role_code: 'notary',
  platform_signature_policy: 'required',
  allowed_signer_roles: ['judge']
});

test('rejects authorization when the document type does not require it', () => {
  assert.throws(
    () => validateDocumentAction({
      actionCode: 'authorize',
      outcome: 'approved',
      policy: { ...basePolicy, requires_authorization: 0 },
      actorRoles: ['notary'],
      openObservationCount: 0
    }),
    (error) => error.code === 'authorization_not_required' && error.status === 409
  );
});

test('blocks approval while observations remain open', () => {
  assert.throws(
    () => validateDocumentAction({
      actionCode: 'review',
      outcome: 'approved',
      policy: basePolicy,
      actorRoles: ['judge'],
      openObservationCount: 1
    }),
    (error) => error.code === 'open_observations_pending'
  );
});

test('allows a returned review even when observations remain open', () => {
  assert.doesNotThrow(() => validateDocumentAction({
    actionCode: 'review',
    outcome: 'returned',
    policy: basePolicy,
    actorRoles: ['judge'],
    openObservationCount: 2
  }));
});

test('requires approved review before authorization', () => {
  assert.throws(
    () => validateApprovalPrerequisites({
      actionCode: 'authorize',
      policy: basePolicy,
      latestActions: { review: 'pending', authorize: 'pending' },
      signatureStatus: 'pending'
    }),
    (error) => error.code === 'review_required'
  );
});

test('requires signature and authorization before certification', () => {
  assert.throws(
    () => validateApprovalPrerequisites({
      actionCode: 'certify',
      policy: basePolicy,
      latestActions: { review: 'approved', authorize: 'approved' },
      signatureStatus: 'pending'
    }),
    (error) => error.code === 'signature_required'
  );
});

test('rejects a signer role not allowed by the document rule', () => {
  assert.throws(
    () => validateSignaturePolicy({
      policy: basePolicy,
      actorRoles: ['notary'],
      latestActions: { review: 'approved', authorize: 'approved' },
      openObservationCount: 0
    }),
    (error) => error.code === 'signer_role_not_allowed' && error.status === 403
  );
});

test('accepts signing when review, authorization, policy and role match', () => {
  assert.doesNotThrow(() => validateSignaturePolicy({
    policy: basePolicy,
    actorRoles: ['judge'],
    latestActions: { review: 'approved', authorize: 'approved' },
    openObservationCount: 0
  }));
});
