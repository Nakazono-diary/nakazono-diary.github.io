// 記録の置き場(いまはスマホの中の IndexedDB)。
// あとで置き場を替える(ミニPCなど、暗号化して置く)ときは、このファイルの中だけを差し替える。
// 画面(app.js)は、ここの関数だけを使う。

const DB_NAME = 'diary'
const DB_VER = 1
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
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}

function tx(mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction('entries', mode)
    const st = t.objectStore('entries')
    let out
    Promise.resolve(fn(st)).then(v => { out = v })
    t.oncomplete = () => resolve(out)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  }))
}

const req2p = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })

// 記録を1つ足す。entry: { id, at: 'YYYY-MM-DDTHH:MM:SS', day: 'YYYY-MM-DD', kind, label, note }
export function addEntry(entry) {
  return tx('readwrite', st => req2p(st.add(entry))).then(() => entry)
}

export function deleteEntry(id) {
  return tx('readwrite', st => req2p(st.delete(id)))
}

// その日の記録(時刻の順)
export function entriesOfDay(day) {
  return tx('readonly', st => req2p(st.index('day').getAll(day)))
    .then(list => list.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)))
}

export function allEntries() {
  return tx('readonly', st => req2p(st.getAll()))
    .then(list => list.sort((a, b) => (a.at < b.at ? -1 : 1)))
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
