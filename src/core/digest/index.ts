/**
 * Email digests (2026-10-28): settings and the send job.
 *
 * A user opts in by saving an address (`email_digests` row). The job
 * (`runDigests`, every 5 minutes from src/instrumentation.ts) sends each
 * enabled digest once per local day — the daily one at `send_time` or later,
 * the weekly one on Mondays — and stamps the local date only after a
 * successful send, so a mail server that is down is retried on the next run.
 * Demo users never get mail. Content: ./build.ts.
 */

import { DateTime } from 'luxon'
import { getDb } from '@/core/db'
import { isEmailConfigured, sendEmail } from '@/core/email'
import type { DigestSettingsInput } from '@/core/validation'
import { ValidationError } from '@/core/errors'
import { log } from '@/lib/logger'
import { buildDigest, type DigestKind } from './build'

export { buildDigest, type DigestKind } from './build'

export interface DigestSettings {
  email: string
  daily_enabled: boolean
  weekly_enabled: boolean
  send_time: string
}

interface DigestRow {
  user_id: number
  email: string
  daily_enabled: number
  weekly_enabled: number
  send_time: string
  last_daily_date: string | null
  last_weekly_date: string | null
}

function toSettings(row: DigestRow): DigestSettings {
  return {
    email: row.email,
    daily_enabled: row.daily_enabled === 1,
    weekly_enabled: row.weekly_enabled === 1,
    send_time: row.send_time,
  }
}

export function getDigestSettings(userId: number): DigestSettings | null {
  const row = getDb().prepare('SELECT * FROM email_digests WHERE user_id = ?').get(userId) as
    | DigestRow
    | undefined
  return row ? toSettings(row) : null
}

/** Create or change the settings. Creating one needs an address. */
export function saveDigestSettings(userId: number, input: DigestSettingsInput): DigestSettings {
  const current = getDigestSettings(userId)
  const email = input.email ?? current?.email
  if (!email) throw new ValidationError('email is required')
  const next: DigestSettings = {
    email,
    daily_enabled: input.daily_enabled ?? current?.daily_enabled ?? true,
    weekly_enabled: input.weekly_enabled ?? current?.weekly_enabled ?? true,
    send_time: input.send_time ?? current?.send_time ?? '08:00',
  }
  getDb()
    .prepare(
      `INSERT INTO email_digests (user_id, email, daily_enabled, weekly_enabled, send_time)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET email = excluded.email,
         daily_enabled = excluded.daily_enabled, weekly_enabled = excluded.weekly_enabled,
         send_time = excluded.send_time`,
    )
    .run(
      userId,
      next.email,
      next.daily_enabled ? 1 : 0,
      next.weekly_enabled ? 1 : 0,
      next.send_time,
    )
  return next
}

export function deleteDigestSettings(userId: number): void {
  getDb().prepare('DELETE FROM email_digests WHERE user_id = ?').run(userId)
}

/** Build and send one digest now (the "send a test" button; ignores schedule and stamps). */
export async function sendDigestNow(userId: number, kind: DigestKind): Promise<void> {
  const settings = getDigestSettings(userId)
  if (!settings) throw new ValidationError('Set a digest email address first')
  if (!isEmailConfigured()) throw new ValidationError('Email is not configured on this server')
  const { timezone } = getDb().prepare('SELECT timezone FROM users WHERE id = ?').get(userId) as {
    timezone: string
  }
  await sendEmail({ to: settings.email, ...buildDigest(userId, timezone, kind) })
}

/**
 * THE DIGEST'S CLOCK: the CALENDAR date, weekday and HH:mm at `now` in the
 * user's zone — on purpose, not the OpenTask day. A digest is a clock time
 * ("08:00 every day, and Mondays"), like an alarm: it goes out once per
 * calendar day at that time, whatever the user's "Day starts at" says.
 */
export function digestClock(
  timezone: string,
  now: Date,
): { date: string; weekday: number; time: string } {
  const local = DateTime.fromJSDate(now).setZone(timezone)
  return { date: local.toISODate()!, weekday: local.weekday, time: local.toFormat('HH:mm') }
}

/** Which digests are due for this row at `now`. */
export function dueDigests(row: DigestRow, timezone: string, now: Date): DigestKind[] {
  const clock = digestClock(timezone, now)
  if (clock.time < row.send_time) return []
  const due: DigestKind[] = []
  if (row.daily_enabled === 1 && row.last_daily_date !== clock.date) due.push('daily')
  if (row.weekly_enabled === 1 && clock.weekday === 1 && row.last_weekly_date !== clock.date) {
    due.push('weekly')
  }
  return due
}

/** The cron job. Returns how many emails went out. */
export async function runDigests(now: Date = new Date()): Promise<number> {
  if (!isEmailConfigured()) return 0
  const rows = getDb()
    .prepare(
      `SELECT d.*, u.timezone FROM email_digests d JOIN users u ON u.id = d.user_id
       WHERE u.is_demo = 0`,
    )
    .all() as (DigestRow & { timezone: string })[]
  let sent = 0
  for (const row of rows) {
    const { date } = digestClock(row.timezone, now)
    for (const kind of dueDigests(row, row.timezone, now)) {
      try {
        await sendEmail({ to: row.email, ...buildDigest(row.user_id, row.timezone, kind, now) })
        const column = kind === 'daily' ? 'last_daily_date' : 'last_weekly_date'
        getDb()
          .prepare(`UPDATE email_digests SET ${column} = ? WHERE user_id = ?`)
          .run(date, row.user_id)
        sent++
      } catch (err) {
        log.error('digest', `${kind} digest for user ${row.user_id} failed:`, err)
      }
    }
  }
  return sent
}
