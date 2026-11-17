import { appendChild, newCondition, updateNode, type Rule } from '@cdp/shared';
import { describe, expect, it } from 'vitest';
import {
  applyBuilderEdit,
  applyJsonEdit,
  deleteConfirmText,
  draftFromSegment,
  formatJson,
  revertJson,
  emptyDraft,
  planPreview,
  planSave,
  previewText,
  type ListedSegment,
  type SavedSegment,
  type SegmentDraft,
} from './segmentForm';

// Guardada en forma no canónica (exists con value: null y condición suelta en la raíz)
const saved: SavedSegment = {
  id: 'seg-1',
  name: 'Sin CLV',
  description: 'Clientes sin CLV calculado',
  definition: { not: { field: 'clv', op: 'exists', value: null } },
};

const open = (s: SavedSegment = saved): SegmentDraft => {
  const r = draftFromSegment(s);
  if (!r.ok) throw new Error('no abrió');
  return r.draft;
};

/** Lo que hace la página en cada edición del constructor. */
const edit = applyBuilderEdit;

describe('crear', () => {
  it('el borrador vacío trae una condición sin valor y no se puede guardar así', () => {
    const plan = planSave({ ...emptyDraft(), name: 'Nuevo' }, null);
    expect(plan).toMatchObject({ kind: 'invalid', issues: [{ code: 'missing_value' }] });
  });

  it('manda nombre, regla y la descripción solo si tiene texto', () => {
    let d: SegmentDraft = { ...emptyDraft(), name: '  Gastadores  ' };
    const condId = d.tree.children[0]!.id;
    d = edit(d, (t) => updateNode(t, condId, (n) => ({ ...n, field: 'spend_30d', value: 100 })));
    expect(planSave(d, null)).toEqual({
      kind: 'create',
      body: { name: 'Gastadores', definition: { all: [{ field: 'spend_30d', op: 'gt', value: 100 }] } },
    });
    expect(planSave({ ...d, description: ' con texto ' }, null)).toMatchObject({
      body: { description: 'con texto' },
    });
  });

  it.each([
    ['ab', 'nombre corto'],
    ['x'.repeat(81), 'nombre largo'],
    ['   ab   ', 'nombre corto tras quitar espacios'],
  ])('rechaza "%s" (%s)', (name) => {
    expect(planSave({ ...emptyDraft(), name }, null)).toMatchObject({ kind: 'invalid', issues: [] });
  });

  it('rechaza descripciones de más de 500 caracteres', () => {
    expect(planSave({ ...emptyDraft(), name: 'Nombre', description: 'x'.repeat(501) }, null)).toMatchObject({
      kind: 'invalid',
    });
  });
});

describe('editar', () => {
  it('abre la regla guardada en el constructor sin marcarla como tocada', () => {
    const d = open();
    expect(d).toMatchObject({
      editingId: 'seg-1',
      name: 'Sin CLV',
      description: 'Clientes sin CLV calculado',
    });
    expect(d.ruleTouched).toBe(false);
    expect(d.tree.children[0]).toMatchObject({
      kind: 'condition',
      field: 'clv',
      op: 'exists',
      negated: true,
    });
  });

  it('no abre una regla guardada inválida', () => {
    expect(draftFromSegment({ ...saved, definition: { all: [] } as unknown as Rule })).toEqual({ ok: false });
  });

  it('sin cambios no manda nada', () => {
    expect(planSave(open(), saved)).toEqual({ kind: 'unchanged' });
  });

  it('cambiar solo el nombre no manda la regla: la guardada no se normaliza', () => {
    expect(planSave({ ...open(), name: 'Sin CLV todavía' }, saved)).toEqual({
      kind: 'update',
      id: 'seg-1',
      body: { name: 'Sin CLV todavía' },
    });
  });

  it('renombrar funciona aunque la regla guardada esté incompleta (comparación sin valor)', () => {
    const broken: SavedSegment = { ...saved, definition: { all: [{ field: 'clv', op: 'gt' }] } };
    expect(planSave({ ...open(broken), name: 'Renombrado' }, broken)).toEqual({
      kind: 'update',
      id: 'seg-1',
      body: { name: 'Renombrado' },
    });
  });

  it('vaciar la descripción la manda como null', () => {
    expect(planSave({ ...open(), description: '   ' }, saved)).toEqual({
      kind: 'update',
      id: 'seg-1',
      body: { description: null },
    });
  });

  it('al tocar la regla se manda completa y en forma canónica', () => {
    const d = open();
    const edited = edit(d, (t) =>
      appendChild(t, t.id, { ...newCondition(), field: 'orders_30d', op: 'eq', value: 0 }),
    );
    expect(planSave(edited, saved)).toEqual({
      kind: 'update',
      id: 'seg-1',
      body: {
        definition: {
          all: [{ not: { field: 'clv', op: 'exists' } }, { field: 'orders_30d', op: 'eq', value: 0 }],
        },
      },
    });
  });

  it('si la regla tocada queda incompleta no se manda nada', () => {
    const edited = edit(open(), (t) => appendChild(t, t.id, newCondition()));
    expect(planSave({ ...edited, name: 'Otro nombre' }, saved)).toMatchObject({
      kind: 'invalid',
      issues: [{ code: 'missing_value' }],
    });
  });
});

