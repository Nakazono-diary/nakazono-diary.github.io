// 日記・タイムライン: ボタンで記録、文章と写真を書き足す、今日のタイムラインに並ぶ。
// 記録はスマホの中だけ(store.js)。よそのサイトには何も送らない・何も読み込まない。
import { allEntries, askPersist, deleteEntry, deletePhoto, entriesOfDay, getEntry, getPhoto, putEntry, savePhoto } from './store.js'
import { blobToDataURL, shrinkPhoto } from './photo.js'

const VERSION = '0.3.0'

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
const MEMO = { kind: 'memo', label: 'メモ', icon: '✏️' }
const KINDS = [MEMO, ...BUTTONS]
const BY_KIND = Object.fromEntries(KINDS.map(b => [b.kind, b]))
const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土']
const DRAFT_KEY = 'diary.draft'

// ---------- 小道具 ----------
const $ = (s) => document.querySelector(s)
const pad = (n) => String(n).padStart(2, '0')
const dayOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const hmsOf = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
const stamp = (d) => `${dayOf(d)}T${hmsOf(d)}`
const hm = (at) => at.slice(11, 16)
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)
const textOf = (e) => e.text || e.note || ''
const photosOf = (e) => e.photos || []

// 要素を作る: h('div', { class: 'x', onclick: fn }, 子, 子…)
function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue
    if (k === 'class') el.className = v
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'text') el.textContent = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c))
  return el
}

const draft = {
  get() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') } catch { return null } },
  set(v) { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(v)) } catch { /* 取っておけなくても動く */ } },
  clear() { try { localStorage.removeItem(DRAFT_KEY) } catch { /* */ } },
}

// 写真の表示用 URL(使い終わったら放す)
const urls = new Set()
async function photoURL(id) {
  const p = await getPhoto(id)
  if (!p) return null
  const u = URL.createObjectURL(p.blob)
  urls.add(u)
  return u
}
function releaseURLs() { for (const u of urls) URL.revokeObjectURL(u); urls.clear() }

let today = dayOf(new Date())

// ---------- 今日のタイムライン ----------
async function render() {
  today = dayOf(new Date())
  const d = new Date(today + 'T00:00:00')
  $('#date').textContent = `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAY[d.getDay()]})`
  const list = await entriesOfDay(today)
  const nPhotos = list.reduce((a, e) => a + photosOf(e).length, 0)
  $('#count').textContent = list.length ? `記録 ${list.length}件${nPhotos ? ` ・ 写真 ${nPhotos}枚` : ''}` : ''
  $('#empty').hidden = list.length > 0
  releaseURLs()
  const ul = $('#timeline')
  ul.replaceChildren()
  for (const e of list) ul.append(await card(e))
  const last = ul.lastElementChild
  if (last && last.scrollIntoView) last.scrollIntoView({ block: 'nearest' })
}

async function card(e) {
  const k = BY_KIND[e.kind] || { icon: '・', label: e.label }
  const isMemo = e.kind === 'memo'
  const text = textOf(e)
  const body = h('div', { class: 'tl-body' + (isMemo ? ' memo' : '') },
    h('div', { class: 'tl-head' },
      h('span', { class: 'tl-tag' + (isMemo ? ' memo' : ''), text: isMemo ? 'メモ' : 'ボタン' }),
      h('span', { class: 'tl-icon', 'aria-hidden': 'true', text: k.icon }),
      h('span', { class: 'tl-label', text: e.label }),
      h('button', { type: 'button', class: 'tl-edit', 'aria-label': `${hm(e.at)} ${e.label} を直す`, text: '直す',
        onclick: (ev) => { ev.stopPropagation(); openEditor(e.id) } }),
    ))
  if (text) {
    const p = h('p', { class: 'tl-text clamp', text })
    body.append(p)
    // 長いときだけ「続きを読む」
    requestAnimationFrame(() => {
      if (p.scrollHeight > p.clientHeight + 2) {
        const more = h('button', { type: 'button', class: 'tl-more', text: '続きを読む',
          onclick: (ev) => { ev.stopPropagation(); p.classList.toggle('clamp'); more.textContent = p.classList.contains('clamp') ? '続きを読む' : 'たたむ' } })
        p.after(more)
      }
    })
  }
  if (photosOf(e).length) {
    const strip = h('div', { class: 'tl-photos' })
    for (const pid of photosOf(e)) {
      const u = await photoURL(pid)
      if (!u) continue
      strip.append(h('button', { type: 'button', class: 'thumb', 'aria-label': '写真を大きく見る',
        onclick: (ev) => { ev.stopPropagation(); viewPhoto(pid) } }, h('img', { src: u, alt: '', loading: 'lazy' })))
    }
    body.append(strip)
  }
  return h('li', { class: 'tl-item' },
    h('span', { class: 'tl-time', text: hm(e.at) }),
    h('span', { class: 'tl-dot' + (isMemo ? ' memo' : ''), 'aria-hidden': 'true' }),
    h('div', { class: 'tl-card', onclick: () => openEditor(e.id) }, body),
  )
}

