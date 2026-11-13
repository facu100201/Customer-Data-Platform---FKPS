import { ROLE_LABELS, type Permission } from '@cdp/shared';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const NAV: { to: string; label: string; perm: Permission }[] = [
  { to: '/', label: 'Dashboard', perm: 'dashboard:read' },
  { to: '/terminal', label: 'Terminal', perm: 'events:write' },
  { to: '/clientes', label: 'Clientes 360', perm: 'customers:read' },
  { to: '/identidades', label: 'Identidades', perm: 'merges:review' },
  { to: '/segmentos', label: 'Segmentos', perm: 'segments:read' },
  { to: '/activaciones', label: 'Activaciones', perm: 'segments:read' },
  { to: '/terminales', label: 'Terminales', perm: 'terminals:read' },
  { to: '/seguridad', label: 'Seguridad', perm: 'security:read' },
  { to: '/qa', label: 'QA y auditoría', perm: 'audit:read' },
];

export function Layout() {
  const { user, logout, allowed } = useAuth();
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-b border-slate-200 bg-white md:w-56 md:border-r md:border-b-0">
        <div className="flex items-center gap-2 px-4 py-4">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <span className="font-semibold">CDP FKPS</span>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-col md:overflow-visible">
          {NAV.filter((n) => allowed(n.perm)).map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `rounded-lg px-3 py-2 text-sm whitespace-nowrap ${isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600 hover:bg-slate-100'}`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex-1">
        <header className="flex items-center justify-end gap-3 border-b border-slate-200 bg-white px-4 py-2 text-sm">
          <span className="text-slate-500">{user?.email}</span>
          {user && (
            <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-900">
              {ROLE_LABELS[user.role]}
            </span>
          )}
          <button className="btn-ghost" onClick={() => void logout()}>
            Salir
          </button>
        </header>
        <main className="mx-auto max-w-6xl p-4">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
