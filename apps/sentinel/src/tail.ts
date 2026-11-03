import { open, stat } from 'node:fs/promises';

/** Lee solo lo nuevo de un log en cada llamada. Si Apache rota el archivo (se achica), vuelve al inicio. */
export class FileTail {
  private offset: number | null = null;
  private partial = '';

  constructor(private readonly file: string) {}

  async readNew(): Promise<string[]> {
    let size: number;
    try {
      size = (await stat(this.file)).size;
    } catch {
      return [];
    }
    // primera lectura: se arranca al final para no reprocesar el histórico
    if (this.offset === null || size < this.offset) {
      const first = this.offset === null;
      this.offset = first ? size : 0;
      if (first) return [];
    }
    if (size === this.offset) return [];

    const handle = await open(this.file, 'r');
    try {
      const length = Math.min(size - this.offset, 5 * 1024 * 1024);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, this.offset);
      this.offset += length;
      const text = this.partial + buffer.toString('utf8');
      const lines = text.split(/\r?\n/);
      this.partial = lines.pop() ?? '';
      return lines.filter(Boolean);
    } finally {
      await handle.close();
    }
  }
}
