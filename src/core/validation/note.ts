/**
 * Zod validation schemas for notes (the thought inbox) and the email digest
 * settings. See src/core/notes and src/core/digest.
 */

import { z } from 'zod'

/** A note's text cap: a long voice memo transcript fits, a pasted book doesn't. */
export const NOTE_BODY_MAX = 20_000

const body = z
  .string()
  .trim()
  .min(1, 'Note is empty')
  .max(NOTE_BODY_MAX, `Note must be at most ${NOTE_BODY_MAX} characters`)

export const noteCreateSchema = z.object({
  body,
  project_id: z.number().int().positive().nullable().optional(),
  source: z.enum(['web', 'telegram', 'email', 'api']).default('api'),
})

export const noteUpdateSchema = z
  .object({
    body: body.optional(),
    // null unfiles the note (back to the inbox).
    project_id: z.number().int().positive().nullable().optional(),
    status: z.enum(['inbox', 'filed', 'archived']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to update')

export const digestSettingsSchema = z
  .object({
    email: z.string().trim().email('Invalid email address').max(320),
    daily_enabled: z.boolean(),
    weekly_enabled: z.boolean(),
    send_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:MM'),
  })
  .partial()

export type NoteCreateInput = z.infer<typeof noteCreateSchema>
export type NoteUpdateInput = z.infer<typeof noteUpdateSchema>
export type DigestSettingsInput = z.infer<typeof digestSettingsSchema>

export function validateNoteCreate(input: unknown): NoteCreateInput {
  return noteCreateSchema.parse(input)
}

export function validateNoteUpdate(input: unknown): NoteUpdateInput {
  return noteUpdateSchema.parse(input)
}

export function validateDigestSettings(input: unknown): DigestSettingsInput {
  return digestSettingsSchema.parse(input)
}
