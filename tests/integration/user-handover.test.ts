import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, test } from 'node:test'
import {
  callServerFn, client, createApiKey, createUser, migrate, pool, query, resetDb, sessionCookie, setPassword,
  signIn, skip, startApp, type App,
} from './harness.ts'

// #50: admins take over links, departing admins are deactivated, deleted users' links go to the admin.
describe('user handover', { skip }, () => {
  let app: App
  let adminId: string
  let cookie: string
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
    adminId = await createUser({ role: 'admin', twoFactorEnabled: true })
    cookie = await sessionCookie(app, adminId)
  })

  const call = (name: string, data: unknown) => callServerFn(app, name, data, cookie)
  const ownerOf = async (code: string) =>
    (await query('select user_id from links where code = $1', [code]))[0]?.user_id
  const otherAdmin = () => createUser({ role: 'admin', twoFactorEnabled: true })
  async function withLink(userId: string, code: string) {
    const key = await createApiKey(userId)
    const { body } = await client(app, key).create({ url: `https://example.com/${code}`, code })
    return { key, link: body }
  }

  test("an admin can take over another admin's or user's links", async () => {
    const other = await otherAdmin()
    const member = await createUser()
    await withLink(other, 'from-admin')
    await withLink(member, 'from-user')

    assert.equal((await call('takeOverLinks', { id: other })).status, 200)
    assert.equal((await call('takeOverLinks', { id: member })).status, 200)
    assert.equal(await ownerOf('from-admin'), adminId)
    assert.equal(await ownerOf('from-user'), adminId)
    const [audit] = await query(
      `select metadata from audit_logs where action = 'admin.user.links_taken_over' and target_id = $1`, [member],
    )
    assert.deepEqual(audit.metadata, { count: 1 })
  })

  test('a deactivated admin is signed out and locked out, but their links keep redirecting', async () => {
    const other = await otherAdmin()
    await setPassword(other, 'departing-admin-password')
    const otherSession = await signIn(app, `${other}@test.local`, 'departing-admin-password')
    const { key } = await withLink(other, 'kept')

    assert.equal((await call('deactivateUser', { id: other })).status, 200)

    const session = await fetch(`${app.baseUrl}/api/auth/get-session`, { headers: { cookie: otherSession } })
    assert.equal(await session.json(), null)
    const signInAgain = await fetch(`${app.baseUrl}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { origin: app.baseUrl, 'content-type': 'application/json' },
      body: JSON.stringify({ email: `${other}@test.local`, password: 'departing-admin-password' }),
    })
    assert.equal(signInAgain.status, 403)
    assert.equal((await client(app, key).list()).status, 401)

    const visit = await fetch(`${app.baseUrl}/kept`, { redirect: 'manual' })
    assert.equal(visit.status, 302)
    assert.equal(await ownerOf('kept'), other)
  })

  test('a reactivated admin can sign in again', async () => {
    const other = await otherAdmin()
    await setPassword(other, 'returning-admin-password')
    await call('deactivateUser', { id: other })
    assert.equal((await call('reactivateUser', { id: other })).status, 200)
    await signIn(app, `${other}@test.local`, 'returning-admin-password')
  })

  test('only admins are deactivated, and active admins cannot be deleted', async () => {
    const member = await createUser()
    const other = await otherAdmin()
    assert.match((await call('deactivateUser', { id: member })).body, /Only admins can be deactivated/)
    assert.match((await call('deleteUser', { id: other })).body, /Deactivate this admin before deleting/)
    assert.equal((await query('select 1 from "user" where id = $1', [other])).length, 1)
  })

  test("a deactivated account can't receive links or change role", async () => {
    const other = await otherAdmin()
    const { link } = await withLink(adminId, 'mine')
    await call('deactivateUser', { id: other })
    assert.match(
      (await call('bulkUpdateLinks', { ids: [link.id], ownerId: other })).body,
      /can't be transferred to a deactivated account/,
    )
    assert.match((await call('setUserRole', { id: other, role: 'user' })).body, /Reactivate this account/)
    assert.equal(await ownerOf('mine'), adminId)
  })

  test('deleting a user moves their links and analytics to the acting admin', async () => {
    const member = await createUser()
    const { link } = await withLink(member, 'orphan')
    await query(`insert into clicks (id, link_id) values ('c1', $1)`, [link.id])

    assert.equal((await call('deleteUser', { id: member })).status, 200)
    const [audit] = await query(`select metadata from audit_logs where action = 'admin.user.deleted'`)
    assert.deepEqual(audit.metadata, { linksTransferredTo: adminId, count: 1 })
    assert.equal((await query('select 1 from "user" where id = $1', [member])).length, 0)
    assert.equal((await query('select 1 from api_keys where user_id = $1', [member])).length, 0)
    assert.equal(await ownerOf('orphan'), adminId)
    assert.equal((await query('select 1 from clicks where link_id = $1', [link.id])).length, 1)
  })

  test('deleting a deactivated admin moves their links to the acting admin', async () => {
    const other = await otherAdmin()
    await withLink(other, 'departed')
    await call('deactivateUser', { id: other })
    assert.equal((await call('deleteUser', { id: other })).status, 200)
    assert.equal(await ownerOf('departed'), adminId)
  })
})
