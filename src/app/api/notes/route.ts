/**
 * Notes API routes — the thought inbox (src/core/notes)
 *
 * GET  /api/notes - List notes. Query: status (inbox|filed|archived),
 *                   project_id, limit. Default: inbox + filed, newest first.
 * POST /api/notes - Add a note: { body, project_id?, source? }
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@/core/auth'
import { AppError } from '@/core/errors'
import { createNote, listNotes, type NoteStatus } from '@/core/notes'
import { validateNoteCreate } from '@/core/validation'
import { success, badRequest, handleError, handleZodError, parseRouteId } from '@/lib/api-response'
import { log } from '@/lib/logger'
import { withLogging } from '@/lib/with-logging'
import { ZodError } from 'zod'

const STATUSES: NoteStatus[] = ['inbox', 'filed', 'archived']

export const GET = withLogging(async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request)
    const params = request.nextUrl.searchParams
    const status = params.get('status')
    if (status !== null && !STATUSES.includes(status as NoteStatus)) {
      return badRequest('Invalid status')
    }
    const rawProject = params.get('project_id')
    const projectId = rawProject === null ? undefined : parseRouteId(rawProject)
    if (projectId === null) return badRequest('Invalid project_id')
    const rawLimit = params.get('limit')
    const limit = rawLimit === null ? undefined : parseRouteId(rawLimit)
    if (limit === null) return badRequest('Invalid limit')
    const notes = listNotes(user.id, {
      status: (status as NoteStatus | null) ?? undefined,
      projectId,
      limit,
    })
    return success({ notes, count: notes.length })
  } catch (err) {
    if (!(err instanceof AppError)) log.error('api', 'GET /api/notes error:', err)
    return handleError(err)
  }
})

export const POST = withLogging(async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request)
    const input = validateNoteCreate(await request.json())
    return success(createNote(user.id, input), 201)
  } catch (err) {
    if (err instanceof ZodError) return handleZodError(err)
    if (!(err instanceof AppError)) log.error('api', 'POST /api/notes error:', err)
    return handleError(err)
  }
})
