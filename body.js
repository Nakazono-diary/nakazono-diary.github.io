// 体調・お通じ・天気・録音の入力欄と、カードに出す文字。
// どれもスマホの中だけ。病気かどうかの判断はしない(数字をそのまま記録するだけ)。
import { h } from './dom.js'

// ---------- 体調 ----------
export const MOODS = [
  { v: 1, icon: '😫', label: 'つらい' }, { v: 2, icon: '😟', label: 'いまいち' }, { v: 3, icon: '😐', label: 'ふつう' },
  { v: 4, icon: '🙂', label: 'よい' }, { v: 5, icon: '😄', label: 'とてもよい' },
]
export const SLEEP_Q = [{ v: 1, label: '浅い' }, { v: 2, label: 'ふつう' }, { v: 3, label: 'ぐっすり' }]
export const BOWEL = [{ v: 'hard', label: 'かたい' }, { v: 'normal', label: 'ふつう' }, { v: 'soft', label: 'やわらかい' }]
export const DEFAULT_SYMPTOMS = ['頭痛', '肩こり', '腰痛', 'せき', '鼻水', 'のどの痛み', '胃もたれ', 'だるい', 'めまい', '眠い']

const num = (v) => { const x = Number(String(v).replace(/[０-９．]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).trim()); return String(v).trim() !== '' && Number.isFinite(x) ? x : null }
const BOWEL_BY = Object.fromEntries(BOWEL.map(b => [b.v, b.label]))

// ひとつ選ぶボタン群(もう一度押すと外す)
function choice(items, value, onChange, cls = 'chip') {
  let cur = value ?? null
  const box = h('div', { class: 'chips', role: 'group' })
  const paint = () => box.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', items[i].v === cur ? 'true' : 'false'))
  for (const it of items) {
    box.append(h('button', { type: 'button', class: cls, title: it.label, onclick: () => { cur = cur === it.v ? null : it.v; paint(); onChange(cur) } },
      it.icon ? h('span', { class: 'chip-icon', 'aria-hidden': 'true', text: it.icon }) : null, h('span', { text: it.label })))
  }
  paint()
  return box
}

// 「−」「＋」で動かす数字の欄。空のときに押すと、前回の値(なければ目安の値)から始める。長押しで速く進む
function stepper(label, unit, value, { step = 1, start, min = -Infinity, max = Infinity, last }, onChange) {
  const dec = String(step).includes('.') ? String(step).split('.')[1].length : 0
  let cur = value ?? null
  const inp = h('input', { type: 'number', inputmode: 'decimal', step: String(step), class: 'input step-in', 'aria-label': label,
    placeholder: last != null ? String(last) : '' })
  const show = () => { inp.value = cur == null ? '' : cur.toFixed(dec) }
  const set = (x) => { cur = x == null ? null : Math.min(max, Math.max(min, Math.round(x / step) * step)); show(); onChange(cur == null ? null : Number(cur.toFixed(dec))) }
  inp.addEventListener('input', () => { cur = num(inp.value); onChange(cur) })
  inp.addEventListener('blur', show)
  const bump = (d) => set(cur == null ? (last ?? start) : cur + d * step)
  const btn = (d, text) => {
    const b = h('button', { type: 'button', class: 'step-btn', 'aria-label': `${label}を${d > 0 ? '上げる' : '下げる'}`, text })
    let t1 = null, t2 = null
    const stop = () => { clearTimeout(t1); clearInterval(t2); t1 = t2 = null }
    b.addEventListener('pointerdown', (ev) => { ev.preventDefault(); bump(d); t1 = setTimeout(() => { t2 = setInterval(() => bump(d), 70) }, 450) })
    for (const k of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(k, stop)
    b.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); bump(d) } })
    return b
  }
  show()
  return h('div', { class: 'step-field' },
    h('span', { class: 'num-label' }, label, last != null ? h('span', { class: 'step-last', text: ` 前回 ${last}${unit}` }) : null),
    h('div', { class: 'step-row' }, btn(-1, '−'), inp, h('span', { class: 'num-unit', text: unit }), btn(1, '＋'),
      h('button', { type: 'button', class: 'step-clear', 'aria-label': `${label}を空にする`, text: '×', onclick: () => set(null) })))
}

