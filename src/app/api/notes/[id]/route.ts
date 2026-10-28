/**
 * Single note API routes (src/core/notes)
 *
 * GET    /api/notes/:id - Get a note
 * PATCH  /api/notes/:id - Edit body, file into / out of a project, archive
 * DELETE /api/notes/:id - Soft delete
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@/core/auth'
import { AppError } from '@/core/errors'
import { deleteNote, getNote, updateNote } from '@/core/notes'
import { validateNoteUpdate } from '@/core/validation'
import { success, badRequest, handleError, handleZodError, parseRouteId } from '@/lib/api-response'
import { log } from '@/lib/logger'
import { withLogging } from '@/lib/with-logging'
import { ZodError } from 'zod'
import type { RouteContext } from '@/types/api'

export const GET = withLogging(async function GET(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireAuth(request)
    const noteId = parseRouteId((await context.params).id)
    if (noteId === null) return badRequest('Invalid note ID')
    return success(getNote(user.id, noteId))
  } catch (err) {
    if (!(err instanceof AppError)) log.error('api', 'GET /api/notes/:id error:', err)
    return handleError(err)
  }
})

export const PATCH = withLogging(async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const user = await requireAuth(request)
    const noteId = parseRouteId((await context.params).id)
    if (noteId === null) return badRequest('Invalid note ID')
    const input = validateNoteUpdate(await request.json())
    return success(updateNote(user.id, noteId, input))
  } catch (err) {
    if (err instanceof ZodError) return handleZodError(err)
    if (!(err instanceof AppError)) log.error('api', 'PATCH /api/notes/:id error:', err)
    return handleError(err)
  }
})

export const DELETE = withLogging(async function DELETE(
  request: NextRequest,
  context: RouteContext,
) {
  try {
    const user = await requireAuth(request)
    const noteId = parseRouteId((await context.params).id)
    if (noteId === null) return badRequest('Invalid note ID')
    deleteNote(user.id, noteId)
    return success({ deleted: true })
  } catch (err) {
    if (!(err instanceof AppError)) log.error('api', 'DELETE /api/notes/:id error:', err)
    return handleError(err)
  }
})
