import { z } from 'zod';

export const EVENT_CATEGORIES = ['behavior', 'transaction', 'profile', 'operational'] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

/** Nombres de evento conocidos; se aceptan otros mientras respeten el formato snake_case. */
export const KNOWN_EVENTS = {
  behavior: [
    'page_view',
    'product_view',
    'add_to_cart',
    'cart_abandoned',
    'app_open',
    'video_view',
    'download',
  ],
  transaction: ['purchase', 'refund', 'subscription_renewed'],
  profile: ['identify', 'preferences_updated'],
  operational: ['support_ticket', 'chat_started', 'shipment_update'],
} as const satisfies Record<EventCategory, readonly string[]>;

export const identifiersSchema = z
  .object({
    email: z.email().max(254).optional(),
    phone: z
      .string()
      .regex(/^\+?[0-9 ()-]{7,20}$/)
      .optional(),
    crmId: z.string().min(1).max(64).optional(),
    deviceId: z.string().min(1).max(128).optional(),
    cookieId: z.string().min(1).max(128).optional(),
  })
  .strict();
export type Identifiers = z.infer<typeof identifiersSchema>;

export const eventSchema = z
  .object({
    eventId: z.uuid().optional(),
    category: z.enum(EVENT_CATEGORIES),
    name: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/, 'snake_case, 2-64 caracteres'),
    anonymousId: z.string().min(1).max(128),
    terminalId: z.string().max(64).optional(),
    occurredAt: z.iso.datetime({ offset: true }),
    identifiers: identifiersSchema.default({}),
    context: z
      .object({
        ip: z.union([z.ipv4(), z.ipv6()]).optional(),
        userAgent: z.string().max(512).optional(),
      })
      .strict()
      .default({}),
    properties: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  })
  .strict();
export type CdpEvent = z.infer<typeof eventSchema>;
export type CdpEventInput = z.input<typeof eventSchema>;

export const MAX_BATCH = 500;
export const eventBatchSchema = z.object({ events: z.array(eventSchema).min(1).max(MAX_BATCH) });
