// 日記・タイムライン 第1段階: ボタンで記録して、今日のタイムラインに並ぶ。
// 記録はスマホの中だけ(store.js)。よそのサイトには何も送らない・何も読み込まない。
import { addEntry, allEntries, askPersist, deleteEntry, entriesOfDay } from './store.js'

const VERSION = '0.1.0'

// ボタン(仕様書 20 の案。あとで本人と最終版を決める)
const BUTTONS = [
  { kind: 'wake', label: '起床', icon: '☀️' },
  { kind: 'leave', label: '出発', icon: '🚪' },
  { kind: 'arrive', label: '出社', icon: '🏢' },
  { kind: 'lunch', label: '昼休み', icon: '🍙' },
  { kind: 'resume', label: '再開', icon: '▶️' },
  { kind: 'out', label: '退社', icon: '🌆' },
  { kind: 'home', label: '帰宅', icon: '🏠' },
  { kind: 'meal', label: '食事', icon: '🍽️' },
]
const BY_KIND = Object.fromEntries(BUTTONS.map(b => [b.kind, b]))
const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土']

const $ = (s) => document.querySelector(s)
const pad = (n) => String(n).padStart(2, '0')
const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const stamp = (d) => `${dayOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
const hm = (at) => at.slice(11, 16)
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)

let today = dayOf(new Date())

// ---------- 今日のタイムライン ----------
async function render() {
  today = dayOf(new Date())
  const d = new Date(today + 'T00:00:00')
  $('#date').textContent = `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAY[d.getDay()]})`
  const list = await entriesOfDay(today)
  const ul = $('#timeline')
  ul.innerHTML = ''
  $('#empty').hidden = list.length > 0
  $('#count').textContent = list.length ? `${list.length}件` : ''
  for (const e of list) {
    const b = BY_KIND[e.kind] || { icon: '・', label: e.label }
    const li = document.createElement('li')
    li.className = 'tl-item'
    li.innerHTML = `
      <span class="tl-time"></span>
      <span class="tl-dot" aria-hidden="true"></span>
      <span class="tl-body"><span class="tl-icon" aria-hidden="true"></span><span class="tl-label"></span>
        <span class="tl-tag">ボタン</span></span>
      <button type="button" class="tl-del" aria-label="">×</button>`
    li.querySelector('.tl-time').textContent = hm(e.at)
    li.querySelector('.tl-icon').textContent = b.icon
    li.querySelector('.tl-label').textContent = e.label
    const del = li.querySelector('.tl-del')
    del.setAttribute('aria-label', `${hm(e.at)} ${e.label} を消す`)
    del.onclick = async () => {
      if (!confirm(`${hm(e.at)} の「${e.label}」を消しますか?`)) return
      await deleteEntry(e.id)
      render()
    }
    ul.appendChild(li)
  }
  // 最新の記録が見えるように
  const last = ul.lastElementChild
  if (last && last.scrollIntoView) last.scrollIntoView({ block: 'nearest' })
}

// ---------- ボタン ----------
function buildButtons() {
  const box = $('#buttons')
  for (const b of BUTTONS) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'rec-btn'
    btn.innerHTML = `<span class="rec-icon" aria-hidden="true"></span><span class="rec-label"></span>`
    btn.querySelector('.rec-icon').textContent = b.icon
    btn.querySelector('.rec-label').textContent = b.label
    btn.onclick = () => record(b)
    box.appendChild(btn)
  }
}

let toastTimer = null
async function record(b) {
  const now = new Date()
  const e = { id: newId(), at: stamp(now), day: dayOf(now), kind: b.kind, label: b.label, note: null }
  await addEntry(e)
  if (navigator.vibrate) navigator.vibrate(15)
  await render()
  showToast(`${hm(e.at)} 「${b.label}」を記録しました`, async () => { await deleteEntry(e.id); render() })
}

function showToast(text, undo) {
  const t = $('#toast')
  t.querySelector('.toast-text').textContent = text
  const u = t.querySelector('.toast-undo')
  u.onclick = async () => { t.hidden = true; await undo() }
  t.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { t.hidden = true }, 5000)
}

// ---------- ファイルに書き出す(条件1: 最初から手で書き出せる) ----------
async function exportFile() {
  const entries = await allEntries()
  const data = { app: 'diary', format: 1, version: VERSION, exported_at: stamp(new Date()), entries }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `diary-${dayOf(new Date())}.json`
  document.body.appendChild(a)
  a.click()
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1000)
}

// ---------- iPhone: ホーム画面に入れていないときの案内 ----------
function isIOS() {
  const ua = navigator.userAgent || ''
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)   // iPadOS は Mac のふりをする
}
function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true
}
function checkInstall() {
  $('#ios-install').hidden = !(isIOS() && !isStandalone())
}

// ---------- 起動 ----------
async function main() {
  buildButtons()
  $('#export').onclick = exportFile
  $('#version').textContent = `v${VERSION}`
  checkInstall()
  await render()
  askPersist().then(ok => { $('#persist').textContent = ok ? '消されない設定' : '' })
  // 日付が変わったら、今日の表示に切り替える
  setInterval(() => { if (dayOf(new Date()) !== today) render() }, 60 * 1000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render() })
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* なくても動く */ })
  }
}

main().catch(err => {
  $('#error').hidden = false
  $('#error').textContent = `うまく動きませんでした: ${err && err.message ? err.message : err}`
})
