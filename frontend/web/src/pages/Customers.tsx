import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageTitle } from '../components/Guard';
import { useApi } from '../hooks/useApi';

type Identity = { type: string; valueMasked: string; confidence?: string; source?: string };
type CustomerRow = {
  id: string;
  clv: string | null;
  churnScore: string | null;
  lastSeen: string;
  synthetic: boolean;
  identities: Identity[];
};
type CustomerDetail = CustomerRow & {
  traits: Record<string, unknown>;
  aggregates: Record<string, number | null>;
  firstSeen: string;
  events: { id: string; name: string; category: string; occurredAt: string; terminalId: string | null }[];
  memberships: { segment: { id: string; name: string } }[];
};

const money = (v: string | number | null) =>
  v === null ? '–' : Number(v).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });

const churnColor = (v: number) =>
  v >= 0.7 ? 'text-red-600' : v >= 0.4 ? 'text-amber-600' : 'text-emerald-600';

export function Customers() {
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState('lastSeen');
  const { data, error } = useApi<{ total: number; items: CustomerRow[] }>(
    `/customers?page=${page}&sort=${sort}`,
  );

  return (
    <>
      <PageTitle title="Clientes 360">
        <select
          className="input w-auto"
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Ordenar por"
        >
          <option value="lastSeen">Más recientes</option>
          <option value="clv">Mayor CLV</option>
          <option value="churnScore">Mayor riesgo de churn</option>
        </select>
      </PageTitle>
      {error && <p className="card text-red-600">{error}</p>}
      <div className="card overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Perfil</th>
              <th>Identidades</th>
              <th>CLV</th>
              <th>Churn</th>
              <th>Última actividad</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link className="font-mono text-brand-700 hover:underline" to={`/clientes/${c.id}`}>
                    {c.id.slice(0, 8)}
                  </Link>
                  {c.synthetic && (
                    <span className="ml-2 rounded bg-slate-100 px-1 text-xs text-slate-500">sintético</span>
                  )}
                </td>
                <td className="text-xs text-slate-600">
                  {c.identities.map((i) => `${i.type}: ${i.valueMasked}`).join(' · ')}
                </td>
                <td className="tabular-nums">{money(c.clv)}</td>
                <td className={`tabular-nums ${churnColor(Number(c.churnScore ?? 0))}`}>
                  {c.churnScore === null ? '–' : `${Math.round(Number(c.churnScore) * 100)}%`}
                </td>
                <td className="text-xs">{new Date(c.lastSeen).toLocaleString('es-MX')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-2 text-sm">
        <button className="btn-ghost" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
          Anterior
        </button>
        <span>
          Página {page} · {data?.total ?? 0} perfiles
        </span>
        <button
          className="btn-ghost"
          disabled={!data || page * 25 >= data.total}
          onClick={() => setPage((p) => p + 1)}
        >
          Siguiente
        </button>
      </div>
    </>
  );
}

export function CustomerProfile() {
  const { id } = useParams();
  const { data, error } = useApi<CustomerDetail>(id ? `/customers/${id}` : null);
  if (error) return <p className="card text-red-600">{error}</p>;
  if (!data) return <p className="text-slate-500">Cargando…</p>;

  return (
    <>
      <PageTitle title={`Perfil ${data.id.slice(0, 8)}`} />
      <div className="grid gap-4 md:grid-cols-3">
        <section className="card">
          <h2 className="mb-2 text-sm font-medium">Identidades unificadas</h2>
          <ul className="space-y-1 text-sm">
            {data.identities.map((i) => (
              <li key={`${i.type}-${i.valueMasked}`}>
                <span className="text-slate-500">{i.type}</span> {i.valueMasked}
              </li>
            ))}
          </ul>
          <h2 className="mt-4 mb-2 text-sm font-medium">Segmentos</h2>
          <p className="text-sm">{data.memberships.map((m) => m.segment.name).join(', ') || 'Ninguno'}</p>
        </section>
        <section className="card">
          <h2 className="mb-2 text-sm font-medium">Indicadores</h2>
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-slate-500">CLV</dt>
            <dd>{money(data.clv)}</dd>
            <dt className="text-slate-500">Churn</dt>
            <dd>{data.churnScore === null ? '–' : `${Math.round(Number(data.churnScore) * 100)}%`}</dd>
            {Object.entries(data.aggregates)
              .filter(([k]) => k !== 'clv' && k !== 'churn_score')
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="tabular-nums">{v ?? '–'}</dd>
                </div>
              ))}
          </dl>
        </section>
        <section className="card">
          <h2 className="mb-2 text-sm font-medium">Traits</h2>
          <pre className="overflow-x-auto text-xs">{JSON.stringify(data.traits, null, 2)}</pre>
        </section>
      </div>
      <section className="card mt-4 overflow-x-auto p-0">
        <table className="table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Evento</th>
              <th>Tipo</th>
              <th>Terminal</th>
            </tr>
          </thead>
          <tbody>
            {data.events.map((e) => (
              <tr key={e.id}>
                <td className="text-xs">{new Date(e.occurredAt).toLocaleString('es-MX')}</td>
                <td className="font-mono text-xs">{e.name}</td>
                <td className="text-xs">{e.category}</td>
                <td className="text-xs">{e.terminalId ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