// 開いたり閉じたりできる項目。open を覚えておく(よく使う項目は、次から開いた状態で出す)
const OPEN_KEY = 'diary.bodyOpen'
const openSet = () => { try { return new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || '[]')) } catch { return new Set() } }
const keepOpen = (key, on) => { try { const s2 = openSet(); if (on) s2.add(key); else s2.delete(key); localStorage.setItem(OPEN_KEY, JSON.stringify([...s2])) } catch { /* */ } }
function sections(items) {
  // items: [{ key, label, el, filled }]
  const opened = openSet()
  const bar = h('div', { class: 'sec-bar', role: 'group', 'aria-label': '入れる項目' })
  const box = h('div', { class: 'sec-box' })
  for (const it of items) {
    const sec = h('div', { class: 'sec' }, it.el)
    sec.hidden = !(it.filled || opened.has(it.key))
    const b = h('button', { type: 'button', class: 'sec-chip', 'aria-pressed': sec.hidden ? 'false' : 'true', text: it.label, onclick: () => {
      sec.hidden = !sec.hidden; b.setAttribute('aria-pressed', sec.hidden ? 'false' : 'true'); keepOpen(it.key, !sec.hidden) } })
    bar.append(b); box.append(sec)
  }
  return h('div', {}, h('p', { class: 'sec-hint', text: '入れたい項目を押すと開きます(よく使う項目は、次から開いて出ます)' }), bar, box)
}

// 登録した名前から、いくつでも選ぶ(お薬・症状)。「＋」で登録を足す、「登録を直す」で消せる
function chipList({ names, selected, onChange, onNames, addLabel, placeholder }) {
  const sel = [...selected]
  let edit = false
  const box = h('div', {})
  const paint = () => {
    const all = [...names, ...sel.filter(x => !names.includes(x))]
    const chips = h('div', { class: 'chips' })
    for (const n of all) {
      if (edit && names.includes(n)) {
        chips.append(h('button', { type: 'button', class: 'chip del', 'aria-label': `「${n}」の登録を消す`, onclick: () => {
          names.splice(names.indexOf(n), 1); onNames([...names]); paint() } }, `${n} ×`))
      } else {
        chips.append(h('button', { type: 'button', class: 'chip', 'aria-pressed': sel.includes(n) ? 'true' : 'false', onclick: () => {
          const i = sel.indexOf(n); if (i >= 0) sel.splice(i, 1); else sel.push(n); onChange([...sel]); paint() } }, n))
      }
    }
    const inp = h('input', { class: 'input add-in', placeholder, maxlength: '20', 'aria-label': addLabel })
    const add = () => {
      const v = inp.value.trim(); if (!v) return
      if (!names.includes(v)) { names.push(v); onNames([...names]) }
      if (!sel.includes(v)) { sel.push(v); onChange([...sel]) }
      paint()
    }
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); add() } })
    box.replaceChildren(chips,
      h('div', { class: 'add-row' }, inp, h('button', { type: 'button', class: 'small-btn', text: '＋ 足す', onclick: add })),
      names.length ? h('button', { type: 'button', class: 'link-btn small', text: edit ? '直し終わる' : '登録を直す(消す)', onclick: () => { edit = !edit; paint() } }) : null)
  }
  paint()
  return box
}