// ---------- ボタンでいま記録 ----------
function buildButtons() {
  const box = $('#buttons')
  for (const b of BUTTONS) {
    box.append(h('button', { type: 'button', class: 'rec-btn', onclick: () => quickRecord(b) },
      h('span', { class: 'rec-icon', 'aria-hidden': 'true', text: b.icon }),
      h('span', { class: 'rec-label', text: b.label })))
  }
  $('#write').addEventListener('click', () => openEditor(null))
}

let toastTimer = null
async function quickRecord(b) {
  const now = new Date()
  const ts = stamp(now)
  const e = { id: newId(), at: ts, day: dayOf(now), kind: b.kind, label: b.label, text: '', photos: [], created_at: ts, updated_at: ts }
  await putEntry(e)
  if (navigator.vibrate) navigator.vibrate(15)
  await render()
  showToast(`${hm(e.at)} 「${b.label}」を記録しました`, [
    { label: '書き足す', fn: () => openEditor(e.id) },
    { label: '取り消す', fn: async () => { await deleteEntry(e.id); render() } },
  ])
}

function showToast(text, actions = []) {
  const t = $('#toast')
  t.replaceChildren(h('span', { class: 'toast-text', text }),
    ...actions.map(a => h('button', { type: 'button', class: 'toast-btn', text: a.label, onclick: async () => { t.hidden = true; await a.fn() } })))
  t.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { t.hidden = true }, 6000)
}

