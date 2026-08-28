import { nanoid } from 'nanoid'
import { db } from './db'
import { auditLogs } from './schema'

interface AuditInput {
  action: string
  actorUserId?: string | null
  targetType?: string | null
  targetId?: string | null
  headers?: Headers | null
  metadata?: Record<string, unknown>
}

function clean(value: string | null, max: number) {
  return value ? value.slice(0, max) : null
}

/** Security logging must never make the protected operation fail. */
export async function auditEvent(input: AuditInput) {
  try {
    const ip = input.headers?.get(process.env.TRUSTED_IP_HEADER ?? 'x-real-ip') ?? null
    await db.insert(auditLogs).values({
      id: nanoid(),
      action: clean(input.action, 100)!,
      actorUserId: input.actorUserId ?? null,
      targetType: clean(input.targetType ?? null, 50),
      targetId: clean(input.targetId ?? null, 320),
      ip: clean(ip, 64),
      userAgent: clean(input.headers?.get('user-agent') ?? null, 512),
      metadata: input.metadata ?? null,
    })
  } catch (error) {
    console.error('security audit write failed', error)
  }
}
