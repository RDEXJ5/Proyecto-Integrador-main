import { Client, LEGAL_HOLD_STATUS } from 'minio';
import { config } from '../config.js';
import { ApiError } from '../errors.js';
import { decryptDocument, encryptDocument } from '../documents/file-security.js';

export const storageClient = new Client({
  endPoint: config.storage.endPoint,
  port: config.storage.port,
  useSSL: config.storage.useSSL,
  accessKey: config.storage.accessKey,
  secretKey: config.storage.secretKey
});

export async function assertStorageReady() {
  const exists = await storageClient.bucketExists(config.storage.bucket);
  if (!exists) throw new Error(`No existe el bucket privado ${config.storage.bucket}.`);
}

export async function storeDocumentObject({ objectKey, file }) {
  const encrypted = encryptDocument(file.buffer, config.storage.encryptionKey);
  const uploaded = await storageClient.putObject(
    config.storage.bucket,
    objectKey,
    encrypted.buffer,
    encrypted.buffer.length,
    {
      'Content-Type': 'application/octet-stream',
      'X-Amz-Meta-Plain-Sha256': file.sha256,
      'X-Amz-Meta-Plain-Content-Type': file.detectedMimeType
    }
  );
  if (!uploaded.versionId) {
    throw new ApiError(503, 'storage_versioning_required', 'MinIO no devolvió un identificador de versión.');
  }
  await storageClient.setObjectLegalHold(config.storage.bucket, objectKey, {
    versionId: uploaded.versionId,
    status: LEGAL_HOLD_STATUS.ENABLED
  });
  return {
    bucketName: config.storage.bucket,
    providerVersionId: uploaded.versionId,
    etag: uploaded.etag,
    storedSizeBytes: encrypted.buffer.length,
    compressionAlgorithm: encrypted.compressionAlgorithm,
    encryptionAlgorithm: encrypted.encryptionAlgorithm
  };
}

export async function readDocumentObject({ bucketName, objectKey, providerVersionId }) {
  const stream = await storageClient.getObject(bucketName, objectKey, { versionId: providerVersionId });
  const chunks = [];
  let total = 0;
  const maximumEnvelopeBytes = config.storage.maxDocumentBytes + 1024;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total > maximumEnvelopeBytes) {
      stream.destroy();
      throw new ApiError(500, 'stored_object_too_large', 'El objeto almacenado supera el límite configurado.');
    }
    chunks.push(chunk);
  }
  return decryptDocument(Buffer.concat(chunks), config.storage.encryptionKey);
}
