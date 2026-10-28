/**
 * Digest content (2026-10-28): what the daily digest and the weekly review
 * say. Pure reads — nothing here writes. The text is Russian (the owner's
 * language); the HTML is a light rendering of the same lines.
 *
 * Daily: what is overdue now, deadlines in the next 7 days, the note inbox,
 *        and each project's open count.
 * Weekly: per project — done in the last 7 days, notes added, open tasks;
 *        projects gone quiet (open work, nothing done and no note for 14
 *        days); deadlines in the next 14 days; the inbox.
 *
 * Reminders and quotas are left out throughout: they are routines, not
 * project work (`OPEN_WORK_SQL`).
 */

import { DateTime } from 'luxon'
import { getDb } from '@/core/db'
import { getCurrentlyDueTaskIds } from '@/core/tasks/currently-due'

export type DigestKind = 'daily' | 'weekly'

export interface DigestContent {
  subject: string
  text: string
  html: string
}

interface TaskLine {
  id: number
  title: string
  priority: number
  project: string
  deadline_at: string | null
}

interface Section {
  title: string
  lines: string[]
}

/** An open task that is project work: not done, deleted, archived, a reminder or a quota. */
const OPEN_WORK_SQL = `t.done = 0 AND t.deleted_at IS NULL AND t.archived_at IS NULL
  AND t.is_reminder = 0 AND t.is_tracked = 0 AND t.progress_target <= 1`

const MAX_LINES = 15

function priorityMark(priority: number): string {
  if (priority >= 4) return '‼️ '
  if (priority >= 3) return '❗ '
  return ''
}

function fmtDate(iso: string, timezone: string): string {
  return DateTime.fromISO(iso, { zone: 'utc' })
    .setZone(timezone)
    .setLocale('ru')
    .toFormat('d MMM, HH:mm')
}

function capped(lines: string[]): string[] {
  if (lines.length <= MAX_LINES) return lines
  return [...lines.slice(0, MAX_LINES), `…и ещё ${lines.length - MAX_LINES}`]
}

function overdueTasks(userId: number, now: Date): TaskLine[] {
  const ids = getCurrentlyDueTaskIds(userId, now)
  if (ids.length === 0) return []
  return getDb()
    .prepare(
      `SELECT t.id, t.title, t.priority, p.name AS project, t.deadline_at
       FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.id IN (${ids.map(() => '?').join(', ')})
       ORDER BY t.priority DESC, t.due_at ASC`,
    )
    .all(...ids) as TaskLine[]
}

function deadlinesWithin(userId: number, now: Date, days: number): TaskLine[] {
  const until = new Date(now.getTime() + days * 86_400_000)
  return getDb()
    .prepare(
      `SELECT t.id, t.title, t.priority, p.name AS project, t.deadline_at
       FROM tasks t JOIN projects p ON p.id = t.project_id
       WHERE t.user_id = ? AND ${OPEN_WORK_SQL}
         AND t.deadline_at IS NOT NULL AND t.deadline_at >= ? AND t.deadline_at <= ?
       ORDER BY t.deadline_at ASC`,
    )
    .all(userId, now.toISOString(), until.toISOString()) as TaskLine[]
}

function inboxNotes(userId: number): { count: number; latest: string[] } {
  const db = getDb()
  const { count } = db
    .prepare(
      "SELECT COUNT(*) AS count FROM notes WHERE user_id = ? AND status = 'inbox' AND deleted_at IS NULL",
    )
    .get(userId) as { count: number }
  const latest = (
    db
      .prepare(
        `SELECT body FROM notes WHERE user_id = ? AND status = 'inbox' AND deleted_at IS NULL
         ORDER BY created_at DESC, id DESC LIMIT 5`,
      )
      .all(userId) as { body: string }[]
  ).map((n) => (n.body.length > 140 ? `${n.body.slice(0, 137)}…` : n.body).replace(/\s+/g, ' '))
  return { count, latest }
}

interface ProjectStats {
  name: string
  open: number
  done_week: number
  notes_week: number
  last_activity: string | null
}

/**
 * Per project the user can see: open work, done and notes in the last 7 days,
 * and the latest completion or note (for "gone quiet").
 */
