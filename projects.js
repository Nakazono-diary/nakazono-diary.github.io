// タスク管理とのつながり(件名リスト・件名ブリッジ)。この版(個人用)だけのファイル。
// 公開版(tools/make_public.py で作る)では、何もしない public/projects.js に入れかわる。
// 件名名と工程名だけを、タスク管理から一方通行で受け取る(日記からは何も送らない)。
import { getSetting, putSetting } from './store.js'
import { h } from './dom.js'

export const ENABLED = true
export const PICK_LABEL = '件名・工程(タスク管理の件名リストから)'
export const STATS_NOTE = ''   // v0.17.4 から勤務時間も統計に入れた(本人「勤務時間も入れて」)
const KENMEI = 'kenmei.v1.enc'   // 件名ブリッジが置く件名リスト。同じ合言葉・同じ salt で鍵をかけてある(v0.15)

// タスク管理から読み込んだ件名リスト(件名名と工程名だけ。一方通行で、こちらからは何も返さない)
let PROJECTS = { exported_at: '', projects: [] }
// 件名リストの中身を、名前と工程名だけにそろえる(ファイルからでも、件名ブリッジからでも)
export const cleanProjects = (list) => list.filter(p => p && typeof p.title === 'string' && p.title.trim())
  .map(p => ({ title: p.title.trim(), steps: Array.isArray(p.steps) ? p.steps.filter(x => typeof x === 'string' && x.trim()) : [] }))
export async function load() {
  try { const v = await getSetting('projects'); if (v && Array.isArray(v.projects)) PROJECTS = v } catch { /* なくても動く */ }
}
export const projectText = (pj) => (pj && pj.title ? `🏗️ ${pj.title}${pj.step ? ` ・ ${pj.step}` : ''}` : '')

// 件名と工程を選ぶ欄(2つのプルダウン)。value: { title, step } か null
export function projectPicker(value, onChange) {
  const cur = value ? { ...value } : { title: '', step: '' }
  const titles = PROJECTS.projects.map(p => p.title)
  if (cur.title && !titles.includes(cur.title)) titles.unshift(cur.title)   // 昔の件名(今のリストにない)も残す
  const tSel = h('select', { class: 'input pj-sel', 'aria-label': '件名' }, h('option', { value: '', text: '件名なし' }), ...titles.map(t => h('option', { value: t, text: t })))
  const sSel = h('select', { class: 'input pj-sel', 'aria-label': '工程' })
  const fillSteps = () => {
    const p = PROJECTS.projects.find(x => x.title === tSel.value)
    const steps = p ? [...p.steps] : []
    if (cur.step && !steps.includes(cur.step) && cur.title === tSel.value) steps.unshift(cur.step)
    sSel.replaceChildren(h('option', { value: '', text: '工程なし' }), ...steps.map(n => h('option', { value: n, text: n })))
    sSel.disabled = !tSel.value
  }
  tSel.value = cur.title; fillSteps(); sSel.value = cur.step || ''
  const emit = () => onChange(tSel.value ? { title: tSel.value, step: sSel.value || '' } : null)
  tSel.addEventListener('change', () => { fillSteps(); sSel.value = ''; emit() })
  sSel.addEventListener('change', emit)
  const note = PROJECTS.projects.length ? null
    : h('p', { class: 'hint', text: 'まだ件名リストがありません。タスク管理の「日記用に件名一覧を書き出す」のファイルを、「バックアップ」から読み込んでください。' })
  return h('div', { class: 'pj-pick' }, tSel, sSel, note)
}

// タスク管理の件名リスト(kenmei-日付.json)を読み込む。読み込むたびに入れ替える
export function namesCard() {
  const status = h('p')
  const msg = h('p', { class: 'bk-msg', 'aria-live': 'polite' })
  const paint = () => {
    const n = PROJECTS.projects.length
    status.textContent = n ? `いま入っている件名: ${n}件(${(PROJECTS.exported_at || '').slice(0, 10)} に書き出したもの)` : 'まだ読み込んでいません。'
  }
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', id: 'names-in', 'aria-label': '件名リストのファイルを選ぶ' })
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; fileIn.value = ''
    if (!f) return
    msg.className = 'bk-msg'
    try {
      const d = JSON.parse(await f.text())
      if (!d || d.app !== 'taskapp-names' || !Array.isArray(d.projects)) throw new Error('タスク管理の件名リストではないようです')
      const projects = cleanProjects(d.projects)
      PROJECTS = { exported_at: typeof d.exported_at === 'string' ? d.exported_at : '', projects }
      await putSetting('projects', PROJECTS)
      paint()
      msg.className = 'bk-msg ok'; msg.textContent = `件名 ${projects.length}件を読み込みました。`
    } catch (err) { msg.className = 'bk-msg err'; msg.textContent = err instanceof SyntaxError ? '読めないファイルでした' : (err.message || String(err)) }
  })
  paint()
  return h('section', { class: 'bk-card' },
    h('h3', { text: 'タスク管理の件名リスト' }),
    h('p', { text: 'タスク管理の「日記用に件名一覧を書き出す」でできたファイルを読み込むと、「作業」などで件名と工程を選べます。件名と工程の名前だけで、日記からタスク管理へは何も送りません。' }),
    status, fileIn, h('label', { class: 'secondary-btn as-btn', for: 'names-in', text: '件名リストを読み込む' }), msg)
}

export const data = () => PROJECTS

// 日記の書き出しファイルを読み込むところに、件名リストのファイルを入れたとき
export const otherFileMessage = (d) => (d && d.app === 'taskapp-names' ? 'これはタスク管理の件名リストです。下の「タスク管理の件名リスト」から読み込んでください' : '')

// 同期のとき: ドライブの設定にある件名リストと、件名ブリッジが置いた件名リストのうち、新しく書き出したほうを使う
export async function syncPull(rs, byName, download, open) {
  if (rs.projects && Array.isArray(rs.projects.projects) && (rs.projects.exported_at || '') > (PROJECTS.exported_at || '')) { PROJECTS = rs.projects; await putSetting('projects', PROJECTS) }
  let got = 0, note = ''
  const kf = byName.get(KENMEI)
  if (kf) {
    try {
      const d = JSON.parse(new TextDecoder().decode(await open(await download(kf.id))))
      if (d && d.app === 'taskapp-names' && Array.isArray(d.projects) && (d.exported_at || '') > (PROJECTS.exported_at || '')) {
        PROJECTS = { exported_at: d.exported_at || '', projects: cleanProjects(d.projects) }
        await putSetting('projects', PROJECTS); got = PROJECTS.projects.length
      }
    } catch (err) {
      if (err.message !== 'WRONG_PASS') throw err
      note = '件名ブリッジの件名リストが開けませんでした(合言葉を変えたときは、ブリッジの合言葉も入れ直してください)'
    }
  }
  return { got, note }
}
