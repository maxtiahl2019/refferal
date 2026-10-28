/**
 * Notes — the inbox for raw thoughts (2026-10-28)
 *
 * A note is free text the user drops in from anywhere (web, Telegram, email,
 * the API). It lands in the inbox; filing it into a project (by hand, or later
 * by the AI structurer) sets `status = 'filed'`, and unfiling it
 * (`project_id: null`) puts it back in the inbox. Archived notes are kept but
 * leave every list except an explicit `status=archived` read.
 *
 * Notes are not in the undo log (like projects and labels — AGENTS.md
 * § Critical Requirements); deleting one is a soft delete (`deleted_at`).
 */

import { getDb } from '@/core/db'
import { NotFoundError, ValidationError } from '@/core/errors'
import { getProjectById } from '@/core/projects'
import { nowUtc } from '@/core/recurrence'
import type { NoteCreateInput, NoteUpdateInput } from '@/core/validation'
import { emitSyncEvent } from '@/lib/sync-events'

export type NoteStatus = 'inbox' | 'filed' | 'archived'
export type NoteSource = 'web' | 'telegram' | 'email' | 'api'

export interface Note {
  id: number
  user_id: number
  project_id: number | null
  body: string
  source: NoteSource
  status: NoteStatus
  created_at: string
  updated_at: string
}

const NOTE_COLUMNS = 'id, user_id, project_id, body, source, status, created_at, updated_at'

/** Throws unless the user may file into the project (own it, or it is shared). */
function assertProjectVisible(projectId: number, userId: number): void {
  if (!getProjectById(projectId, userId)) {
    throw new ValidationError(`Project ${projectId} not found`)
  }
}

export function getNote(userId: number, noteId: number): Note {
  const note = getDb()
    .prepare(
      `SELECT ${NOTE_COLUMNS} FROM notes WHERE id = ? AND user_id = ? AND deleted_at IS NULL`,
    )
    .get(noteId, userId) as Note | undefined
  if (!note) throw new NotFoundError('Note not found')
  return note
}

export interface ListNotesOptions {
  status?: NoteStatus
  projectId?: number
  /** Only notes created at or after this UTC ISO instant. */
  since?: string
  limit?: number
}

/**
 * The user's notes, newest first. With no status, the inbox and filed notes
 * (archived ones only when asked for by name).
 */
export function listNotes(userId: number, opts: ListNotesOptions = {}): Note[] {
  const where = ['user_id = ?', 'deleted_at IS NULL']
  const params: (string | number)[] = [userId]
  if (opts.status) {
    where.push('status = ?')
    params.push(opts.status)
  } else {
    where.push("status != 'archived'")
  }
  if (opts.projectId !== undefined) {
    where.push('project_id = ?')
    params.push(opts.projectId)
  }
  if (opts.since) {
    where.push('created_at >= ?')
    params.push(opts.since)
  }
  params.push(Math.min(Math.max(opts.limit ?? 200, 1), 1000))
  return getDb()
    .prepare(
      `SELECT ${NOTE_COLUMNS} FROM notes WHERE ${where.join(' AND ')}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    )
    .all(...params) as Note[]
}

export function createNote(userId: number, input: NoteCreateInput): Note {
  const projectId = input.project_id ?? null
  if (projectId !== null) assertProjectVisible(projectId, userId)
  const now = nowUtc()
  const result = getDb()
    .prepare(
      `INSERT INTO notes (user_id, project_id, body, source, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(userId, projectId, input.body, input.source, projectId ? 'filed' : 'inbox', now, now)
  emitSyncEvent(userId, { widgets: false })
  return getNote(userId, Number(result.lastInsertRowid))
}

/**
 * Edit a note. Filing and status follow each other: setting a project files
 * it, clearing the project returns it to the inbox, and an explicit `status`
 * wins (archiving keeps the project). A note can't be 'filed' with no project.
 */
export function updateNote(userId: number, noteId: number, input: NoteUpdateInput): Note {
  const before = getNote(userId, noteId)
  let projectId = before.project_id
  let status = before.status
  if (input.project_id !== undefined) {
    if (input.project_id !== null) assertProjectVisible(input.project_id, userId)
    projectId = input.project_id
    if (status !== 'archived') status = projectId === null ? 'inbox' : 'filed'
  }
  if (input.status !== undefined) status = input.status
  if (status === 'filed' && projectId === null) {
    throw new ValidationError('A filed note needs a project')
  }
  getDb()
    .prepare(
      `UPDATE notes SET body = ?, project_id = ?, status = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    )
    .run(input.body ?? before.body, projectId, status, nowUtc(), noteId, userId)
  emitSyncEvent(userId, { widgets: false })
  return getNote(userId, noteId)
}

/** Soft delete. */
export function deleteNote(userId: number, noteId: number): void {
  getNote(userId, noteId)
  getDb()
    .prepare('UPDATE notes SET deleted_at = ? WHERE id = ? AND user_id = ?')
    .run(nowUtc(), noteId, userId)
  emitSyncEvent(userId, { widgets: false })
}
