export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly httpStatus: number) { super(message); }
}
export function validation(message: string): never { throw new DomainError("VALIDATION", message, 422); }
export function notFound(): never { throw new DomainError("NOT_FOUND", "Not found.", 404); }
