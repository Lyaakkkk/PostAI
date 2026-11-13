export const STORAGE_KEY = 'postai-publications-v1'

let sessionId
let sessionHeld = false

// A live tab holds its own lock. Uncertain/multi-tab cases never delete binaries.
export function registerMediaSession() {
  if (!navigator.locks?.request) return () => {}
  sessionId ||= 'postai-tab:' + crypto.randomUUID()
  let released = false
  let release
  navigator.locks.request(sessionId, async () => {
    if (released) return
    sessionHeld = true
    await new Promise(resolve => { release = resolve })
    sessionHeld = false
  }).catch(() => { sessionHeld = false })
  return () => { released = true; release?.() }
}

export function removedMediaIds(before, after) {
  function references(items) {
    const ids = new Set()
    for (const item of items) {
      if (item.attachments === undefined) continue
      if (!Array.isArray(item.attachments)) throw new Error('Referências de mídia inválidas; arquivos preservados.')
      for (const attachment of item.attachments) {
        if (!attachment || !/^[a-f0-9]{64}$/.test(attachment.id)) throw new Error('Referências de mídia incertas; arquivos preservados.')
        ids.add(attachment.id)
      }
    }
    return ids
  }
  const retained = references(after)
  return [...references(before)].filter(id => !retained.has(id))
}

async function cleanupRemovedMedia(before, after, expectedRaw) {
  const ids = removedMediaIds(before, after)
  if (!ids.length) return
  if (!sessionHeld || !navigator.locks?.query) throw new Error('Não foi possível verificar outras abas; a limpeza de mídia foi adiada.')
  const locks = await navigator.locks.query()
  if ([...locks.held, ...locks.pending].some(lock => lock.name.startsWith('postai-tab:') && lock.name !== sessionId)) {
    throw new Error('Outra aba está aberta; os arquivos foram mantidos por segurança.')
  }
  if (localStorage.getItem(STORAGE_KEY) !== expectedRaw) throw new Error('O histórico mudou; a limpeza de mídia foi adiada.')
  const db = await openDatabase()
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite')
      tx.oncomplete = resolve
      tx.onerror = () => reject(tx.error || new Error('Falha na limpeza de mídia.'))
      tx.onabort = () => reject(tx.error || new Error('Limpeza cancelada.'))
      if (localStorage.getItem(STORAGE_KEY) !== expectedRaw) { tx.abort(); return }
      const store = tx.objectStore('files')
      for (const id of ids) store.delete(id)
    })
  } finally { db.close() }
}

export function readHistory() {
  const raw = localStorage.getItem(STORAGE_KEY)
  const items = JSON.parse(raw || '[]')
  if (!Array.isArray(items) || items.some(item => !item || typeof item !== 'object' || typeof item.id !== 'string')) {
    throw new Error('Histórico inválido. Os dados existentes foram preservados.')
  }
  return { raw, items }
}

export async function commitHistory(expectedRaw, transform, prepare = async () => {}) {
  // Without cross-tab locking, fail closed rather than risk overwriting history.
  if (!navigator.locks?.request) throw new Error('Este navegador não oferece salvamento seguro entre abas. Use um navegador atualizado em HTTPS ou localhost.')
  return navigator.locks.request('postai-history-write', async () => {
    const before = readHistory()
    if (before.raw !== expectedRaw) throw new Error('O histórico mudou em outra aba. Revise a versão atualizada e tente novamente; seu rascunho foi mantido.')
    const next = transform(before.items)
    await prepare()
    if (localStorage.getItem(STORAGE_KEY) !== before.raw) throw new Error('O histórico mudou durante o salvamento. Seu rascunho foi mantido.')
    const raw = JSON.stringify(next)
    localStorage.setItem(STORAGE_KEY, raw)
    // Metadata is committed first. A cleanup failure must never restore deleted posts.
    let warning = ''
    try { await cleanupRemovedMedia(before.items, next, raw) }
    catch (error) { warning = error.message || 'A limpeza de mídia foi adiada.' }
    return { raw, items: next, warning }
  })
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB indisponível neste navegador.'))
    const request = indexedDB.open('postai-media', 1)
    request.onupgradeneeded = () => request.result.createObjectStore('files', { keyPath: 'id' })
    request.onerror = () => reject(request.error)
    let blocked = false
    request.onblocked = () => { blocked = true; reject(new Error('Armazenamento bloqueado por outra aba.')) }
    request.onsuccess = () => {
      const db = request.result
      if (blocked) { db.close(); return }
      db.onversionchange = () => db.close()
      resolve(db)
    }
  })
}

export async function fileId(file) {
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function persistMedia(attachments = []) {
  if (!attachments.length) return
  const records = new Map()
  for (const attachment of attachments) {
    const id = attachment.file ? await fileId(attachment.file) : attachment.id
    if (!id) throw new Error('Anexo sem identificador. Selecione o arquivo novamente.')
    attachment.id = id
    if (!records.get(id)?.file || attachment.file) records.set(id, attachment)
  }
  const db = await openDatabase()
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite')
      const store = tx.objectStore('files')
      let missing = false
      tx.oncomplete = resolve
      tx.onerror = event => reject(event.target.error || tx.error || new Error('Falha ao armazenar mídia.'))
      tx.onabort = () => reject(missing ? new Error('Mídia indisponível. Remova o anexo ou selecione novamente.') : tx.error || new Error('Gravação de mídia cancelada.'))
      for (const [id, attachment] of records) {
        const request = store.get(id)
        request.onsuccess = () => {
          if (request.result) return
          if (!attachment.file) { missing = true; tx.abort(); return }
          store.put({ id, blob: attachment.file, mimeType: attachment.type, size: attachment.size, createdAt: new Date().toISOString() })
        }
      }
    })
  } finally { db.close() }
}

export async function getMedia(id) {
  const db = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('files', 'readonly')
      const request = tx.objectStore('files').get(id)
      tx.oncomplete = () => resolve(request.result?.blob || null)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error || new Error('Leitura cancelada.'))
    })
  } finally { db.close() }
}

export function attachmentMetadata(attachments = []) {
  return [...new Map(attachments.map(({ id, name, type, size }) => [id, { id, name, type, size }])).values()]
}

export function storageError(error) {
  return error?.name === 'QuotaExceededError'
    ? 'Espaço insuficiente no navegador. O rascunho foi mantido; libere espaço ou remova anexos e tente novamente.'
    : error?.message || 'Não foi possível salvar. O rascunho foi mantido.'
}
