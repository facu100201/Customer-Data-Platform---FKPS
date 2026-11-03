import type { CdpEventInput, EventCategory } from '@cdp/shared';
import { useCallback, useEffect, useState } from 'react';
import { PageTitle } from '../components/Guard';
import { api, errorText } from '../services/api';
import { flushQueue, pendingCount, sendOrQueue } from '../services/offlineQueue';
import { newVisitor, terminalId, visitorId } from '../services/terminal';

const ACTIONS: { label: string; category: EventCategory; name: string; properties?: CdpEventInput['properties'] }[] = [
  { label: 'Ver página', category: 'behavior', name: 'page_view', properties: { path: '/inicio' } },
  { label: 'Abrir app', category: 'behavior', name: 'app_open' },
  { label: 'Ver tenis', category: 'behavior', name: 'product_view', properties: { sku: 'TEN-001', category: 'tenis' } },
  { label: 'Agregar al carrito', category: 'behavior', name: 'add_to_cart', properties: { sku: 'TEN-001', amount: 1299 } },
  { label: 'Abandonar carrito', category: 'behavior', name: 'cart_abandoned', properties: { amount: 1299 } },
  { label: 'Comprar $1,299', category: 'transaction', name: 'purchase', properties: { amount: 1299, sku: 'TEN-001' } },
  { label: 'Abrir ticket', category: 'operational', name: 'support_ticket', properties: { topic: 'envío' } },
];

/**
 * Pantalla de dumb terminal: no calcula nada, solo genera puntos de contacto del cliente y los manda
 * al servidor. Si no hay red, quedan en IndexedDB hasta que vuelva.
 */
export function Terminal() {
  const tid = terminalId();
  const [visitor, setVisitor] = useState(visitorId);
  const [email, setEmail] = useState('');
  const [log, setLog] = useState<string[]>([]);
  const [pending, setPending] = useState(0);
  const [banner, setBanner] = useState<string | null>(null);

  const note = (msg: string) => setLog((l) => [`${new Date().toLocaleTimeString()} ${msg}`, ...l].slice(0, 20));

  const refreshBanner = useCallback(() => {
    api<{ banner: string }>(`/personalize/${encodeURIComponent(visitor)}`)
      .then((r) => setBanner(r.banner))
      .catch(() => setBanner(null));
  }, [visitor]);

  useEffect(() => {
    const beat = () => api('/terminals/heartbeat', { method: 'POST', json: { terminalId: tid, label: tid } }).catch(() => undefined);
    const sync = () =>
      flushQueue()
        .then((n) => n > 0 && note(`reenviados ${n} eventos de la cola offline`))
        .catch(() => undefined)
        .finally(() => void pendingCount().then(setPending));
    void beat();
    void sync();
    refreshBanner();
    const hb = setInterval(beat, 20_000);
    const fl = setInterval(sync, 30_000);
    window.addEventListener('online', sync);
    return () => {
      clearInterval(hb);
      clearInterval(fl);
      window.removeEventListener('online', sync);
    };
  }, [tid, refreshBanner]);

  const send = async (category: EventCategory, name: string, properties: CdpEventInput['properties'] = {}, identify = false) => {
    const event: CdpEventInput = {
      eventId: crypto.randomUUID(),
      category,
      name,
      anonymousId: visitor,
      terminalId: tid,
      occurredAt: new Date().toISOString(),
      identifiers: identify && email ? { email } : {},
      context: { userAgent: navigator.userAgent },
      properties,
    };
    try {
      const r = await sendOrQueue(event);
      note(`${name} → ${r === 'sent' ? 'enviado' : 'en cola offline'}`);
      setPending(await pendingCount());
      refreshBanner();
    } catch (err) {
      note(`${name} rechazado: ${errorText(err)}`);
    }
  };

  return (
    <>
      <PageTitle title={`Terminal ${tid}`}>
        <button
          className="btn-ghost"
          onClick={() => {
            setVisitor(newVisitor());
            setEmail('');
            note('nuevo visitante anónimo');
          }}
        >
          Nuevo visitante
        </button>
      </PageTitle>
      {banner && <div className="mb-4 rounded-xl bg-brand-600 p-4 text-white">{banner}</div>}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="card space-y-3">
          <p className="text-xs text-slate-500">
            Visitante: <span className="font-mono">{visitor.slice(0, 18)}…</span> · cola offline: {pending}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {ACTIONS.map((a) => (
              <button key={a.name} className="btn-ghost" onClick={() => void send(a.category, a.name, a.properties, true)}>
                {a.label}
              </button>
            ))}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send('profile', 'identify', {}, true);
            }}
          >
            <input className="input" type="email" placeholder="correo del cliente" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn-primary" disabled={!email}>
              Identificar
            </button>
          </form>
        </section>
        <section className="card">
          <h2 className="mb-2 text-sm font-medium">Bitácora de la terminal</h2>
          <ul className="space-y-1 font-mono text-xs">
            {log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}
