import type { Permission } from '@cdp/shared';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

/** Protege una ruta: sin sesión manda al login; sin permiso muestra un aviso. */
export function Guard({ perm, children }: { perm?: Permission; children: ReactNode }) {
  const { user, loading, allowed } = useAuth();
  const location = useLocation();
  if (loading) return <p className="p-6 text-slate-500">Cargando…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (perm && !allowed(perm)) {
    return <p className="card text-slate-600">Tu rol no tiene acceso a esta sección.</p>;
  }
  return <>{children}</>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="card">
      <p className="text-xs text-slate-500 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
    </div>
  );
}

export function PageTitle({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-xl font-semibold">{title}</h1>
      <div className="flex gap-2">{children}</div>
    </div>
  );
}
