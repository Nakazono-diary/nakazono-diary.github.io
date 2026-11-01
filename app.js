// 日記・タイムライン: ボタンで記録、文章と写真を書き足す、今日のタイムラインに並ぶ。
// 記録はスマホの中だけ(store.js)。よそのサイトには何も送らない・何も読み込まない。
import { allEntries, askPersist, deleteEntry, deletePhoto, entriesOfDay, getEntry, getPhoto, getSetting, putEntry, putSetting, savePhoto } from './store.js'
import { blobToDataURL, shrinkPhoto } from './photo.js'

const VERSION = '0.5.0'

// ボタン: 3つのタブに分ける。並び・名前・絵・移動手段を聞くかは「ボタン設定」で本人が変えられる(settings の 'buttons')。
// kind は記録の種類の目印。いちど使ったら変えない(出社は v0.1 から 'arrive')。
const TABS = [{ key: 'flow', label: '1日の流れ' }, { key: 'do', label: 'すること' }, { key: 'errand', label: '用事' }]
const DEFAULT_BUTTONS = [
  { kind: 'wake', label: '起床', icon: '☀️', tab: 'flow' },
  { kind: 'leave', label: '出発', icon: '🚪', tab: 'flow', askMove: true },
  { kind: 'reach', label: '到着', icon: '📍', tab: 'flow' },
  { kind: 'arrive', label: '出社', icon: '🏢', tab: 'flow' },
  { kind: 'out', label: '退社', icon: '🌆', tab: 'flow', askMove: true },
  { kind: 'home', label: '帰宅', icon: '🏠', tab: 'flow' },
  { kind: 'sleep', label: '就寝', icon: '🌙', tab: 'flow' },
  { kind: 'meal', label: '食事', icon: '🍽️', tab: 'flow' },
  { kind: 'lunch', label: '昼休み', icon: '🍙', tab: 'do' },
  { kind: 'break', label: '休憩', icon: '☕', tab: 'do' },
  { kind: 'resume', label: '再開', icon: '▶️', tab: 'do' },
  { kind: 'read', label: '読書', icon: '📖', tab: 'do' },
  { kind: 'tv', label: 'テレビ', icon: '📺', tab: 'do' },
  { kind: 'game', label: 'ゲーム', icon: '🎮', tab: 'do' },
  { kind: 'hobby', label: '趣味', icon: '🎨', tab: 'do' },
  { kind: 'fitness', label: 'フィットネス', icon: '🏋️', tab: 'do' },
  { kind: 'hospital', label: '病院', icon: '🏥', tab: 'errand' },
  { kind: 'grave', label: 'お墓参り', icon: '🪦', tab: 'errand' },
  { kind: 'shopping', label: '買い物', icon: '🛒', tab: 'errand' },
  { kind: 'bank', label: '銀行', icon: '🏦', tab: 'errand' },
  { kind: 'cityhall', label: '役所', icon: '🏛️', tab: 'errand' },
  { kind: 'barber', label: '床屋', icon: '💈', tab: 'errand' },
]
// ボタンに選べる絵(端末の絵文字。よそから読み込まない)
const ICONS = ['⭐', '☀️', '🌙', '🚪', '📍', '🏢', '🌆', '🏠', '🍽️', '🍙', '☕', '▶️', '⏸️', '📖', '📺', '🎮', '🎨', '🏋️', '🧘', '🚶',
  '🏥', '💊', '🪦', '🙏', '⛩️', '🛒', '🏦', '🏛️', '💈', '✂️', '🎣', '⛳', '🎤', '🎬', '🎵', '🍺', '🍜', '🍰', '🐕', '🌱',
  '🧹', '🧺', '🚗', '⛽', '🔧', '💻', '📞', '✉️', '👪', '👶', '🎂', '🎁', '🏖️', '♨️', '🛏️', '🚿', '🪥', '💤', '📝', '❤️']

