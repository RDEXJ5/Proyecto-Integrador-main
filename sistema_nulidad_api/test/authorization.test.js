import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canAccessOwnParticipantDocumentsOnly,
  canSeeHiddenLegalRecords,
  hasPermission,
  isAllowedChannel,
  isTechnicalOnly
} from '../src/security/authorization.js';

const role = (code, channel) => ({ code, channel });
const user = (roles, permissions = []) => ({ roles, permissions });

test('permissions are read from active grants', () => {
  const judge = user([role('judge', 'web')], ['case.read.assigned', 'document.sign']);
  assert.equal(hasPermission(judge, 'document.sign'), true);
  assert.equal(hasPermission(judge, 'document.certify'), false);
});

test('technical administrator has no implicit legal access', () => {
  const admin = user([role('admin', 'technical')], ['workspace.administration.access']);
  assert.equal(isTechnicalOnly(admin), true);
});

test('auditor and visibility manager can inspect hidden metadata', () => {
  const auditor = user([role('auditor', 'web')], ['case.read.audit']);
  const coordinator = user([role('coordinator', 'web')], ['case.visibility.manage']);
  assert.equal(canSeeHiddenLegalRecords(auditor), true);
  assert.equal(canSeeHiddenLegalRecords(coordinator), true);
});

test('party and witness remain limited to owned documents', () => {
  assert.equal(canAccessOwnParticipantDocumentsOnly(user([role('party', 'mobile')])), true);
  assert.equal(canAccessOwnParticipantDocumentsOnly(user([role('witness', 'mobile')])), true);
  assert.equal(
    canAccessOwnParticipantDocumentsOnly(user([role('party', 'mobile'), role('lawyer', 'web')])),
    false
  );
});

test('a token channel must match a channel assigned by an active role', () => {
  const party = user([role('party', 'mobile')]);
  assert.equal(isAllowedChannel(party, 'mobile'), true);
  assert.equal(isAllowedChannel(party, 'web'), false);
});
