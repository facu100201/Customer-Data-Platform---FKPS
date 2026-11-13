// Terminal ligera del CDP: una ventana que solo carga la app servida por Apache sobre ZeroTier.
// No guarda datos de clientes ni ejecuta lógica del CDP: es la "dumb terminal".
const { app, BrowserWindow, dialog, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = { serverUrl: 'http://10.147.20.5', terminalId: '', kiosk: false };

/** Orden: variables de entorno > terminal.config.json junto al .exe > valores por omisión. */
function loadConfig() {
  const candidates = [
    path.join(path.dirname(app.getPath('exe')), 'terminal.config.json'),
    path.join(app.getPath('userData'), 'terminal.config.json'),
    path.join(__dirname, '..', 'terminal.config.json'),
  ];
  let fileConfig = {};
  for (const file of candidates) {
    if (fs.existsSync(file)) {
      try {
        fileConfig = JSON.parse(fs.readFileSync(file, 'utf8'));
        break;
      } catch (err) {
        dialog.showErrorBox('Configuración inválida', `${file}\n${err.message}`);
      }
    }
  }
  return {
    ...DEFAULTS,
    ...fileConfig,
    ...(process.env.CDP_SERVER_URL && { serverUrl: process.env.CDP_SERVER_URL }),
    ...(process.env.CDP_TERMINAL_ID && { terminalId: process.env.CDP_TERMINAL_ID }),
    ...(process.env.CDP_KIOSK && { kiosk: process.env.CDP_KIOSK === 'true' }),
  };
}

function createWindow() {
  const config = loadConfig();
  const origin = new URL(config.serverUrl).origin;
  const start = new URL('/terminal', origin);
  if (config.terminalId) start.searchParams.set('terminal', config.terminalId);

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    kiosk: config.kiosk,
    autoHideMenuBar: true,
    title: `CDP FKPS · ${config.terminalId || 'terminal'}`,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // La ventana solo navega dentro del servidor del CDP; cualquier otro enlace se abre afuera.
  win.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== origin) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin !== origin) void shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
    // -3 (ERR_ABORTED) ocurre cuando will-navigate cancela una navegación externa: no es falta de red
    if (code === -3 || !isMainFrame) return;
    void win.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(
        `<body style="font-family:sans-serif;padding:2rem"><h2>Sin conexión con el CDP</h2>
         <p>No se pudo abrir ${start.href} (${description}, código ${code}).</p>
         <p>Revisa que ZeroTier esté conectado y autorizado en la red.</p>
         <button onclick="location.href='${start.href}'">Reintentar</button></body>`,
      )}`,
    );
  });

  void win.loadURL(start.href);
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
