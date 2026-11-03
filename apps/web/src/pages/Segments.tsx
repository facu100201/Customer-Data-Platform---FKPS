import { PROFILE_FIELDS, ruleSchema, type Rule } from '@cdp/shared';
import { useState } from 'react';
import { PageTitle } from '../components/Guard';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { api, errorText } from '../services/api';

type Segment = { id: string; name: string; description: string | null; definition: Rule; size: number; refreshedAt: string | null };

const EXAMPLE = JSON.stringify(
  {
    all: [
      { field: 'spend_30d', op: 'gt', value: 100 },
      { field: 'days_since_app_open', op: 'gte', value: 14 },
    ],
  },
  null,
  2,
);

export function Segments() {
  const { allowed } = useAuth();
  const { data, error, reload } = useApi<Segment[]>('/segments');
  const [name, setName] = useState('');
  const [rule, setRule] = useState(EXAMPLE);
  const [msg, setMsg] = useState<string | null>(null);

  const create = async () => {
    setMsg(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(rule);
    } catch {
      return setMsg('La regla no es JSON válido.');
    }
    const check = ruleSchema.safeParse(parsed);
    if (!check.success) return setMsg(`Regla inválida: ${check.error.issues[0]?.message ?? ''}`);
    try {
      const s = await api<Segment>('/segments', { method: 'POST', json: { name, definition: check.data } });
      setMsg(`Segmento creado con ${s.size} perfiles.`);
      setName('');
      reload();
    } catch (err) {
      setMsg(errorText(err));
    }
  };

  const refresh = async (id: string) => {
    await api(`/segments/${id}/refresh`, { method: 'POST' }).catch((e: unknown) => setMsg(errorText(e)));
    reload();
  };

  return (
    <>
      <PageTitle title="Segmentos" />
      {error && <p className="card text-red-600">{error}</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card overflow-x-auto p-0 lg:col-span-2">
          <table className="table">
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Perfiles</th>
                <th>Actualizado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.map((s) => (
                <tr key={s.id}>
                  <td>
                    <p className="font-medium">{s.name}</p>
                    <p className="text-xs text-slate-500">{s.description}</p>
                  </td>
                  <td className="tabular-nums">{s.size}</td>
                  <td className="text-xs">{s.refreshedAt ? new Date(s.refreshedAt).toLocaleString('es-MX') : 'nunca'}</td>
                  <td>
                    {allowed('segments:write') && (
                      <button className="btn-ghost" onClick={() => void refresh(s.id)}>
                        Recalcular
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {allowed('segments:write') && (
          <section className="card space-y-2">
            <h2 className="text-sm font-medium">Nuevo segmento</h2>
            <input className="input" placeholder="Nombre" value={name} onChange={(e) => setName(e.target.value)} />
            <textarea className="input h-48 font-mono text-xs" value={rule} onChange={(e) => setRule(e.target.value)} aria-label="Regla JSON" />
            <p className="text-xs text-slate-500">
              Campos: {PROFILE_FIELDS.join(', ')}. Operadores: eq, neq, gt, gte, lt, lte, exists. Grupos: all, any, not.
            </p>
            <button className="btn-primary w-full" disabled={name.length < 3} onClick={() => void create()}>
              Crear y calcular
            </button>
            {msg && <p className="text-sm">{msg}</p>}
          </section>
        )}
      </div>
    </>
  );
}
