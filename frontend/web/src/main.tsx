import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Guard } from './components/Guard';
import { Layout } from './components/Layout';
import { AuthProvider } from './hooks/useAuth';
import { Activations } from './pages/Activations';
import { CustomerProfile, Customers } from './pages/Customers';
import { Dashboard } from './pages/Dashboard';
import { Login } from './pages/Login';
import { Identities, QaAudit, Security, Terminals } from './pages/Operations';
import { Segments } from './pages/Segments';
import { Terminal } from './pages/Terminal';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            element={
              <Guard>
                <Layout />
              </Guard>
            }
          >
            <Route
              index
              element={
                <Guard perm="dashboard:read">
                  <Dashboard />
                </Guard>
              }
            />
            <Route
              path="terminal"
              element={
                <Guard perm="events:write">
                  <Terminal />
                </Guard>
              }
            />
            <Route
              path="clientes"
              element={
                <Guard perm="customers:read">
                  <Customers />
                </Guard>
              }
            />
            <Route
              path="clientes/:id"
              element={
                <Guard perm="customers:read">
                  <CustomerProfile />
                </Guard>
              }
            />
            <Route
              path="identidades"
              element={
                <Guard perm="merges:review">
                  <Identities />
                </Guard>
              }
            />
            <Route
              path="segmentos"
              element={
                <Guard perm="segments:read">
                  <Segments />
                </Guard>
              }
            />
            <Route
              path="activaciones"
              element={
                <Guard perm="segments:read">
                  <Activations />
                </Guard>
              }
            />
            <Route
              path="terminales"
              element={
                <Guard perm="terminals:read">
                  <Terminals />
                </Guard>
              }
            />
            <Route
              path="seguridad"
              element={
                <Guard perm="security:read">
                  <Security />
                </Guard>
              }
            />
            <Route
              path="qa"
              element={
                <Guard perm="audit:read">
                  <QaAudit />
                </Guard>
              }
            />
            <Route path="*" element={<p className="card">Página no encontrada.</p>} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  </StrictMode>,
);
