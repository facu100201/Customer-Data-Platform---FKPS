import { expect, test } from '@playwright/test';
import { login, type SeedRole } from './helpers';

test('rechaza credenciales incorrectas', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Correo').fill('nadie@fkps.local');
  await page.getByLabel('Contraseña').fill('incorrecta');
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page.getByRole('alert')).toHaveText('Correo o contraseña incorrectos.');
});

// Cada rol ve solo las secciones que su permiso permite
const expectedNav: Record<SeedRole, { visible: string[]; hidden: string[] }> = {
  usuario: { visible: ['Terminal', 'Clientes 360'], hidden: ['Seguridad', 'Identidades', 'QA y auditoría'] },
  qa: { visible: ['Clientes 360', 'QA y auditoría'], hidden: ['Terminal', 'Seguridad', 'Identidades'] },
  admin: { visible: ['Identidades', 'Seguridad', 'QA y auditoría'], hidden: [] },
  superusuario: { visible: ['Terminal', 'Identidades', 'Seguridad', 'QA y auditoría'], hidden: [] },
};

for (const role of Object.keys(expectedNav) as SeedRole[]) {
  test(`navegación del rol ${role}`, async ({ page }) => {
    await login(page, role);
    const nav = page.getByRole('navigation');
    // exact: sin él, "Terminal" también coincide con el enlace "Terminales"
    for (const label of expectedNav[role].visible)
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible();
    for (const label of expectedNav[role].hidden)
      await expect(nav.getByRole('link', { name: label, exact: true })).toHaveCount(0);
  });
}

test('el rol usuario no puede abrir seguridad aunque escriba la URL', async ({ page }) => {
  await login(page, 'usuario');
  await page.goto('/seguridad');
  await expect(page.getByText('Tu rol no tiene acceso a esta sección.')).toBeVisible();
});
