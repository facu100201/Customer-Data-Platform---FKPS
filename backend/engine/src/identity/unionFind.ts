export class UnionFind<T> {
  private parent = new Map<T, T>();
  private rank = new Map<T, number>();

  add(x: T): void {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      this.rank.set(x, 0);
    }
  }

  find(x: T): T {
    this.add(x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root) as T;
    // compresión de caminos
    let node = x;
    while (node !== root) {
      const next = this.parent.get(node) as T;
      this.parent.set(node, root);
      node = next;
    }
    return root;
  }

  union(a: T, b: T): T {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return ra;
    const rankA = this.rank.get(ra) ?? 0;
    const rankB = this.rank.get(rb) ?? 0;
    if (rankA < rankB) {
      this.parent.set(ra, rb);
      return rb;
    }
    this.parent.set(rb, ra);
    if (rankA === rankB) this.rank.set(ra, rankA + 1);
    return ra;
  }

  groups(): T[][] {
    const out = new Map<T, T[]>();
    for (const x of this.parent.keys()) {
      const r = this.find(x);
      const group = out.get(r) ?? [];
      group.push(x);
      out.set(r, group);
    }
    return [...out.values()];
  }
}
