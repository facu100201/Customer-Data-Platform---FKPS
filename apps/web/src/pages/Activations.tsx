import { useState } from 'react';
import { PageTitle } from '../components/Guard';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../hooks/useAuth';
import { api, errorText } from '../services/api';

type Activation = {
  id: string;
  destination: string;
  status: string;
  lastRun: string | null;
  lastResult: { audience: number } | null;
  config: Record<string, unknown>;
  segment: { name: string };
};
type Segment = { id: string; name: string };

const DESTINATIONS: Record<string, string> = {
  email_mock: 'Email (simulado tipo HubSpot)',
  ads_mock: 'Ads (simulado tipo Meta/Google)',
  web_personalization: 'Banner en la web/terminal',
  webhook: 'Webhook (simulado)',
};

export function Activations() {
  const { allowed } = useAuth();
  const { data, error, reload } = useApi<Activation[]>('/activations');
  const segments = useApi<Segment[]>('/segments');
  const [segmentId, setSegmentId] = useState('');
  const [destination, setDestination] = useState('web_personalization');
  const [banner, setBanner] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const create = async () => {
    try {
      await api('/activations', {
        method: 'POST',
        json: { segmentId, destination, config: destination === 'web_personalization' ? { banner } : {} },
      });
      setMsg('Activación creada.');
      reload();
    } catch (err) {
      setMsg(errorText(err));
    }
  };

  const run = async (id: string) => {
    await api(`/activations/${id}/run`, { method: 'POST' }).catch((e: unknown) => setMsg(errorText(e)));
    reload();
  };

  return (
    <>
      <PageTitle title="Activaciones" />
      <p className="mb-4 text-sm text-slate-600">
        El CDP decide a quién y qué enviar. Los destinos de este proyecto son simulados: el resultado queda registrado, pero no se
        conecta con servicios externos.
      </p>
      {error && <p className="card text-red-600">{error}</p>}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card overflow-x-auto p-0 lg:col-span-2">
          <table className="table">
            <thead>
              <tr>
                <th>Segmento</th>
                <th>Destino</th>
                <th>Última ejecución</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data?.map((a) => (
                <tr key={a.id}>
                  <td>{a.segment.name}</td>
                  <td className="text-xs">{DESTINATIONS[a.destination] ?? a.destination}</td>
                  <td className="text-xs">
                    {a.lastRun ? `${new Date(a.lastRun).toLocaleString('es-MX')} · ${a.lastResult?.audience ?? 0} perfiles` : 'nunca'}
                  </td>
                  <td>
                    {allowed('activations:write') && (
                      <button className="btn-ghost" onClick={() => void run(a.id)}>
                        Ejecutar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {allowed('activations:write') && (
          <section className="card space-y-2">
            <h2 className="text-sm font-medium">Nueva activación</h2>
            <select className="input" value={segmentId} onChange={(e) => setSegmentId(e.target.value)} aria-label="Segmento">
              <option value="">Elige un segmento</option>
              {segments.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select className="input" value={destination} onChange={(e) => setDestination(e.target.value)} aria-label="Destino">
              {Object.entries(DESTINATIONS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            {destination === 'web_personalization' && (
              <input className="input" placeholder="Texto del banner" value={banner} onChange={(e) => setBanner(e.target.value)} />
            )}
            <button className="btn-primary w-full" disabled={!segmentId} onClick={() => void create()}>
              Crear
            </button>
            {msg && <p className="text-sm">{msg}</p>}
          </section>
        )}
      </div>
    </>
  );
}
