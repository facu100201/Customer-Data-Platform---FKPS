import { expect, test, type Page } from '@playwright/test';
import { login } from './helpers';

const pesos = async (page: Page, testId: string) =>
  Number(((await page.getByTestId(testId).textContent()) ?? '').replace(/[^0-9.]/g, ''));

test('el simulador recalcula con los controles y se puede restablecer', async ({ page }) => {
  await login(page, 'admin');
  // un cliente con compras garantiza CLV > 0 aunque la base esté vacía
  const stamp = Date.now();
  const res = await page.request.post('/api/events', {
    data: {
      events: [
        {
          category: 'profile',
          name: 'identify',
          anonymousId: `e2e-sim-${stamp}`,
          occurredAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
          identifiers: { email: `e2e.sim.${stamp}@example.com` },
        },
        {
          category: 'transaction',
          name: 'purchase',
          anonymousId: `e2e-sim-${stamp}`,
          occurredAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
          properties: { amount: 250 },
        },
      ],
    },
  });
  expect(res.status()).toBe(202);

  await page.getByRole('navigation').getByRole('link', { name: 'Simulador', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Simulador de escenarios' })).toBeVisible();
  await expect(page.getByTestId('sim-data-info')).toHaveText(/^\d+ perfiles/);
  await expect(page.getByRole('button', { name: 'Restablecer valores' })).toBeDisabled();

  const base = await pesos(page, 'sim-total-clv-base');
  expect(base).toBeGreaterThan(0);

  // duplicar el margen (30 % → 60 %) duplica el CLV total
  await page.getByLabel('Margen').fill('0.6');
  await expect(page.getByTestId('sim-total-clv')).not.toContainText('Sin cambio');
  const doubled = await pesos(page, 'sim-total-clv-value');
  expect(Math.abs(doubled - 2 * base)).toBeLessThanOrEqual(2);

  // bajar el umbral al mínimo no puede dejar menos clientes en riesgo
  await page.getByLabel('Umbral de riesgo').fill('0.05');
  const atRisk = (id: string) =>
    page
      .getByTestId(id)
      .textContent()
      .then((t) => Number((t ?? '').split('(')[0]?.trim()));
  expect(await atRisk('sim-at-risk-value')).toBeGreaterThanOrEqual(await atRisk('sim-at-risk-base'));

  await page.getByRole('button', { name: 'Restablecer valores' }).click();
  for (const id of ['sim-at-risk', 'sim-total-clv', 'sim-clv-at-risk'])
    await expect(page.getByTestId(id)).toContainText('Sin cambio');
});

test('QA usa el simulador solo con perfiles sintéticos', async ({ page }) => {
  await login(page, 'qa');
  await page.goto('/simulador');
  await expect(page.getByTestId('sim-data-info')).toContainText('como QA solo ves perfiles sintéticos');
});

test('guarda escenarios en el dispositivo: recargar, cargar, reemplazar y eliminar', async ({ page }) => {
  const name = `E2E retención ${Date.now()}`;
  const item = () => page.getByTestId('saved-scenario').filter({ hasText: name });
  await login(page, 'admin');
  await page.goto('/simulador');
  await expect(page.getByTestId('sim-data-info')).toHaveText(/^\d+ perfiles/);

  await page.getByLabel('Vida del cliente').fill('36');
  await page.getByLabel('Umbral de riesgo').fill('0.5');
  await page.getByLabel('Nombre del escenario').fill(name);
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(`Se guardó «${name}».`);

  // sigue ahí después de recargar (IndexedDB); los controles vuelven a los valores por defecto
  await page.reload();
  await expect(item()).toHaveCount(1);
  await expect(item()).toContainText('Vida del cliente: 36 meses');
  await expect(page.getByLabel('Vida del cliente')).toHaveValue('24');

  await page.getByRole('button', { name: `Cargar ${name}` }).click();
  await expect(page.getByLabel('Vida del cliente')).toHaveValue('36');
  await expect(page.getByLabel('Umbral de riesgo')).toHaveValue('0.5');
  await expect(item()).toContainText('activo');

  await page.getByLabel('Margen').fill('0.5');
  await expect(item()).toContainText('activo · modificado');

  // mismo nombre con otras mayúsculas: reemplaza en vez de duplicar
  await page.getByLabel('Nombre del escenario').fill(name.toUpperCase());
  await page.getByRole('button', { name: 'Reemplazar', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(`Se reemplazó «${name.toUpperCase()}».`);
  await page.reload();
  // hasText con texto no distingue mayúsculas: un solo elemento = no se duplicó
  const replaced = page.getByTestId('saved-scenario').filter({ hasText: name.toUpperCase() });
  await expect(replaced).toHaveCount(1);
  // y su nombre ahora es el nuevo (comparación exacta, sí distingue mayúsculas)
  await expect(replaced.locator('p').first()).toHaveText(name.toUpperCase());
  await page.getByRole('button', { name: `Cargar ${name.toUpperCase()}` }).click();
  await expect(page.getByLabel('Margen')).toHaveValue('0.5');

  await page.getByRole('button', { name: `Eliminar ${name.toUpperCase()}` }).click();
  await page.getByRole('button', { name: `Confirmar eliminar ${name.toUpperCase()}` }).click();
  await expect(replaced).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId('sim-data-info')).toHaveText(/^\d+ perfiles/);
  await expect(replaced).toHaveCount(0);
});

test('en una terminal compartida cada usuario ve solo sus escenarios', async ({ page }) => {
  const stamp = Date.now();
  const save = async (name: string) => {
    await page.goto('/simulador');
    await page.getByLabel('Nombre del escenario').fill(name);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(`Se guardó «${name}».`);
  };
  const names = () => page.getByTestId('saved-scenario').allTextContents();

  await login(page, 'admin');
  await save(`Admin ${stamp}`);
  await page.getByRole('button', { name: 'Salir' }).click();

  await login(page, 'qa');
  await save(`QA ${stamp}`);
  expect((await names()).join('\n')).not.toContain(`Admin ${stamp}`);
  await page.getByRole('button', { name: 'Salir' }).click();

  await login(page, 'admin');
  await page.goto('/simulador');
  await expect(page.getByTestId('saved-scenario').filter({ hasText: `Admin ${stamp}` })).toHaveCount(1);
  expect((await names()).join('\n')).not.toContain(`QA ${stamp}`);
});

test('compara dos escenarios guardados y restablece los valores por defecto', async ({ page }) => {
  const stamp = Date.now();
  const nameA = `A ${stamp}`;
  const nameB = `B ${stamp}`;
  const save = async (name: string) => {
    await page.getByLabel('Nombre del escenario').fill(name);
    await page.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(`Se guardó «${name}».`);
  };
  const cell = (id: string) => page.getByTestId(id);
  const pesosIn = async (id: string) =>
    Number(((await cell(id).textContent()) ?? '').replace(/[^0-9.]/g, ''));

  await login(page, 'admin');
  await page.goto('/simulador');
  await expect(page.getByTestId('sim-data-info')).toHaveText(/^\d+ perfiles/);

  // A: umbral 50 %; B: lo mismo con el doble de margen
  await page.getByLabel('Umbral de riesgo').fill('0.5');
  await save(nameA);
  await page.getByLabel('Margen').fill('0.6');
  await save(nameB);

  const comparison = page.getByRole('region', { name: 'Comparar escenarios' });
  await comparison.getByLabel('Escenario A').selectOption({ label: nameA });
  await comparison.getByLabel('Escenario B').selectOption({ label: nameB });

  // solo cambia el margen: el CLV se duplica y el riesgo es el mismo
  const clvA = await pesosIn('cmp-total-clv-a');
  expect(clvA).toBeGreaterThan(0);
  expect(Math.abs((await pesosIn('cmp-total-clv-b')) - 2 * clvA)).toBeLessThanOrEqual(2);
  await expect(cell('cmp-at-risk-diff')).toHaveText('0');
  await expect(cell('cmp-moves')).toContainText('0 entran · 0 salen');
  await expect(cell('cmp-params').locator('tbody tr')).toHaveCount(1);
  await expect(cell('cmp-params')).toContainText('Margen');
  await expect(cell('cmp-params')).toContainText('30%');
  await expect(cell('cmp-params')).toContainText('60%');

  // contra los valores por defecto aparece también el umbral
  await comparison.getByLabel('Escenario B').selectOption({ label: 'Valores por defecto' });
  await expect(cell('cmp-params')).toContainText('Umbral de riesgo');
  await comparison.getByLabel('Escenario B').selectOption({ label: nameA });
  await expect(cell('cmp-same')).toBeVisible();

  // si se borra un escenario elegido, ese lado pasa a los valores por defecto
  await comparison.getByLabel('Escenario B').selectOption({ label: nameB });
  await page.getByRole('button', { name: `Eliminar ${nameB}` }).click();
  await page.getByRole('button', { name: `Confirmar eliminar ${nameB}` }).click();
  await expect(comparison.getByLabel('Escenario B')).toHaveValue('default');
  await expect(comparison.getByLabel('Escenario A').locator('option:checked')).toHaveText(nameA);

  // restablecer: controles por defecto y ningún escenario marcado como activo
  await page.getByRole('button', { name: `Cargar ${nameA}` }).click();
  await expect(page.getByTestId('saved-scenario').filter({ hasText: nameA })).toContainText('activo');
  await page.getByRole('button', { name: 'Restablecer valores' }).click();
  await expect(page.getByLabel('Umbral de riesgo')).toHaveValue('0.7');
  await expect(page.getByLabel('Margen')).toHaveValue('0.3');
  await expect(page.getByTestId('saved-scenario').filter({ hasText: nameA })).not.toContainText('activo');
  await expect(page.getByRole('button', { name: 'Restablecer valores' })).toBeDisabled();
  for (const id of ['sim-at-risk', 'sim-total-clv', 'sim-clv-at-risk'])
    await expect(page.getByTestId(id)).toContainText('Sin cambio');
});
