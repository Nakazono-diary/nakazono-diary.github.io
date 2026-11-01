// 「今日の暦」の欄と、潮位表(気象庁のテキスト)の読み取り。
import { h, s } from './dom.js'
import { koyomi } from './koyomi.js'
import { KINENBI } from './kinenbi.js'

// ---------- 潮位表 ----------
// 気象庁「潮位表」のテキスト: 1行1日。1〜72桁 毎時潮位(3桁×24)、73〜78 年月日(2桁×3)、79〜80 地点記号、
// 81〜108 満潮(時刻4桁+潮位3桁)×4、109〜136 干潮×4。予測がないところは 9999 / 999。
export const PORTS = { OS: '大阪', KB: '神戸' }
export function parseTide(text) {
  const days = {}
  let code = ''
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '')
    if (line.length < 108) continue
    const n3 = (i) => Number(line.slice(i, i + 3))
    const hourly = []
    for (let k = 0; k < 24; k++) hourly.push(n3(k * 3))
    const yy = Number(line.slice(72, 74)), mm = Number(line.slice(74, 76)), dd = Number(line.slice(76, 78))
    if (!mm || !dd || hourly.some(x => !Number.isFinite(x))) continue
    code = line.slice(78, 80).trim()
    const pick = (from) => {
      const out = []
      for (let k = 0; k < 4; k++) {
        const i = from + k * 7
        const hh = line.slice(i, i + 2).trim(), mi = line.slice(i + 2, i + 4).trim(), cm = line.slice(i + 4, i + 7).trim()
        if (!hh || hh + mi === '9999' || cm === '999' || !mi) continue
        out.push([`${hh.padStart(2, '0')}:${mi.padStart(2, '0')}`, Number(cm)])
      }
      return out
    }
    const day = `${2000 + yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
    days[day] = { hourly, high: pick(80), low: line.length >= 136 ? pick(108) : [] }
  }
  if (!Object.keys(days).length) throw new Error('潮位表のファイルではないようです(気象庁の「潮位表」のテキストを選んでください)')
  return { code, days }
}

// 1日の潮位の線(毎時)
function tideGraph(d) {
  const W = 288, H = 64, P = 4
  const vals = d.hourly
  const lo = Math.min(...vals), hi = Math.max(...vals), span = Math.max(hi - lo, 1)
  const x = (i) => P + (W - 2 * P) * i / 23, y = (v) => H - P - (H - 2 * P) * (v - lo) / span
  const pts = vals.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const now = new Date()
  const nx = P + (W - 2 * P) * (now.getHours() + now.getMinutes() / 60) / 23
  return s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'tide-svg', role: 'img', 'aria-label': '今日の潮位の動き(毎時)' },
    s('polygon', { points: `${P},${H - P} ${pts} ${W - P},${H - P}`, class: 'tide-fill' }),
    s('polyline', { points: pts, class: 'tide-line' }),
    nx <= W - P ? s('line', { x1: nx, x2: nx, y1: P, y2: H - P, class: 'tide-now' }) : null,
    ...[0, 6, 12, 18].map(hh => s('text', { x: x(hh), y: H - 1, class: 'tide-tick' }, document.createTextNode(String(hh)))))
}

// ---------- 今日の暦 ----------
export function koyomiCard(ymd, tide, open, onToggle) {
  const k = koyomi(ymd)
  const lu = k.lunar
  const kyu = `旧暦 ${lu.leap ? '閏' : ''}${lu.month}月${lu.day}日`
  const what = [...(k.holiday ? [k.holiday] : []), ...k.events, ...(KINENBI[ymd.slice(5)] || [])].filter((x, i, a) => a.indexOf(x) === i)
  const sekki = k.sekki.today ? `今日は${k.sekki.today}` : `${k.sekki.current}${k.sekki.next ? `(${k.sekki.next.name}まであと${k.sekki.next.days}日)` : ''}`
  const td = tide && tide.days ? tide.days[ymd] : null

  const summary = h('div', { class: 'ky-sum' },
    h('span', { class: 'ky-big', text: k.rokuyo }),
    h('span', { text: kyu }),
    h('span', { text: `${k.moon.icon} ${k.shio}` }),
    k.holiday ? h('span', { class: 'ky-hol', text: k.holiday }) : null,
    k.sekki.today ? h('span', { class: 'ky-sekki', text: k.sekki.today }) : null,
    k.kichi.good.includes('天赦日') || k.kichi.good.includes('一粒万倍日') ? h('span', { class: 'ky-good', text: k.kichi.good.filter(x => x === '天赦日' || x === '一粒万倍日').join('・') }) : null)
  const row = (label, ...v) => h('div', { class: 'ky-row' }, h('span', { class: 'ky-label', text: label }), h('span', { class: 'ky-val' }, ...v))
  const tideRows = []
  if (td) {
    const f = (l) => l.map(([t, cm]) => `${t}(${cm}cm)`).join('・') || 'なし'
    tideRows.push(row('潮位', `${tide.name || tide.code} ・ 満潮 ${f(td.high)} ・ 干潮 ${f(td.low)}`), h('div', { class: 'ky-graph' }, tideGraph(td)))
  }
  const detail = h('div', { class: 'ky-detail' },
    row('六曜', `${k.rokuyo}(${kyu})`),
    row('節気', sekki),
    row('月', `${k.moon.icon} 月齢 ${k.moon.age}${k.moon.name ? ` ・ ${k.moon.name}` : ''} ・ 光っている部分 ${k.moon.lit}%`),
    row('潮回り', k.shio),
    ...tideRows,
    row('吉日', k.kichi.good.length ? k.kichi.good.join('・') : 'とくになし', k.kichi.bad.length ? h('span', { class: 'ky-bad', text: ` (注意: ${k.kichi.bad.join('・')})` }) : null),
    row('黄道', `${k.kichi.shin}(${k.kichi.koudou ? '黄道の日=吉' : '黒道の日'}) ・ 日の干支 ${k.kichi.kanshi}(${k.kichi.animal})`),
    row('星座', `${k.seiza.icon} ${k.seiza.name}(太陽がいる黄道十二星座)`),
    row('何の日', what.length ? what.join('・') : 'とくになし'),
  )
  detail.hidden = !open
  const firstWhat = what.length ? h('p', { class: 'ky-what', text: `今日は ${what.slice(0, 3).join('・')}${what.length > 3 ? ' ほか' : ''}` }) : null
  const btn = h('button', { type: 'button', class: 'ky-head', 'aria-expanded': open ? 'true' : 'false', onclick: () => {
    const o = detail.hidden; detail.hidden = !o; if (firstWhat) firstWhat.hidden = o
    btn.setAttribute('aria-expanded', o ? 'true' : 'false'); more.textContent = o ? 'たたむ' : 'くわしく'; onToggle(o) } },
  summary)
  const more = h('span', { class: 'ky-more', text: open ? 'たたむ' : 'くわしく' })
  btn.append(more)
  if (firstWhat) firstWhat.hidden = open
  return h('section', { class: 'koyomi', 'aria-label': '今日の暦' }, btn, firstWhat, detail)
}
