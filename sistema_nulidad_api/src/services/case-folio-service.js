const legalAreaPrefixes = Object.freeze({
  family: 'FAM',
  criminal: 'PEN',
  civil: 'CIV',
  commercial: 'MER',
  labor: 'LAB',
  administrative: 'ADM',
  constitutional: 'CON',
  other: 'OTR'
});

export function folioPrefixForLegalArea(legalAreaCode) {
  const normalizedCode = String(legalAreaCode ?? '').trim().toLowerCase();
  if (legalAreaPrefixes[normalizedCode]) return legalAreaPrefixes[normalizedCode];

  const compactCode = normalizedCode
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .toUpperCase();
  if (!compactCode) return 'EXP';
  return compactCode.slice(0, 3).padEnd(3, 'X');
}

export function formatCaseFolio(legalAreaCode, year, sequenceValue) {
  const normalizedYear = Number(year);
  const normalizedSequence = Number(sequenceValue);
  if (!Number.isInteger(normalizedYear) || normalizedYear < 2000 || normalizedYear > 9999) {
    throw new TypeError('El año del folio no es válido.');
  }
  if (!Number.isSafeInteger(normalizedSequence) || normalizedSequence < 1) {
    throw new TypeError('La secuencia del folio no es válida.');
  }
  return `${folioPrefixForLegalArea(legalAreaCode)}-${normalizedYear}-${String(normalizedSequence).padStart(6, '0')}`;
}

export async function reserveNextCaseFolio(connection, legalAreaCode, date = new Date()) {
  const year = date.getUTCFullYear();
  await connection.execute(
    `INSERT INTO case_folio_sequences (legal_area_code, folio_year, last_value)
     VALUES (?, ?, LAST_INSERT_ID(1))
     ON DUPLICATE KEY UPDATE last_value = LAST_INSERT_ID(last_value + 1)`,
    [legalAreaCode, year]
  );
  const [rows] = await connection.execute('SELECT LAST_INSERT_ID() AS sequence_value');
  return formatCaseFolio(legalAreaCode, year, rows[0].sequence_value);
}
