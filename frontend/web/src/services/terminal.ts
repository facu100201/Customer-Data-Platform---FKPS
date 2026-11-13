const KEY_TERMINAL = 'cdp.terminalId';
const KEY_VISITOR = 'cdp.anonymousId';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // modo privado: el id dura lo que dure la pestaña
  }
}

/** Id estable del equipo. Electron lo puede fijar con ?terminal=term-07 en la URL. */
export function terminalId(): string {
  const fromUrl = new URLSearchParams(location.search).get('terminal');
  if (fromUrl) write(KEY_TERMINAL, fromUrl);
  let id = read(KEY_TERMINAL);
  if (!id) {
    id = `term-${crypto.randomUUID().slice(0, 8)}`;
    write(KEY_TERMINAL, id);
  }
  return id;
}

/** Visitante actual de la terminal (equivale a la cookie anónima de un sitio web). */
export function visitorId(): string {
  let id = read(KEY_VISITOR);
  if (!id) id = newVisitor();
  return id;
}

export function newVisitor(): string {
  const id = `anon-${crypto.randomUUID()}`;
  write(KEY_VISITOR, id);
  return id;
}
