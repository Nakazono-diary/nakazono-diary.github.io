// 暦: 六曜・二十四節気・旧暦・月の満ち欠け・潮回り・祝日・吉日(黄道吉日など)・黄道十二星座。
// すべてスマホの中で計算する(よそには何も聞かない)。太陽と月の位置は Meeus『天文計算』の式。
// 精度: 節気・新月の時刻は数分ていど。日付の境目(日本時間 0 時)すれすれのときだけ、1日ずれることがある。

const RAD = Math.PI / 180
const sin = (d) => Math.sin(d * RAD)
const norm = (d) => ((d % 360) + 360) % 360
const JST = 9 / 24
const DT = 69 / 86400                    // 地球の回転の遅れ(TT-UT、約69秒)

// 日付 'YYYY-MM-DD' ⇔ 日の通し番号(ユリウス日の整数。日本の暦日)
export function dayNo(ymd) {
  const [y, m, d] = ymd.split('-').map(Number)
  const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045
}
export function ymdOf(n) {
  const a = n + 32044, b = Math.floor((4 * a + 3) / 146097), c = a - Math.floor(146097 * b / 4)
  const d = Math.floor((4 * c + 3) / 1461), e = c - Math.floor(1461 * d / 4), m = Math.floor((5 * e + 2) / 153)
  const day = e - Math.floor((153 * m + 2) / 5) + 1, mon = m + 3 - 12 * Math.floor(m / 10), yr = 100 * b + d - 4800 + Math.floor(m / 10)
  return `${yr}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}
// 日本時間でその日の 0 時のユリウス日(UT)
const jdAtJstMidnight = (n) => n - 0.5 - JST
// ユリウス日(UT)が、日本時間で何日か
const jstDayOf = (jd) => Math.floor(jd + 0.5 + JST)

// 太陽の見かけの黄経(度)。jd は UT
export function sunLon(jd) {
  const T = (jd + DT - 2451545) / 36525
  const L0 = 280.46646 + 36000.76983 * T + 0.0003032 * T * T
  const M = 357.52911 + 35999.05029 * T - 0.0001537 * T * T
  const C = (1.914602 - 0.004817 * T - 0.000014 * T * T) * sin(M) + (0.019993 - 0.000101 * T) * sin(2 * M) + 0.000289 * sin(3 * M)
  const om = 125.04 - 1934.136 * T
  return norm(L0 + C - 0.00569 - 0.00478 * sin(om))
}

// k 番目の新月のユリウス日(UT)。k=0 は 2000年1月6日ごろ
function newMoon(k) {
  const T = k / 1236.85, T2 = T * T, T3 = T2 * T, T4 = T3 * T
  let jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * T2 - 0.00000015 * T3 + 0.00000000073 * T4
  const E = 1 - 0.002516 * T - 0.0000074 * T2
  const M = 2.5534 + 29.1053567 * k - 0.0000014 * T2 - 0.00000011 * T3
  const Mp = 201.5643 + 385.81693528 * k + 0.0107582 * T2 + 0.00001238 * T3 - 0.000000058 * T4
  const F = 160.7108 + 390.67050284 * k - 0.0016118 * T2 - 0.00000227 * T3 + 0.000000011 * T4
  const Om = 124.7746 - 1.56375588 * k + 0.0020672 * T2 + 0.00000215 * T3
  jde += -0.4072 * sin(Mp) + 0.17241 * E * sin(M) + 0.01608 * sin(2 * Mp) + 0.01039 * sin(2 * F)
    + 0.00739 * E * sin(Mp - M) - 0.00514 * E * sin(Mp + M) + 0.00208 * E * E * sin(2 * M)
    - 0.00111 * sin(Mp - 2 * F) - 0.00057 * sin(Mp + 2 * F) + 0.00056 * E * sin(2 * Mp + M)
    - 0.00042 * sin(3 * Mp) + 0.00042 * E * sin(M + 2 * F) + 0.00038 * E * sin(M - 2 * F)
    - 0.00024 * E * sin(2 * Mp - M) - 0.00017 * sin(Om) - 0.00007 * sin(Mp + 2 * M)
    + 0.00004 * sin(2 * Mp - 2 * F) + 0.00004 * sin(3 * M) + 0.00003 * sin(Mp + M - 2 * F)
    + 0.00003 * sin(2 * Mp + 2 * F) - 0.00003 * sin(Mp + M + 2 * F) + 0.00003 * sin(Mp - M + 2 * F)
    - 0.00002 * sin(Mp - M - 2 * F) - 0.00002 * sin(3 * Mp + M) + 0.00002 * sin(4 * Mp)
  const A = [299.77 + 0.107408 * k - 0.009173 * T2, 251.88 + 0.016321 * k, 251.83 + 26.651886 * k, 349.42 + 36.412478 * k,
    84.66 + 18.206239 * k, 141.74 + 53.303771 * k, 207.14 + 2.453732 * k, 154.84 + 7.30686 * k, 34.52 + 27.261239 * k,
    207.19 + 0.121824 * k, 291.34 + 1.844379 * k, 161.72 + 24.198154 * k, 239.56 + 25.513099 * k, 331.55 + 3.592518 * k]
  const W = [325, 165, 164, 126, 110, 62, 60, 56, 47, 42, 40, 37, 35, 23]
  for (let i = 0; i < 14; i++) jde += W[i] * 1e-6 * sin(A[i])
  return jde - DT
}

// 日 n(日本の暦日)の前後の新月を、日の通し番号で並べる
function newMoonsAround(n) {
  const k0 = Math.floor((n - 2451550) / 29.530588861) - 15
  const out = []
  for (let k = k0; k <= k0 + 18; k++) out.push(jstDayOf(newMoon(k)))
  return out
}

// ---------- 旧暦 ----------
const cache = new Map()
export function lunar(n) {
  if (cache.has(n)) return cache.get(n)
  const nms = newMoonsAround(n)
  // 各月の「中気」(太陽が 30° の倍数を通る日)の有無で、月の番号と閏月を決める
  const months = []
  for (let i = 0; i + 1 < nms.length; i++) {
    const a = sunLon(jdAtJstMidnight(nms[i])), b0 = sunLon(jdAtJstMidnight(nms[i + 1]))
    const b = b0 < a ? b0 + 360 : b0
    const cross = Math.floor(b / 30) - Math.floor(a / 30)
    const num = cross >= 1 ? ((Math.floor(b / 30) % 12) + 1) % 12 + 1 : 0   // 中気 0°(春分)→2月、270°(冬至)→11月
    months.push({ start: nms[i], end: nms[i + 1], num, cross })
  }
  for (let i = 0; i < months.length; i++) {
    if (months[i].num === 0) { months[i].num = i ? months[i - 1].num : 1; months[i].leap = true }
  }
  const m = months.find(x => x.start <= n && n < x.end)
  const out = { month: m.num, day: n - m.start + 1, leap: !!m.leap, monthStart: m.start, monthLen: m.end - m.start }
  cache.set(n, out)
  return out
}

// ---------- 六曜 ----------
const ROKUYO = ['大安', '赤口', '先勝', '友引', '先負', '仏滅']
export const rokuyo = (lu) => ROKUYO[(lu.month + lu.day) % 6]

// ---------- 二十四節気 ----------
const SEKKI = ['春分', '清明', '穀雨', '立夏', '小満', '芒種', '夏至', '小暑', '大暑', '立秋', '処暑', '白露',
  '秋分', '寒露', '霜降', '立冬', '小雪', '大雪', '冬至', '小寒', '大寒', '立春', '雨水', '啓蟄']
// 日 n に太陽が通る 15° の区切り(あれば番号)
function termOnDay(n) {
  const a = sunLon(jdAtJstMidnight(n)), b0 = sunLon(jdAtJstMidnight(n + 1))
  const b = b0 < a ? b0 + 360 : b0
  if (Math.floor(b / 15) !== Math.floor(a / 15)) return Math.floor(b / 15) % 24
  return -1
}
export function sekki(n) {
  const t = termOnDay(n)
  // いまの節気(直前の区切り)と、次の区切り
  const lon = sunLon(jdAtJstMidnight(n + 1))
  const cur = SEKKI[Math.floor(lon / 15) % 24]
  let next = null
  for (let d = 1; d <= 17; d++) { const k = termOnDay(n + d); if (k >= 0) { next = { name: SEKKI[k], days: d }; break } }
  return { today: t >= 0 ? SEKKI[t] : null, current: cur, next }
}
// その年の、太陽が黄経 lon° を通る日(春分・秋分の日の計算に使う)
export function termDay(year, lon) {
  const n0 = dayNo(`${year}-03-20`) + Math.round(norm(lon) / 360 * 365.2422) - 4
  for (let n = n0; n < n0 + 9; n++) {
    const a = sunLon(jdAtJstMidnight(n)), b = sunLon(jdAtJstMidnight(n + 1))
    if (norm(lon - a) < norm(b - a)) return n
  }
  return null
}

// ---------- 干支 ----------
const KAN = '甲乙丙丁戊己庚辛壬癸'
const SHI = '子丑寅卯辰巳午未申酉戌亥'
const SHI_ANIMAL = ['ねずみ', 'うし', 'とら', 'うさぎ', 'たつ', 'へび', 'うま', 'ひつじ', 'さる', 'とり', 'いぬ', 'いのしし']
export const kanshiIndex = (n) => (((n + 49) % 60) + 60) % 60     // 0 = 甲子(2000-01-01 は 戊午 = 54)
export const kanshi = (i) => KAN[i % 10] + SHI[i % 12]

// 節月(立春から始まる月。0 = 寅月=1月 … 11 = 丑月=12月)。節に入った日から、その月
function setsuMonth(n) {
  const lon = sunLon(jdAtJstMidnight(n + 1))
  return Math.floor(norm(lon - 315) / 30)
}

// ---------- 吉日・黄道 ----------
// 黄道黒道(十二神)。青龍の位置: 寅申月=子、卯酉月=寅、辰戌月=辰、巳亥月=午、午子月=申、未丑月=戌
const SHIN = [['青龍', true], ['明堂', true], ['天刑', false], ['朱雀', false], ['金匱', true], ['天徳', true],
  ['白虎', false], ['玉堂', true], ['天牢', false], ['玄武', false], ['司命', true], ['勾陳', false]]
// 一粒万倍日(節月ごとの日の十二支)
const MANBAI = [['丑', '午'], ['寅', '酉'], ['子', '卯'], ['卯', '辰'], ['巳', '午'], ['酉', '午'],
  ['子', '未'], ['卯', '申'], ['午', '酉'], ['酉', '戌'], ['亥', '子'], ['子', '卯']]
// 天赦日(季節ごとの干支): 春 戊寅、夏 甲午、秋 戊申、冬 甲子
const TENSHA = ['戊寅', '甲午', '戊申', '甲子']
// 大明日(干支)
const DAIMYO = ['己巳', '庚午', '辛未', '壬申', '癸酉', '丁丑', '己卯', '壬午', '甲申', '丁亥', '壬辰', '乙未', '壬寅',
  '甲辰', '乙巳', '丙午', '丁未', '己酉', '庚戌', '辛亥', '丙辰', '戊午', '己未', '庚申', '辛酉']
// 不成就日(旧暦の月ごとの日)
const FUJOJU = { 1: 3, 7: 3, 2: 2, 8: 2, 3: 1, 9: 1, 4: 4, 10: 4, 5: 5, 11: 5, 6: 6, 12: 6 }

export function kichijitsu(n, lu) {
  const ki = kanshiIndex(n), ks = kanshi(ki), shi = SHI[ki % 12]
  const sm = setsuMonth(n)
  const goodStart = [0, 2, 4, 6, 8, 10][sm % 6]     // 青龍がいる十二支
  const shin = SHIN[(ki % 12 - goodStart + 12) % 12]
  const good = [], bad = []
  if (ks === TENSHA[Math.floor(sm / 3)]) good.push('天赦日')
  if (MANBAI[sm].includes(shi)) good.push('一粒万倍日')
  if (DAIMYO.includes(ks)) good.push('大明日')
  if (ks === '甲子') good.push('甲子の日')
  if (shi === '寅') good.push('寅の日')
  if (ks === '己巳') good.push('己巳の日'); else if (shi === '巳') good.push('巳の日')
  if ((lu.day - FUJOJU[lu.month]) % 8 === 0 && lu.day >= FUJOJU[lu.month]) bad.push('不成就日')
  return { kanshi: ks, animal: SHI_ANIMAL[ki % 12], shin: shin[0], koudou: shin[1], good, bad }
}

// ---------- 黄道十二星座(太陽がいる星座。占いで使う区切り) ----------
const SEIZA = ['おひつじ座', 'おうし座', 'ふたご座', 'かに座', 'しし座', 'おとめ座', 'てんびん座', 'さそり座', 'いて座', 'やぎ座', 'みずがめ座', 'うお座']
const SEIZA_ICON = ['♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓']
export function seiza(n) {
  const i = Math.floor(sunLon(jdAtJstMidnight(n) + 0.5) / 30) % 12
  return { name: SEIZA[i], icon: SEIZA_ICON[i] }
}

// ---------- 月の満ち欠け ----------
const SYN = 29.530588861
// jd(UT)の月齢
function ageAt(jd) {
  let k = Math.floor((jd - 2451550.1) / SYN) + 1
  while (newMoon(k) > jd) k--
  return jd - newMoon(k)
}
export function moon(n, lu) {
  const age = ageAt(jdAtJstMidnight(n) + 0.5)          // 正午の月齢
  const frac = (1 - Math.cos(2 * Math.PI * age / SYN)) / 2
  const ICON = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘']
  const icon = ICON[Math.floor((age + SYN / 16) / (SYN / 8)) % 8]
  // 新月・上弦・満月・下弦は、その瞬間がこの日(日本時間)にあるときだけ
  const a0 = ageAt(jdAtJstMidnight(n)), a1 = a0 + 1
  let name = ''
  if (lu.day === 1) name = '新月'
  else if (a0 <= SYN / 4 && SYN / 4 < a1) name = '上弦の月'
  else if (a0 <= SYN / 2 && SYN / 2 < a1) name = '満月'
  else if (a0 <= SYN * 3 / 4 && SYN * 3 / 4 < a1) name = '下弦の月'
  const NAME = { 3: '三日月', 13: '十三夜', 15: '十五夜', 16: '十六夜(いざよい)', 17: '立待月', 18: '居待月', 19: '寝待月', 20: '更待月' }
  if (NAME[lu.day]) name = name ? `${name}・${NAME[lu.day]}` : NAME[lu.day]
  return { age: Math.round(age * 10) / 10, icon, name, lit: Math.round(frac * 100) }
}

// ---------- 潮回り(旧暦の日から) ----------
export function shiomawari(lu) {
  const d = lu.day
  if ([30, 1, 2, 14, 15, 16, 17].includes(d)) return '大潮'
  if ([3, 4, 5, 6, 12, 13, 18, 19, 20, 21, 27, 28, 29].includes(d)) return '中潮'
  if ([7, 8, 9, 22, 23, 24].includes(d)) return '小潮'
  if (d === 10 || d === 25) return '長潮'
  if (d === 11 || d === 26) return '若潮'
  return ''
}

// ---------- 祝日(国民の祝日に関する法律。2020年より後の決まり) ----------
const nthMonday = (y, m, nth) => { const first = dayNo(`${y}-${String(m).padStart(2, '0')}-01`); const wd = (first + 1) % 7; return first + ((8 - wd) % 7) + (nth - 1) * 7 }
const yearCache = new Map()
function holidaysOf(y) {
  if (yearCache.has(y)) return yearCache.get(y)
  const f = (m, d) => dayNo(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  const map = new Map([
    [f(1, 1), '元日'], [nthMonday(y, 1, 2), '成人の日'], [f(2, 11), '建国記念の日'], [f(2, 23), '天皇誕生日'],
    [termDay(y, 0), '春分の日'], [f(4, 29), '昭和の日'], [f(5, 3), '憲法記念日'], [f(5, 4), 'みどりの日'], [f(5, 5), 'こどもの日'],
    [nthMonday(y, 7, 3), '海の日'], [f(8, 11), '山の日'], [nthMonday(y, 9, 3), '敬老の日'], [termDay(y, 180), '秋分の日'],
    [nthMonday(y, 10, 2), 'スポーツの日'], [f(11, 3), '文化の日'], [f(11, 23), '勤労感謝の日'],
  ])
  const base = [...map.keys()].sort((a, b) => a - b)
  // 国民の休日(祝日にはさまれた平日)
  for (let i = 0; i + 1 < base.length; i++) if (base[i + 1] - base[i] === 2 && (base[i] + 2) % 7 !== 0) map.set(base[i] + 1, '国民の休日')
  // 振替休日(祝日が日曜なら、次の祝日でない日)
  for (const d of base) if ((d + 1) % 7 === 0) { let x = d + 1; while (map.has(x)) x++; map.set(x, '振替休日') }
  yearCache.set(y, map)
  return map
}
export const holiday = (n) => holidaysOf(Number(ymdOf(n).slice(0, 4))).get(n) || null
// 曜日(0=日)
export const weekday = (n) => (n + 1) % 7


// ---------- 年で日付が変わる行事 ----------
const nthSunday = (y, m, nth) => { const first = dayNo(`${y}-${String(m).padStart(2, '0')}-01`); return first + ((7 - (first + 1) % 7) % 7) + (nth - 1) * 7 }
const evCache = new Map()
function eventsOf(y) {
  if (evCache.has(y)) return evCache.get(y)
  const map = new Map()
  const put = (n, name) => { if (n == null) return; map.set(n, [...(map.get(n) || []), name]) }
  const risshun = termDay(y - 1, 315)
  put(risshun - 1, '節分')
  put(risshun + 87, '八十八夜')
  put(risshun + 209, '二百十日')
  put(risshun + 219, '二百二十日')
  const shunbun = termDay(y, 0), shubun = termDay(y, 180)
  put(shunbun - 3, '春の彼岸入り'); put(shunbun, '彼岸の中日'); put(shunbun + 3, '春の彼岸明け')
  put(shubun - 3, '秋の彼岸入り'); put(shubun, '彼岸の中日'); put(shubun + 3, '秋の彼岸明け')
  put(termDay(y, 80), '入梅(暦の上の梅雨入り)')
  put(termDay(y, 100), '半夏生')
  // 夏の土用(太陽黄経 117° から立秋の前日まで)の丑の日
  const doyo = termDay(y, 117), rissyu = termDay(y, 135)
  put(doyo, '夏の土用入り')
  let no = 0
  for (let n = doyo; n < rissyu; n++) if (kanshiIndex(n) % 12 === 1) put(n, ++no === 1 ? '土用の丑の日' : '土用の丑の日(二の丑)')
  put(nthSunday(y, 5, 2), '母の日')
  put(nthSunday(y, 6, 3), '父の日')
  // 中秋の名月(旧暦8月15日)と十三夜(旧暦9月13日)
  for (let n = dayNo(`${y}-08-20`); n < dayNo(`${y}-11-10`); n++) {
    const lu = lunar(n)
    if (!lu.leap && lu.month === 8 && lu.day === 15) put(n, '中秋の名月(十五夜)')
    if (!lu.leap && lu.month === 9 && lu.day === 13) put(n, '十三夜(後の月)')
  }
  evCache.set(y, map)
  return map
}
export const events = (n) => eventsOf(Number(ymdOf(n).slice(0, 4))).get(n) || []

// ---------- まとめて ----------
export function koyomi(ymd) {
  const n = dayNo(ymd)
  const lu = lunar(n)
  return {
    lunar: lu, rokuyo: rokuyo(lu), sekki: sekki(n), moon: moon(n, lu), shio: shiomawari(lu),
    holiday: holiday(n), kichi: kichijitsu(n, lu), seiza: seiza(n), events: events(n),
  }
}
