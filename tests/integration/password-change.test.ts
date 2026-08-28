import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import {
  callServerFn, createUser, migrate, pool, query, resetDb, setPassword, signIn, skip, startApp, type App,
} from './harness.ts'

// Regression tests for #47
describe('forced password change', { skip }, () => {
  let app: App
  let userId: string
  let email: string
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
    userId = await createUser({ mustChangePassword: true })
    email = `${userId}@test.local`
    await setPassword(userId, 'temporary-password-1')
  })

  const session = async (cookie: string) => {
    const res = await fetch(`${app.baseUrl}/api/auth/get-session`, { headers: { cookie } })
    return res.json() as Promise<{ user: { mustChangePassword: boolean } } | null>
  }
  const change = (cookie: string, currentPassword: string) =>
    callServerFn(app, 'changeMyPassword', { currentPassword, newPassword: 'a-brand-new-password' }, cookie)

  test('keeps the current session signed in and clears the flag', async () => {
    const cookie = await signIn(app, email, 'temporary-password-1')
    assert.equal((await change(cookie, 'temporary-password-1')).status, 200)

    const current = await session(cookie)
    assert.ok(current, 'current session should survive the password change')
    assert.equal(current.user.mustChangePassword, false)

    const fresh = await session(await signIn(app, email, 'a-brand-new-password'))
    assert.equal(fresh?.user.mustChangePassword, false, 'next sign-in should not force another change')
  })

  test('revokes every other session', async () => {
    const other = await signIn(app, email, 'temporary-password-1')
    const cookie = await signIn(app, email, 'temporary-password-1')
    assert.equal((await change(cookie, 'temporary-password-1')).status, 200)
    assert.equal(await session(other), null)
    assert.ok(await session(cookie))
  })

  test('a wrong current password changes nothing', async () => {
    const cookie = await signIn(app, email, 'temporary-password-1')
    assert.match((await change(cookie, 'not-the-password')).body, /Invalid password/)
    const [row] = await query(`select must_change_password from "user" where id = $1`, [userId])
    assert.equal(row.must_change_password, true)
    assert.ok(await session(cookie))
  })
})