let BUTTONS = DEFAULT_BUTTONS.map(b => ({ ...b }))
async function loadButtons() {
  try {
    const v = await getSetting('buttons')
    if (v && Array.isArray(v.buttons) && v.buttons.length) BUTTONS = v.buttons
  } catch { /* なければ最初のまま */ }
}
async function saveButtons(list) {
  BUTTONS = list
  await putSetting('buttons', { buttons: list, updated_at: stamp(new Date()) })
}
const MEMO = { kind: 'memo', label: 'メモ', icon: '✏️' }
// 移動手段(いくつでも、押した順に並ぶ)
const MOVES = [
  { key: 'walk', label: '徒歩', icon: '🚶' }, { key: 'run', label: '走る', icon: '🏃' }, { key: 'swim', label: '泳ぐ', icon: '🏊' },
  { key: 'bike', label: '自転車', icon: '🚲' }, { key: 'moto', label: 'バイク', icon: '🛵' }, { key: 'car', label: '車', icon: '🚗' },
  { key: 'train', label: '電車', icon: '🚃' }, { key: 'subway', label: '地下鉄', icon: '🚇' }, { key: 'shinkansen', label: '新幹線', icon: '🚄' },
  { key: 'maglev', label: 'リニア', icon: '🚅' }, { key: 'bus', label: 'バス', icon: '🚌' }, { key: 'taxi', label: 'タクシー', icon: '🚕' },
  { key: 'ship', label: '船', icon: '⛴️' }, { key: 'plane', label: '飛行機', icon: '✈️' }, { key: 'other', label: 'その他', icon: '🧭' },
]
const MOVE_BY = Object.fromEntries(MOVES.map(m => [m.key, m]))
const movesOf = (e) => (Array.isArray(e.moves) ? e.moves.filter(k => MOVE_BY[k]) : [])
const movesText = (keys) => keys.map(k => `${MOVE_BY[k].icon} ${MOVE_BY[k].label}`).join(' → ')

// 移動手段のボタン群(押すと足す/外す。押した順に並ぶ)
function movePicker(selected, onChange) {
  const box = h('div', { class: 'moves', role: 'group', 'aria-label': '移動手段' })
  const order = h('p', { class: 'move-order' })
  const paint = () => {
    box.querySelectorAll('button').forEach(b => {
      const i = selected.indexOf(b.dataset.key)
      b.setAttribute('aria-pressed', i >= 0 ? 'true' : 'false')
      b.querySelector('.move-no').textContent = i >= 0 && selected.length > 1 ? String(i + 1) : ''
    })
    order.textContent = selected.length ? movesText(selected) : 'えらんでいません(なくても記録できます)'
  }
  for (const m of MOVES) {
    box.append(h('button', { type: 'button', class: 'move', 'data-key': m.key, onclick: () => {
      const i = selected.indexOf(m.key)
      if (i >= 0) selected.splice(i, 1); else selected.push(m.key)
      paint(); onChange && onChange(selected)
    } }, h('span', { class: 'move-no', 'aria-hidden': 'true' }), h('span', { 'aria-hidden': 'true', text: m.icon }), m.label))
  }
  paint()
  return h('div', {}, box, order)
}
// 記録の種類の見え方(消したボタンも、昔の記録のために最初の一覧から引けるようにする)
const kindInfo = (kind) => (kind === 'memo' ? MEMO : BUTTONS.find(b => b.kind === kind) || DEFAULT_BUTTONS.find(b => b.kind === kind))
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
  const k = { icon: e.icon || (kindInfo(e.kind) || {}).icon || '・' }
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
  if (movesOf(e).length) body.append(h('p', { class: 'tl-moves', text: movesText(movesOf(e)) }))
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
const TAB_KEY = 'diary.tab'
function currentTab() { try { return localStorage.getItem(TAB_KEY) || 'flow' } catch { return 'flow' } }
function buildButtons() {
  const tab = TABS.some(t => t.key === currentTab()) ? currentTab() : 'flow'
  const bar = $('#tabs')
  bar.replaceChildren(...TABS.map(t => h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': t.key === tab ? 'true' : 'false',
    text: t.label, onclick: () => { try { localStorage.setItem(TAB_KEY, t.key) } catch { /* */ } buildButtons() } })))
  const box = $('#buttons')
  const list = BUTTONS.filter(b => b.tab === tab)
  box.replaceChildren(...list.map(b => h('button', { type: 'button', class: 'rec-btn', onclick: () => quickRecord(b) },
    h('span', { class: 'rec-icon', 'aria-hidden': 'true', text: b.icon }),
    h('span', { class: 'rec-label' + (b.label.length > 5 ? ' long' : ''), text: b.label }))))
  if (!list.length) box.append(h('p', { class: 'muted no-btn', text: 'このタブにはボタンがありません。「ボタン設定」で足せます。' }))
}

