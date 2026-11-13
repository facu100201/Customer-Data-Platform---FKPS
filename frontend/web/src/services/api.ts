import type { Role } from '@cdp/shared';

export type User = { id: string; email: string; role: Role };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(`${status} ${code}`);
  }
}

/** La terminal no guarda tokens: la sesión vive en una cookie httpOnly que pone la API. */
export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...rest,
    headers: {
      ...(json !== undefined && { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? res.statusText);
  }
  return (await res.json()) as T;
}

export const ERROR_TEXT: Record<string, string> = {
  credenciales_invalidas: 'Correo o contraseña incorrectos.',
  no_autenticado: 'Tu sesión expiró. Vuelve a entrar.',
  sin_permiso: 'Tu rol no tiene permiso para esta acción.',
  validacion: 'Revisa los datos del formulario.',
};

export const errorText = (err: unknown) =>
  err instanceof ApiError
    ? (ERROR_TEXT[err.code] ?? `Error ${err.status}: ${err.code}`)
    : 'Sin conexión con el servidor.';