describe('vista previa', () => {
  it('manda solo la regla, en la misma forma que se guardaría', () => {
    const d = open();
    expect(planPreview(d)).toEqual({
      kind: 'preview',
      body: { definition: { all: [{ not: { field: 'clv', op: 'exists' } }] } },
    });
    const save = planSave(
      edit(d, (t) => t),
      saved,
    );
    expect(save.kind === 'update' && save.body.definition).toEqual(
      (planPreview(d) as { body: { definition: Rule } }).body.definition,
    );
  });

  it('con la regla incompleta no pide nada y devuelve los problemas', () => {
    expect(planPreview(emptyDraft())).toMatchObject({
      kind: 'invalid',
      issues: [{ code: 'missing_value' }],
    });
  });

  it('no depende del nombre: se puede previsualizar antes de ponerlo', () => {
    const d = edit({ ...emptyDraft(), name: '' }, (t) =>
      updateNode(t, t.children[0]!.id, (n) => ({ ...n, value: 1 })),
    );
    expect(planPreview(d).kind).toBe('preview');
  });

  it.each<[number, number, string]>([
    [12, 340, 'Coinciden 12 de 340 perfiles (3.5 %).'],
    [0, 340, 'Coinciden 0 de 340 perfiles (0 %).'],
    [340, 340, 'Coinciden 340 de 340 perfiles (100 %).'],
    [1, 25000, 'Coinciden 1 de 25,000 perfiles (< 0.1 %).'],
    [0, 0, 'Todavía no hay perfiles para evaluar.'],
  ])('texto para %i de %i', (matches, total, text) => {
    expect(previewText(matches, total)).toBe(text);
  });
});

