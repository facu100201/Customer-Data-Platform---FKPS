import { useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PageTitle, Stat } from '../components/Guard';
import { useApi } from '../hooks/useApi';
import { useStream } from '../hooks/useStream';

type Overview = {
  customers: number;
  events24h: number;
  segments: number;
  terminalsOnline: number;
  pendingMerges: number;
  eventsPerHour: { hour: string; count: number }[];
  eventsPerCategory: { category: string; count: number }[];
  clvDistribution: { bucket: string; count: number }[];
};

type LiveEvent = { customerId: string; name: string; terminalId?: string; at: string };

const CATEGORY_LABEL: Record<string, string> = {
  behavior: 'Comportamiento',
  transaction: 'Transacción',
  profile: 'Perfil',
  operational: 'Operativo',
};

export function Dashboard() {
  const { data, error, reload } = useApi<Overview>('/stats/overview');
  const [live, setLive] = useState<LiveEvent[]>([]);

  useStream({ event: (d) => setLive((prev) => [d as LiveEvent, ...prev].slice(0, 15)) });

  return (
    <>
      <PageTitle title="Dashboard">
        <button className="btn-ghost" onClick={reload}>
          Actualizar
        </button>
      </PageTitle>
      {error && <p className="card mb-4 text-red-600">{error}</p>}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Perfiles unificados" value={data?.customers ?? '–'} />
        <Stat label="Eventos 24 h" value={data?.events24h ?? '–'} />
        <Stat label="Segmentos" value={data?.segments ?? '–'} />
        <Stat label="Terminales en línea" value={data?.terminalsOnline ?? '–'} hint="heartbeat < 60 s" />
        <Stat label="Merges por revisar" value={data?.pendingMerges ?? '–'} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2">
          <h2 className="mb-2 text-sm font-medium">Eventos por hora (24 h)</h2>
          <div className="h-60">
            <ResponsiveContainer>
              <AreaChart
                data={
                  data?.eventsPerHour.map((r) => ({ ...r, label: new Date(r.hour).getHours() + ':00' })) ?? []
                }
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis allowDecimals={false} fontSize={11} width={36} />
                <Tooltip />
                <Area dataKey="count" name="Eventos" stroke="#0d9488" fill="#ccfbf1" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card">
          <h2 className="mb-2 text-sm font-medium">En vivo</h2>
          <ul className="space-y-1 text-xs">
            {live.length === 0 && <li className="text-slate-400">Esperando eventos de las terminales…</li>}
            {live.map((e, i) => (
              <li key={`${e.at}-${i}`} className="flex justify-between gap-2">
                <span className="font-mono">{e.name}</span>
                <span className="text-slate-400">{e.terminalId ?? 'fuente'}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <h2 className="mb-2 text-sm font-medium">Eventos por tipo de dato</h2>
          <div className="h-52">
            <ResponsiveContainer>
              <BarChart
                data={
                  data?.eventsPerCategory.map((r) => ({
                    ...r,
                    label: CATEGORY_LABEL[r.category] ?? r.category,
                  })) ?? []
                }
              >
                <XAxis dataKey="label" fontSize={11} />
                <YAxis allowDecimals={false} fontSize={11} width={36} />
                <Tooltip />
                <Bar dataKey="count" name="Eventos" fill="#14b8a6" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="card lg:col-span-2">
          <h2 className="mb-2 text-sm font-medium">Distribución de CLV (MXN)</h2>
          <div className="h-52">
            <ResponsiveContainer>
              <BarChart data={data?.clvDistribution ?? []}>
                <XAxis dataKey="bucket" fontSize={11} />
                <YAxis allowDecimals={false} fontSize={11} width={36} />
                <Tooltip />
                <Bar dataKey="count" name="Clientes" fill="#0f766e" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </>
  );
}
