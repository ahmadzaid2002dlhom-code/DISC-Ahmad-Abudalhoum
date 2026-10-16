export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function apiJson<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...options, cache: 'no-store' });
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new Error('Unable to read the server response. Please retry.'); }
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
      ? body.error : 'The request failed. Please retry.';
    throw new ApiError(response.status, message);
  }
  return body as T;
}

export const jsonMutation = (method: 'POST' | 'PUT', body: unknown): RequestInit => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