describe('modo JSON', () => {
  /** Borrador nuevo con una condición completa */
  const valid = () =>
    edit(emptyDraft(), (t) =>
      updateNode(t, t.children[0]!.id, (n) => ({ ...n, field: 'spend_30d', value: 100 })),
    );

  it('el JSON de un segmento abierto es el guardado, tal cual', () => {
    expect(JSON.parse(open().jsonText)).toEqual(saved.definition); // con value: null incluido
    expect(open().jsonError).toBeNull();
  });

  it('el JSON de un borrador nuevo muestra la condición aunque esté incompleta', () => {
    expect(JSON.parse(emptyDraft().jsonText)).toEqual({
      all: [{ field: 'spend_total', op: 'gt', value: null }],
    });
  });

  it('editar el constructor reescribe el JSON', () => {
    expect(JSON.parse(valid().jsonText)).toEqual({ all: [{ field: 'spend_30d', op: 'gt', value: 100 }] });
  });

  it('un JSON válido reemplaza al constructor y marca la regla como tocada', () => {
    const d = applyJsonEdit(
      open(),
      '{"any":[{"field":"clv","op":"gte","value":500},{"field":"orders_30d","op":"eq","value":0}]}',
    );
    expect(d.jsonError).toBeNull();
    expect(d.ruleTouched).toBe(true);
    expect(d.tree).toMatchObject({
      combinator: 'any',
      children: [
        { field: 'clv', op: 'gte', value: 500 },
        { field: 'orders_30d', op: 'eq', value: 0 },
      ],
    });
    expect(planSave(d, saved)).toEqual({
      kind: 'update',
      id: 'seg-1',
      body: {
        definition: {
          any: [
            { field: 'clv', op: 'gte', value: 500 },
            { field: 'orders_30d', op: 'eq', value: 0 },
          ],
        },
      },
    });
  });

  it('un JSON inválido conserva el texto y el constructor, y bloquea guardar y previsualizar', () => {
    const before = valid();
    const d = applyJsonEdit({ ...before, name: 'Nombre válido' }, '{"all": [{"field": "email"');
    expect(d.jsonText).toBe('{"all": [{"field": "email"');
    expect(d.jsonError).toMatch(/mal formado/);
    expect(d.tree).toBe(before.tree);
    expect(planSave(d, null)).toMatchObject({ kind: 'invalid', message: expect.stringMatching(/JSON/) });
    expect(planPreview(d)).toMatchObject({ kind: 'invalid', message: expect.stringMatching(/JSON/) });
  });

  it('un JSON inválido al editar tampoco deja guardar solo el nombre', () => {
    const d = applyJsonEdit({ ...open(), name: 'Otro nombre' }, '{"all": 5}');
    expect(planSave(d, saved)).toMatchObject({ kind: 'invalid' });
  });

  it('una regla incompleta en JSON no es un error de JSON: la marca el constructor', () => {
    const d = applyJsonEdit({ ...emptyDraft(), name: 'Nombre' }, '{"all": [{"field":"clv","op":"gt"}]}');
    expect(d.jsonError).toBeNull();
    expect(planSave(d, null)).toMatchObject({ kind: 'invalid', issues: [{ code: 'missing_value' }] });
  });

  it('corregir el JSON quita el bloqueo', () => {
    let d = applyJsonEdit({ ...emptyDraft(), name: 'Nombre' }, '{"all": [');
    d = applyJsonEdit(d, '{"all": [{"field":"clv","op":"exists"}]}');
    expect(planSave(d, null)).toEqual({
      kind: 'create',
      body: { name: 'Nombre', definition: { all: [{ field: 'clv', op: 'exists' }] } },
    });
  });

  it('un JSON inválido no cuenta como tocar la regla; al volver, la guardada queda intacta', () => {
    const opened = open();
    const bad = applyJsonEdit(opened, '{"all": 5}');
    expect(bad.ruleTouched).toBe(false);
    const back = revertJson(bad);
    expect(back.jsonText).toBe(opened.jsonText); // el JSON guardado tal cual, no reformateado
    expect(planSave(back, saved)).toEqual({ kind: 'unchanged' });
  });

  it('espacios u orden de llaves distinto no cuentan como cambio de regla', () => {
    const opened = open();
    const d = applyJsonEdit(opened, '{ "not": { "value": null, "op": "exists", "field": "clv" } }');
    expect(d.jsonError).toBeNull();
    expect(d.ruleTouched).toBe(false);
    expect(d.tree).toBe(opened.tree);
    expect(planSave(d, saved)).toEqual({ kind: 'unchanged' });
  });

  it('escribir otra regla y luego dejarla como estaba sí cuenta (se tocó)', () => {
    const opened = open();
    const changed = applyJsonEdit(opened, '{"all":[{"field":"clv","op":"exists"}]}');
    expect(changed.ruleTouched).toBe(true);
    expect(applyJsonEdit(changed, opened.jsonText).ruleTouched).toBe(true);
  });

  it('volver a la última regla válida descarta el texto con errores', () => {
    const good = applyJsonEdit(emptyDraft(), '{"any":[{"field":"clv","op":"exists"}]}');
    const bad = applyJsonEdit(good, '{"any":[{"field":"clv"');
    const back = revertJson(bad);
    expect(back.jsonError).toBeNull();
    expect(back.tree).toBe(good.tree);
    expect(JSON.parse(back.jsonText)).toEqual({ any: [{ field: 'clv', op: 'exists' }] });
  });

  it('al salir del JSON se muestra en la forma en que se guardará', () => {
    const typed = applyJsonEdit(emptyDraft(), '{"not":{"not":{"field":"clv","op":"exists","value":3}}}');
    expect(JSON.parse(formatJson(typed).jsonText)).toEqual({ all: [{ field: 'clv', op: 'exists' }] });
    const bad = applyJsonEdit(emptyDraft(), '{');
    expect(formatJson(bad)).toBe(bad); // con errores no se toca lo que la persona escribió
    const same = valid();
    expect(formatJson(same)).toBe(same);
  });

  it('una edición del constructor después del JSON vuelve a mandar el constructor', () => {
    const d = applyJsonEdit(emptyDraft(), '{"any":[{"field":"clv","op":"exists"}]}');
    const e = edit(d, (t) => ({ ...t, combinator: 'all' }));
    expect(JSON.parse(e.jsonText)).toEqual({ all: [{ field: 'clv', op: 'exists' }] });
  });
});

describe('confirmación de borrado', () => {
  const listed = (size: number, activationCount: number): ListedSegment => ({
    ...saved,
    size,
    activationCount,
    refreshedAt: null,
  });

  it.each<[number, number, string]>([
    [0, 0, 'También se borran su membresía (0 perfiles). No se puede deshacer.'],
    [1, 0, 'También se borran su membresía (1 perfil). No se puede deshacer.'],
    [13, 1, 'También se borran su membresía (13 perfiles) y 1 activación. No se puede deshacer.'],
    [2500, 3, 'También se borran su membresía (2,500 perfiles) y 3 activaciones. No se puede deshacer.'],
  ])('%i perfiles y %i activaciones', (size, activations, tail) => {
    expect(deleteConfirmText(listed(size, activations))).toBe(`¿Eliminar el segmento "Sin CLV"?\n\n${tail}`);
  });
});
