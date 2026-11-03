export type IdentifierType = 'email' | 'phone' | 'crm_id' | 'device_id' | 'cookie_id' | 'ip';

/** Identificadores que por sí solos prueban que dos fragmentos son la misma persona. */
export const DETERMINISTIC_TYPES: ReadonlySet<IdentifierType> = new Set(['email', 'phone', 'crm_id', 'cookie_id']);

export function normalizeEmail(email: string): string {
  const [local = '', domain = ''] = email.trim().toLowerCase().split('@');
  // Gmail ignora los puntos y todo lo que va después de "+"
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return `${(local.split('+')[0] ?? '').replaceAll('.', '')}@gmail.com`;
  }
  return `${local}@${domain}`;
}

/** Normaliza a E.164. Sin prefijo internacional se asume México (+52). */
export function normalizePhone(phone: string, defaultCountry = '52'): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  return `+${digits}`;
}

export function normalizeIdentifier(type: IdentifierType, value: string): string {
  switch (type) {
    case 'email':
      return normalizeEmail(value);
    case 'phone':
      return normalizePhone(value);
    default:
      return value.trim();
  }
}

/** Versión enmascarada para quien no tiene permiso de PII: an***@dominio.com, +52******1234 */
export function maskIdentifier(type: IdentifierType, value: string): string {
  if (type === 'email') {
    const [local = '', domain = ''] = value.split('@');
    return `${local.slice(0, 2)}***@${domain}`;
  }
  if (type === 'phone') return `${value.slice(0, 3)}******${value.slice(-4)}`;
  if (value.length <= 6) return '***';
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}
