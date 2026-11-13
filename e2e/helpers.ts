import { expect, type Page } from '@playwright/test';

export const users = {
  usuario: {
    email: process.env.SEED_USUARIO_EMAIL ?? 'usuario@fkps.local',
    password: process.env.SEED_USUARIO_PASSWORD ?? '',
  },
  admin: {
    email: process.env.SEED_ADMIN_EMAIL ?? 'admin@fkps.local',
    password: process.env.SEED_ADMIN_PASSWORD ?? '',
  },
  superusuario: {
    email: process.env.SEED_SUPER_EMAIL ?? 'super@fkps.local',
    password: process.env.SEED_SUPER_PASSWORD ?? '',
  },
  qa: { email: process.env.SEED_QA_EMAIL ?? 'qa@fkps.local', password: process.env.SEED_QA_PASSWORD ?? '' },
};

export type SeedRole = keyof typeof users;

export async function login(page: Page, role: SeedRole) {
  await page.goto('/login');
  await page.getByLabel('Correo').fill(users[role].email);
  await page.getByLabel('Contraseña').fill(users[role].password);
  await page.getByRole('button', { name: 'Entrar' }).click();
  // Argon2 es lento a propósito: con 20 terminales entrando a la vez el login puede pasar de 5 s
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 30_000 });
}