// 体調の入力欄。lists = { meds, symptoms, save(key, list) }、last = 前回の値
export function healthForm(value, lists, last = {}) {
  const v = { ...(value || {}) }
  v.meds = [...(v.meds || [])]; v.symptoms = [...(v.symptoms || [])]
  v.bowel = v.bowel ? { ...v.bowel } : {}
  const set = (k) => (x) => { if (x == null || x === '') delete v[k]; else v[k] = x }
  const has = (...ks) => ks.some(k => v[k] != null)
  const el = h('div', { class: 'hf' },
    h('div', {}, h('span', { class: 'ed-label', text: '気分' }), choice(MOODS, v.mood, set('mood'), 'chip mood')),
    h('div', { class: 'hf-bowel' }, h('span', { class: 'ed-label', text: 'お通じ' }),
      choice(BOWEL, v.bowel.type, (x) => { if (x == null) delete v.bowel.type; else v.bowel.type = x }),
      stepper('回数', '回', v.bowel.count, { step: 1, start: 1, min: 0, max: 20 }, (x) => { if (x == null) delete v.bowel.count; else v.bowel.count = x })),
    sections([
      { key: 'temp', label: '🌡️ 体温', filled: has('temp'), el: stepper('体温', '℃', v.temp, { step: 0.1, start: 36.5, min: 34, max: 42, last: last.temp }, set('temp')) },
      { key: 'bp', label: '🩸 血圧・脈拍', filled: has('bpHi', 'bpLo', 'pulse'), el: h('div', { class: 'step-group' },
        stepper('血圧 上', '', v.bpHi, { step: 1, start: 120, min: 50, max: 250, last: last.bpHi }, set('bpHi')),
        stepper('血圧 下', '', v.bpLo, { step: 1, start: 80, min: 30, max: 150, last: last.bpLo }, set('bpLo')),
        stepper('脈拍', '回/分', v.pulse, { step: 1, start: 70, min: 30, max: 200, last: last.pulse }, set('pulse'))) },
      { key: 'weight', label: '⚖️ 体重', filled: has('weight'), el: stepper('体重', 'kg', v.weight, { step: 0.1, start: 60, min: 20, max: 200, last: last.weight }, set('weight')) },
      { key: 'sleep', label: '😴 睡眠', filled: has('sleepH', 'sleepQ'), el: h('div', { class: 'step-group' },
        stepper('睡眠', '時間', v.sleepH, { step: 0.5, start: 7, min: 0, max: 24, last: last.sleepH }, set('sleepH')),
        h('div', {}, h('span', { class: 'num-label', text: '眠りの深さ' }), choice(SLEEP_Q, v.sleepQ, set('sleepQ')))) },
      { key: 'meds', label: '💊 お薬', filled: v.meds.length > 0, el: h('div', {}, h('span', { class: 'num-label', text: 'お薬(飲んだものを押す)' }),
        chipList({ names: lists.meds, selected: v.meds, onChange: (l) => { v.meds = l }, onNames: (l) => lists.save('meds', l), addLabel: 'お薬を登録', placeholder: 'お薬の名前を登録' })) },
      { key: 'symptoms', label: '🤧 気になること', filled: v.symptoms.length > 0, el: h('div', {}, h('span', { class: 'num-label', text: '気になること' }),
        chipList({ names: lists.symptoms, selected: v.symptoms, onChange: (l) => { v.symptoms = l }, onNames: (l) => lists.save('symptoms', l), addLabel: '気になることを登録', placeholder: '例: 目のかすみ' })) },
    ]),
  )
  const get = () => {
    const out = {}
    for (const k of ['mood', 'temp', 'weight', 'bpHi', 'bpLo', 'pulse', 'sleepH', 'sleepQ']) if (v[k] != null) out[k] = v[k]
    if (v.meds.length) out.meds = v.meds
    if (v.symptoms.length) out.symptoms = v.symptoms
    if (v.bowel.count != null || v.bowel.type) out.bowel = { ...v.bowel }
    return Object.keys(out).length ? out : null
  }
  return { el, get }
}

