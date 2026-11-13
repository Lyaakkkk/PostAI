import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  STORAGE_KEY, readHistory, commitHistory, persistMedia, getMedia,
  attachmentMetadata, fileId, registerMediaSession, removedMediaIds,
} from '../src/lib/mediaStorage.js'

// Transactional in-memory substitute: browser persistence still requires a real-browser check.
function fakeDatabase() {
  const records = new Map()
  const state = { records, fail: false, closes: 0 }
  state.open = () => {
    const request = {}
    setTimeout(() => {
      request.result = {
        close() { state.closes++ },
        transaction(name, mode) {
          assert.equal(name, 'files')
          const staged = new Map(records)
          let pending = 0
          let ended = false
          let timer
          const tx = {
            error: null,
            abort() {
              if (ended) return
              ended = true
              clearTimeout(timer)
              queueMicrotask(() => tx.onabort?.())
            },
            objectStore() {
              function finish() {
                clearTimeout(timer)
                timer = setTimeout(() => {
                  if (ended || pending) return
                  ended = true
                  if (mode === 'readwrite') {
                    records.clear()
                    for (const [id, value] of staged) records.set(id, value)
                  }
                  tx.oncomplete?.()
                }, 0)
              }
              function write(fn) {
                if (state.fail) { tx.error = Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); tx.abort(); return }
                fn()
                finish()
              }
              finish()
              return {
                get(id) {
                  pending++
                  const result = {}
                  setTimeout(() => {
                    if (ended) return
                    result.result = staged.get(id)
                    result.onsuccess?.()
                    pending--
                    finish()
                  }, 0)
                  return result
                },
                put(value) { write(() => staged.set(value.id, value)) },
                delete(id) { write(() => staged.delete(id)) },
              }
            },
          }
          return tx
        },
      }
      request.onsuccess()
    }, 0)
    return request
  }
  return state
}

test('media persistence, history compatibility, failures and safe cleanup', async () => {
  let raw = JSON.stringify([{ id: 'legacy', title: 'Texto antigo', favorite: true }])
  let quota = false
  globalThis.localStorage = {
    getItem(key) { assert.equal(key, STORAGE_KEY); return raw },
    setItem(key, value) {
      assert.equal(key, STORAGE_KEY)
      if (quota) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' })
      raw = value
    },
  }
  const held = new Map()
  const queues = new Map()
  let otherTab = false
  const locks = {
    request(name, callback) {
      const previous = queues.get(name) || Promise.resolve()
      const result = previous.then(async () => {
        held.set(name, { name })
        try { return await callback() } finally { held.delete(name) }
      })
      queues.set(name, result.catch(() => {}))
      return result
    },
    async query() { return { held: [...held.values(), ...(otherTab ? [{ name: 'postai-tab:other' }] : [])], pending: [] } },
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { locks } })
  const db = fakeDatabase()
  globalThis.indexedDB = db
  const release = registerMediaSession()
  await Promise.resolve()
  try {
    assert.equal(readHistory().items[0].favorite, true)
    const image = new Blob(['image bytes'], { type: 'image/png' })
    const video = new Blob(['video bytes'], { type: 'video/mp4' })
    const attachments = [image, video].map((file, index) => ({ id: 'draft-' + index, file, name: 'file-' + index, type: file.type, size: file.size }))
    await persistMedia(attachments)
    assert.equal(db.records.size, 2)
    assert.equal(attachments[0].id, await fileId(image))
    await persistMedia([{ ...attachments[0], id: 'another-draft' }])
    assert.equal(db.records.size, 2, 'identical file is stored once')
    const metadata = attachmentMetadata([...attachments, attachments[0]])
    assert.equal(metadata.length, 2)
    assert.ok(metadata.every(item => !('file' in item)))
    await commitHistory(raw, items => [...items, { id: 'a', attachments: metadata }, { id: 'b', attachments: [metadata[0]] }])
    assert.equal(await (await getMedia(metadata[0].id)).text(), 'image bytes', 'retrieves stored bytes without File state')
    assert.equal(await (await getMedia(metadata[1].id)).text(), 'video bytes')
    assert.equal(readHistory().items[0].favorite, true)

    const stale = raw
    await commitHistory(raw, items => [...items, { id: 'text-only' }])
    await assert.rejects(commitHistory(stale, () => []), /outra aba/)
    const beforeFailure = raw
    await assert.rejects(commitHistory(raw, () => [], async () => { throw new Error('IDB failed') }), /IDB failed/)
    assert.equal(raw, beforeFailure)
    quota = true
    await assert.rejects(commitHistory(raw, () => []), /quota/)
    assert.equal(raw, beforeFailure)
    assert.equal(db.records.size, 2, 'no cleanup if metadata write fails')
    quota = false

    await commitHistory(raw, items => items.filter(item => item.id !== 'a'))
    assert.ok(db.records.has(metadata[0].id), 'shared image preserved')
    assert.ok(!db.records.has(metadata[1].id), 'unshared video removed')
    otherTab = true
    const deferred = await commitHistory(raw, items => items.filter(item => item.id !== 'b'))
    assert.match(deferred.warning, /Outra aba/)
    assert.ok(db.records.has(metadata[0].id), 'other tab prevents deletion')
    otherTab = false
    assert.throws(() => removedMediaIds([{ attachments: [{ id: 'uncertain' }] }], []), /incertas/)
    await assert.rejects(persistMedia([{ id: 'unavailable' }]), /indisponível/)
    db.fail = true
    await assert.rejects(persistMedia([{ file: new Blob(['new']), type: 'image/png' }]), /quota/)
    db.fail = false
    assert.equal(db.records.size, 1)
    delete globalThis.indexedDB
    await persistMedia([])
    await commitHistory(raw, items => [...items, { id: 'text-without-idb' }])
    await assert.rejects(getMedia('missing'), /IndexedDB/)
    raw = '{invalid'
    await assert.rejects(commitHistory(raw, () => []))
    assert.equal(raw, '{invalid', 'invalid history is never overwritten')
    assert.ok(db.closes > 0)
  } finally { release() }
})

test('preview filtering and URL lifecycle are present (static checks)', async () => {
  const app = await readFile(new URL('../src/App.jsx', import.meta.url), 'utf8')
  const component = await readFile(new URL('../src/components/PublicationMedia.jsx', import.meta.url), 'utf8')
  assert.match(app, /submissionUse === 'reference' \? \[\]/)
  assert.match(app, /file\.type\.startsWith\('image\/'\) \|\| file\.type\.startsWith\('video\/'\)/)
  assert.match(component, /URL\.revokeObjectURL/)
  assert.match(component, /if \(cancelled\) return/)
  assert.match(component, /controls playsInline/)
})
