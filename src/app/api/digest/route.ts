/**
 * Email digest settings (src/core/digest)
 *
 * GET    /api/digest - { settings | null, email_configured }
 * PATCH  /api/digest - Create or change: { email?, daily_enabled?, weekly_enabled?, send_time? }
 * DELETE /api/digest - Turn digests off (removes the address)
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@/core/auth'
import { AppError } from '@/core/errors'
import { deleteDigestSettings, getDigestSettings, saveDigestSettings } from '@/core/digest'
import { isEmailConfigured } from '@/core/email'
import { validateDigestSettings } from '@/core/validation'
import { success, handleError, handleZodError } from '@/lib/api-response'
import { log } from '@/lib/logger'
import { withLogging } from '@/lib/with-logging'
import { ZodError } from 'zod'

export const GET = withLogging(async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request)
    return success({
      settings: getDigestSettings(user.id),
      email_configured: isEmailConfigured(),
    })
  } catch (err) {
    if (!(err instanceof AppError)) log.error('api', 'GET /api/digest error:', err)
    return handleError(err)
  }
})

export const PATCH = withLogging(async function PATCH(request: NextRequest) {
  try {
    const user = await requireAuth(request)
    const input = validateDigestSettings(await request.json())
    return success({ settings: saveDigestSettings(user.id, input) })
  } catch (err) {
    if (err instanceof ZodError) return handleZodError(err)
    if (!(err instanceof AppError)) log.error('api', 'PATCH /api/digest error:', err)
    return handleError(err)
  }
})

export const DELETE = withLogging(async function DELETE(request: NextRequest) {
  try {
    const user = await requireAuth(request)
    deleteDigestSettings(user.id)
    return success({ deleted: true })
  } catch (err) {
    if (!(err instanceof AppError)) log.error('api', 'DELETE /api/digest error:', err)
    return handleError(err)
  }
})
