/**
 * POST /api/digest/send - Send a digest now: { kind: 'daily' | 'weekly' }
 * (default daily). For trying the settings out; the schedule is untouched.
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@/core/auth'
import { AppError } from '@/core/errors'
import { sendDigestNow } from '@/core/digest'
import { success, badRequest, handleError } from '@/lib/api-response'
import { log } from '@/lib/logger'
import { withLogging } from '@/lib/with-logging'

export const POST = withLogging(async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request)
    const body = (await request.json().catch(() => ({}))) as { kind?: unknown }
    const kind = body.kind ?? 'daily'
    if (kind !== 'daily' && kind !== 'weekly') return badRequest("kind must be 'daily' or 'weekly'")
    await sendDigestNow(user.id, kind)
    return success({ sent: true, kind })
  } catch (err) {
    if (!(err instanceof AppError)) log.error('api', 'POST /api/digest/send error:', err)
    return handleError(err)
  }
})
