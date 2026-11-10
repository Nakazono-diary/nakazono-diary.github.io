// グーグルドライブで同期する(v0.13)。
// ・中身はこの端末の中で暗号化してから送る(合言葉 → PBKDF2 → AES-GCM)。Google には鍵のかかった中身しか行かない。
// ・置き場はドライブの「アプリ専用の隠しフォルダ」(appDataFolder)。ドライブの画面には出ない。
// ・Google の部品(プログラム)は読み込まない。つなぐのは、ログインの画面(移動するだけ)と、ドライブの API だけ。
// ・鍵は「取り出せない形」(extractable: false)で、この端末の IndexedDB に覚える。合言葉そのものは覚えない。

import { USER_SUFFIX } from './store.js'

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata'
const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const MAIN = 'diary-main.v1.enc'           // 記録と設定(写真・録音の中身は別のファイル)
const blobName = (kind, id) => `${kind}-${id}.enc`   // kind: p = 写真、a = 録音
// Google のログインは使う人ごと(v0.19.2。ほかの人のドライブに書かないため)
const TOKEN_KEY = 'diary.gtoken' + USER_SUFFIX
const STATE_KEY = 'diary.gstate' + USER_SUFFIX
const ITER = 600000
const MAGIC = [0x44, 0x52, 0x59, 0x31]     // "DRY1"

// ---------- 暗号 ----------
const b64 = (u8) => btoa(String.fromCharCode(...u8))
const unb64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0))

export async function deriveKey(pass, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass.normalize('NFC')), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITER, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

async function gzip(bytes, on) {
  if (!on || typeof CompressionStream === 'undefined') return bytes
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer())
}
async function gunzip(bytes) {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())
}

// 形: "DRY1" + 1バイト(1 = gzip) + salt 16 + iv 12 + 暗号文
export async function seal(key, salt, bytes, compress = true) {
  const z = compress && typeof CompressionStream !== 'undefined'
  const plain = await gzip(bytes, z)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain))
  const out = new Uint8Array(4 + 1 + 16 + 12 + ct.length)
  out.set(MAGIC, 0); out[4] = z ? 1 : 0; out.set(salt, 5); out.set(iv, 21); out.set(ct, 33)
  return out
}
export function saltOf(buf) {
  const u = new Uint8Array(buf)
  if (u.length < 33 || MAGIC.some((m, i) => u[i] !== m)) throw new Error('同期のファイルの形が違います')
  return u.slice(5, 21)
}
export async function open(key, buf) {
  const u = new Uint8Array(buf)
  saltOf(u)
  let plain
  try { plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(21, 33) }, key, u.slice(33))) } catch { throw new Error('WRONG_PASS') }
  return u[4] === 1 ? gunzip(plain) : plain
}

// ---------- ログイン(Google の画面へ移動して、もどってくる。部品は読み込まない) ----------
export const redirectUri = () => location.origin + location.pathname
export function tokenNow() {
  try {
    const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null')
    return t && t.exp > Date.now() + 60000 ? t.token : null
  } catch { return null }
}
export function login(clientId) {
  const state = b64(crypto.getRandomValues(new Uint8Array(12))).replace(/[^A-Za-z0-9]/g, '')
  try { sessionStorage.setItem(STATE_KEY, state) } catch { /* */ }
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri(), response_type: 'token', scope: SCOPE, state, include_granted_scopes: 'false' })
  location.href = `https://accounts.google.com/o/oauth2/v2/auth?${q}`
}
// もどってきたとき: アドレスの # の後ろから通行証を取り出して、アドレスはきれいにする。同期のつづきをするなら true
export function takeRedirect() {
  if (!location.hash || !/access_token=|error=/.test(location.hash)) return null
  const p = new URLSearchParams(location.hash.slice(1))
  history.replaceState(null, '', location.pathname + location.search)
  let want = null
  try { want = sessionStorage.getItem(STATE_KEY); sessionStorage.removeItem(STATE_KEY) } catch { /* */ }
  if (p.get('error')) return { error: p.get('error') === 'access_denied' ? 'Google のログインがキャンセルされました' : `Google のログインができませんでした(${p.get('error')})` }
  if (!want || p.get('state') !== want) return { error: 'ログインのもどり方が正しくありません。もう一度「同期する」を押してください' }
  try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: p.get('access_token'), exp: Date.now() + (Number(p.get('expires_in')) || 3600) * 1000 })) } catch { /* */ }
  return { ok: true }
}
export function forgetToken() { try { sessionStorage.removeItem(TOKEN_KEY) } catch { /* */ } }

// ---------- ドライブ ----------
class AuthError extends Error {}
export { AuthError }
async function drive(token, url, opt = {}) {
  const res = await fetch(url, { ...opt, headers: { Authorization: `Bearer ${token}`, ...(opt.headers || {}) } })
  if (res.status === 401) { forgetToken(); throw new AuthError('ログインが切れました') }
  if (!res.ok) throw new Error(`ドライブとのやりとりができませんでした(${res.status})`)
  return res
}
export async function listFiles(token) {
  const files = []
  let page = ''
  do {
    const q = new URLSearchParams({ spaces: 'appDataFolder', fields: 'nextPageToken,files(id,name,modifiedTime,size)', pageSize: '1000', ...(page ? { pageToken: page } : {}) })
    const d = await (await drive(token, `${API}/files?${q}`)).json()
    files.push(...(d.files || []))
    page = d.nextPageToken || ''
  } while (page)
  return files
}
export async function download(token, id) {
  return new Uint8Array(await (await drive(token, `${API}/files/${id}?alt=media`)).arrayBuffer())
}
export async function upload(token, name, bytes, id) {
  if (id) {
    await drive(token, `${UPLOAD}/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes })
    return id
  }
  const boundary = 'diary' + Math.random().toString(36).slice(2)
  const meta = JSON.stringify({ name, parents: ['appDataFolder'] })
  const body = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
    bytes, `\r\n--${boundary}--`])
  const d = await (await drive(token, `${UPLOAD}/files?uploadType=multipart&fields=id`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body })).json()
  return d.id
}
export async function remove(token, id) { await drive(token, `${API}/files/${id}`, { method: 'DELETE' }) }

// ---------- 合わせ方 ----------
// 記録: 同じ id は updated_at が新しいほう。消した印(tombs: id → 消した時刻)が記録の updated_at より新しければ消す
export function mergeEntries(local, remote, tombsL, tombsR) {
  const tombs = { ...tombsL }
  for (const [id, t] of Object.entries(tombsR || {})) if (!tombs[id] || t > tombs[id]) tombs[id] = t
  const map = new Map()
  const ver = (e) => e.updated_at || e.created_at || e.at || ''
  for (const e of [...local, ...remote]) {
    const cur = map.get(e.id)
    if (!cur || ver(e) > ver(cur)) map.set(e.id, e)
  }
  const out = []
  for (const e of map.values()) if (!(tombs[e.id] && tombs[e.id] >= ver(e))) out.push(e)
  return { entries: out, tombs }
}
export { b64, unb64, MAIN, blobName }
