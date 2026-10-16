import { z } from 'zod';
import { PaginationSchema, type Page } from './core';

export const notificationCategorySchema = z.enum(['system', 'review']);
export type NotificationCategory = z.infer<typeof notificationCategorySchema>;
export const notificationQuerySchema = PaginationSchema.extend({
  category: notificationCategorySchema.optional(),
}).strict();
export type NotificationQuery = z.infer<typeof notificationQuerySchema>;
export type NotificationListQuery = z.input<typeof notificationQuerySchema>;
export const notificationUnreadSchema = z
  .object({
    system: z.number().int().nonnegative(),
    review: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  })
  .strict();
export const notificationDtoSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    message: z.string(),
    category: notificationCategorySchema,
    readAt: z.string().nullable(),
    createdAt: z.string(),
  })
  .strict();
export const notificationPageSchema = z
  .object({
    items: z.array(notificationDtoSchema),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    unread: notificationUnreadSchema,
  })
  .strict();

export interface NotificationDto {
  id: string;
  title: string;
  message: string;
  category: NotificationCategory;
  readAt: string | null;
  createdAt: string;
}
export interface NotificationUnread {
  system: number;
  review: number;
  total: number;
}
export interface NotificationPage extends Page<NotificationDto> {
  unread: NotificationUnread;
}
