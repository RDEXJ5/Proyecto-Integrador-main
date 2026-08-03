export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export const notFound = () => new ApiError(404, 'not_found', 'Recurso no encontrado.');
