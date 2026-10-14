export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export const notFound = (what) => new ApiError("NOT_FOUND", `Không tìm thấy ${what}`);