// カードに出す体調(入れたものだけ)
export function healthLines(x) {
  if (!x) return []
  const a = []
  const m = MOODS.find(o => o.v === x.mood)
  if (m) a.push(`${m.icon} ${m.label}`)
  if (x.temp != null) a.push(`🌡️ ${x.temp}℃`)
  if (x.bpHi != null || x.bpLo != null) a.push(`🩸 ${x.bpHi ?? '-'}/${x.bpLo ?? '-'}`)
  if (x.pulse != null) a.push(`💓 ${x.pulse}`)
  if (x.weight != null) a.push(`⚖️ ${x.weight}kg`)
  if (x.sleepH != null || x.sleepQ) a.push(`😴 ${x.sleepH != null ? `${x.sleepH}時間` : ''}${x.sleepQ ? `(${SLEEP_Q.find(o => o.v === x.sleepQ).label})` : ''}`)
  const lines = []
  if (a.length) lines.push(a.join(' ・ '))
  if (x.meds && x.meds.length) lines.push(`💊 ${x.meds.join('・')}`)
  if (x.symptoms && x.symptoms.length) lines.push(`気になること: ${x.symptoms.join('・')}`)
  if (x.bowel) lines.push(bowelText(x.bowel))
  return lines
}
export const bowelText = (b) => (b ? `🚽 お通じ${b.count != null ? ` ${b.count}回` : ''}${b.type ? ` ${BOWEL_BY[b.type] || ''}` : ''}` : '')

// お通じボタンの直後: かたさだけ選ぶ
export function bowelPicker(value, onChange) {
  return choice(BOWEL, value && value.type, (t) => onChange(t ? { type: t } : {}))
}

// ---------- 天気 ----------
export const SKY = [
  { v: 'sunny', icon: '☀️', label: '晴れ' }, { v: 'partly', icon: '🌤️', label: '晴れ時々くもり' }, { v: 'cloudy', icon: '☁️', label: 'くもり' },
  { v: 'rain', icon: '🌧️', label: '雨' }, { v: 'storm', icon: '⛈️', label: '雷雨' }, { v: 'snow', icon: '❄️', label: '雪' },
  { v: 'fog', icon: '🌫️', label: '霧' }, { v: 'wind', icon: '💨', label: '風が強い' },
]
export const FEEL = [
  { v: 5, icon: '🥵', label: '暑い' }, { v: 4, icon: '🌞', label: '暖かい' }, { v: 3, icon: '😊', label: 'ちょうどいい' },
  { v: 2, icon: '🍃', label: '涼しい' }, { v: 1, icon: '🥶', label: '寒い' },
]
const SKY_BY = Object.fromEntries(SKY.map(x => [x.v, x]))

