/**
 * Outgoing email over SMTP (2026-10-28) — used by the digests (src/core/digest).
 *
 * Configured entirely from the environment, so the server talks to whatever
 * mail server the owner chooses (their own Postfix, a mailbox provider's SMTP,
 * a relay) and nothing else:
 *
 *   OPENTASK_SMTP_HOST    required to enable email
 *   OPENTASK_SMTP_PORT    default 587 (STARTTLS); 465 implies implicit TLS
 *   OPENTASK_SMTP_SECURE  'true' / 'false' to override the port's default
 *   OPENTASK_SMTP_USER    optional (no auth when unset)
 *   OPENTASK_SMTP_PASS
 *   OPENTASK_SMTP_FROM    the From address; default OPENTASK_SMTP_USER
 *
 * Unset host = email is off: `isEmailConfigured()` is false and the digest job
 * sends nothing. Tests swap the transport with `setEmailTransportForTests`.
 */

import nodemailer from 'nodemailer'

export interface EmailMessage {
  to: string
  subject: string
  text: string
  html?: string
}

export interface EmailTransport {
  sendMail(message: EmailMessage & { from: string }): Promise<unknown>
}

let testTransport: EmailTransport | null = null
let cachedTransport: EmailTransport | null = null

export function isEmailConfigured(): boolean {
  return testTransport !== null || Boolean(process.env.OPENTASK_SMTP_HOST)
}

function fromAddress(): string {
  return process.env.OPENTASK_SMTP_FROM || process.env.OPENTASK_SMTP_USER || 'opentask@localhost'
}

function transport(): EmailTransport {
  if (testTransport) return testTransport
  if (cachedTransport) return cachedTransport
  const host = process.env.OPENTASK_SMTP_HOST
  if (!host) throw new Error('Email is not configured (OPENTASK_SMTP_HOST is unset)')
  const port = Number(process.env.OPENTASK_SMTP_PORT || 587)
  const secureEnv = process.env.OPENTASK_SMTP_SECURE
  const secure = secureEnv ? secureEnv === 'true' : port === 465
  const user = process.env.OPENTASK_SMTP_USER
  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    // STARTTLS is required, never optional, on a non-implicit-TLS port: a
    // digest carries the user's project data and must not go out in clear.
    requireTLS: !secure,
    auth: user ? { user, pass: process.env.OPENTASK_SMTP_PASS ?? '' } : undefined,
  })
  return cachedTransport
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  await transport().sendMail({ ...message, from: fromAddress() })
}

/** Tests only: route every send to `t` (null restores the real transport). */
export function setEmailTransportForTests(t: EmailTransport | null): void {
  testTransport = t
}
