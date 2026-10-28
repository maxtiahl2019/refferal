/**
 * Notes (the thought inbox) and email digests — src/core/notes, src/core/digest.
 *
 * NT-*: notes are created in the inbox, filing and unfiling move them between
 *       inbox and filed, other users' notes and projects are out of reach,
 *       deletes are soft.
 * DG-*: digest content reads overdue work, deadlines and the inbox; the send
 *       job sends each digest once per local day at the send time, weekly
 *       only on Mondays, and retries a failed send.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { getDb } from '@/core/db'
import { createNote, deleteNote, getNote, listNotes, updateNote } from '@/core/notes'
import {
  buildDigest,
  dueDigests,
  getDigestSettings,
  runDigests,
  saveDigestSettings,
} from '@/core/digest'
import { setEmailTransportForTests, type EmailMessage } from '@/core/email'
import { createTask } from '@/core/tasks'
import {
  setupTestDb,
  teardownTestDb,
  seedTestProject,
  seedTestUser,
  TEST_TIMEZONE,
  TEST_USER_ID,
} from '../helpers/setup'

const OTHER_USER = 2

beforeEach(() => {
  setupTestDb()
  seedTestProject(2, 'Launch', TEST_USER_ID)
})

afterEach(() => {
  setEmailTransportForTests(null)
  vi.useRealTimers()
  teardownTestDb()
})

describe('notes', () => {
  test('NT-01: a new note without a project lands in the inbox', () => {
    const note = createNote(TEST_USER_ID, { body: 'idea: referral bonus', source: 'web' })
    expect(note.status).toBe('inbox')
    expect(note.project_id).toBeNull()
    expect(listNotes(TEST_USER_ID, { status: 'inbox' }).map((n) => n.id)).toEqual([note.id])
  })

  test('NT-02: a note created with a project is filed', () => {
    const note = createNote(TEST_USER_ID, { body: 'pricing', project_id: 2, source: 'api' })
    expect(note.status).toBe('filed')
    expect(listNotes(TEST_USER_ID, { projectId: 2 })).toHaveLength(1)
  })

  test('NT-03: filing and unfiling move the note between filed and inbox', () => {
    const note = createNote(TEST_USER_ID, { body: 'x', source: 'web' })
    expect(updateNote(TEST_USER_ID, note.id, { project_id: 2 }).status).toBe('filed')
    expect(updateNote(TEST_USER_ID, note.id, { project_id: null }).status).toBe('inbox')
  })

  test('NT-04: archiving keeps the project and hides the note from the default list', () => {
    const note = createNote(TEST_USER_ID, { body: 'x', project_id: 2, source: 'web' })
    const archived = updateNote(TEST_USER_ID, note.id, { status: 'archived' })
    expect(archived.project_id).toBe(2)
    expect(listNotes(TEST_USER_ID)).toHaveLength(0)
    expect(listNotes(TEST_USER_ID, { status: 'archived' })).toHaveLength(1)
  })

  test('NT-05: a note cannot be filed with no project', () => {
    const note = createNote(TEST_USER_ID, { body: 'x', source: 'web' })
    expect(() => updateNote(TEST_USER_ID, note.id, { status: 'filed' })).toThrow(/needs a project/)
  })

  test("NT-06: another user's note and private project are out of reach", () => {
    seedTestUser(OTHER_USER, 'other@example.com')
    seedTestProject(3, 'Private', OTHER_USER)
    const mine = createNote(TEST_USER_ID, { body: 'mine', source: 'web' })
    expect(() => getNote(OTHER_USER, mine.id)).toThrow(/not found/i)
    expect(() => updateNote(TEST_USER_ID, mine.id, { project_id: 3 })).toThrow(/not found/)
    expect(() => createNote(TEST_USER_ID, { body: 'x', project_id: 3, source: 'web' })).toThrow()
  })

  test('NT-07: delete is soft', () => {
    const note = createNote(TEST_USER_ID, { body: 'x', source: 'web' })
    deleteNote(TEST_USER_ID, note.id)
    expect(listNotes(TEST_USER_ID)).toHaveLength(0)
    const row = getDb().prepare('SELECT deleted_at FROM notes WHERE id = ?').get(note.id) as {
      deleted_at: string | null
    }
    expect(row.deleted_at).not.toBeNull()
  })

  test('NT-08: deleting a project leaves its notes unfiled, not gone', () => {
    const note = createNote(TEST_USER_ID, { body: 'x', project_id: 2, source: 'web' })
    getDb().prepare('UPDATE tasks SET project_id = 1 WHERE project_id = 2').run()
    getDb().prepare('DELETE FROM projects WHERE id = 2').run()
    expect(getNote(TEST_USER_ID, note.id).project_id).toBeNull()
  })
})

describe('digest content', () => {
  test('DG-01: the daily digest lists overdue work, deadlines and the inbox', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-28T15:00:00Z'))
    createTask({
      userId: TEST_USER_ID,
      userTimezone: TEST_TIMEZONE,
      input: { title: 'Send the deck', project_id: 2, due_at: '2026-10-28T14:00:00Z', priority: 3 },
    })
    createTask({
      userId: TEST_USER_ID,
      userTimezone: TEST_TIMEZONE,
      input: { title: 'Sign contract', project_id: 2, deadline_at: '2026-10-31T17:00:00Z' },
    })
    createNote(TEST_USER_ID, { body: 'call Anna about the partner program', source: 'telegram' })

    const { subject, text, html } = buildDigest(TEST_USER_ID, TEST_TIMEZONE, 'daily')
    expect(subject).toContain('Сводка')
    expect(text).toContain('❗ Send the deck [Launch]')
    expect(text).toMatch(/Дедлайны на 7 дней \(1\)\nSign contract \[Launch\]/)
    expect(text).toContain('Неразобранные заметки (1)')
    expect(text).toContain('call Anna about the partner program')
    expect(html).toContain('<li>❗ Send the deck [Launch]</li>')
  })

  test('DG-02: the weekly review counts notes per project and flags quiet projects', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-26T15:00:00Z'))
    createTask({
      userId: TEST_USER_ID,
      userTimezone: TEST_TIMEZONE,
      input: { title: 'Open item', project_id: 2 },
    })
    const { text } = buildDigest(TEST_USER_ID, TEST_TIMEZONE, 'weekly')
    expect(text).toContain('Launch: сделано 0, заметок 0, открыто 1')
    expect(text).toMatch(/Без движения 14\+ дней \(1\)\nLaunch: открыто 1/)
  })

  test('DG-03: HTML escapes user text', () => {
    createNote(TEST_USER_ID, { body: '<script>x</script>', source: 'web' })
    const { html } = buildDigest(TEST_USER_ID, TEST_TIMEZONE, 'daily')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })
})

describe('digest schedule', () => {
  const row = {
    user_id: 1,
    email: 'me@example.com',
    daily_enabled: 1,
    weekly_enabled: 1,
    send_time: '08:00',
    last_daily_date: null as string | null,
    last_weekly_date: null as string | null,
  }

  test('DG-04: nothing before the send time; daily after it; weekly only on Monday', () => {
    // 2026-10-26 is a Monday. Chicago is UTC-5 then.
    expect(dueDigests(row, TEST_TIMEZONE, new Date('2026-10-26T12:59:00Z'))).toEqual([])
    expect(dueDigests(row, TEST_TIMEZONE, new Date('2026-10-26T13:00:00Z'))).toEqual([
      'daily',
      'weekly',
    ])
    expect(dueDigests(row, TEST_TIMEZONE, new Date('2026-10-27T13:00:00Z'))).toEqual(['daily'])
  })

  test('DG-05: a digest already sent today is not due again', () => {
    const sent = { ...row, last_daily_date: '2026-10-27' }
    expect(dueDigests(sent, TEST_TIMEZONE, new Date('2026-10-27T20:00:00Z'))).toEqual([])
  })

  test('DG-06: runDigests sends once per day and retries after a failure', async () => {
    const outbox: EmailMessage[] = []
    let fail = true
    setEmailTransportForTests({
      sendMail: async (m) => {
        if (fail) throw new Error('smtp down')
        outbox.push(m)
      },
    })
    saveDigestSettings(TEST_USER_ID, { email: 'me@example.com', weekly_enabled: false })
    const at = new Date('2026-10-27T14:00:00Z')

    expect(await runDigests(at)).toBe(0)
    fail = false
    expect(await runDigests(at)).toBe(1)
    expect(await runDigests(at)).toBe(0)
    expect(outbox).toHaveLength(1)
    expect(outbox[0].to).toBe('me@example.com')
  })

  test('DG-07: demo users never get mail', async () => {
    const outbox: EmailMessage[] = []
    setEmailTransportForTests({ sendMail: async (m) => void outbox.push(m) })
    saveDigestSettings(TEST_USER_ID, { email: 'me@example.com' })
    getDb().prepare('UPDATE users SET is_demo = 1 WHERE id = ?').run(TEST_USER_ID)
    expect(await runDigests(new Date('2026-10-27T14:00:00Z'))).toBe(0)
  })

  test('DG-08: settings need an address to start, and keep it on later changes', () => {
    expect(() => saveDigestSettings(TEST_USER_ID, { daily_enabled: false })).toThrow(/email/)
    saveDigestSettings(TEST_USER_ID, { email: 'me@example.com' })
    saveDigestSettings(TEST_USER_ID, { send_time: '07:30' })
    expect(getDigestSettings(TEST_USER_ID)).toEqual({
      email: 'me@example.com',
      daily_enabled: true,
      weekly_enabled: true,
      send_time: '07:30',
    })
  })
})
