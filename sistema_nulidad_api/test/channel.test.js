import test from 'node:test';
import assert from 'node:assert/strict';
import { requireChannel, requireMobileParticipant } from '../src/security/channel.js';

function runMiddleware(middleware, request) {
  return new Promise((resolve) => middleware(request, {}, resolve));
}

test('web routes reject a mobile token', async () => {
  const result = await runMiddleware(requireChannel('web'), {
    auth: { channel: 'mobile', user: { roles: [{ code: 'party' }] } }
  });
  assert.equal(result.code, 'channel_not_allowed');
  assert.equal(result.status, 403);
});

test('administration may explicitly accept the technical channel', async () => {
  const result = await runMiddleware(requireChannel(['web', 'technical']), {
    auth: { channel: 'technical', user: { roles: [{ code: 'admin' }] } }
  });
  assert.equal(result, undefined);
});

test('mobile API accepts party and witness profiles only', async () => {
  const partyResult = await runMiddleware(requireMobileParticipant, {
    auth: { channel: 'mobile', user: { roles: [{ code: 'party' }] } }
  });
  assert.equal(partyResult, undefined);

  const judgeResult = await runMiddleware(requireMobileParticipant, {
    auth: { channel: 'mobile', user: { roles: [{ code: 'judge' }] } }
  });
  assert.equal(judgeResult.code, 'mobile_access_not_allowed');
});

test('mobile API does not trust a mobile role carried by a web token', async () => {
  const result = await runMiddleware(requireMobileParticipant, {
    auth: { channel: 'web', user: { roles: [{ code: 'party' }] } }
  });
  assert.equal(result.code, 'mobile_access_not_allowed');
});
