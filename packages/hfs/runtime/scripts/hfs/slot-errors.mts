// slot-errors.mjs - the shared refusal type for HFS manifest and declaration loaders.
export class HfsSlotsError extends Error {
  code: string;
  details: Record<string, unknown>;
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(`${code}: ${message}`);
    this.name = 'HfsSlotsError';
    this.code = code;
    this.details = details;
  }
}

export const fail: (code: string, message: string, details?: Record<string, unknown>) => never = (code, message, details) => { throw new HfsSlotsError(code, message, details); };
