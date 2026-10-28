'use client'

/**
 * Notes — the thought inbox (src/core/notes, /api/notes).
 *
 * The top box takes a thought as fast as possible (⌘/Ctrl+Enter adds it),
 * optionally straight into a project. Below, three views: Inbox (not yet
 * filed), Filed and Archived. Each note can be filed into a project from its
 * own picker (choosing "Inbox" unfiles it), archived or deleted (soft).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import { useRequireSession } from '@/hooks/useRequireSession'
import { useTimezone } from '@/hooks/useTimezone'
import { PageLoading } from '@/components/PageLoading'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { DateTime } from 'luxon'
import { showToast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import type { Project } from '@/types'

type NoteStatus = 'inbox' | 'filed' | 'archived'

interface Note {
  id: number
  project_id: number | null
  body: string
  source: 'web' | 'telegram' | 'email' | 'api'
  status: NoteStatus
  created_at: string
}

const VIEWS: { status: NoteStatus; label: string }[] = [
  { status: 'inbox', label: 'Inbox' },
  { status: 'filed', label: 'Filed' },
  { status: 'archived', label: 'Archived' },
]

const SELECT_CLASS =
  'rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800'

async function api(path: string, method: string, body?: unknown): Promise<Response> {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error(data?.error ?? `Request failed (${res.status})`)
  }
  return res
}

function ProjectPicker({
  projects,
  value,
  onChange,
  label,
}: {
  projects: Project[]
  value: number | null
  onChange: (projectId: number | null) => void
  label: string
}) {
  return (
    <select
      aria-label={label}
      className={SELECT_CLASS}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    >
      <option value="">Inbox (unfiled)</option>
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  )
}

function NoteCard({
  note,
  projects,
  timezone,
  onChanged,
}: {
  note: Note
  projects: Project[]
  timezone: string
  onChanged: () => void
}) {
  const run = (method: string, body?: unknown) =>
    api(`/api/notes/${note.id}`, method, body)
      .then(onChanged)
      .catch((err: Error) => showToast({ message: err.message, type: 'error' }))

  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="text-sm whitespace-pre-wrap">{note.body}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
        <span>
          {DateTime.fromISO(note.created_at).setZone(timezone).toFormat('d LLL, HH:mm')} ·{' '}
          {note.source}
        </span>
        <span className="flex-1" />
        <ProjectPicker
          label="File into project"
          projects={projects}
          value={note.project_id}
          onChange={(project_id) => run('PATCH', { project_id })}
        />
        {note.status === 'archived' ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Restore"
            onClick={() => run('PATCH', { status: note.project_id ? 'filed' : 'inbox' })}
          >
            <ArchiveRestore className="size-4" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            aria-label="Archive"
            onClick={() => run('PATCH', { status: 'archived' })}
          >
            <Archive className="size-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" aria-label="Delete" onClick={() => run('DELETE')}>
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  )
}

export default function NotesPage() {
  const { ready } = useRequireSession()
  const timezone = useTimezone()
  const [view, setView] = useState<NoteStatus>('inbox')
  const [notes, setNotes] = useState<Note[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [draftProject, setDraftProject] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)

  // Only the latest fetch may set the list: an older one still in flight (a
  // slow first load, a tab switch) must not overwrite a newer result.
  const fetchSeq = useRef(0)
  const fetchNotes = useCallback(async (status: NoteStatus) => {
    const seq = ++fetchSeq.current
    setLoading(true)
    try {
      const res = await api(`/api/notes?status=${status}`, 'GET')
      const notes = (await res.json()).data.notes
      if (seq === fetchSeq.current) setNotes(notes)
    } catch (err) {
      if (seq === fetchSeq.current) showToast({ message: (err as Error).message, type: 'error' })
    } finally {
      if (seq === fetchSeq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    fetch('/api/projects')
      .then((res) => (res.ok ? res.json() : null))
      // The task Inbox project is left out: "Inbox (unfiled)" is the notes' own inbox.
      .then((data) =>
        setProjects(((data?.data?.projects as Project[]) ?? []).filter((p) => p.name !== 'Inbox')),
      )
      .catch(() => {})
  }, [ready])

  useEffect(() => {
    if (ready) fetchNotes(view)
  }, [ready, view, fetchNotes])

  const add = async () => {
    if (!draft.trim() || saving) return
    setSaving(true)
    try {
      await api('/api/notes', 'POST', { body: draft, project_id: draftProject, source: 'web' })
      setDraft('')
      fetchNotes(view)
    } catch (err) {
      showToast({ message: (err as Error).message, type: 'error' })
    } finally {
      setSaving(false)
    }
  }

  if (!ready) return <PageLoading />

  return (
    <div className="flex-1">
      <header className="safe-top bg-background/80 sticky top-0 z-10 border-b backdrop-blur-sm">
        <div className="mx-auto max-w-2xl px-4 py-3">
          <h1 className="text-xl font-semibold">Notes</h1>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl px-4 py-6">
        <div className="mb-6 space-y-2">
          <Textarea
            aria-label="New note"
            placeholder="Drop a thought, idea or meeting note…"
            value={draft}
            rows={3}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                add()
              }
            }}
          />
          <div className="flex items-center gap-2">
            <ProjectPicker
              label="Project for new note"
              projects={projects}
              value={draftProject}
              onChange={setDraftProject}
            />
            <span className="flex-1" />
            <Button size="sm" onClick={add} disabled={!draft.trim() || saving}>
              Add note
            </Button>
          </div>
        </div>

        <div className="mb-4 flex gap-1" role="tablist">
          {VIEWS.map((v) => (
            <button
              key={v.status}
              role="tab"
              aria-selected={view === v.status}
              onClick={() => setView(v.status)}
              className={cn(
                'rounded-md px-3 py-1 text-sm',
                view === v.status
                  ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                  : 'text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="animate-pulse py-8 text-center text-zinc-500">Loading...</div>
        ) : notes.length === 0 ? (
          <p className="py-8 text-center text-zinc-400">Nothing here</p>
        ) : (
          <div className="space-y-2">
            {notes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                projects={projects}
                timezone={timezone}
                onChanged={() => fetchNotes(view)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
