import { useDeferredValue, useId, useMemo, useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { PageTitle } from '../components/Guard';
import { SavedScenarios } from '../components/SavedScenarios';
import { ScenarioComparison } from '../components/ScenarioComparison';
import { useAuth } from '../hooks/useAuth';
import { useSavedScenarios } from '../hooks/useSavedScenarios';
import { useSimulatorData } from '../hooks/useSimulatorData';
import {
  CHURN_SLIDERS,
  CLV_SLIDERS,
  DEFAULT_SCENARIO,
  RISK_SLIDER,
  clvBuckets,
  compareRisk,
  getParam,
  histogram,
  isDefault,
  scoreCustomers,
  setParam,
  summarize,
  type ScenarioParams,
  type SliderDef,
} from '../services/scenario';

const money = (v: number) =>
  v.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const pct = (part: number, whole: number) => (whole === 0 ? '0%' : `${Math.round((part / whole) * 100)}%`);

const COLOR_DEFAULT = '#94a3b8'; // slate-400
const COLOR_SCENARIO = '#0d9488'; // brand-600

export function Simulator() {
  const { user } = useAuth();
  const data = useSimulatorData();
  const [params, setParams] = useState<ScenarioParams>(DEFAULT_SCENARIO);
  // Los cálculos siguen al valor diferido para que los sliders no se traben con muchos perfiles
  const deferred = useDeferredValue(params);
  const saved = useSavedScenarios(user?.id);
  /** Escenario guardado que está cargado en los controles. */
  const [activeId, setActiveId] = useState<number | null>(null);

  /** Vuelve a los valores por defecto y deja de marcar un escenario guardado como activo. */
  const resetToDefault = () => {
    setParams(DEFAULT_SCENARIO);
    setActiveId(null);
  };

  const { customers } = data;
  const baseline = useMemo(() => scoreCustomers(customers, DEFAULT_SCENARIO), [customers]);
  const scenario = useMemo(
    () => (isDefault(deferred) ? baseline : scoreCustomers(customers, deferred)),
    [customers, deferred, baseline],
  );
  const buckets = useMemo(() => clvBuckets(baseline.clv), [baseline]);

  const baseSummary = summarize(baseline, DEFAULT_SCENARIO.riskThreshold);
  const scenSummary = summarize(scenario, deferred.riskThreshold);
  const risk = compareRisk(baseline, DEFAULT_SCENARIO.riskThreshold, scenario, deferred.riskThreshold);
  const baseHist = histogram(baseline.clv, buckets);
  const scenHist = histogram(scenario.clv, buckets);
  const chartData = buckets.map((b, i) => ({
    label: b.label,
    defecto: baseHist[i] ?? 0,
    escenario: scenHist[i] ?? 0,
  }));

  const change = (key: SliderDef['key'], value: number) => setParams((p) => setParam(p, key, value));

  return (
    <>
      <PageTitle title="Simulador de escenarios">
        <button
          className="btn-ghost"
          onClick={resetToDefault}
          disabled={isDefault(params) && activeId === null}
        >
          Restablecer valores
        </button>
        <button className="btn-ghost" onClick={() => void data.update()} disabled={data.loading}>
          {data.loading ? 'Cargando…' : 'Actualizar datos'}
        </button>
      </PageTitle>

      <p className="mb-4 text-sm text-slate-500" data-testid="sim-data-info">
        {data.snapshot
          ? `${customers.length} perfiles · datos de las ${data.loadedAt?.toLocaleTimeString('es-MX')}`
          : 'Cargando perfiles…'}
        {data.fullReload && ' · se recargaron todos los perfiles'}
        {user?.role === 'qa' && ' · como QA solo ves perfiles sintéticos'}
      </p>
      {data.error && (
        <p className="card mb-4 text-red-600" role="alert">
          {data.error}
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4">
          {user && (
            <SavedScenarios
              items={saved.items}
              invalid={saved.invalid}
              loadError={saved.loadError}
              params={params}
              activeId={activeId}
              onActiveChange={setActiveId}
              onLoad={setParams}
              onSave={saved.save}
              onDelete={saved.remove}
            />
          )}
          <section className="card min-w-0 space-y-5" aria-label="Parámetros del escenario">
            <SliderGroup title="CLV" subtitle="ticket × compras al mes × vida × margen">
              {CLV_SLIDERS.map((s) => (
                <Slider key={s.key} def={s} value={getParam(params, s.key)} onChange={change} />
              ))}
            </SliderGroup>
            <SliderGroup title="Coeficientes de churn" subtitle="modelo logístico, p = 1 / (1 + e^−z)">
              {CHURN_SLIDERS.map((s) => (
                <Slider key={s.key} def={s} value={getParam(params, s.key)} onChange={change} />
              ))}
            </SliderGroup>
            <SliderGroup title="Riesgo">
              <Slider def={RISK_SLIDER} value={params.riskThreshold} onChange={change} />
            </SliderGroup>
          </section>
        </div>

        <div className="min-w-0 space-y-4 lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-3">
            <Compare
              label="Clientes en riesgo"
              testId="sim-at-risk"
              value={scenSummary.atRisk}
              base={baseSummary.atRisk}
              format={(v) => `${v} (${pct(v, scenSummary.customers)})`}
              formatDelta={String}
              higherIsWorse
            >
              <span data-testid="sim-risk-breakdown">
                {risk.remain} siguen · {risk.entering} entran · {risk.leaving} salen
              </span>
            </Compare>
            <Compare
              label="CLV total"
              testId="sim-total-clv"
              value={scenSummary.totalClv}
              base={baseSummary.totalClv}
              format={money}
            />
            <Compare
              label="CLV en riesgo"
              testId="sim-clv-at-risk"
              value={scenSummary.clvAtRisk}
              base={baseSummary.clvAtRisk}
              format={money}
              higherIsWorse
            />
          </div>

          <section className="card min-w-0">
            <h2 className="text-sm font-medium">Distribución de CLV: escenario vs valores por defecto</h2>
            <p className="mb-2 text-xs text-slate-400">
              Rangos fijos calculados con los quintiles del CLV por defecto (MXN).
            </p>
            {customers.length === 0 && !data.loading ? (
              <p className="py-10 text-center text-sm text-slate-500">
                No hay perfiles para simular. Genera datos con el simulador de terminales.
              </p>
            ) : (
              <>
                <div className="h-64">
                  <ResponsiveContainer>
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" fontSize={11} />
                      <YAxis allowDecimals={false} fontSize={11} width={36} />
                      <Tooltip />
                      {/* sin ordenar: misma secuencia que las barras (por defecto, escenario) */}
                      <Legend wrapperStyle={{ fontSize: 12 }} itemSorter={null} />
                      <Bar dataKey="defecto" name="Valores por defecto" fill={COLOR_DEFAULT} />
                      <Bar dataKey="escenario" name="Escenario" fill={COLOR_SCENARIO} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 overflow-x-auto">
                  <table className="table" data-testid="sim-clv-table">
                    <thead>
                      <tr>
                        <th>CLV</th>
                        <th className="text-right">Por defecto</th>
                        <th className="text-right">Escenario</th>
                        <th className="text-right">Diferencia</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chartData.map((r) => (
                        <tr key={r.label}>
                          <td className="whitespace-nowrap">{r.label}</td>
                          <td className="text-right tabular-nums">{r.defecto}</td>
                          <td className="text-right tabular-nums">{r.escenario}</td>
                          <td className="text-right tabular-nums">{signedInt(r.escenario - r.defecto)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          {customers.length > 0 && (
            <ScenarioComparison customers={customers} buckets={buckets} items={saved.items} />
          )}
        </div>
      </div>
    </>
  );
}

const signedInt = (n: number) => (n > 0 ? `+${n}` : n === 0 ? '0' : `${n}`);

function SliderGroup({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    // min-w-0: un fieldset no se encoge por debajo de su contenido y desbordaba en móvil
    <fieldset className="min-w-0 space-y-3">
      <legend className="text-sm font-medium">
        {title}
        {subtitle && <span className="ml-1 text-xs font-normal text-slate-400">{subtitle}</span>}
      </legend>
      {children}
    </fieldset>
  );
}

function Slider({
  def,
  value,
  onChange,
}: {
  def: SliderDef;
  value: number;
  onChange: (key: SliderDef['key'], value: number) => void;
}) {
  const id = useId();
  const fallback = getParam(DEFAULT_SCENARIO, def.key);
  const changed = value !== fallback;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-sm">
        <label htmlFor={id}>{def.label}</label>
        <span className={`tabular-nums ${changed ? 'font-semibold text-brand-700' : 'text-slate-600'}`}>
          {def.format(value)}
        </span>
      </div>
      <input
        id={id}
        type="range"
        className="w-full accent-brand-600"
        min={def.min}
        max={def.max}
        step={def.step}
        value={value}
        onChange={(e) => onChange(def.key, Number(e.target.value))}
        aria-describedby={`${id}-hint`}
      />
      <p id={`${id}-hint`} className="text-xs text-slate-400">
        {def.hint} · por defecto {def.format(fallback)}
      </p>
    </div>
  );
}

function Compare({
  label,
  testId,
  value,
  base,
  format,
  formatDelta = format,
  higherIsWorse = false,
  children,
}: {
  label: string;
  testId: string;
  value: number;
  base: number;
  format: (v: number) => string;
  /** Formato de la diferencia; por omisión el mismo que el valor. */
  formatDelta?: (v: number) => string;
  higherIsWorse?: boolean;
  children?: ReactNode;
}) {
  const diff = Math.round((value - base) * 100) / 100;
  const worse = higherIsWorse ? diff > 0 : diff < 0;
  const color = diff === 0 ? 'text-slate-400' : worse ? 'text-red-600' : 'text-emerald-600';
  const relative = base === 0 ? '' : ` (${diff > 0 ? '+' : ''}${Math.round((diff / base) * 100)}%)`;
  return (
    <div className="card" data-testid={testId}>
      <p className="text-xs text-slate-500 uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums" data-testid={`${testId}-value`}>
        {format(value)}
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Por defecto: <span data-testid={`${testId}-base`}>{format(base)}</span>
      </p>
      <p className={`text-xs font-medium ${color}`}>
        {diff === 0 ? 'Sin cambio' : `${diff > 0 ? '+' : '−'}${formatDelta(Math.abs(diff))}${relative}`}
      </p>
      {children && <p className="mt-1 text-xs text-slate-500">{children}</p>}
    </div>
  );
}
