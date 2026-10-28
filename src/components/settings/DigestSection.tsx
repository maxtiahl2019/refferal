'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { showToast } from '@/lib/toast'
import { SettingsSection } from './SettingsSection'

interface DigestSettings {
  email: string
  daily_enabled: boolean
  weekly_enabled: boolean
  send_time: string
}

const DEFAULTS: DigestSettings = {
  email: '',
  daily_enabled: true,
  weekly_enabled: true,
  send_time: '08:00',
}

async function request(path: string, method: string, body?: unknown) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error(data?.error ?? `Request failed (${res.status})`)
  return data?.data
}

/**
 * Settings → Email digest (src/core/digest, /api/digest): the address, the
 * daily digest and Monday review switches, the send time, and a "send now"
 * test. Nothing saves until Save; the server must have SMTP configured
 * (OPENTASK_SMTP_HOST), and the section says so when it doesn't.
 */
export function DigestSection() {
  const [settings, setSettings] = useState<DigestSettings>(DEFAULTS)
  const [saved, setSaved] = useState(false)
  const [configured, setConfigured] = useState(true)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    request('/api/digest', 'GET')
      .then((data) => {
        setConfigured(Boolean(data?.email_configured))
        if (data?.settings) {
          setSettings(data.settings)
          setSaved(true)
        }
      })
      .catch(() => {})
  }, [])

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setBusy(true)
    try {
      await fn()
      showToast({ message, type: 'success' })
    } catch (err) {
      showToast({ message: (err as Error).message, type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const save = () =>
    act(async () => {
      const data = await request('/api/digest', 'PATCH', settings)
      setSettings(data.settings)
      setSaved(true)
    }, 'Digest settings saved')

  const turnOff = () =>
    act(async () => {
      await request('/api/digest', 'DELETE')
      setSettings(DEFAULTS)
      setSaved(false)
    }, 'Digests turned off')

  const sendNow = (kind: 'daily' | 'weekly') =>
    act(() => request('/api/digest/send', 'POST', { kind }), 'Digest sent')

  return (
    <SettingsSection
      title="Email digest"
      description={
        configured
          ? 'A morning summary of overdue work, deadlines and unsorted notes, plus a project review every Monday.'
          : 'Email is not configured on this server: set OPENTASK_SMTP_HOST (see .env.example).'
      }
    >
      <div className="space-y-3">
        <Input
          type="email"
          aria-label="Digest email address"
          placeholder="you@example.com"
          value={settings.email}
          onChange={(e) => setSettings({ ...settings, email: e.target.value })}
        />
        <label className="flex items-center justify-between text-sm">
          Daily digest
          <Switch
            checked={settings.daily_enabled}
            onCheckedChange={(daily_enabled) => setSettings({ ...settings, daily_enabled })}
          />
        </label>
        <label className="flex items-center justify-between text-sm">
          Weekly review (Mondays)
          <Switch
            checked={settings.weekly_enabled}
            onCheckedChange={(weekly_enabled) => setSettings({ ...settings, weekly_enabled })}
          />
        </label>
        <label className="flex items-center justify-between text-sm">
          Send at
          <Input
            type="time"
            aria-label="Digest send time"
            className="w-32"
            value={settings.send_time}
            onChange={(e) => setSettings({ ...settings, send_time: e.target.value })}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={save} disabled={busy || !settings.email.trim()}>
            Save
          </Button>
          {saved && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => sendNow('daily')}
                disabled={busy || !configured}
              >
                Send daily now
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => sendNow('weekly')}
                disabled={busy || !configured}
              >
                Send weekly now
              </Button>
              <Button size="sm" variant="ghost" onClick={turnOff} disabled={busy}>
                Turn off
              </Button>
            </>
          )}
        </div>
      </div>
    </SettingsSection>
  )
}
