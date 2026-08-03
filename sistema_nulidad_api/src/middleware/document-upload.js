import multer from 'multer';
import { config } from '../config.js';
import { ApiError } from '../errors.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.storage.maxDocumentBytes,
    files: 1,
    fields: 8,
    fieldSize: 16 * 1024
  }
});

export function acceptSingleDocument(request, response, next) {
  upload.single('file')(request, response, (error) => {
    if (!error) return next();
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError(413, 'file_too_large', 'El archivo supera el límite permitido de 25 MB.'));
      }
      return next(new ApiError(400, 'invalid_multipart_request', 'La carga del archivo no tiene un formato válido.'));
    }
    return next(error);
  });
}
