import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  decryptDocument,
  encryptDocument,
  validateDocumentFile
} from '../src/documents/file-security.js';

test('AES-256-GCM envelope preserves and verifies document content', () => {
  const key = randomBytes(32);
  const original = Buffer.from('contenido jurídico repetible '.repeat(300));
  const encrypted = encryptDocument(original, key);
  assert.equal(encrypted.encryptionAlgorithm, 'AES-256-GCM');
  assert.equal(encrypted.compressionAlgorithm, 'gzip');
  assert.deepEqual(decryptDocument(encrypted.buffer, key), original);
});

test('tampering with an encrypted object is rejected', () => {
  const key = randomBytes(32);
  const encrypted = encryptDocument(Buffer.from('expediente reservado'), key);
  encrypted.buffer[encrypted.buffer.length - 1] ^= 1;
  assert.throws(
    () => decryptDocument(encrypted.buffer, key),
    (error) => error.code === 'storage_integrity_failed'
  );
});

test('file type is detected from bytes instead of the supplied extension', async () => {
  const file = await validateDocumentFile({
    originalname: '../resolución.exe',
    buffer: Buffer.from('%PDF-1.7\n1 0 obj\n<<>>\nendobj\n%%EOF')
  });
  assert.equal(file.detectedMimeType, 'application/pdf');
  assert.equal(file.originalName, 'resolución.pdf');
  assert.equal(file.sha256.length, 64);
});