export function weatherForm(value, last = {}) {
  const v = { ...(value || {}) }
  v.sky = [...(v.sky || [])]
  const set = (k) => (x) => { if (x == null) delete v[k]; else v[k] = x }
  // 空模様は押した順(晴れ → 雨 のように)
  const skyBox = h('div', { class: 'chips' })
  const order = h('p', { class: 'move-order' })
  const paintSky = () => {
    skyBox.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', v.sky.includes(b.dataset.v) ? 'true' : 'false'))
    order.textContent = v.sky.length ? v.sky.map(k => `${SKY_BY[k].icon} ${SKY_BY[k].label}`).join(' → ') : '押した順に並びます(晴れ → 雨 など)'
  }
  for (const it of SKY) skyBox.append(h('button', { type: 'button', class: 'chip', 'data-v': it.v, onclick: () => {
    const i = v.sky.indexOf(it.v); if (i >= 0) v.sky.splice(i, 1); else v.sky.push(it.v); paintSky() } },
  h('span', { class: 'chip-icon', 'aria-hidden': 'true', text: it.icon }), it.label))
  paintSky()
  const el = h('div', { class: 'hf' },
    h('div', {}, h('span', { class: 'ed-label', text: '空模様' }), skyBox, order),
    h('div', {}, h('span', { class: 'ed-label', text: '体感' }), choice(FEEL, v.feel, set('feel'), 'chip mood')),
    stepper('いまの気温', '℃', v.temp, { step: 0.5, start: 20, min: -30, max: 50, last: last.temp }, set('temp')),
    sections([
      { key: 'w-hilo', label: '🌡️ 最高・最低', filled: v.hi != null || v.lo != null, el: h('div', { class: 'step-group' },
        stepper('最高', '℃', v.hi, { step: 0.5, start: last.temp ?? 25, min: -30, max: 50, last: last.hi }, set('hi')),
        stepper('最低', '℃', v.lo, { step: 0.5, start: last.temp ?? 15, min: -30, max: 50, last: last.lo }, set('lo'))) },
      { key: 'w-hum', label: '💧 湿度', filled: v.hum != null, el: stepper('湿度', '%', v.hum, { step: 1, start: 50, min: 0, max: 100, last: last.hum }, set('hum')) },
    ]))
  const get = () => {
    const out = {}
    if (v.sky.length) out.sky = v.sky
    for (const k of ['temp', 'hum', 'hi', 'lo', 'feel']) if (v[k] != null) out[k] = v[k]
    return Object.keys(out).length ? out : null
  }
  return { el, get }
}
export function weatherText(w) {
  if (!w) return ''
  const a = []
  if (w.sky && w.sky.length) a.push(w.sky.filter(k => SKY_BY[k]).map(k => `${SKY_BY[k].icon} ${SKY_BY[k].label}`).join(' → '))
  if (w.temp != null) a.push(`${w.temp}℃`)
  if (w.hi != null || w.lo != null) a.push(`最高 ${w.hi ?? '-'}℃ / 最低 ${w.lo ?? '-'}℃`)
  if (w.hum != null) a.push(`湿度 ${w.hum}%`)
  const f = FEEL.find(o => o.v === w.feel)
  if (f) a.push(`体感 ${f.icon} ${f.label}`)
  return a.join(' ・ ')
}

// ---------- 録音(声はこのスマホの中だけ。文字起こしは、ミニPCに移ってから) ----------
export const fmtSec = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null
  for (const m of ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']) if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m
  return ''
}
// 録音ボタン。onDone(blob, mime, sec) で1本ずつ渡す
export function recorderButton(onDone, onMsg) {
  let rec = null, stream = null, chunks = [], t0 = 0, timer = null
  const label = h('span', { text: '録音する' })
  const time = h('span', { class: 'rec-time' })
  const btn = h('button', { type: 'button', class: 'rec-start' }, h('span', { class: 'rec-dot', 'aria-hidden': 'true' }), label, time)
  const stopAll = () => { clearInterval(timer); if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; btn.classList.remove('on'); label.textContent = '録音する'; time.textContent = '' }
  const start = async () => {
    const mime = pickMime()
    if (mime === null || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { onMsg('このブラウザでは録音できません'); return }
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) } catch { onMsg('マイクを使えませんでした(マイクの許可を確かめてください)'); return }
    chunks = []
    rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
    rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data) }
    rec.onstop = () => {
      const sec = (Date.now() - t0) / 1000
      const type = rec.mimeType || mime || 'audio/webm'
      stopAll()
      if (chunks.length) onDone(new Blob(chunks, { type }), type, Math.round(sec))
    }
    rec.start(1000)
    t0 = Date.now()
    btn.classList.add('on'); label.textContent = '止める'; time.textContent = '0:00'
    timer = setInterval(() => { time.textContent = fmtSec((Date.now() - t0) / 1000) }, 500)
    onMsg('')
  }
  btn.addEventListener('click', () => { if (rec && rec.state === 'recording') rec.stop(); else start() })
  return { el: btn, start, stop: () => { if (rec && rec.state === 'recording') rec.stop(); else stopAll() }, busy: () => !!(rec && rec.state === 'recording') }
}
