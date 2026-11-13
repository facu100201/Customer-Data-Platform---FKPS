import { useState } from 'react';
import { PageTitle, Stat } from '../components/Guard';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { useStream } from '../hooks/useStream';
import { api, errorText } from '../services/api';

type TerminalRow = {
  id: string;
  label: string | null;
  ztIp: string | null;
  userAgent: string | null;
  lastHeartbeat: string;
  online: boolean;
};
type Merge = {
  id: string;
  winnerId: string;
  loserId: string;
  score: string;
  reasons: string[];
  createdAt: string;
};
type Alert = {
  id: string;
  severity: string;
  category: string;
  summary: string;
  excerpt: string;
  model: string;
  createdAt: string;
  acknowledgedBy: string | null;
};
type AuditRow = {
  id: string;
  action: string;
  ip: string | null;
  at: string;
  actor: { email: string; role: string } | null;
};

const SEVERITY_STYLE: Record<string, string> = {
  low: 'bg-slate-100 text-slate-700',
  medium: 'bg-amber-100 text-amber-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800',
};

export function Terminals() {
  const { data, reload } = useApi<TerminalRow[]>('/terminals');
  useStream({ terminal: reload });
  const online = data?.filter((t) => t.online).length ?? 0;

  return (
    <>
      <PageTitle title="Terminales (dumb terminals)" />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="En línea" value={online} hint="heartbeat en los últimos 60 s" />
        <Stat label="Registradas" value={data?.length ?? 0} />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {data?.map((t) => (
          <div key={t.id} className={`card p-3 ${t.online ? '' : 'opacity-50'}`}>
            <p className="flex items-center gap-2 font-mono text-sm">
              <span className={`h-2 w-2 rounded-full ${t.online ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              {t.id}
            </p>
            <p className="mt-1 text-xs text-slate-500">{t.ztIp ?? 'sin IP'}</p>
            <p className="text-xs text-slate-400">{new Date(t.lastHeartbeat).toLocaleTimeString('es-MX')}</p>
          </div>
        ))}
      </div>
    </>
  );
}

export function Identities() {
  const { data, error, reload } = useApi<Merge[]>('/merges?status=pending');
  const [msg, setMsg] = useState<string | null>(null);

  const decide = async (id: string, decision: 'approve' | 'reject') => {
    try {
      await api(`/merges/${id}/${decision}`, { method: 'POST' });
      setMsg(decision === 'approve' ? 'Perfiles fusionados.' : 'Fusión rechazada.');
    } catch (err) {
      setMsg(errorText(err));
    }
    reload();
  };

  return (
    <>
      <PageTitle title="Revisión de identidades" />
      <p className="mb-4 text-sm text-slate-600">
        Coincidencias probabilísticas con puntaje entre 0.60 y 0.85. Arriba de 0.85 el CDP fusiona solo; abajo
        de 0.60 las descarta.
      </p>
      {(error ?? msg) && <p className="card mb-3 text-sm">{error ?? msg}</p>}
      {data?.length === 0 && <p className="card text-slate-500">No hay coincidencias pendientes.</p>}
      <div className="space-y-2">
        {data?.map((m) => (
          <div key={m.id} className="card flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <p>
                <span className="font-mono">{m.loserId.slice(0, 8)}</span> →{' '}
                <span className="font-mono">{m.winnerId.slice(0, 8)}</span> · puntaje{' '}
                <b>{Number(m.score).toFixed(2)}</b>
              </p>
              <p className="text-xs text-slate-500">{m.reasons.join(' · ')}</p>
            </div>
            <div className="flex gap-2">
              <button className="btn-primary" onClick={() => void decide(m.id, 'approve')}>
                Fusionar
              </button>
              <button className="btn-ghost" onClick={() => void decide(m.id, 'reject')}>
                Rechazar
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

export function Security() {
  const { allowed } = useAuth();
  const { data, error, reload } = useApi<Alert[]>('/security/alerts');
  useStream({ alert: reload });

  const ack = async (id: string) => {
    await api(`/security/alerts/${id}/ack`, { method: 'POST' }).catch(() => undefined);
    reload();
  };

  return (
    <>
      <PageTitle title="Seguridad (Sentinel + Ollama)" />
      <p className="mb-4 text-sm text-slate-600">
        El Sentinel lee los logs de Apache y los logins fallidos, filtra con reglas y le pide a un modelo
        local de Ollama que clasifique lo sospechoso. Nada sale del servidor.
      </p>
      {error && <p className="card text-red-600">{error}</p>}
      {data?.length === 0 && <p className="card text-slate-500">Sin alertas.</p>}
      <div className="space-y-2">
        {data?.map((a) => (
          <div key={a.id} className={`card ${a.acknowledgedBy ? 'opacity-60' : ''}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-xs font-medium ${SEVERITY_STYLE[a.severity] ?? ''}`}>
                {a.severity}
              </span>
              <span className="text-sm font-medium">{a.category}</span>
              <span className="text-xs text-slate-400">
                {new Date(a.createdAt).toLocaleString('es-MX')} · {a.model}
              </span>
              {allowed('security:manage') && !a.acknowledgedBy && (
                <button className="btn-ghost ml-auto" onClick={() => void ack(a.id)}>
                  Marcar atendida
                </button>
              )}
            </div>
            <p className="mt-2 text-sm">{a.summary}</p>
            <pre className="mt-2 overflow-x-auto rounded bg-slate-50 p-2 text-xs">{a.excerpt}</pre>
          </div>
        ))}
      </div>
    </>
  );
}

export function QaAudit() {
  const { data, error } = useApi<AuditRow[]>('/audit');
  return (
    <>
      <PageTitle title="QA y auditoría" />
      <section className="card mb-4 text-sm">
        <h2 className="mb-2 font-medium">Prueba de carga con terminales simuladas</h2>
        <p className="text-slate-600">Desde cualquier equipo de la red ZeroTier con el repositorio:</p>
        <pre className="mt-2 overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-100">
          npm run sim -- --url http://IP_ZEROTIER --terminals 25 --minutes 5
        </pre>
        <p className="mt-2 text-slate-600">
          Los perfiles que genera quedan marcados como sintéticos. QA solo ve esos perfiles.
        </p>
      </section>
      {error && <p className="card text-red-600">{error}</p>}
      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Acción</th>
              <th>Actor</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {data?.map((r) => (
              <tr key={r.id}>
                <td className="text-xs">{new Date(r.at).toLocaleString('es-MX')}</td>
                <td className="font-mono text-xs">{r.action}</td>
                <td className="text-xs">{r.actor ? `${r.actor.email} (${r.actor.role})` : '–'}</td>
                <td className="text-xs">{r.ip ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