function projectStats(userId: number, now: Date): ProjectStats[] {
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString()
  return getDb()
    .prepare(
      `SELECT p.name,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.user_id = ? AND ${OPEN_WORK_SQL}) AS open,
        (SELECT COUNT(*) FROM completions c JOIN tasks t ON t.id = c.task_id
          WHERE t.project_id = p.id AND c.user_id = ? AND c.completed_at >= ?) AS done_week,
        (SELECT COUNT(*) FROM notes n WHERE n.project_id = p.id AND n.user_id = ?
          AND n.deleted_at IS NULL AND n.created_at >= ?) AS notes_week,
        MAX(
          (SELECT MAX(c.completed_at) FROM completions c JOIN tasks t ON t.id = c.task_id
            WHERE t.project_id = p.id AND c.user_id = ?),
          (SELECT MAX(n.created_at) FROM notes n WHERE n.project_id = p.id AND n.user_id = ?
            AND n.deleted_at IS NULL)
        ) AS last_activity
       FROM projects p
       WHERE p.owner_id = ? OR p.shared = 1
       ORDER BY p.sort_order ASC, p.name ASC`,
    )
    .all(userId, userId, weekAgo, userId, weekAgo, userId, userId, userId) as ProjectStats[]
}

function taskLine(t: TaskLine, timezone: string): string {
  const deadline = t.deadline_at ? ` — дедлайн ${fmtDate(t.deadline_at, timezone)}` : ''
  return `${priorityMark(t.priority)}${t.title} [${t.project}]${deadline}`
}

function dailySections(userId: number, timezone: string, now: Date): Section[] {
  const overdue = overdueTasks(userId, now)
  const deadlines = deadlinesWithin(userId, now, 7)
  const inbox = inboxNotes(userId)
  const projects = projectStats(userId, now).filter((p) => p.open > 0)
  return [
    {
      title: `🔥 Просрочено и на сегодня (${overdue.length})`,
      lines: capped(overdue.map((t) => taskLine(t, timezone))),
    },
    {
      title: `⏰ Дедлайны на 7 дней (${deadlines.length})`,
      lines: capped(deadlines.map((t) => taskLine(t, timezone))),
    },
    {
      title: `📥 Неразобранные заметки (${inbox.count})`,
      lines: inbox.latest.map((b) => `• ${b}`),
    },
    {
      title: '📂 Открытые задачи по проектам',
      lines: projects.map((p) => `${p.name}: ${p.open}`),
    },
  ]
}

const QUIET_DAYS = 14

function weeklySections(userId: number, timezone: string, now: Date): Section[] {
  const stats = projectStats(userId, now)
  const quietBefore = new Date(now.getTime() - QUIET_DAYS * 86_400_000).toISOString()
  const quiet = stats.filter(
    (p) => p.open > 0 && (p.last_activity === null || p.last_activity < quietBefore),
  )
  const active = stats.filter((p) => p.open > 0 || p.done_week > 0 || p.notes_week > 0)
  const deadlines = deadlinesWithin(userId, now, 14)
  const inbox = inboxNotes(userId)
  return [
    {
      title: '📊 Неделя по проектам',
      lines: active.map(
        (p) => `${p.name}: сделано ${p.done_week}, заметок ${p.notes_week}, открыто ${p.open}`,
      ),
    },
    {
      title: `💤 Без движения ${QUIET_DAYS}+ дней (${quiet.length})`,
      lines: quiet.map((p) => `${p.name}: открыто ${p.open}`),
    },
    {
      title: `⏰ Дедлайны на 14 дней (${deadlines.length})`,
      lines: capped(deadlines.map((t) => taskLine(t, timezone))),
    },
    {
      title: `📥 Неразобранные заметки (${inbox.count})`,
      lines: inbox.latest.map((b) => `• ${b}`),
    },
  ]
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function render(heading: string, sections: Section[]): { text: string; html: string } {
  const text = [
    heading,
    '',
    ...sections.flatMap((s) => [s.title, ...(s.lines.length ? s.lines : ['—']), '']),
  ].join('\n')
  const html =
    `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a">` +
    `<h2 style="margin:0 0 12px">${escapeHtml(heading)}</h2>` +
    sections
      .map(
        (s) =>
          `<h3 style="margin:16px 0 4px;font-size:15px">${escapeHtml(s.title)}</h3>` +
          (s.lines.length
            ? `<ul style="margin:0;padding-left:18px">${s.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>`
            : '<p style="margin:0;color:#888">—</p>'),
      )
      .join('') +
    '</div>'
  return { text, html }
}

export function buildDigest(
  userId: number,
  timezone: string,
  kind: DigestKind,
  now: Date = new Date(),
): DigestContent {
  const day = DateTime.fromJSDate(now).setZone(timezone).setLocale('ru').toFormat('d MMMM')
  const heading = kind === 'daily' ? `Сводка на ${day}` : `Недельный обзор, ${day}`
  const sections =
    kind === 'daily' ? dailySections(userId, timezone, now) : weeklySections(userId, timezone, now)
  return { subject: heading, ...render(heading, sections) }
}
