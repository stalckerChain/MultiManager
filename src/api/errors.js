class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toJSON() {
    const json = { error: this.message, code: this.code };
    if (this.details) json.details = this.details;
    return json;
  }
}

const badRequest = (message, details) => new ApiError(400, 'BAD_REQUEST', message, details);
const unauthorized = () => new ApiError(401, 'UNAUTHORIZED', 'Не авторизован');
const notFound = (resource) => new ApiError(404, 'NOT_FOUND', `${resource} не найден`);
const conflict = (message) => new ApiError(409, 'CONFLICT', message);
const preconditionFailed = (message) => new ApiError(412, 'PRECONDITION_FAILED', message);
const badGateway = (message, details) => new ApiError(502, 'BAD_GATEWAY', message, details);
const serverError = (message, details) => new ApiError(500, 'INTERNAL_ERROR', message, details);

function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { ApiError, asyncHandler, badRequest, unauthorized, notFound, conflict, preconditionFailed, badGateway, serverError };
