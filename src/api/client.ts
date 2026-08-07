import { config } from '../config.ts';

export class ApiError extends Error {
  readonly status: number;
  readonly method: string;
  readonly path: string;
  readonly body: unknown;

  constructor(status: number, method: string, path: string, body: unknown) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body);
    super(`${method} ${path} -> ${status}: ${detail}`);
    this.name = 'ApiError';
    this.status = status;
    this.method = method;
    this.path = path;
    this.body = body;
  }
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function signIn(email: string, password: string): Promise<string> {
  const path = '/api/v1/auth/sign-in';
  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new ApiError(response.status, 'POST', path, await readBody(response));
  }
  const json = (await response.json()) as { accessToken: string };
  return json.accessToken;
}

export function createClient(token: string) {
  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${config.apiBaseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw new ApiError(response.status, method, path, await readBody(response));
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  return { request };
}