// ---------- 書く・直す(画面案の「記録を足す」) ----------
async function openEditor(id) {
  const editing = id ? await getEntry(id) : null
  const now = new Date()
  const saved = !editing ? draft.get() : null
  const st = {
    kind: editing ? editing.kind : (saved && saved.kind) || 'memo',
    day: editing ? editing.day : dayOf(now),
    time: editing ? editing.at.slice(11, 16) : `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    timeIsNow: !editing,
    text: editing ? textOf(editing) : (saved && saved.text) || '',
    photos: editing ? [...photosOf(editing)] : [],
  }
  const added = []      // この窓で足した写真(やめたら消す)
  const removed = []    // この窓で外した写真(保存したら消す)
  const sheet = $('#sheet')
  const close = async (commit) => {
    if (!commit) for (const pid of added) await deletePhoto(pid)
    sheet.hidden = true
    sheet.replaceChildren()
    document.body.classList.remove('no-scroll')
  }

  // 時刻
  const dayIn = h('input', { type: 'date', class: 'input', value: st.day, 'aria-label': '日付' })
  const timeIn = h('input', { type: 'time', class: 'input', value: st.time, 'aria-label': '時刻' })
  const nowTag = h('span', { class: 'now-tag', text: 'いま' })
  nowTag.hidden = !st.timeIsNow
  const onTime = () => { st.timeIsNow = false; nowTag.hidden = true }
  dayIn.addEventListener('change', onTime); timeIn.addEventListener('change', onTime)

  // 種類
  const kindBox = h('div', { class: 'kinds', role: 'group', 'aria-label': '種類' })
  const paintKinds = () => kindBox.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.kind === st.kind ? 'true' : 'false'))
  for (const k of KINDS) {
    const b = h('button', { type: 'button', class: 'kind', 'data-kind': k.kind, onclick: () => { st.kind = k.kind; paintKinds(); keepDraft() } },
      h('span', { 'aria-hidden': 'true', text: k.icon }), k.label)
    kindBox.append(b)
  }
  paintKinds()

  // 文章
  const ta = h('textarea', { class: 'input textarea', rows: '6', placeholder: 'ここに書きます(何行でも)', 'aria-label': '文章' })
  ta.value = st.text
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, window.innerHeight * 0.5) + 'px' }
  const keepDraft = () => { if (!editing) draft.set({ kind: st.kind, text: ta.value }) }
  ta.addEventListener('input', () => { grow(); keepDraft() })

  // 写真
  const strip = h('div', { class: 'ed-photos' })
  const msg = h('p', { class: 'ed-msg', 'aria-live': 'polite' })
  const paintPhotos = async () => {
    strip.replaceChildren()
    for (const pid of st.photos) {
      const u = await photoURL(pid)
      if (!u) continue
      strip.append(h('div', { class: 'ed-photo' },
        h('img', { src: u, alt: '' }),
        h('button', { type: 'button', class: 'ed-photo-x', 'aria-label': 'この写真を外す', text: '×',
          onclick: () => { st.photos = st.photos.filter(x => x !== pid); if (added.includes(pid)) { added.splice(added.indexOf(pid), 1); deletePhoto(pid) } else removed.push(pid); paintPhotos() } })))
    }
  }
  const fileIn = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'visually-hidden', id: 'photo-in', 'aria-label': '写真を選ぶ' })
  fileIn.addEventListener('change', async () => {
    const files = [...fileIn.files]
    fileIn.value = ''
    for (let i = 0; i < files.length; i++) {
      msg.textContent = `写真を入れています… ${i + 1}/${files.length}`
      try {
        const { blob, w, h: ph } = await shrinkPhoto(files[i])
        const p = await savePhoto({ id: newId(), blob, w, h: ph, created_at: stamp(new Date()) })
        st.photos.push(p.id); added.push(p.id)
      } catch (err) { msg.textContent = `入れられない写真がありました: ${err.message || err}` }
    }
    if (!msg.textContent.startsWith('入れられない')) msg.textContent = ''
    paintPhotos()
  })
  const addPhoto = h('label', { class: 'add-photo', for: 'photo-in' }, h('span', { 'aria-hidden': 'true', text: '📷' }), '写真を足す')

  // 保存
  const save = async () => {
    const k = BY_KIND[st.kind] || MEMO
    const text = ta.value.trim()
    if (st.kind === 'memo' && !text && !st.photos.length) { msg.textContent = '文章か写真を入れてください'; return }
    const ts = stamp(new Date())
    const t = st.timeIsNow ? hmsOf(new Date()) : `${timeIn.value || '00:00'}:00`
    const day = st.timeIsNow ? dayOf(new Date()) : (dayIn.value || today)
    const e = {
      ...(editing || {}), id: editing ? editing.id : newId(), at: `${day}T${t}`, day, kind: k.kind, label: k.label,
      text, photos: st.photos, created_at: editing ? editing.created_at || ts : ts, updated_at: ts,
    }
    delete e.note
    await putEntry(e)
    for (const pid of removed) await deletePhoto(pid)
    if (!editing) draft.clear()
    await close(true)
    await render()
    showToast(editing ? '直しました' : `${hm(e.at)} 「${e.label}」を記録しました`)
  }
  const remove = async () => {
    if (!confirm(`${hm(editing.at)} の「${editing.label}」を消しますか?(文章と写真も消えます)`)) return
    for (const pid of added) await deletePhoto(pid)
    await deleteEntry(editing.id)
    sheet.hidden = true; sheet.replaceChildren(); document.body.classList.remove('no-scroll')
    render()
  }

  sheet.replaceChildren(h('div', { class: 'sheet-inner', role: 'dialog', 'aria-modal': 'true', 'aria-label': editing ? '記録を直す' : '書く' },
    h('div', { class: 'sheet-top' },
      h('h2', { text: editing ? '記録を直す' : '書く' }),
      h('button', { type: 'button', class: 'link-btn', text: '閉じる', onclick: () => close(false) })),
    h('div', { class: 'sheet-body' },
      h('div', { class: 'ed-time' }, h('span', { class: 'ed-label', text: '時刻' }), dayIn, timeIn, nowTag),
      h('div', {}, h('span', { class: 'ed-label', text: '種類' }), kindBox),
      h('div', {}, h('span', { class: 'ed-label', text: '文章' }), ta,
        h('p', { class: 'hint', text: !editing && saved && saved.text ? '書きかけを戻しました。' : '書きかけは自動で取っておきます。' })),
      h('div', {}, h('span', { class: 'ed-label', text: '写真' }), strip, fileIn, addPhoto,
        h('p', { class: 'hint', text: '写真は小さくして、このスマホの中にしまいます(撮影場所の情報は消えます)。' })),
      msg),
    h('div', { class: 'sheet-foot' },
      editing ? h('button', { type: 'button', class: 'danger-btn', text: '消す', onclick: remove }) : null,
      h('button', { type: 'button', class: 'primary-btn', text: editing ? '保存する' : '記録する', onclick: save })),
  ))
  sheet.hidden = false
  document.body.classList.add('no-scroll')
  paintPhotos()
  requestAnimationFrame(grow)
  if (!editing) ta.focus()
}

// ---------- 写真を大きく見る ----------
async function viewPhoto(pid) {
  const u = await photoURL(pid)
  if (!u) return
  const v = $('#viewer')
  v.replaceChildren(h('img', { src: u, alt: '写真' }), h('button', { type: 'button', class: 'viewer-close', text: '閉じる' }))
  v.hidden = false
  v.onclick = () => { v.hidden = true; v.replaceChildren() }
}

// ---------- ファイルに書き出す(条件1: 最初から手で書き出せる。文章と写真も入れる) ----------
async function exportFile(btn) {
  if (btn) btn.disabled = true
  try {
    const entries = await allEntries()
    const photos = {}
    for (const e of entries) for (const pid of photosOf(e)) {
      const p = await getPhoto(pid)
      if (p) photos[pid] = { w: p.w, h: p.h, created_at: p.created_at, data: await blobToDataURL(p.blob) }
    }
    const data = { app: 'diary', format: 2, version: VERSION, exported_at: stamp(new Date()), entries, photos }
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' })
    const a = h('a', { href: URL.createObjectURL(blob), download: `diary-${dayOf(new Date())}.json` })
    document.body.append(a)
    a.click()
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1500)
    return { entries: entries.length, photos: Object.keys(photos).length }
  } finally { if (btn) btn.disabled = false }
}

// ---------- ファイルから読み込む(今ある記録は消さずに足す。同じ記録は新しいほうを残す) ----------
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

function dataURLToBlob(url) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url || '')
  if (!m || !m[2]) throw new Error('写真の形が違います')
  const bin = atob(m[3])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: m[1] || 'image/jpeg' })
}

// ファイルを読んで、何がどれだけ入るかを調べる(まだ入れない)
async function planImport(file) {
  let data
  try { data = JSON.parse(await file.text()) } catch { throw new Error('日記の書き出しファイルではないようです(読めませんでした)') }
  if (!data || data.app !== 'diary' || !Array.isArray(data.entries)) throw new Error('日記の書き出しファイルではないようです')
  const photos = data.photos && typeof data.photos === 'object' ? data.photos : {}
  const plan = { add: [], replace: [], same: 0, bad: 0, photos: 0, exported_at: data.exported_at || '' }
  for (const raw of data.entries) {
    if (!raw || typeof raw.id !== 'string' || !AT_RE.test(raw.at || '') || typeof raw.label !== 'string') { plan.bad++; continue }
    const at = raw.at.length === 16 ? raw.at + ':00' : raw.at
    const e = { ...raw, at, day: at.slice(0, 10), kind: raw.kind || 'memo', text: textOf(raw), photos: Array.isArray(raw.photos) ? raw.photos.filter(p => typeof p === 'string') : [] }
    delete e.note
    const now = await getEntry(e.id)
    if (!now) plan.add.push(e)
    else if ((e.updated_at || e.at) > (now.updated_at || now.at)) plan.replace.push(e)
    else plan.same++
  }
  for (const e of [...plan.add, ...plan.replace]) for (const pid of e.photos) if (photos[pid] && !(await getPhoto(pid))) plan.photos++
  plan.photoData = photos
  return plan
}

async function applyImport(plan) {
  let photos = 0
  for (const e of [...plan.add, ...plan.replace]) {
    const keep = []
    for (const pid of e.photos) {
      if (await getPhoto(pid)) { keep.push(pid); continue }
      const p = plan.photoData[pid]
      if (!p || !p.data) continue
      try {
        await savePhoto({ id: pid, blob: dataURLToBlob(p.data), w: p.w || 0, h: p.h || 0, created_at: p.created_at || e.at })
        keep.push(pid); photos++
      } catch { /* 読めない写真は飛ばす */ }
    }
    await putEntry({ ...e, photos: keep })
  }
  return photos
}

function openBackup() {
  const sheet = $('#sheet')
  const close = () => { sheet.hidden = true; sheet.replaceChildren(); document.body.classList.remove('no-scroll') }
  const msg = h('div', { class: 'bk-msg', 'aria-live': 'polite' })
  const expBtn = h('button', { type: 'button', class: 'primary-btn', text: 'ファイルに書き出す' })
  expBtn.addEventListener('click', async () => {
    msg.className = 'bk-msg'
    msg.textContent = '書き出しています…'
    try {
      const n = await exportFile(expBtn)
      msg.textContent = `記録 ${n.entries}件・写真 ${n.photos}枚を書き出しました。スマホの「ダウンロード」に入ります。`
    } catch (err) { msg.className = 'bk-msg err'; msg.textContent = `書き出せませんでした: ${err.message || err}` }
  })
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', id: 'import-in', 'aria-label': '読み込むファイルを選ぶ' })
  const confirmBox = h('div', { class: 'bk-confirm' })
  confirmBox.hidden = true
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]
    fileIn.value = ''
    confirmBox.hidden = true
    if (!f) return
    msg.className = 'bk-msg'
    msg.textContent = `「${f.name}」を調べています…`
    let plan
    try { plan = await planImport(f) } catch (err) { msg.className = 'bk-msg err'; msg.textContent = err.message || String(err); return }
    const n = plan.add.length + plan.replace.length
    msg.textContent = ''
    const lines = [
      `ファイル: ${f.name}${plan.exported_at ? `(${plan.exported_at.slice(0, 16).replace('T', ' ')} に書き出したもの)` : ''}`,
      `新しく足す記録: ${plan.add.length}件`,
      plan.replace.length ? `こちらより新しいので入れ替える記録: ${plan.replace.length}件` : null,
      `すでにあるので、そのままにする記録: ${plan.same}件`,
      `新しく足す写真: ${plan.photos}枚`,
      plan.bad ? `読めなかった記録: ${plan.bad}件(飛ばします)` : null,
    ].filter(Boolean)
    confirmBox.replaceChildren(
      h('ul', {}, ...lines.map(l => h('li', { text: l }))),
      n ? h('p', { class: 'hint', text: '今ある記録は消しません。' }) : h('p', { text: '足すものはありません。' }),
      h('div', { class: 'bk-row' },
        h('button', { type: 'button', class: 'secondary-btn', text: 'やめる', onclick: () => { confirmBox.hidden = true } }),
        n ? h('button', { type: 'button', class: 'primary-btn', text: `${n}件を読み込む`, onclick: async (ev) => {
          ev.currentTarget.disabled = true
          try {
            const ph = await applyImport(plan)
            confirmBox.hidden = true
            msg.className = 'bk-msg ok'
            msg.textContent = `読み込みました(記録 ${n}件・写真 ${ph}枚)。`
            render()
          } catch (err) { msg.className = 'bk-msg err'; msg.textContent = `読み込めませんでした: ${err.message || err}` }
        } }) : null))
    confirmBox.hidden = false
  })

  sheet.replaceChildren(h('div', { class: 'sheet-inner', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'バックアップ' },
    h('div', { class: 'sheet-top' }, h('h2', { text: 'バックアップ' }),
      h('button', { type: 'button', class: 'link-btn', text: '閉じる', onclick: close })),
    h('div', { class: 'sheet-body' },
      h('section', { class: 'bk-card' },
        h('h3', { text: 'ファイルに書き出す' }),
        h('p', { text: '記録を文章・写真ごと1つのファイル(.json)にします。ときどき書き出して、PC などに移しておくと安心です。' }),
        expBtn),
      h('section', { class: 'bk-card' },
        h('h3', { text: 'ファイルから読み込む' }),
        h('p', { text: '書き出したファイルから戻します。今ある記録は消さずに足します(機種変更のときなど)。' }),
        fileIn,
        h('label', { class: 'secondary-btn as-btn', for: 'import-in', text: 'ファイルを選ぶ' }),
        confirmBox),
      msg,
      h('section', { class: 'bk-note' },
        h('h3', { text: '記録はどこにある?' }),
        h('p', { text: 'このスマホのブラウザの中(この住所専用の保存場所)だけにあります。どこにも送っていません。' }),
        h('p', { text: 'ブラウザの「サイトのデータを削除」、アプリの削除、機種変更・初期化で消えます。その前に書き出してください。' })),
    )))
  sheet.hidden = false
  document.body.classList.add('no-scroll')
}

// ---------- iPhone: ホーム画面に入れていないときの案内 ----------
function isIOS() {
  const ua = navigator.userAgent || ''
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1)
}
function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true
}

// ---------- 起動 ----------
async function main() {
  buildButtons()
  $('#export').addEventListener('click', openBackup)
  $('#version').textContent = `v${VERSION}`
  $('#ios-install').hidden = !(isIOS() && !isStandalone())
  await render()
  askPersist().then(ok => { $('#persist').textContent = ok ? '・ 消されない設定' : '' })
  setInterval(() => { if (dayOf(new Date()) !== today && $('#sheet').hidden) render() }, 60 * 1000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden && $('#sheet').hidden) render() })
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* なくても動く */ })
  }
}

main().catch(err => {
  $('#error').hidden = false
  $('#error').textContent = `うまく動きませんでした: ${err && err.message ? err.message : err}`
})
