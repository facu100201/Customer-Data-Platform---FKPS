export const ROLES = ['usuario', 'qa', 'admin', 'superusuario'] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = [
  'dashboard:read',
  'customers:read',
  'customers:read_pii',
  'events:write',
  'segments:read',
  'segments:write',
  'activations:write',
  'merges:review',
  'terminals:read',
  'simulator:run',
  'security:read',
  'security:manage',
  'users:manage',
  'roles:manage',
  'audit:read',
  'data:purge',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const BASE: Permission[] = ['dashboard:read', 'customers:read', 'segments:read', 'terminals:read'];

const ADMIN: Permission[] = [
  ...BASE,
  'events:write',
  'customers:read_pii',
  'segments:write',
  'activations:write',
  'merges:review',
  'simulator:run',
  'security:read',
  'users:manage',
  'audit:read',
];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  usuario: new Set<Permission>([...BASE, 'events:write']),
  qa: new Set<Permission>([...BASE, 'simulator:run', 'audit:read']),
  admin: new Set<Permission>(ADMIN),
  superusuario: new Set<Permission>(PERMISSIONS),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export const ROLE_LABELS: Record<Role, string> = {
  usuario: 'Usuario',
  qa: 'QA',
  admin: 'Administrador',
  superusuario: 'Superusuario',
};