let toastTimer = null
async function quickRecord(b) {
  const now = new Date()
  const ts = stamp(now)
  const e = { id: newId(), at: ts, day: dayOf(now), kind: b.kind, label: b.label, icon: b.icon, text: '', photos: [], created_at: ts, updated_at: ts }
  await putEntry(e)
  if (navigator.vibrate) navigator.vibrate(15)
  await render()
  showToast(`${hm(e.at)} 「${b.label}」を記録しました`, [
    { label: '書き足す', fn: () => { closeMovePick(); openEditor(e.id) } },
    { label: '取り消す', fn: async () => { closeMovePick(); await deleteEntry(e.id); render() } },
  ])
  if (b.askMove) openMovePick(e)
  else closeMovePick()
}

// 出発・退社を押した直後: 移動手段をその場で付ける(押すたびに保存)
function openMovePick(e) {
  const box = $('#movepick')
  const sel = []
  box.replaceChildren(
    h('div', { class: 'mp-top' }, h('strong', { text: `「${e.label}」の移動手段は?` }),
      h('button', { type: 'button', class: 'link-btn', text: '閉じる', onclick: closeMovePick })),
    movePicker(sel, async (keys) => {
      const now = await getEntry(e.id)
      if (!now) return
      await putEntry({ ...now, moves: [...keys], updated_at: stamp(new Date()) })
      render()
    }))
  box.hidden = false
}
function closeMovePick() { const box = $('#movepick'); box.hidden = true; box.replaceChildren() }

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
    moves: editing ? [...movesOf(editing)] : [],
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
  const kindBox = h('div', { class: 'kind-groups', role: 'group', 'aria-label': '種類' })
  const paintKinds = () => kindBox.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.kind === st.kind ? 'true' : 'false'))
  const kindBtn = (k) => h('button', { type: 'button', class: 'kind', 'data-kind': k.kind, onclick: () => { st.kind = k.kind; paintKinds(); keepDraft() } },
    h('span', { 'aria-hidden': 'true', text: k.icon }), k.label)
  const extra = editing && editing.kind !== 'memo' && !BUTTONS.some(b => b.kind === editing.kind)
    ? [kindBtn({ kind: editing.kind, label: editing.label, icon: editing.icon || (kindInfo(editing.kind) || {}).icon || '・' })] : []
  kindBox.append(h('div', { class: 'kinds' }, kindBtn(MEMO), ...extra))
  for (const t of TABS) {
    const list = BUTTONS.filter(b => b.tab === t.key)
    if (list.length) kindBox.append(h('p', { class: 'kind-tab', text: t.label }), h('div', { class: 'kinds' }, ...list.map(kindBtn)))
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
    const k = kindInfo(st.kind) || (editing && editing.kind === st.kind ? { kind: editing.kind, label: editing.label, icon: editing.icon } : MEMO)
    const text = ta.value.trim()
    if (st.kind === 'memo' && !text && !st.photos.length) { msg.textContent = '文章か写真を入れてください'; return }
    const ts = stamp(new Date())
    const t = st.timeIsNow ? hmsOf(new Date()) : `${timeIn.value || '00:00'}:00`
    const day = st.timeIsNow ? dayOf(new Date()) : (dayIn.value || today)
    const e = {
      ...(editing || {}), id: editing ? editing.id : newId(), at: `${day}T${t}`, day, kind: k.kind, label: k.label, icon: k.icon,
      text, photos: st.photos, moves: [...st.moves], created_at: editing ? editing.created_at || ts : ts, updated_at: ts,
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
      h('div', {}, h('span', { class: 'ed-label', text: '移動手段(いくつでも・押した順)' }), movePicker(st.moves)),
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
    const data = { app: 'diary', format: 2, version: VERSION, exported_at: stamp(new Date()), entries, photos, buttons: BUTTONS }
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
  const plan = { add: [], replace: [], same: 0, bad: 0, photos: 0, exported_at: data.exported_at || '', buttons: [], buttonsAll: null }
  // ボタン: こちらでまだ一度もボタンを変えていなければ(機種変更など)、ファイルの並びをそのまま使う。
  // 変えていれば、ファイルにあってこちらにないボタン(自分で足したボタンなど)だけ足す。
  if (Array.isArray(data.buttons)) {
    const ok = data.buttons.filter(b => b && typeof b.kind === 'string' && typeof b.label === 'string' && b.label.trim() && TABS.some(t => t.key === b.tab))
      .map(b => ({ kind: b.kind, label: b.label.trim().slice(0, 20), icon: typeof b.icon === 'string' ? b.icon.slice(0, 8) : '⭐', tab: b.tab, ...(b.askMove ? { askMove: true } : {}) }))
    const mine = await getSetting('buttons')
    if (!mine && ok.length) {
      if (JSON.stringify(ok) !== JSON.stringify(BUTTONS)) plan.buttonsAll = ok
    } else {
      plan.buttons = ok.filter(b => !BUTTONS.some(x => x.kind === b.kind))
    }
  }
  for (const raw of data.entries) {
    if (!raw || typeof raw.id !== 'string' || !AT_RE.test(raw.at || '') || typeof raw.label !== 'string') { plan.bad++; continue }
    const at = raw.at.length === 16 ? raw.at + ':00' : raw.at
    const e = { ...raw, at, day: at.slice(0, 10), kind: raw.kind || 'memo', text: textOf(raw), photos: Array.isArray(raw.photos) ? raw.photos.filter(p => typeof p === 'string') : [], moves: Array.isArray(raw.moves) ? raw.moves.filter(k => MOVE_BY[k]) : [] }
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
  if (plan.buttonsAll) { await saveButtons(plan.buttonsAll); buildButtons() }
  else if (plan.buttons.length) { await saveButtons([...BUTTONS, ...plan.buttons]); buildButtons() }
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
    const go = n || plan.buttons.length || plan.buttonsAll
    msg.textContent = ''
    const lines = [
      `ファイル: ${f.name}${plan.exported_at ? `(${plan.exported_at.slice(0, 16).replace('T', ' ')} に書き出したもの)` : ''}`,
      `新しく足す記録: ${plan.add.length}件`,
      plan.replace.length ? `こちらより新しいので入れ替える記録: ${plan.replace.length}件` : null,
      `すでにあるので、そのままにする記録: ${plan.same}件`,
      `新しく足す写真: ${plan.photos}枚`,
      plan.buttonsAll ? 'ボタン: ファイルの並び・名前に入れ替えます(まだボタンを変えていないため)' : null,
      plan.buttons.length ? `足すボタン: ${plan.buttons.map(b => b.label).join('・')}` : null,
      plan.bad ? `読めなかった記録: ${plan.bad}件(飛ばします)` : null,
    ].filter(Boolean)
    confirmBox.replaceChildren(
      h('ul', {}, ...lines.map(l => h('li', { text: l }))),
      go ? h('p', { class: 'hint', text: '今ある記録は消しません。' }) : h('p', { text: '足すものはありません。' }),
      h('div', { class: 'bk-row' },
        h('button', { type: 'button', class: 'secondary-btn', text: 'やめる', onclick: () => { confirmBox.hidden = true } }),
        go ? h('button', { type: 'button', class: 'primary-btn', text: n ? `${n}件を読み込む` : 'ボタンを読み込む', onclick: async (ev) => {
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

// ---------- ボタン設定(足す・名前と絵を変える・並べ替える・消す・移動手段を聞く) ----------
function openButtonSettings() {
  const sheet = $('#sheet')
  let list = BUTTONS.map(b => ({ ...b }))
  let pickFor = null          // 絵を選んでいるボタンの kind
  const msg = h('p', { class: 'ed-msg', 'aria-live': 'polite' })
  const body = h('div', { class: 'sheet-body' })
  const close = () => { sheet.hidden = true; sheet.replaceChildren(); document.body.classList.remove('no-scroll') }
  const move = (b, d) => {
    const same = list.filter(x => x.tab === b.tab)
    const i = same.indexOf(b), j = i + d
    if (j < 0 || j >= same.length) return
    const a = list.indexOf(same[i]), c = list.indexOf(same[j]);
    [list[a], list[c]] = [list[c], list[a]]
    paint()
  }
  const paint = () => {
    body.replaceChildren(h('p', { class: 'hint', text: 'ボタンの名前・絵・並びを変えられます。消しても、そのボタンで記録した分は残ります。最後に「保存する」を押してください。' }))
    for (const t of TABS) {
      const same = list.filter(b => b.tab === t.key)
      const sec = h('section', { class: 'bs-tab' }, h('h3', { text: t.label }))
      same.forEach((b, i) => {
        const name = h('input', { class: 'input bs-name', value: b.label, maxlength: '12', 'aria-label': `${b.label || '新しいボタン'}の名前` })
        name.addEventListener('input', () => { b.label = name.value })
        const ask = h('input', { type: 'checkbox' })
        ask.checked = !!b.askMove
        ask.addEventListener('change', () => { b.askMove = ask.checked })
        const tabSel = h('select', { class: 'input bs-tabsel', 'aria-label': 'タブを変える' }, ...TABS.map(x => h('option', { value: x.key, text: x.label })))
        tabSel.value = b.tab
        tabSel.addEventListener('change', () => { b.tab = tabSel.value; paint() })
        const row = h('div', { class: 'bs-row' },
          h('button', { type: 'button', class: 'bs-icon', 'aria-label': `${b.label}の絵を変える`, text: b.icon, onclick: () => { pickFor = pickFor === b.kind ? null : b.kind; paint() } }),
          name,
          h('div', { class: 'bs-ops' },
            h('button', { type: 'button', class: 'bs-op', 'aria-label': '上へ', text: '↑', disabled: i === 0, onclick: () => move(b, -1) }),
            h('button', { type: 'button', class: 'bs-op', 'aria-label': '下へ', text: '↓', disabled: i === same.length - 1, onclick: () => move(b, 1) }),
            h('button', { type: 'button', class: 'bs-op del', 'aria-label': `${b.label}を消す`, text: '消す', onclick: () => {
              if (!confirm(`「${b.label || '新しいボタン'}」を消しますか?(記録した分は残ります)`)) return
              list = list.filter(x => x !== b); paint() } })),
          h('div', { class: 'bs-sub' }, h('label', { class: 'bs-ask' }, ask, '押したら移動手段を聞く'), tabSel))
        sec.append(row)
        if (pickFor === b.kind) {
          sec.append(h('div', { class: 'icon-grid', role: 'group', 'aria-label': '絵を選ぶ' },
            ...ICONS.map(ic => h('button', { type: 'button', class: 'icon-pick', 'aria-pressed': ic === b.icon ? 'true' : 'false', text: ic,
              onclick: () => { b.icon = ic; pickFor = null; paint() } }))))
        }
      })
      sec.append(h('button', { type: 'button', class: 'secondary-btn bs-add', text: `＋ 「${t.label}」にボタンを足す`, onclick: () => {
        const nb = { kind: 'c-' + newId().slice(0, 8), label: '', icon: '⭐', tab: t.key }
        list.push(nb); pickFor = null; paint()
        // 足したボタンの名前の欄に、すぐ書けるようにする
        requestAnimationFrame(() => { const el = body.querySelectorAll('.bs-tab')[TABS.indexOf(t)].querySelectorAll('.bs-name'); el[el.length - 1].focus() })
      } }))
      body.append(sec)
    }
    body.append(h('button', { type: 'button', class: 'link-btn bs-reset', text: '最初のボタンに戻す', onclick: () => {
      if (!confirm('ボタンを最初の並びに戻しますか?(自分で足したボタンは消えます。記録は残ります)')) return
      list = DEFAULT_BUTTONS.map(b => ({ ...b })); paint() } }), msg)
  }
  const save = async () => {
    list.forEach(b => { b.label = (b.label || '').trim() })
    if (list.some(b => !b.label)) { msg.textContent = '名前が空のボタンがあります'; return }
    await saveButtons(list.map(b => ({ kind: b.kind, label: b.label, icon: b.icon, tab: b.tab, ...(b.askMove ? { askMove: true } : {}) })))
    buildButtons()
    close()
    showToast('ボタンを保存しました')
  }
  sheet.replaceChildren(h('div', { class: 'sheet-inner', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'ボタン設定' },
    h('div', { class: 'sheet-top' }, h('h2', { text: 'ボタン設定' }), h('button', { type: 'button', class: 'link-btn', text: '閉じる', onclick: close })),
    body,
    h('div', { class: 'sheet-foot' }, h('button', { type: 'button', class: 'primary-btn', text: '保存する', onclick: save }))))
  paint()
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
  await loadButtons()
  buildButtons()
  $('#write').addEventListener('click', () => { closeMovePick(); openEditor(null) })
  $('#btnset').addEventListener('click', () => { closeMovePick(); openButtonSettings() })
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
