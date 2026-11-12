// 記録の置き場(いまはスマホの中の IndexedDB)。
// あとで置き場を替える(ミニPCなど、暗号化して置く)ときは、このファイルの中だけを差し替える。
// 画面(app.js)は、ここの関数だけを使う。
//
// entries: { id, at: 'YYYY-MM-DDTHH:MM:SS', day: 'YYYY-MM-DD', kind, label, text, photos: [photoId], created_at, updated_at }
// photos : { id, blob(JPEG), w, h, created_at }
// audios : { id, blob(録音), mime, sec, created_at }
// settings: { key, value }   (key 'buttons' = ボタン、'projects' = 件名リスト、'meds' = お薬、'symptoms' = 症状、'tide' = 潮位表)
// entries にはほかに moves・project・health・bowel・weather・audios: [audioId] が付くことがある

// v0.18.2: お試しモード(裏メニュー。URL に ?try を付けて開く)は、本番とは別の置き場 diary-try を使う
import { DEBUG_MENU } from './edition.js'
// 公開版(DEBUG_MENU = false)では ?try を付けても本番の置き場のまま
export const TRY_MODE = DEBUG_MENU && typeof location !== 'undefined' && /[?&]try(=|&|$)/.test(location.search)
const BASE = TRY_MODE ? 'diary-try' : 'diary'

// ---------- 使う人(v0.19.2。本人「1つの携帯をシェアしている人向けに」) ----------
// 1人目(id 'main')はこれまでの置き場 diary をそのまま使う。2人目からは diary-u-<id>(記録もボタンも全部別)。
// 使う人の一覧は 1人目の置き場の settings 'users' に置く。いま使っている人はこの端末の localStorage に覚える。
const CUR_KEY = TRY_MODE ? 'diary.try.user' : 'diary.user'
export const USER_ID = (() => { try { return localStorage.getItem(CUR_KEY) || 'main' } catch { return 'main' } })()
const dbNameOf = (id) => (id === 'main' ? BASE : `${BASE}-u-${id}`)
const DB_NAME = dbNameOf(USER_ID)
// localStorage・sessionStorage の名前に付ける印(書きかけ・ログインなどを人ごとに分ける)。1人目は今までの名前のまま
export const USER_SUFFIX = USER_ID === 'main' ? '' : `.u-${USER_ID}`
const DB_VER = 4
let dbp = null
// お試しの置き場を空にする(本番の diary には触らない)
export async function wipeTry() {
  if (!TRY_MODE) throw new Error('お試しモードではありません')
  if (dbp) { (await dbp).close(); dbp = null }
  await new Promise((resolve, reject) => { const r = indexedDB.deleteDatabase(DB_NAME); r.onsuccess = resolve; r.onerror = () => reject(r.error); r.onblocked = resolve })
}

function openDb(name) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VER)
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
}
function open() {
  if (!dbp) dbp = openDb(DB_NAME)
  return dbp
}

// 使う人の一覧: [{ id, name, icon, pin?(4けたの番号のハッシュ), askOnOpen? }]。1人目の置き場から読む
async function baseSetting(key, value) {
  const db = USER_ID === 'main' ? await open() : await openDb(BASE)
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(['settings'], value === undefined ? 'readonly' : 'readwrite')
      const st = t.objectStore('settings')
      const r = value === undefined ? st.get(key) : st.put({ key, value })
      let out = null
      r.onsuccess = () => { out = value === undefined ? (r.result ? r.result.value : null) : value }
      t.oncomplete = () => resolve(out)
      t.onerror = () => reject(t.error)
    })
  } finally { if (USER_ID !== 'main') db.close() }
}
export async function listUsers() {
  const v = await baseSetting('users')
  return Array.isArray(v) && v.length ? v : [{ id: 'main', name: 'わたし', icon: '🙂' }]
}
export const saveUsers = (list) => baseSetting('users', list)
// 切り替える: 覚えてから開き直す(画面の中の状態を全部入れかえるため)
export function switchUser(id) {
  try { localStorage.setItem(CUR_KEY, id) } catch { /* */ }
  location.reload()
}
// 使う人を消す(その人の記録・写真・録音・ボタンも全部)。1人目は消せない
export async function dropUserData(id) {
  if (id === 'main') throw new Error('1人目は消せません')
  if (id === USER_ID && dbp) { (await dbp).close(); dbp = null }   // 開いたままだと消せないので先に閉じる
  await new Promise((resolve, reject) => { const r = indexedDB.deleteDatabase(dbNameOf(id)); r.onsuccess = resolve; r.onerror = () => reject(r.error); r.onblocked = resolve })
  try { for (const k of Object.keys(localStorage)) if (k.endsWith(`.u-${id}`)) localStorage.removeItem(k) } catch { /* */ }
}
// 4けたの番号は、そのまま置かずにハッシュにして置く(のぞき見よけ。本当の鍵ではない)
export async function pinHash(id, pin) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`diary-pin:${id}:${pin}`))
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('')
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

