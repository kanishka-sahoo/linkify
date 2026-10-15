import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import { createUser, migrate, pool, query, resetDb, setPassword, signIn, skip, startApp, type App } from './harness.ts'

describe('sign in with username', { skip }, () => {
  let app: App
  let userId: string
  before(async () => {
    migrate()
    app = await startApp()
  })
  after(async () => {
    await app?.stop()
    await pool.end()
  })
  beforeEach(async () => {
    await resetDb()
    userId = await createUser()
    await query(`update "user" set username = 'jane.doe', display_username = 'Jane.Doe' where id = $1`, [userId])
    await setPassword(userId, 'correct-password-1')
  })

  const signInUsername = (username: string, password: string) =>
    fetch(`${app.baseUrl}/api/auth/sign-in/username`, {
      method: 'POST',
      headers: { origin: app.baseUrl, 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    })

  test('accepts the username in any case', async () => {
    const res = await signInUsername('JANE.DOE', 'correct-password-1')
    assert.equal(res.status, 200)
    const body = await res.json() as { user: { id: string } }
    assert.equal(body.user.id, userId)
  })

  test('rejects a wrong password', async () => {
    assert.equal((await signInUsername('jane.doe', 'wrong-password-1')).status, 401)
  })

  test('email sign-in still works', async () => {
    assert.ok(await signIn(app, `${userId}@test.local`, 'correct-password-1'))
  })

  test('deactivated accounts cannot sign in by username', async () => {
    await query(`update "user" set deactivated_at = now() where id = $1`, [userId])
    assert.equal((await signInUsername('jane.doe', 'correct-password-1')).status, 403)
  })

  test('username availability lookups are disabled', async () => {
    const res = await fetch(`${app.baseUrl}/api/auth/is-username-available`, {
      method: 'POST',
      headers: { origin: app.baseUrl, 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'jane.doe' }),
    })
    assert.equal(res.status, 404)
  })
})
