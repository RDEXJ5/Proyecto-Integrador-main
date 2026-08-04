import test from 'node:test';
import assert from 'node:assert/strict';
import {
  folioPrefixForLegalArea,
  formatCaseFolio,
  reserveNextCaseFolio
} from '../src/services/case-folio-service.js';

test('usa prefijos jurídicos comprensibles', () => {
  assert.equal(folioPrefixForLegalArea('family'), 'FAM');
  assert.equal(folioPrefixForLegalArea('criminal'), 'PEN');
  assert.equal(folioPrefixForLegalArea('civil'), 'CIV');
  assert.equal(folioPrefixForLegalArea('new_legal_area'), 'NEW');
  assert.equal(folioPrefixForLegalArea(''), 'EXP');
});

test('formatea una secuencia anual con seis posiciones', () => {
  assert.equal(formatCaseFolio('commercial', 2026, 27), 'MER-2026-000027');
});

test('reserva la siguiente secuencia usando la misma conexión transaccional', async () => {
  const calls = [];
  const connection = {
    async execute(sql, parameters) {
      calls.push({ sql, parameters });
      if (sql.startsWith('SELECT LAST_INSERT_ID')) return [[{ sequence_value: 8 }]];
      return [{ affectedRows: 1 }];
    }
  };

  const folio = await reserveNextCaseFolio(connection, 'constitutional', new Date('2026-08-05T01:00:00Z'));

  assert.equal(folio, 'CON-2026-000008');
  assert.deepEqual(calls[0].parameters, ['constitutional', 2026]);
  assert.match(calls[0].sql, /ON DUPLICATE KEY UPDATE/);
});