// ---------- スマホの引っ越し(v0.20.1) ----------
// 人ごとの置き場をまるごと読み出す / 書き戻す。中身の形は app.js(引っ越し用ファイル)が決める。
// 同期の鍵(syncKey)は取り出せない形なので入れない。使う人の一覧(users)は別に扱う。
const SKIP_SETTINGS = new Set(['syncKey', 'users'])
const allOf = (db, store) => new Promise((resolve, reject) => {
  const r = db.transaction([store], 'readonly').objectStore(store).getAll()
  r.onsuccess = () => resolve(r.result || []); r.onerror = () => reject(r.error)
})
export async function dumpUser(id) {
  const same = id === USER_ID
  const db = same ? await open() : await openDb(dbNameOf(id))
  try {
    const settings = (await allOf(db, 'settings')).filter(s => !SKIP_SETTINGS.has(s.key) && !(typeof CryptoKey !== 'undefined' && s.value instanceof CryptoKey))
    return { entries: await allOf(db, 'entries'), photos: await allOf(db, 'photos'), audios: await allOf(db, 'audios'), settings }
  } finally { if (!same) db.close() }
}
// 今あるものは消さない: 記録は、ないか、ファイルのほうが新しければ入れる。写真・録音は、ないものだけ。
// 設定は、ないものだけ(この人の記録がまだ0件なら、ファイルの設定で入れ替える)
export async function restoreUser(id, d) {
  const same = id === USER_ID
  const db = same ? await open() : await openDb(dbNameOf(id))
  try {
    const have = new Map((await allOf(db, 'entries')).map(e => [e.id, e]))
    const fresh = have.size === 0
    const haveSet = new Set((await allOf(db, 'settings')).map(s => s.key))
    const haveP = new Set((await allOf(db, 'photos')).map(p => p.id))
    const haveA = new Set((await allOf(db, 'audios')).map(a => a.id))
    const n = { entries: 0, photos: 0, audios: 0 }
    await new Promise((resolve, reject) => {
      const t = db.transaction(['entries', 'photos', 'audios', 'settings'], 'readwrite')
      for (const e of d.entries || []) {
        const now = have.get(e.id)
        if (!now || (e.updated_at || e.at) > (now.updated_at || now.at)) { t.objectStore('entries').put(e); n.entries++ }
      }
      for (const p of d.photos || []) if (!haveP.has(p.id)) { t.objectStore('photos').put(p); n.photos++ }
      for (const a of d.audios || []) if (!haveA.has(a.id)) { t.objectStore('audios').put(a); n.audios++ }
      for (const s of d.settings || []) if (!SKIP_SETTINGS.has(s.key) && (fresh || !haveSet.has(s.key))) t.objectStore('settings').put(s)
      t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error)
    })
    return n
  } finally { if (!same) db.close() }
}
// 使う人の一覧が、この端末でまだ一度も保存されていないか(はじめての端末)
export async function usersSaved() { return !!(await baseSetting('users')) }
