import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { fileTypeFromBuffer } from 'file-type';
import { ApiError } from '../errors.js';

const envelopeMagic = Buffer.from('EDOC1');
const allowedTypes = new Map([
  ['application/pdf', 'pdf'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx']
]);

export async function validateDocumentFile(file) {
  if (!file?.buffer?.length) {
    throw new ApiError(400, 'file_required', 'Seleccione un archivo para cargar.');
  }
  const detected = await fileTypeFromBuffer(file.buffer);
  if (!detected || !allowedTypes.has(detected.mime)) {
    throw new ApiError(415, 'unsupported_document_type', 'Sólo se aceptan archivos PDF, JPG, PNG o DOCX válidos.');
  }
  return {
    buffer: file.buffer,
    detectedMimeType: detected.mime,
    extension: allowedTypes.get(detected.mime),
    originalName: safeFilename(file.originalname, allowedTypes.get(detected.mime)),
    sizeBytes: file.buffer.length,
    sha256: createHash('sha256').update(file.buffer).digest('hex')
  };
}

function safeFilename(value, extension) {
  const basename = path.basename(String(value ?? 'documento'))
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 240);
  const stem = (basename ? basename.slice(0, basename.length - path.extname(basename).length) : 'documento')
    .trim()
    .slice(0, 230) || 'documento';
  return `${stem}.${extension}`;
}

export function encryptDocument(plaintext, key) {
  const compressed = gzipSync(plaintext, { level: 9 });
  const useCompression = compressed.length < plaintext.length;
  const payload = useCompression ? compressed : plaintext;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    buffer: Buffer.concat([envelopeMagic, Buffer.from([useCompression ? 1 : 0]), iv, tag, ciphertext]),
    compressionAlgorithm: useCompression ? 'gzip' : 'none',
    encryptionAlgorithm: 'AES-256-GCM'
  };
}

export function decryptDocument(envelope, key) {
  if (envelope.length < 34 || !envelope.subarray(0, 5).equals(envelopeMagic)) {
    throw new ApiError(500, 'invalid_storage_envelope', 'El objeto almacenado no tiene un formato válido.');
  }
  const compressionFlag = envelope[5];
  if (![0, 1].includes(compressionFlag)) {
    throw new ApiError(500, 'invalid_storage_envelope', 'El objeto almacenado usa una compresión desconocida.');
  }
  const iv = envelope.subarray(6, 18);
  const tag = envelope.subarray(18, 34);
  const ciphertext = envelope.subarray(34);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const payload = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return compressionFlag === 1 ? gunzipSync(payload) : payload;
  } catch {
    throw new ApiError(500, 'storage_integrity_failed', 'No fue posible verificar la integridad del archivo almacenado.');
  }
}
