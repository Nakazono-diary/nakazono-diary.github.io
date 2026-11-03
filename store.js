// 記録の置き場(いまはスマホの中の IndexedDB)。
// あとで置き場を替える(ミニPCなど、暗号化して置く)ときは、このファイルの中だけを差し替える。
// 画面(app.js)は、ここの関数だけを使う。
//
// entries: { id, at: 'YYYY-MM-DDTHH:MM:SS', day: 'YYYY-MM-DD', kind, label, text, photos: [photoId], created_at, updated_at }
// photos : { id, blob(JPEG), w, h, created_at }
// audios : { id, blob(録音), mime, sec, created_at }
// settings: { key, value }   (key 'buttons' = ボタン、'projects' = 件名リスト、'meds' = お薬、'symptoms' = 症状、'tide' = 潮位表)
// entries にはほかに moves・project・health・bowel・weather・audios: [audioId] が付くことがある

const DB_NAME = 'diary'
const DB_VER = 4
let dbp = null

function open() {
  if (dbp) return dbp
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('entries')) {
        const st = db.createObjectStore('entries', { keyPath: 'id' })
        st.createIndex('day', 'day')
      }
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' })
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' })
      if (!db.objectStoreNames.contains('audios')) db.createObjectStore('audios', { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}

const req2p = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })

function tx(stores, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(stores, mode)
    let out
    Promise.resolve(fn(name => t.objectStore(name))).then(v => { out = v }, err => { try { t.abort() } catch { /* */ } reject(err) })
    t.oncomplete = () => resolve(out)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  }))
}

const byTime = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)

// 記録を足す/直す(写真は先に savePhoto で入れておき、その id を photos に並べる)
export function putEntry(entry) {
  return tx(['entries'], 'readwrite', s => req2p(s('entries').put(entry))).then(() => entry)
}

// 記録を消す(付いていた写真・録音も消す)。
// 消した印(settings の tombs: id → 消した時刻)も残す。同期で、ほかの端末からも消すため(v0.13)
export function deleteEntry(id, at = null) {
  return tx(['entries', 'photos', 'audios', 'settings'], 'readwrite', async s => {
    const e = await req2p(s('entries').get(id))
    for (const pid of (e && e.photos) || []) await req2p(s('photos').delete(pid))
    for (const aid of (e && e.audios) || []) await req2p(s('audios').delete(aid))
    await req2p(s('entries').delete(id))
    const t = await req2p(s('settings').get('tombs'))
    const tombs = (t && t.value) || {}
    const when = at || new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19)
    if (!tombs[id] || when > tombs[id]) tombs[id] = when
    await req2p(s('settings').put({ key: 'tombs', value: tombs }))
  })
}

export function getEntry(id) {
  return tx(['entries'], 'readonly', s => req2p(s('entries').get(id)))
}

export function entriesOfDay(day) {
  return tx(['entries'], 'readonly', s => req2p(s('entries').index('day').getAll(day))).then(l => l.sort(byTime))
}

export function allEntries() {
  return tx(['entries'], 'readonly', s => req2p(s('entries').getAll())).then(l => l.sort(byTime))
}

export function savePhoto(photo) {
  return tx(['photos'], 'readwrite', s => req2p(s('photos').put(photo))).then(() => photo)
}

export function getPhoto(id) {
  return tx(['photos'], 'readonly', s => req2p(s('photos').get(id)))
}

export function deletePhoto(id) {
  return tx(['photos'], 'readwrite', s => req2p(s('photos').delete(id)))
}

export function saveAudio(a) {
  return tx(['audios'], 'readwrite', s => req2p(s('audios').put(a))).then(() => a)
}
export function getAudio(id) {
  return tx(['audios'], 'readonly', s => req2p(s('audios').get(id)))
}
export function deleteAudio(id) {
  return tx(['audios'], 'readwrite', s => req2p(s('audios').delete(id)))
}

export function getSetting(key) {
  return tx(['settings'], 'readonly', s => req2p(s('settings').get(key))).then(r => (r ? r.value : null))
}

export function putSetting(key, value) {
  return tx(['settings'], 'readwrite', s => req2p(s('settings').put({ key, value })))
}

// ブラウザに「この記録は勝手に消さないで」と頼む(できるブラウザだけ)
export async function askPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true
      return await navigator.storage.persist()
    }
  } catch { /* 頼めなくても動く */ }
  return false
}
