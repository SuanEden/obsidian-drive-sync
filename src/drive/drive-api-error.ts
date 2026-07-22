export class DriveApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: string | null,
    readonly retryable: boolean,
    readonly retryAfterMs: number | null,
  ) {
    super(message);
    this.name = 'DriveApiError';
  }
}

export function createDriveApiError(
  status: number,
  body: unknown,
  headers: Readonly<Record<string, string>>,
): DriveApiError {
  const parsed = parseErrorBody(body);
  const retryable =
    status === 429 ||
    [500, 502, 503, 504].includes(status) ||
    (status === 403 &&
      ['rateLimitExceeded', 'userRateLimitExceeded'].includes(parsed.reason ?? ''));

  return new DriveApiError(
    parsed.message ?? `Google Drive respondeu com HTTP ${status}.`,
    status,
    parsed.reason,
    retryable,
    parseRetryAfter(headers),
  );
}

function parseErrorBody(body: unknown): { message: string | null; reason: string | null } {
  if (!isRecord(body) || !isRecord(body.error)) {
    return { message: null, reason: null };
  }

  const message = typeof body.error.message === 'string' ? body.error.message : null;
  const errors = Array.isArray(body.error.errors) ? body.error.errors : [];
  const first = errors.find(isRecord);
  const reason = first !== undefined && typeof first.reason === 'string' ? first.reason : null;
  return { message, reason };
}

function parseRetryAfter(headers: Readonly<Record<string, string>>): number | null {
  const entry = Object.entries(headers).find(
    ([name]) => name.toLocaleLowerCase() === 'retry-after',
  );
  if (entry === undefined) {
    return null;
  }

  const seconds = Number(entry[1]);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const date = Date.parse(entry[1]);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
