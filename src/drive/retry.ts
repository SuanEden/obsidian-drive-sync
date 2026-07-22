import { DriveApiError } from './drive-api-error';

export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly sleep: (delayMs: number) => Promise<void>;
  readonly random: () => number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 30_000,
  sleep: (delayMs) => new Promise((resolve) => window.setTimeout(resolve, delayMs)),
  random: Math.random,
};

export async function withDriveRetry<T>(
  operation: () => Promise<T>,
  policy: RetryPolicy = DEFAULT_RETRY_POLICY,
): Promise<T> {
  for (let attempt = 0; attempt < policy.maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      const lastAttempt = attempt === policy.maxAttempts - 1;
      const retryable =
        error instanceof DriveApiError ? error.retryable : isRetryableTransportError(error);
      if (!retryable || lastAttempt) {
        throw error;
      }

      const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** attempt);
      const jittered = Math.round(exponential * (0.5 + policy.random() * 0.5));
      await policy.sleep(
        error instanceof DriveApiError ? (error.retryAfterMs ?? jittered) : jittered,
      );
    }
  }

  throw new Error('Política de tentativas inválida.');
}

export function isRetryableTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /failed to fetch|networkerror|unknownhostexception|unable to resolve host|err_(?:network_changed|internet_disconnected|name_not_resolved|connection_reset|timed_out)|timed? out/iu.test(
    `${error.name}: ${error.message}`,
  );
}
