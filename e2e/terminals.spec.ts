import { expect, test } from '@playwright/test';
import { login } from './helpers';

const TERMINALS = 20;

/**
 * 20 navegadores independientes (contextos sin cookies compartidas) abren la pantalla de terminal
 * al mismo tiempo, generan eventos y el admin las ve en línea. Es la prueba de "dumb terminals".
 */
test(`${TERMINALS} terminales concurrentes generan eventos`, async ({ browser }) => {
  test.setTimeout(180_000);

  const contexts = await Promise.all(Array.from({ length: TERMINALS }, () => browser.newContext()));
  await Promise.all(
    contexts.map(async (ctx, i) => {
      const page = await ctx.newPage();
      await login(page, 'usuario');
      await page.goto(`/terminal?terminal=e2e-${String(i + 1).padStart(2, '0')}`);
      await page.getByRole('button', { name: 'Ver tenis' }).click();
      await page.getByPlaceholder('correo del cliente').fill(`cliente${i}@example.com`);
      await page.getByRole('button', { name: 'Identificar' }).click();
      await page.getByRole('button', { name: 'Comprar $1,299' }).click();
      await expect(page.getByText(/purchase → enviado/)).toBeVisible();
    }),
  );

  const admin = await browser.newContext();
  const page = await admin.newPage();
  await login(page, 'admin');
  await page.goto('/terminales');
  await expect(page.getByText(/^e2e-\d{2}$/)).toHaveCount(TERMINALS);

  // Cada terminal identificó a un cliente distinto: 20 perfiles con email
  const res = await page.request.get('/api/customers?pageSize=100');
  const body = (await res.json()) as { items: { identities: { type: string }[] }[] };
  const withEmail = body.items.filter((c) => c.identities.some((i) => i.type === 'email'));
  expect(withEmail.length).toBeGreaterThanOrEqual(TERMINALS);

  await Promise.all([...contexts, admin].map((c) => c.close()));
});
