import { useId, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import {
  DEFAULT_SCENARIO,
  compareRisk,
  histogram,
  paramDiff,
  scoreCustomers,
  summarize,
  type Bucket,
  type ScenarioParams,
  type SimCustomer,
} from '../services/scenario';
import type { StoredScenario } from '../services/scenarioStore';

const DEFAULT_OPTION = 'default';
const COLOR_A = '#6366f1'; // indigo-500
const COLOR_B = '#0d9488'; // brand-600

type Option = { value: string; name: string; params: ScenarioParams };

const money = (v: number) =>
  v.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const pct = (part: number, whole: number) => (whole === 0 ? '0%' : `${Math.round((part / whole) * 100)}%`);
const short = (name: string) => (name.length > 28 ? `${name.slice(0, 27)}…` : name);

/**
 * Sin elección todavía: la automática. Si lo elegido ya no existe (se borró ese escenario): valores por
 * defecto. options[0] siempre es "Valores por defecto".
 */
function optionFor(options: readonly Option[], picked: string | null, auto: string): Option {
  const wanted = picked ?? auto;
  return options.find((o) => o.value === wanted) ?? options[0]!;
}

/** Por omisión: los dos escenarios más recientes; con uno solo, valores por defecto contra ese. */
function autoPick(items: readonly StoredScenario[]): [string, string] {
  const [newest, previous] = items;
  if (newest && previous) return [String(previous.id), String(newest.id)];
  if (newest) return [DEFAULT_OPTION, String(newest.id)];
  return [DEFAULT_OPTION, DEFAULT_OPTION];
}

/** Compara dos escenarios guardados (o uno contra los valores por defecto) sobre los mismos perfiles. */
export function ScenarioComparison({
  customers,
  buckets,
  items,
}: {
  customers: SimCustomer[];
  buckets: Bucket[];
  items: StoredScenario[];
}) {
  const idA = useId();
  const idB = useId();
  const [picked, setPicked] = useState<[string | null, string | null]>([null, null]);

  const options = useMemo<Option[]>(
    () => [
      { value: DEFAULT_OPTION, name: 'Valores por defecto', params: DEFAULT_SCENARIO },
      ...items.map((s) => ({ value: String(s.id), name: s.name, params: s.params })),
    ],
    [items],
  );
  // Elección y cálculo juntos: solo se recalcula al cambiar los datos, los escenarios o la elección
  const { a, b, scoresA, scoresB } = useMemo(() => {
    const auto = autoPick(items);
    const a = optionFor(options, picked[0], auto[0]);
    const b = optionFor(options, picked[1], auto[1]);
    return {
      a,
      b,
      scoresA: scoreCustomers(customers, a.params),
      scoresB: scoreCustomers(customers, b.params),
    };
  }, [customers, options, items, picked]);
  const sumA = summarize(scoresA, a.params.riskThreshold);
  const sumB = summarize(scoresB, b.params.riskThreshold);
  const moves = compareRisk(scoresA, a.params.riskThreshold, scoresB, b.params.riskThreshold);
  const diff = paramDiff(a.params, b.params);
  const histA = histogram(scoresA.clv, buckets);
  const histB = histogram(scoresB.clv, buckets);
  const chartData = buckets.map((bk, i) => ({ label: bk.label, a: histA[i] ?? 0, b: histB[i] ?? 0 }));

  const rows = [
    {
      id: 'at-risk',
      label: 'Clientes en riesgo',
      a: `${sumA.atRisk} (${pct(sumA.atRisk, sumA.customers)})`,
      b: `${sumB.atRisk} (${pct(sumB.atRisk, sumB.customers)})`,
      delta: sumB.atRisk - sumA.atRisk,
      format: String,
      higherIsWorse: true,
    },
    {
      id: 'total-clv',
      label: 'CLV total',
      a: money(sumA.totalClv),
      b: money(sumB.totalClv),
      delta: sumB.totalClv - sumA.totalClv,
      format: money,
      higherIsWorse: false,
    },
    {
      id: 'clv-at-risk',
      label: 'CLV en riesgo',
      a: money(sumA.clvAtRisk),
      b: money(sumB.clvAtRisk),
      delta: sumB.clvAtRisk - sumA.clvAtRisk,
      format: money,
      higherIsWorse: true,
    },
  ];

  const select = (side: 0 | 1, value: string) =>
    // el otro lado se queda con lo que muestra ahora
    setPicked(side === 0 ? [value, b.value] : [a.value, value]);

  return (
    <section className="card min-w-0 space-y-3" aria-label="Comparar escenarios">
      <div>
        <h2 className="text-sm font-medium">Comparar escenarios</h2>
        <p className="text-xs text-slate-400">
          Dos escenarios guardados (o uno contra los valores por defecto) sobre los mismos perfiles. La
          diferencia es B − A.
        </p>
      </div>

      {items.length === 0 && (
        <p className="text-xs text-slate-500">
          Guarda al menos un escenario para compararlo con los valores por defecto, o dos para compararlos
          entre sí.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { id: idA, label: 'Escenario A', value: a.value, color: COLOR_A, side: 0 as const },
          { id: idB, label: 'Escenario B', value: b.value, color: COLOR_B, side: 1 as const },
        ].map((s) => (
          <div key={s.label} className="min-w-0">
            <label htmlFor={s.id} className="flex items-center gap-2 text-sm">
              <span className="inline-block h-3 w-3 rounded-sm" style={{ background: s.color }} aria-hidden />
              {s.label}
            </label>
            <select
              id={s.id}
              className="input mt-1"
              value={s.value}
              onChange={(e) => select(s.side, e.target.value)}
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {a.value === b.value ? (
        <p className="text-xs text-amber-700" data-testid="cmp-same">
          Elegiste el mismo escenario en A y en B.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="table" data-testid="cmp-table">
              <thead>
                <tr>
                  <th></th>
                  <th className="text-right">A</th>
                  <th className="text-right">B</th>
                  <th className="text-right">Diferencia</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const delta = Math.round(r.delta * 100) / 100;
                  const worse = r.higherIsWorse ? delta > 0 : delta < 0;
                  const color = delta === 0 ? 'text-slate-400' : worse ? 'text-red-600' : 'text-emerald-600';
                  return (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap">{r.label}</td>
                      <td className="text-right tabular-nums" data-testid={`cmp-${r.id}-a`}>
                        {r.a}
                      </td>
                      <td className="text-right tabular-nums" data-testid={`cmp-${r.id}-b`}>
                        {r.b}
                      </td>
                      <td className={`text-right tabular-nums ${color}`} data-testid={`cmp-${r.id}-diff`}>
                        {delta === 0 ? '0' : `${delta > 0 ? '+' : '−'}${r.format(Math.abs(delta))}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-500" data-testid="cmp-moves">
            De A a B: {moves.remain} siguen en riesgo · {moves.entering} entran · {moves.leaving} salen
          </p>

          <div>
            <h3 className="text-xs font-medium text-slate-600 uppercase">Parámetros distintos</h3>
            {diff.length === 0 ? (
              <p className="text-xs text-slate-500">Los dos escenarios tienen los mismos parámetros.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="table" data-testid="cmp-params">
                  <thead>
                    <tr>
                      <th>Parámetro</th>
                      <th className="text-right">A</th>
                      <th className="text-right">B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.map((d) => (
                      <tr key={d.key}>
                        <td>{d.label}</td>
                        <td className="text-right whitespace-nowrap tabular-nums">{d.a}</td>
                        <td className="text-right whitespace-nowrap tabular-nums">{d.b}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="h-56">
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="label" fontSize={11} />
                <YAxis allowDecimals={false} fontSize={11} width={36} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} itemSorter={null} />
                <Bar dataKey="a" name={`A: ${short(a.name)}`} fill={COLOR_A} />
                <Bar dataKey="b" name={`B: ${short(b.name)}`} fill={COLOR_B} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </section>
  );
}
