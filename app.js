// 日記・タイムライン: ボタンで記録、文章と写真を書き足す、今日のタイムラインに並ぶ。
// 記録はスマホの中だけ(store.js)。よそのサイトには何も送らない・何も読み込まない。
import * as S from './sync.js'
import * as ED from './edition.js'
import * as PJ from './projects.js'
import { TRY_MODE, USER_ID, USER_SUFFIX, listUsers, saveUsers, switchUser, dumpUser, restoreUser, usersSaved, dropUserData, pinHash, wipeTry, allEntries, askPersist, deleteAudio, deleteEntry, deletePhoto, entriesOfDay, getAudio, getEntry, getPhoto, getSetting, putEntry, putSetting, saveAudio, savePhoto } from './store.js'
import { blobToDataURL, shrinkPhoto } from './photo.js'
import { h } from './dom.js'
import { DEFAULT_SYMPTOMS, bowelPicker, bowelText, fmtSec, healthForm, healthLines, recorderButton, weatherForm, weatherText } from './body.js'
import { PORTS, koyomiCard, parseTide } from './koyomiView.js'
import { RADII, distance, fmtDist, matchPlace, measure } from './places.js'

const VERSION = '0.21.8'

// ボタン: 3つのタブに分ける。並び・名前・絵・移動手段を聞くかは「ボタン設定」で本人が変えられる(settings の 'buttons')。
// kind は記録の種類の目印。いちど使ったら変えない(出社は v0.1 から 'arrive')。
const BASE_TABS = [{ key: 'flow', label: '1日の流れ' }, { key: 'do', label: 'すること' }, { key: 'play', label: '遊び' }, { key: 'errand', label: '用事' }, { key: 'pet', label: 'ペット' }, { key: 'go', label: '外出・移動' }, { key: 'body', label: '体調・天気' }]
// v0.21.1 タブの設定(本人「タブの変更も入れよう」「(自分のタブ・ボタン設定にも)両方とも実装で」)。settings の tabs = [{ key, label, hidden }](並び順)。
// 名前を変える・隠す(hidden)・並べ替え・自分のタブ(key は t-…、MAX_OWN_TABS まで)。TABS はいつも全部のタブ(隠したものも)
const MAX_OWN_TABS = 3
let TABS = BASE_TABS.map(t => ({ ...t }))
function cleanTabs(a) {
  const out = []
  for (const t of Array.isArray(a) ? a : []) {
    if (!t || typeof t.key !== 'string' || out.some(x => x.key === t.key)) continue
    const base = BASE_TABS.find(b => b.key === t.key)
    if (!base && !/^t-[\w-]{1,40}$/.test(t.key)) continue
    const label = typeof t.label === 'string' && t.label.trim() ? t.label.trim().slice(0, 10) : (base ? base.label : '')
    if (!label) continue
    out.push({ key: t.key, label, ...(t.hidden ? { hidden: true } : {}) })
  }
  for (const b of BASE_TABS) if (!out.some(x => x.key === b.key)) out.push({ ...b })   // あとから増えたタブは最後に
  return out.filter((t, i) => BASE_TABS.some(b => b.key === t.key) || out.slice(0, i).filter(x => !BASE_TABS.some(b => b.key === x.key)).length < MAX_OWN_TABS)
}
async function saveTabs(list) { TABS = cleanTabs(list); await putSetting('tabs', TABS) }
const tabLabel = (key) => (TABS.find(t => t.key === key) || {}).label || ''
const DEFAULT_BUTTONS = [
  { kind: 'wake', label: '起床', icon: '☀️', tab: 'flow', askPlace: true },
  { kind: 'leave', label: '出発', icon: '🚪', tab: 'flow', askMove: true, askPlace: true, span: true },
  { kind: 'reach', label: '到着', icon: '📍', tab: 'flow', askPlace: true },
  { kind: 'arrive', label: '出社', icon: '🏢', tab: 'flow', askPlace: true, span: true },
  { kind: 'out', label: '退社', icon: '🌆', tab: 'flow', askMove: true, askPlace: true, span: true },
  { kind: 'home', label: '帰宅', icon: '🏠', tab: 'flow', askPlace: true },
  { kind: 'sleep', label: '就寝', icon: '🌙', tab: 'flow', span: true },
  { kind: 'meal', label: '食事', icon: '🍽️', tab: 'flow', span: true },
  { kind: 'bath', label: '入浴', icon: '🛁', tab: 'flow', span: true },   // v0.16(本人 2026-11-05「入浴がないね」)
  { kind: 'work', label: '作業', icon: '💻', tab: 'do', ...(PJ.ENABLED ? { askProject: true } : {}), span: true },
  { kind: 'lunch', label: '昼休み', icon: '🍙', tab: 'do', span: true },
  { kind: 'break', label: '休憩', icon: '☕', tab: 'do', span: true },
  { kind: 'resume', label: '再開', icon: '▶️', tab: 'do' },
  { kind: 'read', label: '読書', icon: '📖', tab: 'do', span: true },
  { kind: 'tv', label: 'テレビ', icon: '📺', tab: 'do', span: true },
  { kind: 'game', label: 'ゲーム', icon: '🎮', tab: 'do', span: true },
  { kind: 'hobby', label: '趣味', icon: '🎨', tab: 'do', span: true },
  { kind: 'fitness', label: 'フィットネス', icon: '🏋️', tab: 'do', span: true },
  { kind: 'hospital', label: '病院', icon: '🏥', tab: 'errand', askPlace: true, span: true },
  { kind: 'grave', label: 'お墓参り', icon: '🪦', tab: 'errand', askPlace: true, span: true },
  { kind: 'shopping', label: '買い物', icon: '🛒', tab: 'errand', askPlace: true, span: true },
  { kind: 'bank', label: '銀行', icon: '🏦', tab: 'errand', askPlace: true, span: true },
  { kind: 'cityhall', label: '役所', icon: '🏛️', tab: 'errand', askPlace: true, span: true },
  { kind: 'barber', label: '美容院・床屋', icon: '💇', tab: 'errand', askPlace: true, span: true },   // v0.19.3 本人「床屋だけはおかしい」(前は 💈 床屋)
  // v0.11: 外出(仕事の途中・昼食を買いに など。戻りで終わる)と、移動だけの記録(本人 2026-11-03)
  { kind: 'goout', label: '外出', icon: '🚶', tab: 'go', askPlace: true, span: true },
  { kind: 'back', label: '戻り', icon: '🔙', tab: 'go', askPlace: true },
  { kind: 'trip', label: '移動', icon: '🚃', tab: 'go', askMove: true, span: true },
  // v0.18: 遊び(本人「普通の人はもっと余暇を楽しんでるよね。遊び要素が何もなかった」)。askFun = 記録のカードで「楽しかった度」を聞く
  { kind: 'dineout', label: '外食', icon: '🍜', tab: 'play', askPlace: true, span: true, askFun: true },
  { kind: 'cafe', label: 'カフェ', icon: '🧋', tab: 'play', askPlace: true, span: true, askFun: true },
  { kind: 'movie', label: '映画', icon: '🎬', tab: 'play', askPlace: true, span: true, askFun: true },
  { kind: 'karaoke', label: 'カラオケ', icon: '🎤', tab: 'play', askPlace: true, span: true, askFun: true },
  { kind: 'stroll', label: '散歩', icon: '🌳', tab: 'play', askPlace: true, span: true, askFun: true },
  { kind: 'travel', label: '旅行', icon: '🧳', tab: 'play', askPlace: true, span: true, askFun: true },
  { kind: 'drinks', label: '飲み会', icon: '🍻', tab: 'play', askPlace: true, span: true, askFun: true },
  { kind: 'oshi', label: '推し活', icon: '💖', tab: 'play', span: true, askFun: true },
  { kind: 'watch', label: '観戦', icon: '🏟️', tab: 'play', askPlace: true, span: true, askFun: true },
  { kind: 'onsen', label: '温泉', icon: '♨️', tab: 'play', askPlace: true, span: true, askFun: true },
  // form: 押したら開く入力欄(health = 体調、bowel = お通じのかたさ、weather = 天気と気温)
  { kind: 'health', label: '体調', icon: '🩺', tab: 'body', form: 'health' },
  { kind: 'bowel', label: 'お通じ', icon: '🚽', tab: 'body', form: 'bowel' },
  { kind: 'weather', label: '天気', icon: '🌤️', tab: 'body', form: 'weather' },
]
const FORMS = ['health', 'bowel', 'weather', 'pethealth']
// v0.21.0 ボタンの色(本人「ボタンのカラーとかまで選べる」)。ボタンに color(下の key)。色そのものは style.css の .btn-c-<key>
const BTN_COLORS = [['red', '赤'], ['orange', 'だいだい'], ['yellow', '黄'], ['lime', '黄緑'], ['green', '緑'], ['teal', '青緑'],
  ['sky', '水色'], ['blue', '青'], ['purple', '紫'], ['pink', 'ピンク'], ['brown', '茶'], ['gray', '灰']].map(([key, label]) => ({ key, label }))
const colorCls = (b) => (b && BTN_COLORS.some(c => c.key === b.color) ? ` btn-c-${b.color}` : '')
// 時間の長さ(span: true のボタンは、押すと始まり、終わりを押すまで「続いているもの」になる)
// 組: このボタンを押すと、続いている〇〇を終える(就寝→起床 など)
const END_BY = { sleep: ['wake'], leave: ['reach', 'arrive', 'home'], out: ['reach', 'home'], arrive: ['out'], lunch: ['resume', 'out'], break: ['resume', 'out'],   // v0.19.6 本人「昼休みの押し忘れは退社で」
  goout: ['back', 'home'], trip: ['reach', 'arrive', 'home', 'back'], sail: ['portin', 'home'], launch: ['kikan'] }   // v0.21.3 出港 → 帰港
// 長さの呼び名(就寝の長さは「睡眠」など)
const SPAN_NAME = { sleep: '睡眠', leave: '移動', out: '移動', arrive: '勤務', goout: '外出', trip: '移動', sail: '出漁', launch: '宇宙滞在' }
// 記録の長さの呼び名。出社の組は押したときの呼び名(sname。v0.19.1 ひな形で「学校」「仕事」に変わるため)を使う
const spanNameOf = (e) => (e && e.sname) || SPAN_NAME[e.kind]
// v0.19.6 本人「出社と呼べるのは出社したときじゃないのかな」→ 出社・退社・出発(登校・下校・出勤・退勤・仕事始め)は「その瞬間」のボタン。
// カードと左の時刻は押した時刻だけ。続いているあいだは「勤務中・〇分」、終わったら長さ(勤務・移動)は終わらせた側のカードに出す。
// 就寝・食事・入浴・休憩・移動ボタンなど「していること」のボタンは今までどおり「〜」で長さを出す(本人「就寝は睡眠時間を計るうえでいい」)。
const MOMENT_KINDS = new Set(['arrive', 'out', 'leave', 'sail', 'launch'])
const isMoment = (e) => !!(e && e.span && MOMENT_KINDS.has(e.kind))
const ONGOING_WORD = { 勤務: '勤務中', 仕事: '仕事中', 学校: '学校にいます', 移動: '移動中', 出漁: '漁に出ています', 宇宙滞在: '宇宙にいます' }
const isMoveMoment = (e) => isMoment(e) && spanNameOf(e) === '移動'   // v0.19.7: 出発・退社のあとの移動は別の帯に
const ongoingWord = (e) => (isMoment(e) ? ONGOING_WORD[spanNameOf(e)] || `${spanNameOf(e)}中` : '続いています')
// 昼休み・休憩の時間(勤務の実働を出すため。render で今日と前の日の分を入れる)
let RESTS = []
const restMin = (a, b) => RESTS.reduce((m, r) => { const x = Math.max(new Date(a).getTime(), new Date(r.at).getTime()), y = Math.min(new Date(b).getTime(), new Date(r.end).getTime()); return y > x ? m + (y - x) / 60000 : m }, 0)
const fmtDur = (min) => { min = Math.max(0, Math.round(min)); const h2 = Math.floor(min / 60), m = min % 60; return h2 ? `${h2}時間${m ? `${m}分` : ''}` : `${m}分` }
const durMin = (a, b) => (new Date(b) - new Date(a)) / 60000
const ongoingOf = async () => (await allEntries()).filter(e => e.span && !e.end)
// ボタンに選べる絵(端末の絵文字。よそから読み込まない)
const ICONS = ['🎷', '🎸', '🎪', '🎶', '⛷️', '🚙', '🏍️', '🚴', '⛰️', '🤿', '🏊', '🐠', '🫧', '🧋', '🍻', '💖', '🏟️', '♨️', '🧳', '🌳', '🎡', '🎢', '🏖️', '⛺', '🎲', '🎯', '📷', '⭐', '☀️', '🌙', '🛁', '🚪', '📍', '🏢', '🌆', '🏠', '🍽️', '🍙', '☕', '▶️', '⏸️', '📖', '📺', '🎮', '🎨', '🏋️', '🧘', '🚶',
  '🏥', '💊', '🪦', '🙏', '⛩️', '🛒', '🏦', '🏛️', '💈', '✂️', '🎣', '⛳', '🎤', '🎬', '🎵', '🍺', '🍜', '🍰', '🐕', '🌱',
  '🧹', '🧺', '🚗', '⛽', '🔧', '💻', '📞', '✉️', '👪', '👶', '🎂', '🎁', '🏖️', '♨️', '🛏️', '🚿', '🪥', '💤', '📝', '❤️',
  '🩺', '🚽', '🌡️', '🤧', '🦷', '👓', '🌤️', '☔', '🎙️', '🌊', '🔙', '🚃', '🚌', '🚲',
  // v0.20.9 本人「私の子イヌじゃないけどなー」→ 動物をたくさん
  '🐈', '🐈‍⬛', '🐩', '🦮', '🐕‍🦺', '🐇', '🐹', '🐭', '🐿️', '🦔', '🐦', '🦜', '🐤', '🦉', '🐟', '🐡', '🐢', '🦎', '🐍', '🐸', '🐴', '🐓', '🐷', '🐑', '🐾', '🦴', '🥕', '🧶', '🎾']

let BUTTONS = DEFAULT_BUTTONS.map(b => ({ ...b }))
async function loadButtons() {
  try {
    const v = await getSetting('buttons')
    const pt = await getSetting('petType'); if (PET_TYPES.some(x => x.key === pt)) PET_TYPE = pt
    if (v && v.preset) { PRESET = v.preset; applyPresetNames() }
    if (v && Array.isArray(v.buttons) && v.buttons.length) {
      BUTTONS = v.buttons
      // あとから増えた最初のボタンを、いちどだけ足す(本人が消したら、もう足さない)
      const added = Array.isArray(v.added) ? v.added : []
      const news = ADDED_LATER.filter(k => !added.includes(k) && !BUTTONS.some(b => b.kind === k))
      if (news.length || ADDED_LATER.some(k => !added.includes(k))) {
        for (const k of news) {
          const d = DEFAULT_BUTTONS.find(b => b.kind === k)
          // 同じタブの最後に足す(タブにまだなければ、いちばん後ろ)
          let i = -1
          BUTTONS.forEach((b, j) => { if (b.tab === d.tab) i = j })
          BUTTONS.splice(i < 0 ? BUTTONS.length : i + 1, 0, { ...d })
        }
        await putSetting('buttons', { ...v, buttons: BUTTONS, added: [...new Set([...added, ...ADDED_LATER])] })
      }
      // v0.8: 場所を測るボタン(最初の並びで測るもの)を、いちどだけ決める。そのあとは本人の設定のまま
      const v3 = await getSetting('buttons')
      if (!v3.spanAdded) {
        const kinds = DEFAULT_BUTTONS.filter(b => b.span).map(b => b.kind)
        BUTTONS = BUTTONS.map(b => (kinds.includes(b.kind) ? { ...b, span: true } : b))
        await putSetting('buttons', { ...v3, buttons: BUTTONS, spanAdded: true })
      }
      const v2 = await getSetting('buttons')
      if (!v2.placeAdded) {
        const kinds = DEFAULT_BUTTONS.filter(b => b.askPlace).map(b => b.kind)
        BUTTONS = BUTTONS.map(b => (kinds.includes(b.kind) ? { ...b, askPlace: true } : b))
        await putSetting('buttons', { ...v2, buttons: BUTTONS, placeAdded: true })
      }
    }
  } catch { /* なければ最初のまま */ }
}
// v0.18.1: ボタンの候補(本人「設定に追加しておいて」「他にも候補があれば」)。最初の画面には出さず、ボタン設定の「候補から足す」で選ぶ
// place: false = 押しても場所を測らない(家でするもの)
const CANDIDATES = [
  { group: '🎉 定番(最初からあるもの)', items: [['dineout', '外食', '🍜'], ['cafe', 'カフェ', '🧋'], ['movie', '映画', '🎬'], ['karaoke', 'カラオケ', '🎤'], ['stroll', '散歩', '🌳'],
    ['travel', '旅行', '🧳'], ['drinks', '飲み会', '🍻'], ['oshi', '推し活', '💖', false], ['watch', '観戦', '🏟️'], ['onsen', '温泉', '♨️']] },
  { group: '🎵 音楽・観る', items: [['jazz', 'ジャズ', '🎷'], ['rock', 'ロック', '🎸'], ['live', 'ライブ', '🎶'], ['fes', 'フェス', '🎪'], ['classic', 'クラシック', '🎻'],
    ['theater', '観劇', '🎭'], ['museum', '美術館', '🖼️'], ['zoo', '動物園', '🦁'], ['aquarium', '水族館', '🐬'], ['themepark', '遊園地', '🎢'], ['keiba', '競馬', '🏇']] },
  { group: '🧳 おでかけ・旅', items: [['kaigai', '海外旅行', '🌏'], ['drive', 'ドライブ', '🚙'], ['touring', 'ツーリング', '🏍️'], ['cycling', 'サイクリング', '🚴'], ['camp', 'キャンプ', '⛺'],
    ['bbq', 'バーベキュー', '🍖'], ['picnic', 'ピクニック', '🧺'], ['tabearuki', '食べ歩き', '🍡'], ['jisha', '寺社めぐり', '⛩️'], ['hanami', '花見', '🌸'],
    ['momiji', '紅葉狩り', '🍁'], ['hanabi', '花火', '🎆'], ['matsuri', 'お祭り', '🏮'], ['kisei', '帰省', '🏡'], ['sauna', 'サウナ', '🧖']] },
  { group: '⛰️ 山・海・雪', items: [['hike', '登山', '⛰️'], ['fishing', '釣り', '🎣'], ['beach', '海水浴', '🏖️'], ['scuba', 'スキューバ', '🤿'], ['freedive', '素潜り', '🐠'],
    ['dive', '潜水', '🫧'], ['surf', 'サーフィン', '🏄'], ['canoe', 'カヌー', '🛶'], ['swimming', '水泳', '🏊'], ['ski', 'スキー', '⛷️'], ['snowboard', 'スノボ', '🏂']] },
  { group: '⚽ スポーツ', items: [['golf', 'ゴルフ', '⛳'], ['running', 'ランニング', '🏃'], ['tennis', 'テニス', '🎾'], ['baseball', '野球', '⚾'], ['soccer', 'サッカー', '⚽'],
    ['basket', 'バスケ', '🏀'], ['pingpong', '卓球', '🏓'], ['badminton', 'バドミントン', '🏸'], ['bowling', 'ボウリング', '🎳'], ['yoga', 'ヨガ', '🧘'], ['dance', 'ダンス', '💃']] },
  { group: '🏠 家で', items: [['cooking', '料理', '🍳', false], ['sweets', 'お菓子作り', '🧁', false], ['instrument', '楽器', '🎹', false], ['craft', '手芸', '🧶', false],
    ['garden', 'ガーデニング', '🌱', false], ['photo', '写真', '📷'], ['manga', 'マンガ', '📚', false], ['douga', '動画', '🎞️', false], ['boardgame', 'ボードゲーム', '🎲', false],
    ['mahjong', '麻雀', '🀄'], ['shogi', '将棋・囲碁', '♟️', false], ['nap', '昼寝', '😴', false]] },
  // v0.19.3 本人「美容院も」「女性目線ならネイル・まつエク・エステ」「家中心なら育児」→ 全部。最初の画面には出さず、ここから選んだ人だけ
  // play: false = 統計の「遊び」に数えない、fun: false = 楽しかった度を聞かない
  { group: '💅 身だしなみ', tab: 'errand', play: false, fun: false, items: [['hairsalon', '美容院', '💇'], ['barbershop', '床屋', '💈'], ['nail', 'ネイル', '💅'], ['matsuek', 'まつエク', '👁️'],
    ['esthe', 'エステ', '🧖‍♀️'], ['mayu', 'まゆ毛', '✨'], ['massage', 'マッサージ', '💆'], ['seitai', '整体', '🦴'], ['datsumo', '脱毛', '🪒']] },
  // v0.20.8 本人「ペット(動物家族)に対するボタンが乏しい」→ タブ「ペット」を増やす。mood = 押したあとに「ご機嫌」を聞くもの
  { group: '🐾 ペット', tab: 'pet', play: false, fun: false, mood: ['petwalk', 'petfood', 'petsnack', 'petplay', 'dogrun'], items: [['pethealth', '体調', '🩺', false, false], ['petwalk', 'お散歩', '🐕'], ['petfood', 'ごはん', '🥣', false, false],
    ['petsnack', 'おやつ', '🦴', false, false], ['petplay', 'あそぶ', '🎾', false], ['petbrush', 'お手入れ', '🪮', false], ['petnail', '爪切り', '✂️', false, false],
    ['pettoilet', 'トイレそうじ', '🧻', false, false], ['petshampoo', 'シャンプー', '🛁'], ['vet', '動物病院', '🏥'], ['petmeds', 'お薬', '💊', false, false],
    ['dogrun', 'ドッグラン', '🐕‍🦺'], ['pethotel', 'ペットホテル', '🏨', true, false]] },
  { group: '👶 子育て', tab: 'do', play: false, fun: false, items: [['childcare', '育児', '👶', false], ['junyu', '授乳', '🍼', false], ['omutsu', 'おむつ', '🧷', false, false],
    ['nekashi', '寝かしつけ', '💤', false], ['pickup', '送り迎え', '🚗']] },
].map(g => ({ group: g.group, tab: g.tab || 'play', mood: g.mood || [], play: g.play !== false, fun: g.fun !== false, items: g.items.map(([kind, label, icon, place, span]) => ({ kind, label, icon, place: place !== false, span: span !== false })) }))
// v0.20.7: 候補はまとまりごとに入るタブを決める(本人「前は遊びとか項目選択してて固定なようにしてなかった?」)。
// 遊びの候補 → 遊び、身だしなみ → 用事、子育て → すること。足したあとで「タブを変える」で移すのは自由
// v0.20.9: ペットの種類(本人「私の子イヌじゃないけどなーっていうのがあると思う」)。選んだ種類で、ペットのボタンの絵が変わる。
// 犬(とその他)のとき以外は、お散歩・ドッグランを候補に出さない(使いたい人はボタン設定で「＋ 新しいボタン」から)
const PET_TYPES = [['dog', '犬', '🐕'], ['cat', '猫', '🐈'], ['rabbit', 'うさぎ', '🐇'], ['hamster', 'ハムスター', '🐹'], ['bird', '小鳥', '🐦'],
  ['fish', '魚', '🐠'], ['turtle', 'カメ', '🐢'], ['reptile', 'は虫類', '🦎'], ['other', 'その他', '🐾']].map(([key, label, icon]) => ({ key, label, icon }))
let PET_TYPE = 'dog'
const PET_DOG_ONLY = ['petwalk', 'dogrun']
const PET_SNACK = { dog: '🦴', cat: '🐟', rabbit: '🥕', hamster: '🌻', bird: '🌾' }
function petIcon(kind, type, base) {
  const t = PET_TYPES.find(x => x.key === type) || PET_TYPES[0]
  if (kind === 'petplay') return t.icon
  if (kind === 'petwalk') return type === 'dog' ? '🦮' : t.icon
  if (kind === 'petsnack') return PET_SNACK[type] || '🍪'
  return base
}
const candItems = (g, type = PET_TYPE) => (g.tab !== 'pet' ? g.items
  : g.items.filter(x => type === 'dog' || type === 'other' || !PET_DOG_ONLY.includes(x.kind)).map(x => ({ ...x, icon: petIcon(x.kind, type, x.icon) })))
const candToButton = (g, x) => ({ kind: x.kind, label: x.label, icon: x.icon, tab: g.tab, ...(x.kind === 'pethealth' ? { form: 'pethealth' } : {}), ...(x.span ? { span: true } : {}), ...(g.fun ? { askFun: true } : {}), ...(x.place ? { askPlace: true } : {}), ...(g.mood.includes(x.kind) ? { askMood: true } : {}) })
// 統計の「遊び」に数える候補(身だしなみ・子育ては入れない)
const CAND_KINDS = CANDIDATES.filter(g => g.play).flatMap(g => g.items.map(x => x.kind))
// 1つのタブに置けるボタンの数(v0.18.4。本人「最大ボタン数決めないとね」)
const MAX_PER_TAB = 20
const PLAY_KINDS = ['dineout', 'cafe', 'movie', 'karaoke', 'stroll', 'travel', 'drinks', 'oshi', 'watch', 'onsen']
const ADDED_LATER = ['work', 'health', 'bowel', 'weather', 'goout', 'back', 'trip', 'bath', ...PLAY_KINDS]   // v0.6・v0.7・v0.11・v0.16・v0.18 で増えた最初のボタン

// ---------- ひな形(v0.19.1。本人「学生さんなら出社じゃないよな」「主婦さんならどうだろう」) ----------
// 最初に開いたときと、ボタン設定の「ひな形から選び直す」で選ぶ。選んだあとも1つずつ自由に直せる。
// kind は同じ意味のまま名前だけ変える(登校 = 出社の kind 'arrive')。なので昔の「出社」と新しい「登校」は統計では続けて数える。
// 記録には押したときの名前と絵が入っているので、ひな形を変えても昔の記録の見た目は変わらない。
const XB = {   // ひな形だけで使うボタン(DEFAULT_BUTTONS にないもの)
  class: { kind: 'class', label: '授業', icon: '📚', span: true },
  study: { kind: 'study', label: '勉強', icon: '✏️', span: true },
  club: { kind: 'club', label: '部活', icon: '⚽', span: true, askPlace: true },
  parttime: { kind: 'parttime', label: 'バイト', icon: '💼', span: true, askPlace: true },
  chores: { kind: 'chores', label: '家事', icon: '🧹', span: true },
  cooking: { kind: 'cooking', label: '料理', icon: '🍳', span: true },
  laundry: { kind: 'laundry', label: '洗濯', icon: '🧺', span: true },
  pickup: { kind: 'pickup', label: '送り迎え', icon: '🚗', span: true, askPlace: true },
  childcare: { kind: 'childcare', label: '育児', icon: '👶', span: true },   // v0.19.3 本人「家中心で忘れてはならないのが育児」
}
// v0.21.3 本人「第一次産業の人のためのボタンも」「あまりボタンを追加してもなんなので、最初のひな形選択で対応できるように」
// → 候補には入れず、ひな形「農業・漁業など」で選んだ種類のボタンだけ並べる(自分で作るの一覧にも出る)
const PB = Object.fromEntries([
  ['field', '畑仕事', '🧑‍🌾'], ['paddy', '田んぼ', '🌾'], ['sowing', '種まき', '🌱'], ['taue', '田植え', '🌿'], ['watering', '水やり', '💧'],
  ['kusakari', '草刈り', '🪴'], ['spray', '消毒', '🧴'], ['harvest', '収穫', '🧺'], ['senka', '選果', '🍊', false], ['shukka', '出荷', '📦', true, false],
  ['chokubai', '直売所', '🏪'], ['patrol', '見回り', '👀'],
  ['sail', '出港', '⚓'], ['gyo', '漁', '🐟'], ['netcare', '網の手入れ', '🕸️'], ['portin', '帰港', '🛳️', true, false], ['mizuage', '水揚げ', '🦀'],
  ['seri', 'せり', '🔔'], ['boatcare', '船の整備', '🔧'], ['yoshoku', '養殖の世話', '🦪'],
  ['feeding', 'えさやり', '🌾'], ['milking', '搾乳', '🥛'], ['barnclean', '畜舎のそうじ', '🧹'], ['graze', '放牧', '🐄'],
  // v0.21.7 本人「トラックの運転手・パイロット・警官・消防士や救命士は?」「宇宙飛行士とか(笑)」→ 職種のひな形だけで使うボタン
  ['tenko', '点呼', '📋', false, false], ['tsumikomi', '積み込み', '📦'], ['unten', '運転', '🚚'], ['nioroshi', '荷下ろし', '📥'], ['shachuhaku', '車中泊', '🛏️'],
  ['kyuyu', '給油', '⛽', true, false], ['sensha', '洗車', '🧽'],
  ['briefing', 'ブリーフィング', '🗺️', false], ['jomu', '乗務', '✈️'], ['stay', 'ステイ', '🏨'], ['sim', '訓練(シミュレーター)', '🕹️'], ['shintai', '身体検査', '🩺'],
  ['patrolcar', 'パトロール', '🚓'], ['ritsuban', '立番', '🧍'], ['jiken', '事件対応', '🚨'], ['shorui', '書類', '📝', false], ['kunren', '訓練', '🎯'],
  ['shutsudo', '火災出動', '🚒'], ['kyukyu', '救急出動', '🚑'], ['hansou', '病院へ搬送', '🏥'], ['tenken', '点検', '🔧', false], ['kamin', '仮眠', '😴', false],
  ['launch', '打ち上げ', '🚀', false], ['jikken', '実験', '🧪', false], ['spacefit', '運動', '🚴', false], ['eva', '船外活動', '👨‍🚀', false],
  ['koshin', '地球と交信', '📡', false], ['kikan', '帰還', '🪂', false, false],
  ['yamashigoto', '山仕事', '🌲'], ['bassai', '伐採', '🪓'], ['shokurin', '植林', '🌳'], ['shitakusa', '下草刈り', '🌿'], ['edauchi', '枝打ち', '✂️'], ['makiwari', '薪割り', '🪵'],
].map(([kind, label, icon, place, span]) => [kind, { kind, label, icon, ...(span !== false ? { span: true } : {}), ...(place !== false ? { askPlace: true } : {}) }]))
const PRIMARY = [
  { key: 'farm', icon: '🌾', label: '農業', desc: '畑・田んぼ・収穫・出荷', items: ['field', 'paddy', 'sowing', 'taue', 'watering', 'kusakari', 'spray', 'harvest', 'senka', 'shukka', 'chokubai', 'patrol'] },
  { key: 'fish', icon: '🐟', label: '漁業', desc: '出港・漁・帰港・水揚げ', items: ['sail', 'gyo', 'netcare', 'portin', 'mizuage', 'seri', 'boatcare', 'yoshoku'] },
  { key: 'stock', icon: '🐄', label: '畜産', desc: 'えさやり・搾乳・放牧', items: ['feeding', 'milking', 'barnclean', 'graze', 'patrol', 'shukka'] },
  { key: 'forest', icon: '🌲', label: '林業', desc: '山仕事・伐採・植林', items: ['yamashigoto', 'bassai', 'shokurin', 'shitakusa', 'edauchi', 'makiwari'] },
]
// 職種ごとのボタン(自分で作るの一覧の小見出し)
const JOB_GROUPS = [
  { icon: '🚚', label: '運転・配送', items: ['tenko', 'tsumikomi', 'unten', 'nioroshi', 'shachuhaku', 'kyuyu', 'sensha'] },
  { icon: '✈️', label: 'パイロット', items: ['briefing', 'jomu', 'stay', 'sim', 'shintai'] },
  { icon: '👮', label: '警察', items: ['patrolcar', 'ritsuban', 'jiken', 'shorui', 'kunren'] },
  { icon: '🚒', label: '消防・救急', items: ['shutsudo', 'kyukyu', 'hansou', 'kunren', 'tenken', 'kamin'] },
  { icon: '🚀', label: '宇宙飛行士', items: ['launch', 'jikken', 'spacefit', 'eva', 'koshin', 'kikan'] },
]
const pbtn = (kind, tab, over = {}) => ({ ...(DEFAULT_BUTTONS.find(b => b.kind === kind) || XB[kind] || PB[kind]), tab, ...over })
// どのひな形にも入れるもの(遊び・用事・外出・体調)
const PRESET_TAIL = () => DEFAULT_BUTTONS.filter(b => ['play', 'errand', 'go', 'body'].includes(b.tab)).map(b => ({ ...b }))
const flowOf = (...ks) => ks.map(k => (Array.isArray(k) ? pbtn(k[0], 'flow', k[1]) : pbtn(k, 'flow')))
const doOf = (...ks) => ks.map(k => (Array.isArray(k) ? pbtn(k[0], 'do', k[1]) : pbtn(k, 'do')))
const PRESETS = [
  { key: 'office', icon: '🏢', label: '会社員', desc: '出社・退社・昼休み', work: '勤務',
    make: () => DEFAULT_BUTTONS.map(b => ({ ...b })) },
  { key: 'student', icon: '🎒', label: '学生', desc: '登校・下校・授業・部活・バイト・勉強', work: '学校',
    make: () => [...flowOf('wake', 'leave', 'reach', ['arrive', { label: '登校', icon: '🏫' }], ['out', { label: '下校', icon: '🎒' }], 'home', 'sleep', 'meal', 'bath'),
      ...doOf('class', 'study', 'club', 'parttime', 'lunch', 'break', 'resume', 'read', 'game', 'hobby'), ...PRESET_TAIL()] },
  { key: 'home', icon: '🏠', label: '家のこと中心', desc: '家事・料理・洗濯・育児・送り迎え・買い物', work: '勤務',
    make: () => [...flowOf('wake', 'leave', 'reach', 'home', 'sleep', 'meal', 'bath'),
      ...doOf('chores', 'cooking', 'laundry', 'childcare', 'pickup', 'break', 'resume', 'read', 'tv', 'hobby', 'fitness'), ...PRESET_TAIL()] },
  { key: 'remote', icon: '💻', label: '在宅・フリーランス', desc: '仕事始め・仕事終わり・作業・休憩', work: '仕事',
    make: () => [...flowOf('wake', ['arrive', { label: '仕事始め', icon: '🧑‍💻', askPlace: false }], ['out', { label: '仕事終わり', icon: '🏁', askMove: false, askPlace: false, span: false }], 'leave', 'reach', 'home', 'sleep', 'meal', 'bath'),
      ...doOf('work', 'lunch', 'break', 'resume', 'read', 'tv', 'game', 'hobby', 'fitness'), ...PRESET_TAIL()] },
  { key: 'shift', icon: '🌙', label: 'シフト勤務', desc: '出勤・退勤(夜勤もそのまま続けて記録)', work: '勤務',
    make: () => DEFAULT_BUTTONS.map(b => (b.kind === 'arrive' ? { ...b, label: '出勤', icon: '⏰' } : b.kind === 'out' ? { ...b, label: '退勤', icon: '🌃' } : { ...b })) },
  { key: 'primary', icon: '🌾', label: '農業・漁業など', desc: '農業・漁業・畜産・林業から選ぶ', work: '仕事', pick: true,
    make: (picked = PRIMARY.map(x => x.key)) => [...flowOf('wake', 'leave', 'reach', 'home', 'sleep', 'meal', 'bath', 'lunch', 'break', 'resume'),
      ...doOf(...[...new Set(PRIMARY.filter(x => picked.includes(x.key)).flatMap(x => x.items))]), ...PRESET_TAIL()] },
  { key: 'driver', icon: '🚚', label: '運転・配送', desc: '点呼・積み込み・運転・荷下ろし・車中泊', work: '勤務',
    make: () => [...flowOf('wake', 'leave', 'reach', ['arrive', { label: '出勤', icon: '⏰' }], ['out', { label: '退勤', icon: '🌃' }], 'home', 'sleep', 'meal', 'bath'),
      ...doOf('tenko', 'tsumikomi', 'unten', 'nioroshi', 'break', 'resume', 'shachuhaku', 'kyuyu', 'sensha'), ...PRESET_TAIL()] },
  { key: 'pilot', icon: '✈️', label: 'パイロット', desc: 'ショーアップ・乗務・ステイ・訓練', work: '勤務',
    make: () => [...flowOf('wake', 'leave', 'reach', ['arrive', { label: 'ショーアップ', icon: '🧑‍✈️' }], ['out', { label: '退勤', icon: '🌃' }], 'home', 'sleep', 'meal', 'bath'),
      ...doOf('briefing', 'jomu', 'break', 'resume', 'stay', 'sim', 'shintai'), ...PRESET_TAIL()] },
  { key: 'police', icon: '👮', label: '警察', desc: '当番入り・当番明け・パトロール・事件対応', work: '当番',
    make: () => [...flowOf('wake', 'leave', 'reach', ['arrive', { label: '当番入り', icon: '👮' }], ['out', { label: '当番明け', icon: '🌅' }], 'home', 'sleep', 'meal', 'bath'),
      ...doOf('patrolcar', 'ritsuban', 'jiken', 'shorui', 'kunren', 'break', 'resume'), ...PRESET_TAIL()] },
  { key: 'fire', icon: '🚒', label: '消防・救急', desc: '当番入り・当番明け・出動・搬送・訓練', work: '当番',
    make: () => [...flowOf('wake', 'leave', 'reach', ['arrive', { label: '当番入り', icon: '🚒' }], ['out', { label: '当番明け', icon: '🌅' }], 'home', 'sleep', 'meal', 'bath'),
      ...doOf('shutsudo', 'kyukyu', 'hansou', 'kunren', 'tenken', 'kamin', 'break', 'resume'), ...PRESET_TAIL()] },
  { key: 'astro', icon: '🚀', label: '宇宙飛行士', desc: '打ち上げ・実験・船外活動・帰還(遊び心で)', work: '勤務',
    make: () => [...flowOf(['wake', { askPlace: false }], ['sleep', { label: '寝袋', icon: '🛌' }], 'meal'),
      ...doOf('launch', 'jikken', 'spacefit', 'eva', 'koshin', 'kikan', 'break', 'resume'), ...DEFAULT_BUTTONS.filter(b => b.tab === 'body').map(b => ({ ...b }))] },
  { key: 'custom', icon: '✏️', label: '自分で作る', desc: 'タブ・ボタン・色・並びまで、全部自分で決める', work: '勤務',
    make: () => [...flowOf('wake', 'leave', 'reach', 'home', 'sleep', 'meal', 'bath'), ...DEFAULT_BUTTONS.filter(b => b.tab === 'body').map(b => ({ ...b }))] },
]
let PRESET = 'office'
const presetOf = (k) => PRESETS.find(p => p.key === k) || PRESETS[0]
// 統計などで使う「出社〜退社」の呼び名(学生なら「学校」)
function applyPresetNames() { SPAN_NAME.arrive = presetOf(PRESET).work }
const workLabels = () => ({ a: (BUTTONS.find(b => b.kind === 'arrive') || {}).label || '出社', o: (BUTTONS.find(b => b.kind === 'out') || {}).label || '退社' })
// お薬・気になることの登録(本人が足す)、潮位表
const LISTS = {
  meds: [], symptoms: [...DEFAULT_SYMPTOMS],
  async save(key, list) { LISTS[key] = list; await putSetting(key, list) },
}
let TIDE = null
// 登録した場所 { id, name, addr, lat, lon, r(メートル) }
let PLACES = []
async function savePlaces(list) { PLACES = list; await putSetting('places', list) }
async function loadLists() {
  try {
    const pl = await getSetting('places'); if (Array.isArray(pl)) PLACES = pl
    const m = await getSetting('meds'); if (Array.isArray(m)) LISTS.meds = m
    const sy = await getSetting('symptoms'); if (Array.isArray(sy)) LISTS.symptoms = sy
    TIDE = await getSetting('tide')
    const w = cleanWiths(await getSetting('withs')); if (w.length) WITH_OPTS = w
    TABS = cleanTabs(await getSetting('tabs'))
  } catch { /* なくても動く */ }
}
// ボタンの見た目以外に持つもの(保存・読み込みで残す)
const btnExtra = (b) => ({ ...(b.span ? { span: true } : {}), ...(b.askPlace ? { askPlace: true } : {}), ...(b.askMove ? { askMove: true } : {}), ...(b.askProject ? { askProject: true } : {}), ...(b.askFun ? { askFun: true } : {}), ...(b.askMood ? { askMood: true } : {}), ...(BTN_COLORS.some(c => c.key === b.color) ? { color: b.color } : {}), ...(b.askWith != null ? { askWith: !!b.askWith } : {}), ...(FORMS.includes(b.form) ? { form: b.form } : {}) })
async function saveButtons(list, preset = PRESET) {
  BUTTONS = list; PRESET = preset; applyPresetNames()
  await putSetting('buttons', { buttons: list, preset, added: ADDED_LATER, placeAdded: true, spanAdded: true, updated_at: stamp(new Date()) })
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
// 乗りかえ(移動手段ごとの時刻)。legs = [{ mode, at }]。それぞれ次の乗りかえ(なければ移動の終わり・いま)まで
const legsOf = (e) => (Array.isArray(e.legs) ? e.legs.filter(l => l && MOVE_BY[l.mode] && typeof l.at === 'string') : [])
function legSpans(e, now = new Date()) {
  const legs = legsOf(e)
  return legs.map((l, i) => {
    const to = i + 1 < legs.length ? legs[i + 1].at : (e.end || null)
    return { mode: l.mode, at: l.at, to, min: durMin(l.at, to || now), live: !to }
  })
}
const legsText = (e) => legSpans(e).map(x => `${MOVE_BY[x.mode].icon} ${MOVE_BY[x.mode].label} ${fmtDur(x.min)}${x.live ? '(いま)' : ''}`).join(' → ')
// 乗りかえの記録(移動手段の並びも合わせる)
const legPickedAt = new Map()     // 記録の id → いちばん後ろの手段を選んだ時刻(押しまちがいの直し用。記録には残さない)
async function addLeg(id, mode) {
  const cur = await getEntry(id)
  if (!cur) return
  const legs = legsOf(cur)
  if (legs.length && legs[legs.length - 1].mode === mode) return
  // 押しまちがいの直し: いちばん後ろの手段を選んでから1分以内なら、乗りかえにせず手段を入れかえる
  const last = legs[legs.length - 1]
  if (last && (Date.now() - (legPickedAt.get(id) || 0)) < 60 * 1000) {
    const next = [...legs.slice(0, -1), { mode, at: last.at }]
    await putEntry({ ...cur, legs: next, moves: next.map(l => l.mode), updated_at: stamp(new Date()) })
    await render()
    legPickedAt.set(id, Date.now())
    showToast(`${MOVE_BY[mode].icon} ${MOVE_BY[mode].label}に直しました`)
    return
  }
  const at = legs.length ? stamp(new Date()) : cur.at   // 1本目は出発の時刻から
  const next = [...legs, { mode, at }]
  await putEntry({ ...cur, legs: next, moves: next.map(l => l.mode), updated_at: stamp(new Date()) })
  legPickedAt.set(id, Date.now())
  await render()
  showToast(legs.length ? `${hm(at)} ${MOVE_BY[mode].icon} ${MOVE_BY[mode].label}に乗りかえました` : `${MOVE_BY[mode].icon} ${MOVE_BY[mode].label}で移動中`)
}
// 移動手段を1つ選ぶ(押した直後の欄・帯)
function modeRow(current, onPick, cls = 'mode-row') {
  return h('div', { class: cls, role: 'group', 'aria-label': '移動手段' },
    ...MOVES.map(m => h('button', { type: 'button', class: 'mode', 'aria-pressed': m.key === current ? 'true' : 'false', title: m.label,
      onclick: () => onPick(m.key) }, h('span', { 'aria-hidden': 'true', text: m.icon }), h('span', { class: 'mode-label', text: m.label }))))
}

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
const DRAFT_KEY = (TRY_MODE ? 'diary.try.draft' : 'diary.draft') + USER_SUFFIX   // 書きかけは人ごと(v0.19.2)   // お試しモードの書きかけは別に

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
const audiosOf = (e) => e.audios || []
// 記録の場所の名前(登録の名前を変えたら、新しい名前で出す)
const placeName = (e) => {
  if (!e.place) return ''
  const p = PLACES.find(x => x.id === e.place.id)
  return p ? p.name : e.place.name || ''
}
// 新しく場所を登録して、その範囲にある名前のない記録にも付ける
async function registerPlace(loc, name, addr = '') {
  const p = { id: newId(), name, addr, lat: loc.lat, lon: loc.lon, r: 150, created_at: stamp(new Date()) }
  await savePlaces([...PLACES, p])
  let n = 0
  for (const e of await allEntries()) {
    if (e.loc && !e.place && distance(e.loc, p) <= p.r) { await putEntry({ ...e, place: { id: p.id, name: p.name } }); n++ }
  }
  return { place: p, applied: n }
}
// 名前を付ける欄(位置はあるが登録の場所がないとき)
function placeNamer(loc, onDone) {
  const inp = h('input', { class: 'input add-in', maxlength: '30', placeholder: ED.TEXT.placeExample, 'aria-label': 'この場所の名前' })
  const go = async () => {
    const name = inp.value.trim()
    if (!name) { inp.focus(); return }
    const r = await registerPlace(loc, name)
    onDone(r.place)
  }
  inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); go() } })
  return h('div', { class: 'add-row' }, inp, h('button', { type: 'button', class: 'small-btn', text: '名前を付ける', onclick: go }))
}
// 登録した場所から選ぶ(近い順。位置がなければ名前順)
function placeSelect(value, loc, onChange) {
  const list = [...PLACES].sort((a, b) => (loc ? distance(loc, a) - distance(loc, b) : a.name.localeCompare(b.name, 'ja')))
  const sel = h('select', { class: 'input pj-sel', 'aria-label': '登録した場所から選ぶ' },
    h('option', { value: '', text: PLACES.length ? '場所なし(登録した場所から選ぶ)' : 'まだ登録した場所がありません' }),
    ...list.map(p => h('option', { value: p.id, text: loc ? `${p.name}(${fmtDist(distance(loc, p))})` : p.name })))
  if (value && value.id && !PLACES.some(p => p.id === value.id)) sel.append(h('option', { value: value.id, text: `${value.name}(登録を消した場所)` }))
  sel.value = value ? value.id : ''
  sel.addEventListener('change', () => {
    const p = PLACES.find(x => x.id === sel.value)
    onChange(p ? { id: p.id, name: p.name } : sel.value && value ? value : null)
  })
  return sel
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
// 見ている日(null = 今日)。前の日・次の日で動かす(v0.12)
let viewDay = null
const shownDay = () => viewDay || today
function goDay(day) {
  viewDay = !day || day >= dayOf(new Date()) ? null : day
  render()
}
const addDays = (day, n) => dayOf(new Date(new Date(day + 'T12:00:00').getTime() + n * 86400000))
const KY_KEY = 'diary.koyomiOpen'
function koyomiOpen() { try { return localStorage.getItem(KY_KEY) === '1' } catch { return false } }

// 録音の再生用 URL(写真と同じく、使い終わったら放す)
async function audioURL(id) {
  const a = await getAudio(id)
  if (!a) return null
  const u = URL.createObjectURL(a.blob)
  urls.add(u)
  return { url: u, sec: a.sec || 0 }
}
async function audioList(ids, onRemove) {
  const box = h('div', { class: 'audios' })
  for (const aid of ids) {
    const a = await audioURL(aid)
    if (!a) continue
    box.append(h('div', { class: 'audio-row' },
      h('span', { class: 'audio-tag', text: `🎙️ ${fmtSec(a.sec)}` }),
      h('audio', { controls: true, preload: 'metadata', src: a.url, onclick: (ev) => ev.stopPropagation() }),
      onRemove ? h('button', { type: 'button', class: 'ed-photo-x static', 'aria-label': 'この録音を外す', text: '×', onclick: () => onRemove(aid) }) : null))
  }
  return box
}

// ---------- 1日のタイムライン(今日か、前の日) ----------
async function render() {
  today = dayOf(new Date())
  const day = shownDay()
  const isToday = day === today
  const d = new Date(day + 'T00:00:00')
  $('#date').textContent = `${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAY[d.getDay()]})`
  // 前の日・次の日
  $('#day-today').hidden = isToday
  $('#day-next').disabled = isToday
  $('#day-pick').value = day
  $('#day-pick').max = today
  $('#date').classList.toggle('past', !isToday)
  $('#timeline').setAttribute('aria-label', isToday ? '今日のタイムライン' : `${d.getMonth() + 1}月${d.getDate()}日のタイムライン`)
  const list = await entriesOfDay(day)
  // 前の日に始まって今日終わったもの(睡眠など)も、終えた記録のカードに出すため
  const yday = dayOf(new Date(d.getTime() - 86400000))
  ENDED = new Map()
  const two = [...await entriesOfDay(yday), ...list]
  for (const x of two) if (x.end_by) ENDED.set(x.end_by, [...(ENDED.get(x.end_by) || []), x])
  RESTS = two.filter(x => x.span && x.end && (x.kind === 'lunch' || x.kind === 'break'))
  await renderOngoing()
  const nPhotos = list.reduce((a, e) => a + photosOf(e).length, 0)
  $('#count').textContent = list.length ? `記録 ${list.length}件${nPhotos ? ` ・ 写真 ${nPhotos}枚` : ''}` : ''
  try {
    $('#koyomi').replaceChildren(koyomiCard(day, TIDE, koyomiOpen(), (o) => { try { localStorage.setItem(KY_KEY, o ? '1' : '0') } catch { /* */ } }))
  } catch (err) { $('#koyomi').replaceChildren(h('p', { class: 'hint', text: `暦を出せませんでした: ${err.message || err}` })) }
  $('#empty').hidden = list.length > 0
  releaseURLs()
  const ul = $('#timeline')
  ul.replaceChildren()
  for (const e of list) {
    ul.append(await card(e))
    if (isMoveMoment(e)) ul.append(moveBlock(e))   // v0.19.7: 出発・退社のすぐ下に移動の帯
  }
  renderDayBand(day, [...await entriesOfDay(yday), ...list])
  await renderMemory(isToday)
  if (isToday) {
    const last = ul.lastElementChild
    if (last && last.scrollIntoView) last.scrollIntoView({ block: 'nearest' })
  } else $('.main').scrollTop = 0
}

// ---------- 1年前の今日(v0.18。今日を見ているときだけ。なければ先月の今日) ----------
const MEMO_HIDE = 'diary.memoryHidden' + USER_SUFFIX
async function renderMemory(isToday) {
  const box = $('#memory')
  if (!box) return
  box.replaceChildren()
  let hidden = ''
  try { hidden = localStorage.getItem(MEMO_HIDE) || '' } catch { /* */ }
  if (!isToday || hidden === today) return
  const md = today.slice(5)
  let hit = null
  for (let y = 1; y <= 10 && !hit; y++) {
    const d = `${Number(today.slice(0, 4)) - y}-${md}`
    const l = (await entriesOfDay(d)).filter(e => e.kind !== 'health' && e.kind !== 'bowel')
    if (l.length) hit = { day: d, list: l, title: `${y}年前の今日` }
  }
  if (!hit) {
    const t = new Date(today + 'T12:00:00'); t.setMonth(t.getMonth() - 1)
    const d = dayOf(t)
    if (d.slice(8) === today.slice(8)) {
      const l = (await entriesOfDay(d)).filter(e => e.kind !== 'health' && e.kind !== 'bowel')
      if (l.length) hit = { day: d, list: l, title: '先月の今日' }
    }
  }
  if (!hit) return
  const dt = new Date(hit.day + 'T00:00:00')
  const photoId = hit.list.flatMap(e => photosOf(e))[0]
  const best = hit.list.filter(e => e.fun).sort((a, b) => b.fun - a.fun)[0]
  const memo = hit.list.find(e => (e.text || '').trim())
  const icons = [...new Set(hit.list.map(e => e.icon || (kindInfo(e.kind) || {}).icon).filter(Boolean))].slice(0, 8).join(' ')
  const img = photoId ? h('img', { class: 'mem-photo', alt: '' }) : null
  if (img) photoURL(photoId).then(u => { if (u) img.src = u })
  box.append(h('section', { class: 'mem-card', role: 'button', tabindex: '0', 'aria-label': `${hit.title}の記録を見る`, onclick: () => goDay(hit.day),
    onkeydown: (ev) => { if (ev.key === 'Enter') goDay(hit.day) } },
    img,
    h('div', { class: 'mem-body' },
      h('p', { class: 'mem-title' }, `📅 ${hit.title}`, h('span', { class: 'mem-date', text: ` ${dt.getFullYear()}/${dt.getMonth() + 1}/${dt.getDate()}(${WEEKDAY[dt.getDay()]})` })),
      h('p', { class: 'mem-icons', text: icons }),
      best ? h('p', { class: 'mem-line', text: `${FUN_FACES[best.fun - 1]} ${best.with && best.with.length ? `${best.with.map(k => (WITH_OPTS.find(o => o.key === k) || {}).label).filter(Boolean).join('・')}と` : ''}${best.label}が${FUN_WORDS[best.fun - 1]}` }) : null,
      memo ? h('p', { class: 'mem-line memo', text: memo.text.trim().slice(0, 60) }) : null,
      h('p', { class: 'mem-more', text: 'その日を見る ▶' })),
    h('button', { type: 'button', class: 'mem-close', 'aria-label': '今日はもう出さない', text: '×', onclick: (ev) => {
      ev.stopPropagation(); try { localStorage.setItem(MEMO_HIDE, today) } catch { /* */ } box.replaceChildren() } })))
}

// 1日の帯(0時〜24時。睡眠・勤務・移動・外出などが、1日のどこを占めているか)。広い画面で出す
const BAND_COLOR = { sleep: 'band-sleep', arrive: 'band-work', work: 'band-work', goout: 'band-out', meal: 'band-meal', lunch: 'band-meal', break: 'band-rest' }
function renderDayBand(day, list) {
  const box = $('#dayband')
  if (!box) return
  const d0 = new Date(day + 'T00:00:00').getTime(), d1 = d0 + 86400000
  const now = Date.now()
  const segs = []
  for (const e of list) {
    if (!e.span) continue
    const a = new Date(e.at).getTime()
    const b = e.end ? new Date(e.end).getTime() : (day === today ? now : a)
    if (b <= d0 || a >= d1 || b <= a) continue
    const cls = isMoveEntry(e) ? 'band-move' : (BAND_COLOR[e.kind] || 'band-other')
    segs.push({ a: Math.max(a, d0), b: Math.min(b, d1), cls, e })
  }
  const track = h('div', { class: 'band-track' })
  for (const sg of segs) {
    const el = h('div', { class: `band-seg ${sg.cls}`, title: `${sg.e.icon || ''} ${spanNameOf(sg.e) || sg.e.label} ${hm(stamp(new Date(sg.a)))}〜${hm(stamp(new Date(sg.b)))}` })
    el.style.left = `${(sg.a - d0) / 864000}%`
    el.style.width = `${Math.max(0.3, (sg.b - sg.a) / 864000)}%`
    track.append(el)
  }
  if (day === today) { const n = h('div', { class: 'band-now' }); n.style.left = `${(now - d0) / 864000}%`; track.append(n) }
  const ticks = h('div', { class: 'band-ticks' }, ...[0, 3, 6, 9, 12, 15, 18, 21, 24].map(x => { const t = h('span', { text: String(x) }); t.style.left = `${x / 24 * 100}%`; return t }))
  const legend = h('div', { class: 'band-legend' }, ...[['band-sleep', '睡眠'], ['band-work', '勤務・作業'], ['band-move', '移動'], ['band-out', '外出'], ['band-meal', '食事'], ['band-rest', '休憩'], ['band-other', 'そのほか']]
    .filter(([c]) => segs.some(sg => sg.cls === c)).map(([c, t]) => h('span', { class: 'band-key' }, h('i', { class: `band-dot ${c}` }), t)))
  box.replaceChildren(h('p', { class: 'band-title', text: '1日の流れ' }), track, ticks, segs.length ? legend : h('p', { class: 'hint', text: '長さのある記録(睡眠・勤務・移動など)がまだありません' }))
}

let ENDED = new Map()
// 続いているものの帯(下のボタンの上)
// v0.17.1: 本人「終わったはあまり使わない」→ 帯に出すのは、移動中(乗りかえを早く押すため)と、
// 前の日から続いているもの(今日の記録のカードに出ないので、終わり忘れに気づけるように)だけ。
// ほかの続いているものは、記録のカードの「続いています ・ 〇時間」と「終わった」で見る。
async function renderOngoing() {
  const box = $('#ongoing')
  const today = dayOf(new Date())
  const list = (await ongoingOf()).filter(e => isMoveEntry(e) || e.day !== today)
  box.hidden = !list.length
  const now = new Date()
  box.replaceChildren(...list.map(e => {
    const min = durMin(e.at, now)
    const isMove = isMoveEntry(e)
    const legs = legsOf(e)
    const curMode = legs.length ? legs[legs.length - 1].mode : null
    const item = h('div', { class: 'og-item' + (min > 12 * 60 ? ' long' : '') + (isMove ? ' is-move' : '') },
      h('div', { class: 'og-main' },
        h('span', { class: 'og-icon', 'aria-hidden': 'true', text: e.icon || (kindInfo(e.kind) || {}).icon || '・' }),
        h('span', { class: 'og-text' }, h('strong', { text: isMove ? (e.label || spanNameOf(e)) : (spanNameOf(e) || e.label) }),
          ` ${e.day !== dayOf(now) ? '前日 ' : ''}${hm(e.at)}〜(${fmtDur(min)}${min > 12 * 60 ? '・終わり忘れ?' : ''})`,
          isMove && legs.length ? h('span', { class: 'og-legs', text: legsText(e) }) : null),
        h('button', { type: 'button', class: 'og-end', text: '終わった', onclick: () => finishNow(e) })))
    if (isMove) {
      const row = modeRow(curMode, (m) => addLeg(e.id, m), 'mode-row og-modes')
      item.append(h('p', { class: 'og-hint', text: curMode ? '乗りかえたら押す:' : '最初の移動手段は?' }), row)
      // いま乗っているものが見える位置まで横に送る
      requestAnimationFrame(() => { const on = row.querySelector('[aria-pressed="true"]'); if (on) row.scrollLeft = Math.max(0, on.offsetLeft - row.offsetLeft - 8) })
    }
    return item
  }))
}
// 移動の記録(乗りかえを記録できるもの): 長さがあって、押したら移動手段を聞くボタン(出発・退社)か、すでに乗りかえがあるもの
function isMoveEntry(e) {
  if (!e.span) return false
  if (legsOf(e).length) return true
  const k = BUTTONS.find(b => b.kind === e.kind) || DEFAULT_BUTTONS.find(b => b.kind === e.kind)
  return !!(k && k.askMove)
}
// いま終える
async function finishNow(e) {
  const ts = stamp(new Date())
  const cur = await getEntry(e.id)
  if (!cur) return
  await putEntry({ ...cur, end: ts, updated_at: ts })
  await render()
  showToast(`「${spanNameOf(e) || e.label}」を終えました(${fmtDur(durMin(e.at, ts))})`, [
    { label: '取り消す', fn: async () => { const c = await getEntry(e.id); if (c) { delete c.end; await putEntry(c); render() } } },
  ])
}
// 時刻の欄の見せ方(長さのあるものは 始まり〜終わり)
function timeCell(e) {
  if (!e.span || isMoment(e)) return h('span', { class: 'tl-time', text: hm(e.at) })
  const endTxt = e.end ? `〜${e.end.slice(0, 10) !== e.day ? '翌' : ''}${hm(e.end)}` : '〜'
  return h('span', { class: 'tl-time' }, hm(e.at), h('span', { class: 'tl-end', text: endTxt }))
}

// ---------- 楽しかった度(v0.18) ----------
const FUN_FACES = ['😞', '😐', '🙂', '😄', '🤩']
const FUN_WORDS = ['いまいち', 'ふつう', 'よかった', '楽しかった', '最高!']
// だれとを聞くか: ボタンの askWith(付けていなければ楽しかった度と同じ)
function askWithOf(e) { const b = BUTTONS.find(x => x.kind === e.kind) || DEFAULT_BUTTONS.find(x => x.kind === e.kind); return !!(b && (b.askWith != null ? b.askWith : b.askFun)) }
function askFunOf(e) { const b = BUTTONS.find(x => x.kind === e.kind) || DEFAULT_BUTTONS.find(x => x.kind === e.kind); return !!(b && b.askFun) }
async function setFun(id, n) {
  const cur = await getEntry(id)
  if (!cur) return
  const next = { ...cur, updated_at: stamp(new Date()) }
  if (cur.fun === n) delete next.fun; else next.fun = n      // 同じ顔をもう一度押すと消す
  await putEntry(next)
  render()
}
function funRow(e) {
  return h('div', { class: 'tl-fun', role: 'group', 'aria-label': '楽しかった度' },
    h('span', { class: 'tl-fun-q', text: e.fun ? FUN_WORDS[e.fun - 1] : (e.end || !e.span ? '楽しかった?' : 'どうだった?') }),
    ...FUN_FACES.map((f, i) => h('button', { type: 'button', class: 'fun-face', 'aria-pressed': e.fun === i + 1 ? 'true' : 'false', 'aria-label': FUN_WORDS[i], text: f,
      onclick: (ev) => { ev.stopPropagation(); setFun(e.id, i + 1) } })))
}

// どんな子?(ペットの種類)を選ぶ列。押した種類に印を付けて onPick を呼ぶ
function petTypeRow(cur, onPick) {
  const row = h('div', { class: 'pt-row', role: 'group', 'aria-label': 'どんな子?' }, h('span', { class: 'pt-q', text: 'どんな子?' }))
  for (const t of PET_TYPES) {
    const b = h('button', { type: 'button', class: 'chip pt-chip', 'aria-pressed': t.key === cur ? 'true' : 'false', text: `${t.icon} ${t.label}` })
    b.addEventListener('click', (ev) => { ev.preventDefault(); row.querySelectorAll('.pt-chip').forEach(x => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); onPick(t.key) })
    row.append(b)
  }
  return row
}

// ---------- ペットの体調(v0.20.9。本人「体調はクラくんおすすめで」) ----------
// 記録に pethealth = { appetite, poop, pee, vomit, weight, signs[] } と pmood(ご機嫌)。病気かどうかの判断はしない
const PH_FIELDS = [
  ['appetite', '🍽️ 食欲', ['よく食べた', 'ふつう', '少しだけ', '食べない']],
  ['poop', '💩 うんち', ['ふつう', 'ゆるい', 'かたい', '出ていない']],
  ['pee', '💧 おしっこ', ['ふつう', '多い', '少ない']],
  ['vomit', '🤮 吐いた', ['なし', '1回', '何回も']],
]
const PH_SIGNS = ['せき・くしゃみ', '目やに・涙', 'かゆがる', '足をかばう', 'ぐったり', '毛が抜ける', '水をよく飲む']
function petHealthText(ph) {
  if (!ph) return ''
  const a = PH_FIELDS.filter(([k]) => ph[k]).map(([k, l]) => `${l.split(' ')[1]} ${ph[k]}`)
  if (ph.weight != null) a.push(`体重 ${ph.weight}kg`)
  if (ph.signs && ph.signs.length) a.push(`気になる: ${ph.signs.join('・')}`)
  return a.length ? `🩺 ${a.join(' ・ ')}` : ''
}
async function openPetHealth(b, id) {
  const editing = id ? await getEntry(id) : null
  const ph0 = (editing && editing.pethealth) || {}
  const st = { ...ph0, signs: [...(ph0.signs || [])], pmood: editing ? editing.pmood : undefined }
  const now = new Date()
  const dayIn = h('input', { type: 'date', class: 'input small', value: editing ? editing.day : shownDay(), 'aria-label': '日付' })
  const timeIn = h('input', { type: 'time', class: 'input small', value: editing ? editing.at.slice(11, 16) : `${pad(now.getHours())}:${pad(now.getMinutes())}`, 'aria-label': '時刻' })
  let timeTouched = !editing && shownDay() !== today
  dayIn.addEventListener('change', () => { timeTouched = true }); timeIn.addEventListener('change', () => { timeTouched = true })
  // 前に入れた体重を出発点に
  let lastW = null
  if (ph0.weight == null) for (const e of (await allEntries()).sort((a, c) => (a.at < c.at ? 1 : -1))) if (e.pethealth && e.pethealth.weight != null && e.id !== id) { lastW = e.pethealth.weight; break }
  const wIn = h('input', { type: 'number', class: 'input small', inputmode: 'decimal', step: '0.01', min: '0', max: '200', placeholder: lastW != null ? `前回 ${lastW}` : 'kg', value: ph0.weight != null ? String(ph0.weight) : '', 'aria-label': '体重(kg)' })
  const ta = h('textarea', { class: 'input textarea short', rows: '3', placeholder: 'ひとこと(なくてもよい)', 'aria-label': 'ひとこと' })
  ta.value = editing ? textOf(editing) : ''
  const msg = h('p', { class: 'ed-msg', 'aria-live': 'polite' })
  const one = (key, label, opts) => {
    const row = h('div', { class: 'chips' })
    const paint = () => row.replaceChildren(...opts.map(o => h('button', { type: 'button', class: 'chip', 'aria-pressed': st[key] === o ? 'true' : 'false', text: o,
      onclick: () => { st[key] = st[key] === o ? undefined : o; paint() } })))
    paint()
    return h('div', { class: 'ph-field' }, h('span', { class: 'ed-label', text: label }), row)
  }
  const moodBox = h('div', { class: 'chips' })
  const paintMood = () => moodBox.replaceChildren(...PMOOD_FACES.map((f, i) => h('button', { type: 'button', class: 'chip mood', 'aria-pressed': st.pmood === i + 1 ? 'true' : 'false',
    onclick: () => { st.pmood = st.pmood === i + 1 ? undefined : i + 1; paintMood() } }, h('span', { class: 'chip-icon', text: f }), PMOOD_WORDS[i])))
  paintMood()
  const signBox = h('div', { class: 'chips' })
  const paintSigns = () => signBox.replaceChildren(...PH_SIGNS.map(o => h('button', { type: 'button', class: 'chip', 'aria-pressed': st.signs.includes(o) ? 'true' : 'false', text: o,
    onclick: () => { st.signs = st.signs.includes(o) ? st.signs.filter(x => x !== o) : [...st.signs, o]; paintSigns() } })))
  paintSigns()
  const data = () => {
    const d = {}
    for (const [k] of PH_FIELDS) if (st[k]) d[k] = st[k]
    const w = parseFloat(wIn.value); if (Number.isFinite(w) && w > 0) d.weight = Math.round(w * 100) / 100
    if (st.signs.length) d.signs = [...st.signs]
    return Object.keys(d).length ? d : null
  }
  const sheet = $('#sheet')
  const close = () => { sheet.hidden = true; sheet.replaceChildren(); document.body.classList.remove('no-scroll') }
  const save = async () => {
    const d = data()
    if (!d && !st.pmood && !ta.value.trim()) { msg.textContent = 'ご機嫌や食欲など、どれか1つ入れてください'; return null }
    const ts = stamp(new Date())
    const useNow = !editing && !timeTouched
    const t = useNow ? hmsOf(new Date()) : `${timeIn.value || '00:00'}:${editing && !timeTouched ? editing.at.slice(17, 19) : '00'}`
    const day = useNow ? dayOf(new Date()) : (dayIn.value || today)
    const e = { ...(editing || { photos: [], created_at: ts }), id: editing ? editing.id : newId(), at: `${day}T${t}`, day, kind: b.kind, label: editing ? editing.label : b.label, icon: editing ? editing.icon : b.icon, text: ta.value.trim(), updated_at: ts }
    delete e.pethealth; delete e.pmood
    if (d) e.pethealth = d
    if (st.pmood) e.pmood = st.pmood
    await putEntry(e)
    close()
    await render()
    showToast(editing ? '直しました' : `${hm(e.at)} 「${e.label}」を記録しました`)
    return e
  }
  const snap = () => JSON.stringify([dayIn.value, timeIn.value, ta.value, wIn.value, st])
  const first = snap()
  sheet.replaceChildren(h('div', { class: 'sheet-inner', role: 'dialog', 'aria-modal': 'true', 'aria-label': b.label },
    h('div', { class: 'sheet-top' },
      h('h2', {}, h('span', { 'aria-hidden': 'true', text: `${b.icon} ` }), editing ? `${b.label}を直す` : `${b.label}(ペット)`),
      h('button', { type: 'button', class: 'link-btn', text: '閉じる', onclick: () => guardedClose(snap, first, save, close, !editing) })),
    h('div', { class: 'sheet-body' },
      h('div', { class: 'ed-time compact' }, dayIn, timeIn, h('span', { class: 'hint', text: editing ? '' : '(そのままなら、いまの時刻)' })),
      h('div', { class: 'ph-field' }, h('span', { class: 'ed-label', text: '🐾 ご機嫌' }), moodBox),
      ...PH_FIELDS.map(([k, l, o]) => one(k, l, o)),
      h('div', { class: 'ph-field' }, h('span', { class: 'ed-label', text: '⚖️ 体重(kg)' }), wIn),
      h('div', { class: 'ph-field' }, h('span', { class: 'ed-label', text: '👀 気になること(いくつでも)' }), signBox),
      h('div', { class: 'ph-field' }, h('span', { class: 'ed-label', text: 'ひとこと' }), ta),
      h('p', { class: 'hint', text: '残しておくだけで、病気かどうかの判断はしません。気になるときは動物病院へ。' }),
      msg),
    h('div', { class: 'sheet-foot' },
      editing ? h('button', { type: 'button', class: 'danger-btn', text: '消す', onclick: async () => {
        if (!confirm(`${hm(editing.at)} の「${editing.label}」を消しますか?`)) return
        await deleteEntry(editing.id); close(); render() } }) : null,
      h('button', { type: 'button', class: 'primary-btn', text: editing ? '保存する' : '記録する', onclick: save }))))
  sheet.hidden = false
  document.body.classList.add('no-scroll')
}

// ---------- ペットのご機嫌(v0.20.8。本人「遊ぶにご機嫌をポチれるように」) ----------
const PMOOD_FACES = ['😢', '😐', '🙂', '😄', '🥰']
const PMOOD_WORDS = ['元気ない', 'ふつう', 'ごきげん', 'うれしそう', '大よろこび']
function askMoodOf(e) { const b = BUTTONS.find(x => x.kind === e.kind); return !!(b && b.askMood) }
async function setMood(id, n) {
  const cur = await getEntry(id)
  if (!cur) return
  const next = { ...cur, updated_at: stamp(new Date()) }
  if (cur.pmood === n) delete next.pmood; else next.pmood = n
  await putEntry(next)
  render()
}
function moodRow(e) {
  return h('div', { class: 'tl-fun tl-mood', role: 'group', 'aria-label': 'ご機嫌' },
    h('span', { class: 'tl-fun-q', text: e.pmood ? `🐾 ${PMOOD_WORDS[e.pmood - 1]}` : '🐾 ご機嫌は?' }),
    ...PMOOD_FACES.map((f, i) => h('button', { type: 'button', class: 'fun-face', 'aria-pressed': e.pmood === i + 1 ? 'true' : 'false', 'aria-label': PMOOD_WORDS[i], text: f,
      onclick: (ev) => { ev.stopPropagation(); setMood(e.id, i + 1) } })))
}

// ---------- だれと(v0.18.3。本人「人とだったら、友達と飲み・家族とカラオケにならない?」→ ボタンではなく、記録に付ける印) ----------
const DEFAULT_WITH = [['alone', 'ひとり', '🙂'], ['friends', '友だち', '👫'], ['family', '家族', '👨‍👩‍👧'], ['partner', 'パートナー', '💑'],
  ['coworker', '仕事仲間', '👔'], ['kids', '子ども', '🧒'], ['pet', 'ペット', '🐕']].map(([key, label, icon]) => ({ key, label, icon }))
// v0.18.6: 本人「誰と設定ができなくなったのは残念」→ だれとの一覧は自分で足す・名前を変える・並べ替える・消すができる(settings の withs)
let WITH_OPTS = DEFAULT_WITH.map(o => ({ ...o }))
const WITH_ICONS = ['🙂', '👫', '👨‍👩‍👧', '💑', '👔', '🧒', '🐕', '🐈', '👩', '👨', '👵', '👴', '👶', '🧑‍🤝‍🧑', '💼', '🎓', '🏫', '⚽', '🎸', '⭐']
async function saveWiths(list) { WITH_OPTS = list; await putSetting('withs', list) }
const cleanWiths = (a) => (Array.isArray(a) ? a : []).filter(o => o && typeof o.key === 'string' && typeof o.label === 'string' && o.label.trim()).map(o => ({ key: o.key.slice(0, 40), label: o.label.trim().slice(0, 12), icon: typeof o.icon === 'string' ? o.icon.slice(0, 16) : '🙂' }))
const withText = (w) => (w || []).map(k => WITH_OPTS.find(o => o.key === k)).filter(Boolean).map(o => `${o.icon} ${o.label}`).join('・')
async function setWith(id, key) {
  const cur = await getEntry(id)
  if (!cur) return
  const now = new Set(cur.with || [])
  if (now.has(key)) now.delete(key)
  else { if (key === 'alone') now.clear(); else now.delete('alone'); now.add(key) }   // 「ひとり」とほかは一緒に付けない
  const next = { ...cur, updated_at: stamp(new Date()) }
  if (now.size) next.with = WITH_OPTS.map(o => o.key).filter(k => now.has(k)); else delete next.with
  WITH_OPEN.add(id)
  await putEntry(next)
  render()
}
const WITH_OPEN = new Set()   // 「だれと」を開いているカード
function withRow(e) {
  const open = WITH_OPEN.has(e.id)
  if (!open) {
    return h('div', { class: 'tl-with' }, h('button', { type: 'button', class: 'with-open', onclick: (ev) => { ev.stopPropagation(); WITH_OPEN.add(e.id); render() } },
      e.with && e.with.length ? `${withText(e.with)} と` : '＋ だれと?'))
  }
  return h('div', { class: 'tl-with open', role: 'group', 'aria-label': 'だれと' },
    ...WITH_OPTS.map(o => h('button', { type: 'button', class: 'chip with-chip', 'aria-pressed': (e.with || []).includes(o.key) ? 'true' : 'false', text: `${o.icon} ${o.label}`,
      onclick: (ev) => { ev.stopPropagation(); setWith(e.id, o.key) } })),
    h('button', { type: 'button', class: 'link-btn small', text: '閉じる', onclick: (ev) => { ev.stopPropagation(); WITH_OPEN.delete(e.id); render() } }))
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
        onclick: (ev) => { ev.stopPropagation(); openEntry(e) } }),
    ))
  // 瞬間のボタンで、終わらせた記録があるとき: 長さはそちらのカードに出すので、ここには出さない
  const endedElsewhere = isMoment(e) && e.end && e.end_by
  if (e.span && !endedElsewhere && !isMoveMoment(e)) {
    const min = durMin(e.at, e.end || new Date())
    const word = ongoingWord(e)
    body.append(h('p', { class: 'tl-dur' + (e.end ? '' : ' on') },
      e.end ? (isMoment(e) ? `${spanNameOf(e)} ${hm(e.at)}〜${hm(e.end)}(${fmtDur(min)})` : `${spanNameOf(e) ? `${spanNameOf(e)} ` : ''}${fmtDur(min)}`)
        : h('span', { class: 'live-dur', 'data-at': e.at, 'data-word': word, text: `${word} ・ ${fmtDur(min)}` }),
      e.end ? null : h('button', { type: 'button', class: 'og-end small', text: '終わった', onclick: (ev) => { ev.stopPropagation(); finishNow(e) } })))
  }
  // この記録で終えたもの(起床 → 睡眠 など)
  for (const x of ENDED.get(e.id) || []) {
    if (isMoveMoment(x) && x.day === e.day) continue   // 移動は出発・退社の下の帯に出す(前の日からの移動だけここ)
    const all = durMin(x.at, x.end), rest = x.kind === 'arrive' ? restMin(x.at, x.end) : 0   // 勤務は昼休み・休憩を引いた実働も
    body.append(h('p', { class: 'tl-dur' }, `${spanNameOf(x) === '移動' && isMoment(x) ? '🚃' : x.icon || ''} ${spanNameOf(x) || x.label} ${x.day !== e.day ? '前日 ' : ''}${hm(x.at)}〜${hm(x.end)}(${fmtDur(all)}${rest > 0 ? `・実働 ${fmtDur(all - rest)}` : ''})`))
    if (legsOf(x).length) body.append(h('p', { class: 'tl-moves', text: legsText(x) }))
  }
  // v0.18: 楽しかった度(遊びのボタンなど askFun の記録と、もう付けた記録)
  if (e.fun || askFunOf(e)) body.append(funRow(e))
  if (e.pmood || askMoodOf(e)) body.append(moodRow(e))
  if ((e.with && e.with.length) || askWithOf(e)) body.append(withRow(e))
  if (placeName(e)) body.append(h('p', { class: 'tl-place', text: `📍 ${placeName(e)}` }))
  else if (e.loc) body.append(h('p', { class: 'tl-place none', text: '📍 名前のない場所(「直す」で名前を付けられます)' }))
  if (e.project && e.project.title) body.append(h('p', { class: 'tl-project', text: PJ.projectText(e.project) }))
  if (legsOf(e).length && isMoment(e)) { /* 移動の帯に出す */ }
  else if (legsOf(e).length) {
    const p = h('p', { class: 'tl-moves' + (e.end ? '' : ' live-legs'), text: legsText(e) })
    p._entry = e
    body.append(p)
  } else if (movesOf(e).length) body.append(h('p', { class: 'tl-moves', text: movesText(movesOf(e)) }))
  for (const line of healthLines(e.health)) body.append(h('p', { class: 'tl-health', text: line }))
  if (e.bowel && (e.bowel.type || e.bowel.count != null)) body.append(h('p', { class: 'tl-health', text: e.kind === 'bowel' ? bowelText(e.bowel).replace('🚽 お通じ', 'かたさ:').replace(/(\d+)回/, '$1回 ・') : bowelText(e.bowel) }))
  if (e.weather) body.append(h('p', { class: 'tl-weather', text: weatherText(e.weather) }))
  if (e.pethealth) body.append(h('p', { class: 'tl-health', text: petHealthText(e.pethealth) }))
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
  if (audiosOf(e).length) body.append(await audioList(audiosOf(e)))
  return h('li', { class: 'tl-item' },
    timeCell(e),
    h('span', { class: 'tl-dot' + (isMemo ? ' memo' : '') + (e.span ? ' span' : ''), 'aria-hidden': 'true' }),
    h('div', { class: 'tl-card', onclick: () => openEntry(e) }, body),
  )
}

// ---------- 移動の帯(v0.19.7。本人「移動は出発依存が強い。別枠に」) ----------
// 出発・退社のカードのすぐ下に、移動の長さと乗りかえを1本の帯で出す。押すと出発・退社の記録を直す。
function moveBlock(e) {
  const box = h('div', { class: 'mv-body' })
  const fill = () => {
    const live = !e.end
    const min = durMin(e.at, e.end || new Date())
    const head = h('div', { class: 'mv-head' },
      h('span', { class: 'mv-title', text: live ? `🚃 移動中 ・ ${fmtDur(min)}` : `🚃 移動 ${hm(e.at)}〜${e.end.slice(0, 10) !== e.day ? '翌' : ''}${hm(e.end)}(${fmtDur(min)})` }),
      live ? h('button', { type: 'button', class: 'og-end small', text: '着いた', onclick: (ev) => { ev.stopPropagation(); finishNow(e) } }) : null)
    const rows = legSpans(e).map(x => h('li', { class: 'mv-leg' + (x.live ? ' live' : '') },
      h('span', { class: 'mv-at', text: hm(x.at) }),
      h('span', { class: 'mv-mode', text: `${MOVE_BY[x.mode].icon} ${MOVE_BY[x.mode].label}` }),
      h('span', { class: 'mv-min', text: x.live ? `${fmtDur(x.min)}(いま)` : fmtDur(x.min) })))
    box.replaceChildren(head, rows.length ? h('ul', { class: 'mv-legs' }, ...rows)
      : h('p', { class: 'mv-none', text: live ? '移動手段は下の帯で選べます' : '移動手段は「直す」で入れられます' }))
  }
  fill()
  const li = h('li', { class: 'tl-item tl-move' + (e.end ? '' : ' live') },
    h('span', { class: 'tl-time' }),
    h('span', { class: 'tl-dot mv-line', 'aria-hidden': 'true' }),
    h('div', { class: 'tl-card', onclick: () => openEntry(e) }, box))
  li._fill = fill
  return li
}

// ---------- ボタンでいま記録 ----------
// v0.17.2: 押し終わったら、ボタンの部分を下に引っ込める(本人「入力終わったら下に落ちるような」)。
// 引っ込んでいても、タブの1行はいつも同じ場所に残す。タブを押すとまた出る。右の ▾ / ▴ でも出し入れできる。
// 広い画面(2列)では引っ込めない(CSS で .down を効かせない)。
const DOCK_KEY = 'diary.dockDown'
function setDockDown(down) {
  const dock = document.querySelector('.dock')
  if (!dock || dock.classList.contains('down') === down) return
  dock.classList.toggle('down', down)
  const t = $('#dock-toggle')
  t.textContent = down ? '▴' : '▾'
  t.setAttribute('aria-label', down ? 'ボタンを出す' : 'ボタンをしまう')
  t.setAttribute('aria-expanded', down ? 'false' : 'true')
  try { localStorage.setItem(DOCK_KEY, down ? '1' : '') } catch { /* */ }
}
function initDock() {
  let down = false
  try { down = localStorage.getItem(DOCK_KEY) === '1' } catch { /* */ }
  setDockDown(down)
  $('#dock-toggle').addEventListener('click', () => setDockDown(!document.querySelector('.dock').classList.contains('down')))
}
const TAB_KEY = 'diary.tab'
function currentTab() { try { return localStorage.getItem(TAB_KEY) || 'flow' } catch { return 'flow' } }
function buildButtons() {
  // v0.20.8: ペットのタブは、ペットのボタンがあるときだけ出す。v0.21.1: 隠したタブは出さない
  const shown = TABS.filter(t => !t.hidden && (t.key !== 'pet' || BUTTONS.some(b => b.tab === 'pet')))
  const tab = shown.some(t => t.key === currentTab()) ? currentTab() : (shown[0] || TABS[0]).key
  const bar = $('#tabs')
  bar.replaceChildren(...shown.map(t => h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': t.key === tab ? 'true' : 'false',
    text: t.label, onclick: () => { try { localStorage.setItem(TAB_KEY, t.key) } catch { /* */ } setDockDown(false); buildButtons() } })))
  const box = $('#buttons')
  const list = BUTTONS.filter(b => b.tab === tab)
  box.replaceChildren(...list.map(b => h('button', { type: 'button', class: 'rec-btn' + colorCls(b), onclick: () => pressButton(b) },
    h('span', { class: 'rec-icon', 'aria-hidden': 'true', text: b.icon }),
    h('span', { class: 'rec-label' + (b.label.length > 5 ? ' long' : ''), text: b.label }))))
  if (!list.length) box.append(h('p', { class: 'muted no-btn', text: 'このタブにはボタンがありません。「ボタン設定」で足せます。' }))
}

let toastTimer = null
// 体調・天気は入力欄を開く。ほかは押した時刻ですぐ記録
function pressButton(b) {
  if (viewDay) { viewDay = null; render() }      // ボタンは「いま」の記録なので、今日にもどる
  if (b.form === 'health' || b.form === 'weather') { closeMovePick(); openBodySheet(b, null) }
  else if (b.form === 'pethealth') { closeMovePick(); openPetHealth(b, null) }
  else quickRecord(b)
}
async function quickRecord(b) {
  const now = new Date()
  const ts = stamp(now)
  const ongoing = await ongoingOf()
  // 同じボタンが続いている途中なら、それを終える(もう一度押す=終わった)
  const same = b.span ? ongoing.find(x => x.kind === b.kind) : null
  if (same) { closeMovePick(); await finishNow(same); setDockDown(true); return }
  const e = { id: newId(), at: ts, day: dayOf(now), kind: b.kind, label: b.label, icon: b.icon, text: '', photos: [], created_at: ts, updated_at: ts, ...(b.span ? { span: true } : {}), ...(b.span && b.kind === 'arrive' ? { sname: SPAN_NAME.arrive } : {}) }
  // 組になっているもの(就寝→起床 など)を終える
  const ended = ongoing.filter(x => (END_BY[x.kind] || []).includes(b.kind))
  for (const x of ended) await putEntry({ ...x, end: ts, end_by: e.id, updated_at: ts })
  await putEntry(e)
  if (navigator.vibrate) navigator.vibrate(15)
  await render()
  const endTxt = ended.map(x => `「${spanNameOf(x) || x.label}」${fmtDur(durMin(x.at, ts))}`).join('・')
  showToast(`${hm(e.at)} 「${b.label}」を${b.span ? '始めました' : '記録しました'}${endTxt ? `(${endTxt}を終えました)` : ''}`, [
    { label: '書き足す', fn: () => { closeMovePick(); openEditor(e.id) } },
    { label: '取り消す', fn: async () => {
      closeMovePick(); await deleteEntry(e.id)
      for (const x of ended) { const c = await getEntry(x.id); if (c) { delete c.end; delete c.end_by; await putEntry(c) } }
      render() } },
  ])
  // どのボタンでも、押した直後に「押し忘れ? 本当は何分前?」を出す(v0.14)
  openMovePick(e, b, ended, now)
}

// 押し忘れて、あとから押したとき: 本当の時刻にさかのぼる(v0.14。本人 2026-11-04「忘れてて後から入力することが多々ある」)
// 押した時刻から「○分前」か、時刻を選ぶ。組で終えた記録(就寝・出発など)の終わりと、1本目の移動手段の時刻も一緒に動かす
function backdateRow(e, ended, pressed) {
  const status = h('span', { class: 'bd-status' })
  const apply = async (when) => {
    if (when > new Date()) when = new Date(when.getTime() - 86400000)      // いまより先の時刻なら、前の日のこと
    const cur = await getEntry(e.id)
    if (!cur) return
    const ts = stamp(when)
    for (const x of ended) {
      const c = await getEntry(x.id)
      if (c && c.at >= ts) { showToast(`「${c.label}」(${hm(c.at)})より前にはできません`); return }
    }
    const legs = legsOf(cur)
    if (legs.length > 1 && legs[1].at <= ts) { showToast('乗りかえの時刻より後にはできません。「直す」で直してください'); return }
    const next = { ...cur, at: ts, day: dayOf(when), updated_at: stamp(new Date()) }
    if (legs.length && legs[0].at === cur.at) { next.legs = [{ ...legs[0], at: ts }, ...legs.slice(1)]; next.moves = next.legs.map(l => l.mode) }
    await putEntry(next)
    for (const x of ended) {
      const c = await getEntry(x.id)
      if (c && c.end_by === e.id) await putEntry({ ...c, end: ts, updated_at: stamp(new Date()) })
    }
    status.textContent = `→ ${hm(ts)} にしました`
    await render()
  }
  const chip = (min) => h('button', { type: 'button', class: 'bd-chip', text: min < 60 ? `${min}分前` : `${min / 60}時間前`,
    onclick: () => apply(new Date(pressed.getTime() - min * 60000)) })
  const timeIn = h('input', { type: 'time', class: 'input small bd-time', 'aria-label': '本当の時刻' })
  timeIn.addEventListener('change', () => {
    if (!timeIn.value) return
    const [H, M] = timeIn.value.split(':').map(Number)
    const d = new Date(pressed); d.setHours(H, M, 0, 0)
    apply(d)
  })
  return h('div', { class: 'bd' },
    h('p', { class: 'mp-label', text: `押し忘れ? 本当の時刻にさかのぼる(いまは ${hm(stamp(pressed))})` }),
    h('div', { class: 'bd-row' }, ...[5, 10, 15, 30, 60].map(chip), timeIn, status))
}

// ボタンを押した直後: 件名・工程や移動手段を、その場で付ける(選ぶたびに保存)
let movePickTimer = null
function openMovePick(e, b, ended = [], pressed = new Date()) {
  const box = $('#movepick')
  clearTimeout(movePickTimer)
  const update = async (patch) => {
    const now = await getEntry(e.id)
    if (!now) return
    await putEntry({ ...now, ...patch, updated_at: stamp(new Date()) })
    render()
  }
  const parts = []
  if (b.askPlace) {
    // 位置を測って、登録の場所なら名前を付ける。なければ名前を付ける欄を出す
    const placeBox = h('div', { class: 'mp-place' }, h('p', { class: 'mp-status', text: '📍 場所を測っています…' }))
    parts.push(placeBox)
    measure().then(async (r) => {
      if (!box.contains(placeBox)) { if (r.loc) { const now = await getEntry(e.id); if (now) { const p = matchPlace(r.loc, PLACES); await putEntry({ ...now, loc: r.loc, ...(p ? { place: { id: p.id, name: p.name } } : {}) }); render() } } return }
      if (r.error) {
        placeBox.replaceChildren(...[h('p', { class: 'mp-status err', text: `📍 ${r.error}` }),
          PLACES.length ? placeSelect(null, null, (pl) => update({ place: pl })) : null].filter(Boolean))
        return
      }
      const p = matchPlace(r.loc, PLACES)
      await update({ loc: r.loc, ...(p ? { place: { id: p.id, name: p.name } } : {}) })
      if (p) {
        placeBox.replaceChildren(h('p', { class: 'mp-status ok', text: `📍 ${p.name}(誤差 ±${r.loc.acc}m)` }),
          h('button', { type: 'button', class: 'link-btn small', text: 'ちがう場所を選ぶ', onclick: () => placeBox.append(placeSelect({ id: p.id, name: p.name }, r.loc, (pl) => update({ place: pl }))) }))
      } else {
        placeBox.replaceChildren(...[h('p', { class: 'mp-status', text: `📍 登録していない場所です(誤差 ±${r.loc.acc}m)。名前を付けると、次からは自動で出ます。` }),
          placeNamer(r.loc, async (pl) => { await update({ place: { id: pl.id, name: pl.name } }); placeBox.replaceChildren(h('p', { class: 'mp-status ok', text: `📍 「${pl.name}」を登録しました` })) }),
          PLACES.length ? placeSelect(null, r.loc, (pl) => update({ place: pl })) : null].filter(Boolean))
      }
    })
  }
  if (b.askProject && PJ.ENABLED) parts.push(h('p', { class: 'mp-label', text: '件名・工程は?' }), PJ.projectPicker(null, (pj) => update({ project: pj })))
  // 長さのある移動(出発・退社・移動)の手段は、上の帯だけで選ぶ・乗りかえる
  // (v0.19.0 本人「出発のときに移動画面も出るけどちょっとうるさい」。前はこの欄にも同じ列を出していた)
  if (b.askMove && b.span) { /* 帯にまかせる */ } else if (b.askMove) parts.push(h('p', { class: 'mp-label', text: '移動手段は?' }), movePicker([], (keys) => update({ moves: [...keys] })))
  if (b.form === 'bowel') parts.push(h('p', { class: 'mp-label', text: 'かたさは?' }), bowelPicker(null, (bw) => update({ bowel: bw })))
  const onlyTime = !parts.length
  parts.push(backdateRow(e, ended, pressed))
  // 時刻だけの欄は、触らなければ20秒で閉じる(押すたびに欄が残らないように)
  if (onlyTime) {
    movePickTimer = setTimeout(closeMovePick, 20000)
    box.addEventListener('pointerdown', () => clearTimeout(movePickTimer), { once: true })
  }
  box.replaceChildren(
    h('div', { class: 'mp-top' }, h('strong', { text: `「${e.label}」` }),
      h('button', { type: 'button', class: 'link-btn', text: '閉じる', onclick: closeMovePick })),
    ...parts)
  box.hidden = false
}
// 押した直後の欄を閉じたら(「閉じる」・20秒・ほかの画面へ)、押し終わったものとしてボタンを引っ込める
function closeMovePick() { clearTimeout(movePickTimer); const box = $('#movepick'); const was = !box.hidden; box.hidden = true; box.replaceChildren(); if (was) setDockDown(true) }

function showToast(text, actions = []) {
  const t = $('#toast')
  t.replaceChildren(h('span', { class: 'toast-text', text }),
    ...actions.map(a => h('button', { type: 'button', class: 'toast-btn', text: a.label, onclick: async () => { t.hidden = true; await a.fn() } })))
  t.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { t.hidden = true }, 6000)
}

// ---------- 体調・天気の短い画面 ----------
// カードを押したとき: 体調・天気の記録は短い画面、それ以外は書く・直す画面
// v0.20.0: 保存忘れのお知らせ(本人「手直ししたときに保存をよく押し忘れる」)。
// 直したところがあるまま「閉じる」を押したら聞く。'save' | 'discard' | 'back' を返す
function askUnsaved(isNew = false) {
  return new Promise((resolve) => {
    const box = h('div', { class: 'uv-wrap', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': '保存していません' })
    const done = (v) => { box.remove(); resolve(v) }
    box.append(h('div', { class: 'uv-card' },
      h('p', { class: 'uv-title', text: isNew ? '⚠️ まだ記録していません' : '⚠️ 直したところがまだ保存されていません' }),
      h('p', { class: 'uv-text', text: 'このまま閉じると、入れたところは消えます。' }),
      h('button', { type: 'button', class: 'primary-btn', text: isNew ? '記録して閉じる' : '保存して閉じる', onclick: () => done('save') }),
      h('button', { type: 'button', class: 'secondary-btn', text: isNew ? '記録せずに閉じる' : '保存せずに閉じる', onclick: () => done('discard') }),
      h('button', { type: 'button', class: 'link-btn', text: 'もどる(続けて直す)', onclick: () => done('back') })))
    box.addEventListener('click', (ev) => { if (ev.target === box) done('back') })
    document.body.append(box)
    box.querySelector('.primary-btn').focus()
  })
}
// snap() が開いたときと違えば聞いてから閉じる
async function guardedClose(snap, first, save, close, isNew) {
  if (snap() === first) return close()
  const a = await askUnsaved(isNew)
  if (a === 'save') return save()
  if (a === 'discard') return close()
}

function openEntry(e) {
  const k = kindInfo(e.kind) || {}
  if (k.form === 'pethealth' || e.pethealth) { openPetHealth({ ...k, kind: e.kind, label: e.label, icon: e.icon }, e.id); return }
  if ((k.form === 'health' && e.health !== undefined) || (k.form === 'weather' && e.weather !== undefined)) openBodySheet(k, e.id)
  else if ((k.form === 'health' || k.form === 'weather') && !e.text && !photosOf(e).length && !audiosOf(e).length) openBodySheet(k, e.id)
  else openEditor(e.id)
}
// 前回の値(数字の「−」「＋」の出発点にする。いま直している記録は除く)
async function lastValues(exceptId) {
  const out = { health: {}, weather: {} }
  const all = (await allEntries()).filter(e => e.id !== exceptId).reverse()
  for (const e of all) {
    for (const k of ['temp', 'weight', 'bpHi', 'bpLo', 'pulse', 'sleepH']) if (e.health && e.health[k] != null && out.health[k] == null) out.health[k] = e.health[k]
    for (const k of ['temp', 'hi', 'lo', 'hum']) if (e.weather && e.weather[k] != null && out.weather[k] == null) out.weather[k] = e.weather[k]
  }
  return out
}
async function openBodySheet(b, id) {
  const editing = id ? await getEntry(id) : null
  const isH = b.form === 'health'
  const last = await lastValues(id)
  const form = isH ? healthForm(editing && editing.health, LISTS, last.health) : weatherForm(editing && editing.weather, last.weather)
  const now = new Date()
  const dayIn = h('input', { type: 'date', class: 'input small', value: editing ? editing.day : shownDay(), 'aria-label': '日付' })
  const timeIn = h('input', { type: 'time', class: 'input small', value: editing ? editing.at.slice(11, 16) : `${pad(now.getHours())}:${pad(now.getMinutes())}`, 'aria-label': '時刻' })
  let timeTouched = !editing && shownDay() !== today
  dayIn.addEventListener('change', () => { timeTouched = true }); timeIn.addEventListener('change', () => { timeTouched = true })
  const ta = h('textarea', { class: 'input textarea short', rows: '3', placeholder: 'ひとこと(なくてもよい)', 'aria-label': 'ひとこと' })
  ta.value = editing ? textOf(editing) : ''
  const taBox = h('div', {}, h('span', { class: 'ed-label', text: 'ひとこと' }), ta)
  taBox.hidden = !ta.value
  const msg = h('p', { class: 'ed-msg', 'aria-live': 'polite' })
  const sheet = $('#sheet')
  const close = () => { sheet.hidden = true; sheet.replaceChildren(); document.body.classList.remove('no-scroll') }
  const save = async () => {
    const data = form.get()
    if (!data && !ta.value.trim()) { msg.textContent = isH ? '気分やお通じなど、どれか1つ入れてください' : '空模様や気温など、どれか1つ入れてください'; return null }
    const ts = stamp(new Date())
    const useNow = !editing && !timeTouched
    const t = useNow ? hmsOf(new Date()) : `${timeIn.value || '00:00'}:${editing && !timeTouched ? editing.at.slice(17, 19) : '00'}`
    const day = useNow ? dayOf(new Date()) : (dayIn.value || today)
    const e = { ...(editing || { photos: [], created_at: ts }), id: editing ? editing.id : newId(), at: `${day}T${t}`, day, kind: b.kind, label: editing ? editing.label : b.label, icon: editing ? editing.icon : b.icon, text: ta.value.trim(), updated_at: ts }
    delete e.health; delete e.weather
    if (data) e[isH ? 'health' : 'weather'] = data
    await putEntry(e)
    close()
    await render()
    showToast(editing ? '直しました' : `${hm(e.at)} 「${e.label}」を記録しました`)   // v0.20.9: ここで moved(書く・直すの変数)を使っていて、体調を直すと止まっていた
    return e
  }
  const snapB = () => JSON.stringify([dayIn.value, timeIn.value, ta.value, form.get()])
  const firstB = snapB()
  sheet.replaceChildren(h('div', { class: 'sheet-inner', role: 'dialog', 'aria-modal': 'true', 'aria-label': b.label },
    h('div', { class: 'sheet-top' },
      h('h2', {}, h('span', { 'aria-hidden': 'true', text: `${b.icon} ` }), editing ? `${b.label}を直す` : b.label),
      h('button', { type: 'button', class: 'link-btn', text: '閉じる', onclick: () => guardedClose(snapB, firstB, save, close, !editing) })),
    h('div', { class: 'sheet-body' },
      h('div', { class: 'ed-time compact' }, dayIn, timeIn, h('span', { class: 'hint', text: editing ? '' : '(そのままなら、いまの時刻)' })),
      form.el,
      taBox,
      h('div', { class: 'more-row' },
        taBox.hidden ? h('button', { type: 'button', class: 'link-btn small', text: '＋ ひとこと書く', onclick: (ev) => { taBox.hidden = false; ev.currentTarget.remove(); ta.focus() } }) : null,
        h('button', { type: 'button', class: 'link-btn small', text: '写真・場所なども付ける', onclick: async () => { const e = await save(); if (e) openEditor(e.id) } })),
      isH ? h('p', { class: 'hint', text: '数字をそのまま残すだけで、病気かどうかの判断はしません。気になるときはお医者さんへ。' }) : null,
      msg),
    h('div', { class: 'sheet-foot' },
      editing ? h('button', { type: 'button', class: 'danger-btn', text: '消す', onclick: async () => {
        if (!confirm(`${hm(editing.at)} の「${editing.label}」を消しますか?`)) return
        await deleteEntry(editing.id); close(); render() } }) : null,
      h('button', { type: 'button', class: 'primary-btn', text: editing ? '保存する' : '記録する', onclick: save })),
  ))
  sheet.hidden = false
  document.body.classList.add('no-scroll')
}

// ---------- 書く・直す(画面案の「記録を足す」) ----------
// 時刻を直した記録(before → after)に合わせて、つながっている記録を動かす。動かした記録を返す
async function moveLinked(before, after, link, ts) {
  const m16 = (v) => (v || '').slice(0, 16)
  const out = []
  if (m16(before.at) !== m16(after.at)) {
    for (const x of link.prev) {
      const c = await getEntry(x.id)
      if (!c || !c.end || after.at <= c.at) continue            // 始まりより前には動かさない
      await putEntry({ ...c, end: after.at, updated_at: ts }); out.push(c)
    }
  }
  if (before.end && after.end && m16(before.end) !== m16(after.end)) {
    for (const x of link.next) {
      const c = await getEntry(x.id)
      if (!c || (c.end && c.end <= after.end)) continue          // 終わりより後には動かさない
      const n = { ...c, at: after.end, day: after.end.slice(0, 10), updated_at: ts }
      const legs = legsOf(c)
      if (legs.length && m16(legs[0].at) === m16(c.at)) n.legs = [{ ...legs[0], at: after.end }, ...legs.slice(1)]   // 1本目の移動手段も
      await putEntry(n); out.push(c)
      // 同じ記録で一緒に終わった、ほかの記録の終わりも(帰宅で 移動 と 外出 が終わった など)
      for (const z of (await allEntries()).filter(z => z.end_by === c.id && z.id !== after.id)) {
        if (after.end <= z.at) continue
        await putEntry({ ...z, end: after.end, updated_at: ts }); out.push(z)
      }
    }
  }
  return out
}
async function openEditor(id, preset = {}) {
  const editing = id ? await getEntry(id) : null
  const now = new Date()
  const saved = !editing ? draft.get() : null
  const st = {
    kind: editing ? editing.kind : preset.kind || (saved && saved.kind) || 'memo',
    day: editing ? editing.day : shownDay(),
    time: editing ? editing.at.slice(11, 16) : `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    timeIsNow: !editing && shownDay() === today,     // 前の日を見ているときは、その日に書く
    text: editing ? textOf(editing) : (saved && saved.text) || '',
    photos: editing ? [...photosOf(editing)] : [],
    moves: editing ? [...movesOf(editing)] : [],
    legs: editing ? legsOf(editing).map(l => ({ ...l })) : [],
    project: editing && editing.project ? { ...editing.project } : null,
    audios: editing ? [...audiosOf(editing)] : [],
    loc: editing && editing.loc ? { ...editing.loc } : null,
    place: editing && editing.place ? { ...editing.place } : null,
  }
  const added = []      // この窓で足した写真(やめたら消す)
  const removed = []    // この窓で外した写真(保存したら消す)
  const addedA = [], removedA = []   // 録音も同じ
  const sheet = $('#sheet')
  const close = async (commit) => {
    if (rec.busy()) rec.stop()
    if (!commit) { for (const pid of added) await deletePhoto(pid); for (const aid of addedA) await deleteAudio(aid) }
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
  // 終わり(長さのある記録。空なら「続いています」、時刻だけの記録なら空のまま)
  const endDayIn = h('input', { type: 'date', class: 'input', value: editing && editing.end ? editing.end.slice(0, 10) : '', 'aria-label': '終わりの日付' })
  const endTimeIn = h('input', { type: 'time', class: 'input', value: editing && editing.end ? editing.end.slice(11, 16) : '', 'aria-label': '終わりの時刻' })
  endTimeIn.addEventListener('change', () => { if (!endDayIn.value) endDayIn.value = st.timeIsNow ? dayOf(new Date()) : dayIn.value })
  const endBox = h('div', { class: 'ed-time' }, h('span', { class: 'ed-label', text: '終わり(長さのあるもの。空なら「続いています」)' }), endDayIn, endTimeIn,
    h('button', { type: 'button', class: 'small-btn', text: 'いま', onclick: () => { const n = new Date(); endDayIn.value = dayOf(n); endTimeIn.value = `${pad(n.getHours())}:${pad(n.getMinutes())}` } }),
    h('button', { type: 'button', class: 'small-btn', text: '空にする', onclick: () => { endDayIn.value = ''; endTimeIn.value = '' } }))

  // つながっている記録(v0.16.1 本人「時間修正したときに前の事柄の終了時間と今の事柄の開始時間を連動して」)
  //   前: この記録が終わらせた記録(end_by)。組がなければ、終わりがこの記録の始まりとぴったり同じ記録
  //   次: この記録を終わらせた記録(end_by)。組がなければ、始まりがこの記録の終わりとぴったり同じ記録
  const link = { prev: [], next: [], pairedPrev: false, pairedNext: false }
  if (editing) {
    const all = (await allEntries()).filter(x => x.id !== editing.id)
    const m16 = (v) => (v || '').slice(0, 16)
    link.prev = all.filter(x => x.end && x.end_by === editing.id)
    if (link.prev.length) link.pairedPrev = true
    else link.prev = all.filter(x => x.end && m16(x.end) === m16(editing.at))
    if (editing.end) {
      const y = editing.end_by ? all.find(x => x.id === editing.end_by) : null
      link.next = y ? [y] : all.filter(x => m16(x.at) === m16(editing.end))
      if (y) link.pairedNext = true
    }
  }
  const nameOf = (x) => spanNameOf(x) || x.label
  // v0.21.8 本人「入浴と就寝がひっついて離れない。入浴はつぎの関連薄いからデフォルトでチェックなしのほうが」
  // → 前・次それぞれにチェック。組(就寝→起床・出社→退社など)でつながっているときだけ最初からオン、時刻がたまたま同じだけのときはオフ
  const prevChk = h('input', { type: 'checkbox' }); prevChk.checked = link.pairedPrev
  const nextChk = h('input', { type: 'checkbox' }); nextChk.checked = link.pairedNext
  const linkBox = (link.prev.length || link.next.length)
    ? h('div', { class: 'ed-links' },
      h('span', { class: 'ed-label', text: 'つながっている記録も一緒に動かす' }),
      link.prev.length ? h('label', { class: 'ed-link' }, prevChk, h('span', { text: link.prev.map(x => `前の「${nameOf(x)}」の終わり`).join('・') + (link.pairedPrev ? '' : '(時刻が同じだけ)') })) : null,
      link.next.length ? h('label', { class: 'ed-link' }, nextChk, h('span', { text: link.next.map(x => `次の「${x.label}」の時刻`).join('・') + (link.pairedNext ? '' : '(時刻が同じだけ)') })) : null)
    : null

  // 種類
  const kindBox = h('div', { class: 'kind-groups', role: 'group', 'aria-label': '種類' })
  const paintKinds = () => {
    kindBox.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.kind === st.kind ? 'true' : 'false'))
    // 種類に合わせて、体調・お通じ・天気の欄を出す
    const f = (kindInfo(st.kind) || {}).form
    secHealth.hidden = f !== 'health'; secBowel.hidden = f !== 'bowel'; secWeather.hidden = f !== 'weather'
  }
  const kindBtn = (k) => h('button', { type: 'button', class: 'kind', 'data-kind': k.kind, onclick: () => { st.kind = k.kind; paintKinds(); keepDraft() } },
    h('span', { 'aria-hidden': 'true', text: k.icon }), k.label)
  const extra = editing && editing.kind !== 'memo' && !BUTTONS.some(b => b.kind === editing.kind)
    ? [kindBtn({ kind: editing.kind, label: editing.label, icon: editing.icon || (kindInfo(editing.kind) || {}).icon || '・' })] : []
  kindBox.append(h('div', { class: 'kinds' }, kindBtn(MEMO), ...extra))
  for (const t of TABS) {
    const list = BUTTONS.filter(b => b.tab === t.key)
    if (list.length) kindBox.append(h('p', { class: 'kind-tab', text: t.label }), h('div', { class: 'kinds' }, ...list.map(kindBtn)))
  }

  // 乗りかえ(長さのある移動の記録は、移動手段ごとの時刻を直せる)
  const legsMode = !!(editing && editing.span && (legsOf(editing).length || ((kindInfo(editing.kind) || {}).askMove)))
  const legsBox = h('div', { class: 'legs-ed' })
  const paintLegs = () => {
    const rows = st.legs.map((l, i) => {
      const sel = h('select', { class: 'input leg-mode', 'aria-label': `${i + 1}本目の移動手段` }, ...MOVES.map(m => h('option', { value: m.key, text: `${m.icon} ${m.label}` })))
      sel.value = l.mode
      sel.addEventListener('change', () => { l.mode = sel.value })
      const tm = h('input', { type: 'time', class: 'input leg-time', value: l.at.slice(11, 16), 'aria-label': `${i + 1}本目の始まり` })
      tm.addEventListener('change', () => { l.time = tm.value })
      return h('div', { class: 'leg-row' }, h('span', { class: 'leg-no', text: `${i + 1}` }), sel, tm,
        h('button', { type: 'button', class: 'bs-op del', 'aria-label': `${i + 1}本目を消す`, text: '×', onclick: () => { st.legs.splice(i, 1); paintLegs() } }))
    })
    legsBox.replaceChildren(...rows,
      h('button', { type: 'button', class: 'small-btn', text: '＋ 乗りかえを足す', onclick: () => {
        const lastAt = st.legs.length ? st.legs[st.legs.length - 1] : null
        st.legs.push({ mode: lastAt ? lastAt.mode : 'walk', at: lastAt ? lastAt.at : `${dayIn.value}T${timeIn.value}:00`, time: lastAt ? (lastAt.time || lastAt.at.slice(11, 16)) : timeIn.value }); paintLegs() } }),
      h('p', { class: 'hint', text: 'それぞれ、次の乗りかえ(最後は移動の終わり)までの時間になります。1本目の時刻は、ふつうは出発の時刻です。' }))
  }
  paintLegs()

  // 場所(登録した場所から選ぶ・いまの場所を測る・名前を付ける)
  const placeBox = h('div', { class: 'ed-place' })
  const paintPlace = (note = '') => {
    const kids = [placeSelect(st.place, st.loc, (pl) => { st.place = pl; paintPlace() })]
    if (st.loc && !st.place) kids.push(h('p', { class: 'hint', text: `この記録には位置があります(誤差 ±${st.loc.acc || '?'}m)。名前を付けると登録され、近くのほかの記録にも付きます。` }),
      placeNamer(st.loc, (pl) => { st.place = { id: pl.id, name: pl.name }; paintPlace(`「${pl.name}」を登録しました`) }))
    kids.push(h('div', { class: 'add-row' },
      h('button', { type: 'button', class: 'small-btn', text: st.loc ? '📍 位置を測り直す' : '📍 いまの場所を測る', onclick: async (ev) => {
        ev.currentTarget.disabled = true
        paintPlace('測っています…')
        const r = await measure()
        if (r.error) { paintPlace(r.error); return }
        st.loc = r.loc
        const p = matchPlace(r.loc, PLACES)
        st.place = p ? { id: p.id, name: p.name } : null
        paintPlace(p ? `「${p.name}」でした` : '登録していない場所でした')
      } }),
      st.loc ? h('button', { type: 'button', class: 'small-btn', text: '位置を外す', onclick: () => { st.loc = null; paintPlace() } }) : null))
    if (note) kids.push(h('p', { class: 'hint strong', text: note }))
    placeBox.replaceChildren(...kids)
  }
  paintPlace()

  // 体調・お通じ・天気
  const last = await lastValues(editing && editing.id)
  const hf = healthForm(editing && editing.health, LISTS, last.health)
  const wf = weatherForm(editing && editing.weather, last.weather)
  let bowel = editing && editing.bowel ? { ...editing.bowel } : {}
  const secHealth = h('div', { class: 'ed-sec' }, h('span', { class: 'ed-label', text: '体調(入れたものだけ記録します)' }), hf.el,
    h('p', { class: 'hint', text: '数字をそのまま残すだけで、病気かどうかの判断はしません。気になるときはお医者さんへ。' }))
  const secBowel = h('div', { class: 'ed-sec' }, h('span', { class: 'ed-label', text: 'お通じのかたさ' }), bowelPicker(bowel, (b) => { bowel = b }))
  const secWeather = h('div', { class: 'ed-sec' }, h('span', { class: 'ed-label', text: '天気と気温' }), wf.el)
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

  // 録音
  const audioBox = h('div', {})
  const paintAudios = async () => audioBox.replaceChildren(await audioList(st.audios, (aid) => {
    st.audios = st.audios.filter(x => x !== aid)
    if (addedA.includes(aid)) { addedA.splice(addedA.indexOf(aid), 1); deleteAudio(aid) } else removedA.push(aid)
    paintAudios()
  }))
  const rec = recorderButton(async (blob, mime, sec) => {
    const a = await saveAudio({ id: newId(), blob, mime, sec, created_at: stamp(new Date()) })
    st.audios.push(a.id); addedA.push(a.id)
    paintAudios()
  }, (t) => { msg.textContent = t })

  // 保存
  const save = async () => {
    const k = kindInfo(st.kind) || (editing && editing.kind === st.kind ? { kind: editing.kind, label: editing.label, icon: editing.icon } : MEMO)
    const text = ta.value.trim()
    if (rec.busy()) { msg.textContent = '録音中です。先に「止める」を押してください'; return }
    const f = k.form
    const health = f === 'health' ? hf.get() : null
    const weather = f === 'weather' ? wf.get() : null
    const bw = f === 'bowel' && (bowel.type || bowel.count != null) ? bowel : null
    if (st.kind === 'memo' && !text && !st.photos.length && !st.audios.length) { msg.textContent = '文章・写真・録音のどれかを入れてください'; return }
    const ts = stamp(new Date())
    const t = st.timeIsNow ? hmsOf(new Date()) : `${timeIn.value || '00:00'}:00`
    const day = st.timeIsNow ? dayOf(new Date()) : (dayIn.value || today)
    const e = {
      ...(editing || {}), id: editing ? editing.id : newId(), at: `${day}T${t}`, day, kind: k.kind, label: k.label, icon: k.icon,
      text, photos: st.photos, moves: [...st.moves], project: st.project, audios: st.audios, loc: st.loc, place: st.place, created_at: editing ? editing.created_at || ts : ts, updated_at: ts,
    }
    delete e.note; delete e.health; delete e.weather; delete e.bowel
    if (health) e.health = health
    if (weather) e.weather = weather
    if (bw) e.bowel = bw
    if (!e.loc) delete e.loc
    if (!e.place) delete e.place
    if (legsMode) {
      // 乗りかえの時刻: 始まりの日付で。始まりより前の時刻なら翌日とみなす
      const legs = st.legs.map(l => {
        const t2 = l.time || l.at.slice(11, 16)
        let at = `${day}T${t2}:${l.time ? '00' : l.at.slice(17, 19)}`
        if (at < e.at.slice(0, 16)) { const d2 = new Date(`${day}T00:00:00`); d2.setDate(d2.getDate() + 1); at = `${dayOf(d2)}T${t2}:00` }
        return { mode: l.mode, at }
      }).sort((a, b) => (a.at < b.at ? -1 : 1))
      if (legs.length) { e.legs = legs; e.moves = legs.map(l => l.mode) } else { delete e.legs; e.moves = [] }
    }
    // 長さ: 終わりを入れたら長さのある記録にする。新しい記録で、長さのボタンなら続いているものにする
    if (endTimeIn.value) {
      const end = `${endDayIn.value || day}T${endTimeIn.value}:${editing && editing.end && editing.end.slice(0, 16) === `${endDayIn.value || day}T${endTimeIn.value}` ? editing.end.slice(17, 19) : '00'}`
      if (end <= e.at) { msg.textContent = '終わりは始まりより後にしてください'; return }
      e.span = true; e.end = end
    } else {
      delete e.end
      if (!editing) { if (k.span) e.span = true; else delete e.span }
      else if (!editing.span) delete e.span
      // 直していて終わりを空にした: 長さのボタンなら「続いています」に戻る
    }
    await putEntry(e)
    const moved = (editing && linkBox && (prevChk.checked || nextChk.checked))
      ? await moveLinked(editing, e, { prev: prevChk.checked ? link.prev : [], next: nextChk.checked ? link.next : [] }, ts) : []
    for (const pid of removed) await deletePhoto(pid)
    for (const aid of removedA) await deleteAudio(aid)
    if (!editing) draft.clear()
    await close(true)
    await render()
    showToast(editing ? `直しました${moved.length ? `(${moved.map(x => `「${nameOf(x)}」`).join('・')}も動かしました)` : ''}` : `${hm(e.at)} 「${e.label}」を記録しました`)
  }
  const remove = async () => {
    if (!confirm(`${hm(editing.at)} の「${editing.label}」を消しますか?(文章・写真・録音も消えます)`)) return
    if (rec.busy()) rec.stop()
    for (const pid of added) await deletePhoto(pid)
    for (const aid of addedA) await deleteAudio(aid)
    await deleteEntry(editing.id)
    sheet.hidden = true; sheet.replaceChildren(); document.body.classList.remove('no-scroll')
    render()
  }

  const snapE = () => JSON.stringify([dayIn.value, timeIn.value, endDayIn.value, endTimeIn.value, prevChk.checked, nextChk.checked, ta.value, { ...st, timeIsNow: undefined }, hf.get(), wf.get(), bowel])
  const firstE = snapE()
  sheet.replaceChildren(h('div', { class: 'sheet-inner', role: 'dialog', 'aria-modal': 'true', 'aria-label': editing ? '記録を直す' : '書く' },
    h('div', { class: 'sheet-top' },
      h('h2', { text: editing ? '記録を直す' : '書く' }),
      h('button', { type: 'button', class: 'link-btn', text: '閉じる', onclick: () => guardedClose(snapE, firstE, save, () => close(false), !editing) })),
    h('div', { class: 'sheet-body' },
      h('div', { class: 'ed-time' }, h('span', { class: 'ed-label', text: '時刻(始まり)' }), dayIn, timeIn, nowTag),
      endBox,
      linkBox,
      h('div', {}, h('span', { class: 'ed-label', text: '場所' }), placeBox),
      h('div', {}, h('span', { class: 'ed-label', text: '種類' }), kindBox),
      secHealth, secBowel, secWeather,
      PJ.ENABLED ? h('div', {}, h('span', { class: 'ed-label', text: PJ.PICK_LABEL }), PJ.projectPicker(st.project, (pj) => { st.project = pj })) : null,
      h('div', {}, h('span', { class: 'ed-label', text: legsMode ? '移動手段と乗りかえの時刻' : '移動手段(いくつでも・押した順)' }), legsMode ? legsBox : movePicker(st.moves)),
      h('div', {}, h('span', { class: 'ed-label', text: '文章' }), ta,
        h('p', { class: 'hint', text: !editing && saved && saved.text ? '書きかけを戻しました。' : '書きかけは自動で取っておきます。' })),
      h('div', {}, h('span', { class: 'ed-label', text: '写真' }), strip, fileIn, addPhoto,
        h('p', { class: 'hint', text: '写真は小さくして、このスマホの中にしまいます(撮影場所の情報は消えます)。' })),
      h('div', {}, h('span', { class: 'ed-label', text: '録音' }), audioBox, rec.el,
        h('p', { class: 'hint', text: ED.TEXT.voiceHint })),
      msg),
    h('div', { class: 'sheet-foot' },
      editing ? h('button', { type: 'button', class: 'danger-btn', text: '消す', onclick: remove }) : null,
      h('button', { type: 'button', class: 'primary-btn', text: editing ? '保存する' : '記録する', onclick: save })),
  ))
  sheet.hidden = false
  document.body.classList.add('no-scroll')
  paintPhotos()
  paintAudios()
  requestAnimationFrame(grow)
  if (preset.record) rec.start()
  else if (!editing && !preset.kind) ta.focus()
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

// ---------- アプリ版(Android)のとき(v0.17.5) ----------
// アプリの中ではファイルを落とす仕組み(a の download)が効かないので、アプリの一時置き場に書いてから
// 「共有」の画面を出す(グーグルドライブ・ファイル・メールなどに、本人が選んで保存する)。
const isNativeApp = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
async function shareFileNative(name, text) {
  const C = window.Capacitor
  const w = await C.nativePromise('Filesystem', 'writeFile', { path: name, data: text, directory: 'CACHE', encoding: 'utf8' })
  try { await C.nativePromise('Share', 'share', { title: name, files: [w.uri], dialogTitle: 'バックアップの保存先を選ぶ' }) }
  catch (err) { if (!/cancel/i.test(String(err && (err.message || err)))) throw err }
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
    const audios = {}
    for (const e of entries) for (const aid of audiosOf(e)) {
      const a = await getAudio(aid)
      if (a) audios[aid] = { mime: a.mime, sec: a.sec, created_at: a.created_at, data: await blobToDataURL(a.blob) }
    }
    const data = { app: 'diary', format: 3, version: VERSION, exported_at: stamp(new Date()), entries, photos, audios, buttons: BUTTONS,
      lists: { meds: LISTS.meds, symptoms: LISTS.symptoms, withs: WITH_OPTS, tabs: TABS }, places: PLACES }
    const name = `diary-${dayOf(new Date())}.json`
    const text = JSON.stringify(data, null, 1)
    if (isNativeApp()) await shareFileNative(name, text)
    else {
      const blob = new Blob([text], { type: 'application/json' })
      const a = h('a', { href: URL.createObjectURL(blob), download: name })
      document.body.append(a)
      a.click()
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1500)
    }
    return { entries: entries.length, photos: Object.keys(photos).length, audios: Object.keys(audios).length }
  } finally { if (btn) btn.disabled = false }
}

// ---------- ファイルから読み込む(今ある記録は消さずに足す。同じ記録は新しいほうを残す) ----------
const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

function dataURLToBlob(url) {
  const m = /^data:([^,]*?)(;base64)?,(.*)$/s.exec(url || '')
  if (!m || !m[2]) throw new Error('写真・録音の形が違います')
  const bin = atob(m[3])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: m[1] || 'image/jpeg' })
}

// ファイルを読んで、何がどれだけ入るかを調べる(まだ入れない)
async function planImport(file) {
  let data
  try { data = JSON.parse(await file.text()) } catch { throw new Error('日記の書き出しファイルではないようです(読めませんでした)') }
  const other = PJ.otherFileMessage(data)
  if (other) throw new Error(other)
  if (!data || data.app !== 'diary' || !Array.isArray(data.entries)) throw new Error('日記の書き出しファイルではないようです')
  const photos = data.photos && typeof data.photos === 'object' ? data.photos : {}
  const plan = { add: [], replace: [], same: 0, bad: 0, photos: 0, exported_at: data.exported_at || '', buttons: [], buttonsAll: null }
  // ボタン: こちらでまだ一度もボタンを変えていなければ(機種変更など)、ファイルの並びをそのまま使う。
  // 変えていれば、ファイルにあってこちらにないボタン(自分で足したボタンなど)だけ足す。
  if (Array.isArray(data.buttons)) {
    const ok = data.buttons.filter(b => b && typeof b.kind === 'string' && typeof b.label === 'string' && b.label.trim() && (TABS.some(t => t.key === b.tab) || cleanTabs((data.lists || {}).tabs).some(t => t.key === b.tab)))
      .map(b => ({ kind: b.kind, label: b.label.trim().slice(0, 20), icon: typeof b.icon === 'string' ? b.icon.slice(0, 8) : '⭐', tab: b.tab, ...btnExtra(b) }))
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
    const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : undefined)
    const e = { ...raw, health: obj(raw.health), weather: obj(raw.weather), bowel: obj(raw.bowel), audios: Array.isArray(raw.audios) ? raw.audios.filter(a => typeof a === 'string') : [], at, day: at.slice(0, 10), kind: raw.kind || 'memo', text: textOf(raw), photos: Array.isArray(raw.photos) ? raw.photos.filter(p => typeof p === 'string') : [], moves: Array.isArray(raw.moves) ? raw.moves.filter(k => MOVE_BY[k]) : [], project: raw.project && typeof raw.project.title === 'string' ? { title: raw.project.title, step: typeof raw.project.step === 'string' ? raw.project.step : '' } : null }
    delete e.note
    for (const k of ['health', 'weather', 'bowel']) if (e[k] === undefined) delete e[k]
    if (e.end != null && !(AT_RE.test(e.end) && e.end > e.at)) delete e.end
    if (e.span !== true) delete e.span
    if (e.legs != null) { const lg = Array.isArray(e.legs) ? e.legs.filter(l => l && MOVE_BY[l.mode] && AT_RE.test(l.at || '')).map(l => ({ mode: l.mode, at: l.at })) : []; if (lg.length) e.legs = lg; else delete e.legs }
    const now = await getEntry(e.id)
    if (!now) plan.add.push(e)
    else if ((e.updated_at || e.at) > (now.updated_at || now.at)) plan.replace.push(e)
    else plan.same++
  }
  for (const e of [...plan.add, ...plan.replace]) for (const pid of e.photos) if (photos[pid] && !(await getPhoto(pid))) plan.photos++
  plan.photoData = photos
  const audios = data.audios && typeof data.audios === 'object' ? data.audios : {}
  plan.audios = 0
  for (const e of [...plan.add, ...plan.replace]) for (const aid of e.audios) if (audios[aid] && !(await getAudio(aid))) plan.audios++
  plan.audioData = audios
  // お薬・気になることの登録は、ないものだけ足す
  const L = data.lists && typeof data.lists === 'object' ? data.lists : {}
  plan.lists = {}
  for (const key of ['meds', 'symptoms']) {
    const add = (Array.isArray(L[key]) ? L[key] : []).filter(x => typeof x === 'string' && x.trim() && !LISTS[key].includes(x))
    if (add.length) plan.lists[key] = add
  }
  plan.tabs = cleanTabs(L.tabs).filter(t => !TABS.some(x => x.key === t.key))   // v0.21.1: 自分のタブは、ないものだけ足す
  plan.withs = cleanWiths(L.withs).filter(o => !WITH_OPTS.some(x => x.key === o.key))   // だれとは、ないもの(同じ key がないもの)だけ足す
  // 登録した場所は、ないもの(同じ id がないもの)だけ足す
  plan.places = (Array.isArray(data.places) ? data.places : []).filter(p => p && typeof p.id === 'string' && typeof p.name === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lon) && !PLACES.some(x => x.id === p.id))
    .map(p => ({ id: p.id, name: p.name.slice(0, 30), addr: typeof p.addr === 'string' ? p.addr.slice(0, 100) : '', lat: p.lat, lon: p.lon, r: Number.isFinite(p.r) ? p.r : 150, created_at: p.created_at || '' }))
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
    const keepA = []
    for (const aid of e.audios) {
      if (await getAudio(aid)) { keepA.push(aid); continue }
      const a = plan.audioData[aid]
      if (!a || !a.data) continue
      try {
        await saveAudio({ id: aid, blob: dataURLToBlob(a.data), mime: a.mime || '', sec: a.sec || 0, created_at: a.created_at || e.at })
        keepA.push(aid)
      } catch { /* 読めない録音は飛ばす */ }
    }
    await putEntry({ ...e, photos: keep, audios: keepA })
  }
  for (const [key, add] of Object.entries(plan.lists || {})) await LISTS.save(key, [...LISTS[key], ...add])
  if (plan.withs && plan.withs.length) await saveWiths([...WITH_OPTS, ...plan.withs])
  if (plan.tabs && plan.tabs.length) await saveTabs([...TABS, ...plan.tabs])
  if (plan.places && plan.places.length) await savePlaces([...PLACES, ...plan.places])
  return photos
}

// 潮位表(気象庁)を読み込む。読み込んだあとは外につながらない
function tideCard() {
  const status = h('p')
  const msg = h('p', { class: 'bk-msg', 'aria-live': 'polite' })
  const nameIn = h('input', { class: 'input', maxlength: '12', 'aria-label': '港の名前', placeholder: '港の名前' })
  const paint = () => {
    const days = TIDE && TIDE.days ? Object.keys(TIDE.days).sort() : []
    status.textContent = days.length ? `いま入っている潮位表: ${TIDE.name || TIDE.code}(${days[0]} 〜 ${days[days.length - 1]})` : 'まだ読み込んでいません。'
    nameIn.value = TIDE ? TIDE.name || '' : ''
    nameRow.hidden = !days.length
  }
  const nameRow = h('div', { class: 'add-row' }, nameIn, h('button', { type: 'button', class: 'small-btn', text: '名前を保存', onclick: async () => {
    if (!TIDE) return
    TIDE = { ...TIDE, name: nameIn.value.trim() }; await putSetting('tide', TIDE); paint(); render() } }))
  const fileIn = h('input', { type: 'file', accept: '.txt,text/plain', class: 'visually-hidden', id: 'tide-in', 'aria-label': '潮位表のファイルを選ぶ' })
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0]; fileIn.value = ''
    if (!f) return
    msg.className = 'bk-msg'
    try {
      const t = parseTide(await f.text())
      // 同じ港なら年をまたいで足す。違う港なら入れ替える
      const same = TIDE && TIDE.code === t.code
      TIDE = { code: t.code, name: same ? TIDE.name : (PORTS[t.code] || t.code), days: { ...(same ? TIDE.days : {}), ...t.days }, loaded_at: stamp(new Date()) }
      await putSetting('tide', TIDE)
      paint(); render()
      msg.className = 'bk-msg ok'; msg.textContent = `${Object.keys(t.days).length}日分を読み込みました。`
    } catch (err) { msg.className = 'bk-msg err'; msg.textContent = err.message || String(err) }
  })
  paint()
  return h('section', { class: 'bk-card' },
    h('h3', { text: '潮位表(気象庁)' }),
    h('p', { text: '気象庁の「潮位表」の、港ごとの1年分のテキストファイル(例: 大阪)を保存して、ここで読み込みます。読み込んだあとは外につながらずに、満潮・干潮の時刻が「今日の暦」に出ます。年に1回、翌年の分を読み込んでください。' }),
    h('a', { href: 'https://www.data.jma.go.jp/kaiyou/db/tide/suisan/readme.html', target: '_blank', rel: 'noopener noreferrer', class: 'ext-link', text: '気象庁の潮位表の説明ページを開く' }),
    status, fileIn, h('label', { class: 'secondary-btn as-btn', for: 'tide-in', text: '潮位表を読み込む' }), nameRow, msg)
}

// ---------- スマホの引っ越し(v0.20.1。本人「スマホ変えたときのデータ引継ぎ」「複数人の時は選択式」) ----------
// 引っ越し用ファイル = 選んだ人の置き場まるごと(記録・写真・録音・ボタンなどの設定)を、合言葉の鍵(PBKDF2 → AES-GCM)で包んだもの。
// LINE やメールで送っても、合言葉を知らない人には開けない(ルール3: 鍵をかけずに外へ出さない)。同期の鍵は入らない。
const MOVE_APP = 'diary-move'
const bytesToB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s) }
const b64ToBytes = (b) => { const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u }
async function saveTextFile(name, text) {
  if (isNativeApp()) return shareFileNative(name, text)
  const blob = new Blob([text], { type: 'application/json' })
  const a = h('a', { href: URL.createObjectURL(blob), download: name })
  document.body.append(a); a.click()
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 1500)
}
async function buildMoveFile(ids, pass) {
  const users = await listUsers()
  const people = []
  for (const u of users.filter(u => ids.includes(u.id))) {
    const d = await dumpUser(u.id)
    const photos = []; for (const p of d.photos) photos.push({ ...p, blob: await blobToDataURL(p.blob) })
    const audios = []; for (const a of d.audios) audios.push({ ...a, blob: await blobToDataURL(a.blob) })
    people.push({ meta: u, entries: d.entries, photos, audios, settings: d.settings })
  }
  const bytes = new TextEncoder().encode(JSON.stringify({ people }))
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const sealed = await S.seal(await S.deriveKey(pass, salt), salt, bytes)
  return { text: JSON.stringify({ app: MOVE_APP, format: 1, version: VERSION, exported_at: stamp(new Date()), enc: bytesToB64(sealed) }), people }
}
async function openMoveFile(file, pass) {
  let raw
  try { raw = JSON.parse(await file.text()) } catch { throw new Error('引っ越し用のファイルではないようです') }
  if (raw && raw.app === 'diary') throw new Error('これはふつうの書き出しファイルです。下の「ファイルから読み込む」で読み込んでください')
  if (!raw || raw.app !== MOVE_APP || typeof raw.enc !== 'string') throw new Error('引っ越し用のファイルではないようです')
  const u = b64ToBytes(raw.enc)
  let plain
  try { plain = await S.open(await S.deriveKey(pass, S.saltOf(u)), u) }
  catch (err) { throw new Error(String(err && err.message) === 'WRONG_PASS' ? '合言葉が違います' : '開けませんでした(ファイルが壊れているかもしれません)') }
  const data = JSON.parse(new TextDecoder().decode(plain))
  return { exported_at: raw.exported_at || '', people: Array.isArray(data.people) ? data.people.filter(p => p && p.meta && typeof p.meta.id === 'string') : [] }
}
async function restoreMove(people) {
  const out = []
  for (const p of people) {
    const conv = (list) => (list || []).map(x => { try { return { ...x, blob: dataURLToBlob(x.blob) } } catch { return null } }).filter(Boolean)
    const n = await restoreUser(p.meta.id, { entries: p.entries, photos: conv(p.photos), audios: conv(p.audios), settings: p.settings })
    out.push({ name: p.meta.name, ...n })
  }
  // 使う人の一覧: この端末でまだ保存していなければファイルのとおりに。あれば、いない人だけ足す
  const metas = people.map(p => ({ id: p.meta.id, name: String(p.meta.name || '').slice(0, 12) || 'わたし', icon: p.meta.icon || '🙂', ...(p.meta.pin ? { pin: p.meta.pin } : {}), ...(p.meta.askOnOpen ? { askOnOpen: true } : {}) }))
  let list = await usersSaved() ? await listUsers() : []
  for (const m of metas) if (!list.some(u => u.id === m.id)) list.push(m)
  if (!list.some(u => u.id === 'main')) list.unshift({ id: 'main', name: 'わたし', icon: '🙂' })
  list.sort((a, b) => (a.id === 'main' ? -1 : b.id === 'main' ? 1 : 0))
  await saveUsers(list.slice(0, 8))
  return out
}
const MOVE_STEPS = ['前のスマホ: 「バックアップ」→「📦 引っ越し用ファイルを作る」で、合言葉を決めてファイルを作る', 'そのファイルを新しいスマホへ送る(LINE の自分あて・メール・グーグルドライブなど)', '新しいスマホ: 日記を入れて開き、「📲 前のスマホから引っ越す」でファイルを選び、同じ合言葉を入れる']
const moveSteps = () => h('ol', { class: 'mvx-steps' }, ...MOVE_STEPS.map(t => h('li', { text: t })))

// 引っ越し用ファイルを作る(バックアップの画面)
function moveExportCard() {
  const box = h('div', { class: 'mvx-people' })
  const msg = h('p', { class: 'bk-msg', 'aria-live': 'polite' })
  const p1 = h('input', { type: 'password', class: 'input', autocomplete: 'new-password', placeholder: '合言葉(6文字以上)', 'aria-label': '合言葉' })
  const p2 = h('input', { type: 'password', class: 'input', autocomplete: 'new-password', placeholder: 'もう一度', 'aria-label': '合言葉をもう一度' })
  const btn = h('button', { type: 'button', class: 'primary-btn', text: '📦 引っ越し用ファイルを作る' })
  let users = [], picks = new Map()
  ;(async () => {
    users = await listUsers()
    if (users.length < 2) { picks.set(USER_ID, { on: true }); return }
    box.append(h('p', { class: 'ed-label', text: '入れる人を選んでください' }))
    for (const u of users) {
      const st = { on: true, pin: null }
      picks.set(u.id, st)
      const needPin = u.pin && u.id !== USER_ID
      const pinIn = needPin ? h('input', { type: 'password', inputmode: 'numeric', maxlength: '4', class: 'input mvx-pin', placeholder: `${u.name}さんの番号`, 'aria-label': `${u.name}さんの番号` }) : null
      if (pinIn) { st.pin = pinIn; pinIn.hidden = false }
      const chk = h('input', { type: 'checkbox', checked: true })
      chk.addEventListener('change', () => { st.on = chk.checked; if (pinIn) pinIn.hidden = !chk.checked })
      box.append(h('div', { class: 'mvx-row' }, h('label', { class: 'mvx-who' }, chk, h('span', { text: `${u.icon} ${u.name}${u.id === USER_ID ? '(いまの人)' : ''}` })), pinIn))
    }
  })()
  btn.addEventListener('click', async () => {
    msg.className = 'bk-msg err'
    const ids = [...picks].filter(([, v]) => v.on).map(([k]) => k)
    if (!ids.length) { msg.textContent = '入れる人を1人以上選んでください'; return }
    for (const u of users.filter(u => ids.includes(u.id) && u.pin && u.id !== USER_ID)) {
      const v = picks.get(u.id).pin.value.trim()
      if (await pinHash(u.id, v) !== u.pin) { msg.textContent = `${u.name}さんの番号が違います(入れるには、その人の番号が要ります)`; return }
    }
    if (p1.value.length < 6) { msg.textContent = '合言葉は6文字以上にしてください'; return }
    if (p1.value !== p2.value) { msg.textContent = '2つの合言葉が違います'; return }
    btn.disabled = true; msg.className = 'bk-msg'; msg.textContent = '作っています…(写真が多いと少しかかります)'
    try {
      const r = await buildMoveFile(ids, p1.value)
      await saveTextFile(`diary-hikkoshi-${dayOf(new Date())}.json`, r.text)
      msg.className = 'bk-msg ok'
      msg.textContent = `${r.people.map(p => `${p.meta.name}(記録 ${p.entries.length}件・写真 ${p.photos.length}枚)`).join('、')} のファイルを作りました。合言葉は忘れないでください(なくすと開けません)。`
      p1.value = ''; p2.value = ''
    } catch (err) { msg.className = 'bk-msg err'; msg.textContent = `作れませんでした: ${err.message || err}` }
    finally { btn.disabled = false }
  })
  return h('section', { class: 'bk-card' },
    h('h3', { text: '📦 スマホの引っ越し' }),
    h('p', { text: '機種変更のときに使います。記録・写真・録音・ボタン・場所をまるごと1つのファイルにして、合言葉の鍵をかけます。' }),
    moveSteps(), box,
    h('div', { class: 'mvx-pass' }, p1, p2),
    h('p', { class: 'hint', text: '合言葉は、新しいスマホで開くときに使います。メモしておいてください。' }),
    btn, msg,
    h('div', { class: 'mvx-in' }, h('p', { class: 'ed-label', text: '引っ越し用ファイルを受け取った側' }), moveImportBox()))
}
// 引っ越し用ファイルを読み込む(ようこその画面とバックアップの画面)
function moveImportBox(onStart) {
  const wrap = h('div', { class: 'mvx-imp' })
  const msg = h('p', { class: 'bk-msg', 'aria-live': 'polite' })
  const id = `mvx-file-${Math.random().toString(36).slice(2, 7)}`
  const fileIn = h('input', { type: 'file', accept: '.json,application/json', class: 'visually-hidden', id, 'aria-label': '引っ越し用ファイルを選ぶ' })
  const fname = h('p', { class: 'hint' })
  const pass = h('input', { type: 'password', class: 'input', autocomplete: 'off', placeholder: '前のスマホで決めた合言葉', 'aria-label': '合言葉' })
  const openBtn = h('button', { type: 'button', class: 'primary-btn', text: 'ファイルを開く' })
  const pickBox = h('div')
  let file = null
  fileIn.addEventListener('change', () => { file = fileIn.files[0] || null; fname.textContent = file ? `選んだファイル: ${file.name}` : ''; if (onStart) onStart() })
  openBtn.addEventListener('click', async () => {
    msg.className = 'bk-msg err'
    if (!file) { msg.textContent = '先にファイルを選んでください'; return }
    if (!pass.value) { msg.textContent = '合言葉を入れてください'; return }
    openBtn.disabled = true; msg.className = 'bk-msg'; msg.textContent = '開いています…'
    let pk
    try { pk = await openMoveFile(file, pass.value) } catch (err) { msg.className = 'bk-msg err'; msg.textContent = err.message || String(err); openBtn.disabled = false; return }
    openBtn.disabled = false; msg.textContent = ''
    if (!pk.people.length) { msg.className = 'bk-msg err'; msg.textContent = 'このファイルにはだれも入っていません'; return }
    const on = new Set(pk.people.map(p => p.meta.id))
    const go = h('button', { type: 'button', class: 'primary-btn', text: '📲 引っ越す' })
    go.addEventListener('click', async () => {
      const sel = pk.people.filter(p => on.has(p.meta.id))
      if (!sel.length) { msg.className = 'bk-msg err'; msg.textContent = '1人以上選んでください'; return }
      go.disabled = true; msg.className = 'bk-msg'; msg.textContent = '入れています…'
      try {
        const r = await restoreMove(sel)
        msg.className = 'bk-msg ok'
        msg.textContent = `引っ越しました: ${r.map(x => `${x.name}(記録 ${x.entries}件・写真 ${x.photos}枚)`).join('、')}。開き直します…`
        setTimeout(() => location.reload(), 1800)
      } catch (err) { go.disabled = false; msg.className = 'bk-msg err'; msg.textContent = `入れられませんでした: ${err.message || err}` }
    })
    pickBox.replaceChildren(
      h('p', { class: 'ed-label', text: `${pk.exported_at ? pk.exported_at.slice(0, 16).replace('T', ' ') + ' に作ったファイル。' : ''}引っ越す人を選んでください` }),
      ...pk.people.map(p => {
        const chk = h('input', { type: 'checkbox', checked: true })
        chk.addEventListener('change', () => { if (chk.checked) on.add(p.meta.id); else on.delete(p.meta.id) })
        return h('div', { class: 'mvx-row' }, h('label', { class: 'mvx-who' }, chk, h('span', { text: `${p.meta.icon || '🙂'} ${p.meta.name}(記録 ${p.entries.length}件・写真 ${p.photos.length}枚)` })))
      }),
      h('p', { class: 'hint', text: 'この端末に今ある記録は消しません。同じ記録は新しいほうを残します。' }),
      go)
  })
  wrap.append(fileIn, h('label', { class: 'secondary-btn as-btn', for: id, text: 'ファイルを選ぶ' }), fname, pass, openBtn, pickBox, msg)
  return wrap
}

// ---------- 印刷・PDF(v0.20.2。本人「印刷したいフォーマット、期間などを選択式」「サムネールなんか出して」) ----------
// 期間と形と入れるものを選ぶ → 印刷用の紙(#print-root)を作って印刷の画面を出す。スマホの印刷の画面で「PDF に保存」も選べる。
// 紙は @media print のときだけ見える(画面には出ない)。Android アプリ版は window.print が効かないので Printer(自前の小さな部品)で。
const PRT_STYLES = [
  { key: 'timeline', icon: '🕒', label: 'タイムライン', desc: '今の画面に近い形。時刻と記録が縦に並ぶ' },
  { key: 'diary', icon: '📖', label: '日記帳', desc: '1日1ページ。文章と写真が大きめ' },
  { key: 'table', icon: '📋', label: '一覧表', desc: '日付・時刻・できごとの表。見比べ向け' },
  { key: 'md', icon: '📓', label: 'MD ノート', desc: '手書きのノートの形。1行1時間の罫線に書く' },
]
const PRT_PARTS = [
  { key: 'text', label: '文章' }, { key: 'photos', label: '写真' }, { key: 'place', label: '場所' },
  { key: 'move', label: '移動・乗りかえ' }, { key: 'health', label: '体調' }, { key: 'weather', label: '天気' }, { key: 'sum', label: '1日のまとめ' },
]
const PRT_KEY = 'diary.print'
const prtLoad = () => { try { return JSON.parse(localStorage.getItem(PRT_KEY)) || {} } catch { return {} } }
const prtSave = (v) => { try { localStorage.setItem(PRT_KEY, JSON.stringify(v)) } catch { /* */ } }
const dayTitle = (day) => { const d = new Date(`${day}T12:00:00`); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${WEEKDAY[d.getDay()]})` }
function prtRange(kind, base, from, to) {
  if (kind === 'day') return [base, base]
  if (kind === 'week') { const d = new Date(`${base}T12:00:00`); const mon = addDays(base, -((d.getDay() + 6) % 7)); return [mon, addDays(mon, 6)] }
  if (kind === 'month') { const d = new Date(`${base}T12:00:00`); return [dayOf(new Date(d.getFullYear(), d.getMonth(), 1)), dayOf(new Date(d.getFullYear(), d.getMonth() + 1, 0))] }
  return from <= to ? [from, to] : [to, from]
}
async function prtDays(from, to) {
  const all = (await allEntries()).filter(e => e.day >= from && e.day <= to)
  const map = new Map()
  for (const e of all) { if (!map.has(e.day)) map.set(e.day, []); map.get(e.day).push(e) }
  return [...map.keys()].sort().map(day => ({ day, list: map.get(day).sort((a, b) => (a.at < b.at ? -1 : 1)) }))
}
// 1つの記録を、紙に書く材料にする
function prtLine(e, o) {
  const k = kindInfo(e.kind) || {}
  const sub = []
  if (e.span && e.end) sub.push(`${spanNameOf(e) || ''} 〜${e.end.slice(0, 10) !== e.day ? '翌' : ''}${hm(e.end)}(${fmtDur(durMin(e.at, e.end))})`.trim())
  if (o.move) { const lg = legSpans(e); if (lg.length) sub.push(lg.map(x => `${MOVE_BY[x.mode].icon}${MOVE_BY[x.mode].label} ${fmtDur(x.min)}`).join(' → ')) }
  if (o.place && placeName(e)) sub.push(`📍 ${placeName(e)}`)
  if (e.project && e.project.title) sub.push(`📁 ${e.project.title}${e.project.step ? ` / ${e.project.step}` : ''}`)
  if (o.health && e.health) sub.push(...healthLines(e.health))
  if (o.health && e.bowel) sub.push(bowelText(e.bowel))
  if (o.weather && e.weather) sub.push(weatherText(e.weather))
  if (o.health && e.pethealth) sub.push(petHealthText(e.pethealth))
  if (e.fun) sub.push(`${FUN_FACES[e.fun - 1]} ${FUN_WORDS[e.fun - 1]}`)
  if (e.pmood) sub.push(`🐾 ${PMOOD_FACES[e.pmood - 1]} ${PMOOD_WORDS[e.pmood - 1]}`)
  return { time: hm(e.at), icon: e.icon || k.icon || '📝', label: e.label || k.label || 'メモ', sub: sub.filter(Boolean), text: o.text ? textOf(e) : '', photos: o.photos ? photosOf(e) : [] }
}
// 1日のまとめ(長さのある記録を呼び名ごとに足す)
function prtSum(list) {
  const tot = new Map()
  for (const e of list) if (e.span && e.end) { const n = spanNameOf(e) || e.label; tot.set(n, (tot.get(n) || 0) + durMin(e.at, e.end)) }
  return [...tot].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([n, m]) => `${n} ${fmtDur(m)}`).join(' ・ ')
}
async function prtImgs(ids, cls, max) {
  const out = []
  for (const pid of ids.slice(0, max)) {
    const p = await getPhoto(pid)
    if (p && p.blob) out.push(h('img', { class: cls, src: URL.createObjectURL(p.blob), alt: '' }))
  }
  return out
}
// 紙を作る。days = prtDays の結果
async function prtBuild(style, days, o, title) {
  const root = h('div', { class: `prt prt-${style}` })
  if (style === 'table') {
    const tb = h('tbody')
    for (const d of days) {
      d.list.forEach((e, i) => {
        const L = prtLine(e, o)
        tb.append(h('tr', { class: i === 0 ? 'prt-newday' : '' },
          h('td', { class: 'prt-c-day', text: i === 0 ? dayTitle(d.day).replace(/^\d+年/, '') : '' }),
          h('td', { class: 'prt-c-time', text: L.time }),
          h('td', { class: 'prt-c-what', text: `${L.icon} ${L.label}` }),
          h('td', { class: 'prt-c-sub', text: L.sub.join(' / ') }),
          h('td', { class: 'prt-c-text', text: L.text })))
      })
      if (o.sum) { const sm = prtSum(d.list); if (sm) tb.append(h('tr', { class: 'prt-sumrow' }, h('td'), h('td', { colspan: '4', text: `まとめ: ${sm}` }))) }
    }
    root.append(h('h1', { class: 'prt-title', text: title }),
      h('table', { class: 'prt-table' }, h('colgroup', {}, ...[13, 7, 15, 37, 28].map(w => h('col', { width: `${w}%` }))), h('thead', {}, h('tr', {}, ...['日付', '時刻', 'できごと', 'くわしく', '文章'].map(t => h('th', { text: t })))), tb))
    return root
  }
  if (style === 'md') { for (const d of days) root.append(await prtMdPage(d, o)); return root }
  if (style === 'timeline') root.append(h('h1', { class: 'prt-title', text: title }))
  for (const d of days) {
    const page = h('section', { class: 'prt-day' })
    const weather = o.weather ? d.list.filter(e => e.weather).map(e => weatherText(e.weather)).filter(Boolean)[0] : ''
    page.append(h('h2', { class: 'prt-dayhead' }, h('span', { text: dayTitle(d.day) }), weather ? h('span', { class: 'prt-wx', text: weather }) : null))
    if (o.sum) { const sm = prtSum(d.list); if (sm) page.append(h('p', { class: 'prt-sum', text: `まとめ: ${sm}` })) }
    if (style === 'diary') {
      // 文章と写真のある記録を大きく、ほかは下に1行ずつ小さく
      const big = d.list.filter(e => (o.text && textOf(e)) || (o.photos && photosOf(e).length))
      for (const e of big) {
        const L = prtLine(e, o)
        page.append(h('article', { class: 'prt-entry' },
          h('p', { class: 'prt-ehead', text: `${L.time} ${L.icon} ${L.label}` }),
          L.text ? h('p', { class: 'prt-text', text: L.text }) : null,
          ...(L.photos.length ? [h('div', { class: 'prt-photos big' }, ...await prtImgs(L.photos, 'prt-img', 4))] : [])))
      }
      page.append(h('h3', { class: 'prt-sub', text: 'この日の流れ' }),
        h('ul', { class: 'prt-flow' }, ...d.list.map(e => { const L = prtLine(e, o); return h('li', {}, h('b', { text: L.time }), ` ${L.icon} ${L.label}${L.sub.length ? `  ${L.sub.join(' / ')}` : ''}`) })))
    } else {
      const ul = h('ul', { class: 'prt-tl' })
      for (const e of d.list) {
        const L = prtLine(e, o)
        ul.append(h('li', {},
          h('span', { class: 'prt-time', text: L.time }),
          h('div', { class: 'prt-body' },
            h('p', { class: 'prt-what', text: `${L.icon} ${L.label}` }),
            ...L.sub.map(t => h('p', { class: 'prt-detail', text: t })),
            L.text ? h('p', { class: 'prt-text', text: L.text }) : null,
            ...(L.photos.length ? [h('div', { class: 'prt-photos' }, ...await prtImgs(L.photos, 'prt-img', 3))] : []))))
      }
      page.append(ul)
    }
    root.append(page)
  }
  return root
}
// MD ノートの形(v0.20.2。本人の手書きのノートに合わせる): 1日1ページ。上に【 月/日 】曜日と天気、右上に緑の小さなメモ(1日のまとめ)。
// 罫線の1行が1時間(左に時刻の番号)。その時間の行に「8:00 出発 8:40 出社」と書き、長い時間(1時間半以上。睡眠は除く)は左に縦線。
// 右に「今日の体調」。下の空いた行に文章。A5 のノートと A4 は形が同じなので、A4 に1日1ページで大きくした形になる。
async function prtMdPage(d, o) {
  const dt = new Date(`${d.day}T12:00:00`)
  const wx = o.weather ? d.list.filter(e => e.weather).map(e => weatherText(e.weather)).filter(Boolean)[0] || '' : ''
  const hourOf = (at) => Number(at.slice(11, 13))
  const startH = 0, rows = []   // v0.20.3: 本人「上は0時にならなきゃ」→ いつも 0〜24時の25行
  for (let hh = startH; hh <= 24; hh++) rows.push({ hh, items: [], bar: false })
  const rowOf = (hh) => rows[Math.max(0, Math.min(rows.length - 1, hh - startH))]
  for (const e of d.list) {
    const L = prtLine(e, o)
    if ((e.health || e.weather || e.bowel) && ['health', 'weather', 'bowel'].includes((kindInfo(e.kind) || {}).form)) continue   // 天気は上、体調は右に書く
    let t = `${Number(L.time.slice(0, 2))}:${L.time.slice(3)} ${L.label}`
    const lg = o.move ? legSpans(e) : []
    if (lg.length) t += `(${lg.map(x => MOVE_BY[x.mode].label).join('→')})`
    if (o.place && placeName(e) && !lg.length) t += `(${placeName(e)})`
    if (e.span && e.end && !isMoment(e)) t += ` 〜${hourOf(e.end) + (e.end.slice(0, 10) !== e.day ? 24 : 0)}:${e.end.slice(14, 16)}`
    if (e.fun) t += ` ${FUN_FACES[e.fun - 1]}`
    if (e.pmood) t += ` 🐾${PMOOD_FACES[e.pmood - 1]}`
    rowOf(hourOf(e.at)).items.push(t)
    if (e.span && e.end && e.kind !== 'sleep' && durMin(e.at, e.end) >= 90) {
      const h2 = Math.min(24, hourOf(e.end) + (e.end.slice(0, 10) !== e.day ? 24 : 0))
      for (let hh = hourOf(e.at) + 1; hh <= h2; hh++) rowOf(hh).bar = true
    }
  }
  const health = o.health ? d.list.flatMap(e => [...(e.health ? healthLines(e.health) : []), ...(e.bowel ? [bowelText(e.bowel)] : [])]) : []
  const texts = o.text ? d.list.filter(e => textOf(e)).map(e => `${Number(hm(e.at).slice(0, 2))}:${hm(e.at).slice(3)} ${textOf(e)}`) : []
  const photos = o.photos ? d.list.flatMap(e => photosOf(e)) : []
  const sm = o.sum ? prtSum(d.list) : ''
  return h('section', { class: 'prt-mdpage' },
    h('div', { class: 'prt-md-head' },
      h('span', { class: 'prt-md-date', text: `【 ${dt.getMonth() + 1}/${dt.getDate()} 】 ${WEEKDAY[dt.getDay()]}` }),
      h('span', { class: 'prt-md-wx', text: wx })),
    h('p', { class: 'prt-md-note', text: sm }),
    h('div', { class: 'prt-md-grid' },
      h('div', { class: 'prt-md-rows' }, ...rows.map(r => h('div', { class: 'prt-md-row' + (r.bar ? ' bar' : '') },
        h('span', { class: 'prt-md-num', text: r.hh >= 8 ? String(r.hh) : '' }),
        h('span', { class: 'prt-md-txt', text: r.items.join('　') })))),
      health.length ? h('div', { class: 'prt-md-side' }, h('p', { class: 'prt-md-sidet', text: '今日の体調' }), ...health.map(t => h('p', { text: t }))) : null),
    ...texts.map(t => h('p', { class: 'prt-md-free', text: t })),
    ...[0, 1, 2].map(() => h('p', { class: 'prt-md-free' })),
    ...(photos.length ? [h('div', { class: 'prt-photos' }, ...await prtImgs(photos, 'prt-img', 4))] : []))
}
// 紙を印刷の画面へ。写真が読み終わるのを待ってから
async function prtGo(paper, name) {
  document.getElementById('print-root')?.remove()
  const holder = h('div', { id: 'print-root' }, paper)
  document.body.append(holder)
  await Promise.all([...holder.querySelectorAll('img')].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r })))
  if (isNativeApp()) { await window.Capacitor.nativePromise('Printer', 'print', { name }); return }
  const done = () => { window.removeEventListener('afterprint', done); setTimeout(() => holder.remove(), 500) }
  window.addEventListener('afterprint', done)
  window.print()
}
function openPrint() {
  const sheet = $('#sheet')
  const saved = prtLoad()
  const st = { range: saved.range || 'day', style: saved.style || 'timeline', parts: { text: true, photos: true, place: true, move: true, health: true, weather: true, sum: true, ...(saved.parts || {}) }, from: shownDay(), to: shownDay() }
  const close = () => { sheet.hidden = true; sheet.replaceChildren(); document.body.classList.remove('no-scroll') }
  const info = h('p', { class: 'prt-info', 'aria-live': 'polite' })
  const thumbs = h('div', { class: 'prt-styles' })
  const fromIn = h('input', { type: 'date', class: 'input small', value: st.from, 'aria-label': 'いつから' })
  const toIn = h('input', { type: 'date', class: 'input small', value: st.to, 'aria-label': 'いつまで' })
  const custom = h('div', { class: 'prt-custom' }, fromIn, h('span', { text: '〜' }), toIn)
  const rangeRow = h('div', { class: 'prt-seg', role: 'group', 'aria-label': '期間' })
  const goBtn = h('button', { type: 'button', class: 'primary-btn', text: '🖨 印刷する(PDF にも)' })
  let days = [], seq = 0
  const RANGES = [['day', '1日'], ['week', '1週間'], ['month', '1か月'], ['custom', '日付を選ぶ']]
  const paintRange = () => {
    rangeRow.replaceChildren(...RANGES.map(([k, t]) => h('button', { type: 'button', class: 'prt-segbtn', 'aria-pressed': st.range === k ? 'true' : 'false', text: t, onclick: () => { st.range = k; refresh() } })))
    custom.hidden = st.range !== 'custom'
  }
  // 形のサムネイル: 本当の記録の最初の日を、小さくした紙で見せる
  const paintThumbs = async () => {
    const my = ++seq
    const sample = days.length ? [days[0]] : []
    const cards = []
    for (const s of PRT_STYLES) {
      const page = h('div', { class: 'prt-thumb-page' })
      if (sample.length) page.append(await prtBuild(s.key, sample, { ...st.parts, photos: st.parts.photos }, '日記'))
      else page.append(h('p', { class: 'prt-thumb-empty', text: '記録がありません' }))
      cards.push(h('button', { type: 'button', class: 'prt-card', 'aria-pressed': st.style === s.key ? 'true' : 'false', onclick: () => { st.style = s.key; paintThumbsSel() } },
        h('div', { class: 'prt-thumb', 'aria-hidden': 'true' }, page),
        h('span', { class: 'prt-cname', text: `${s.icon} ${s.label}` }), h('span', { class: 'prt-cdesc', text: s.desc })))
    }
    if (my === seq) thumbs.replaceChildren(...cards)
    requestAnimationFrame(() => thumbs.querySelectorAll('.prt-thumb').forEach(t => { t.firstChild.style.setProperty('--prt-scale', String(t.clientWidth / 794)) }))
  }
  const paintThumbsSel = () => { [...thumbs.children].forEach((c, i) => c.setAttribute('aria-pressed', PRT_STYLES[i].key === st.style ? 'true' : 'false')); prtSave({ range: st.range, style: st.style, parts: st.parts }) }
  const refresh = async () => {
    paintRange()
    const [a, b] = prtRange(st.range, shownDay(), fromIn.value || shownDay(), toIn.value || shownDay())
    days = await prtDays(a, b)
    const n = days.reduce((x, d) => x + d.list.length, 0)
    info.textContent = `${dayTitle(a)}${a !== b ? ` 〜 ${dayTitle(b)}` : ''} ・ 記録のある日 ${days.length}日 ・ 記録 ${n}件`
    goBtn.disabled = !n
    prtSave({ range: st.range, style: st.style, parts: st.parts })
    paintThumbs()
  }
  fromIn.addEventListener('change', refresh); toIn.addEventListener('change', refresh)
  const parts = h('div', { class: 'prt-parts' }, ...PRT_PARTS.map(pt => {
    const c = h('input', { type: 'checkbox', checked: !!st.parts[pt.key] })
    c.addEventListener('change', () => { st.parts[pt.key] = c.checked; refresh() })
    return h('label', { class: 'prt-part' }, c, h('span', { text: pt.label }))
  }))
  goBtn.addEventListener('click', async () => {
    goBtn.disabled = true
    try {
      const [a, b] = prtRange(st.range, shownDay(), fromIn.value, toIn.value)
      const s = PRT_STYLES.find(x => x.key === st.style)
      const title = `日記 ${dayTitle(a)}${a !== b ? ` 〜 ${dayTitle(b)}` : ''}`
      await prtGo(await prtBuild(st.style, days, st.parts, title), `nikki-${a}${a !== b ? `_${b}` : ''}-${s.key}`)
    } catch (err) { info.textContent = `印刷の画面を出せませんでした: ${err.message || err}` }
    finally { goBtn.disabled = false }
  })
  sheet.replaceChildren(h('div', { class: 'sheet-inner', role: 'dialog', 'aria-modal': 'true', 'aria-label': '印刷' },
    h('div', { class: 'sheet-top' }, h('h2', { text: '🖨 印刷・PDF' }), h('button', { type: 'button', class: 'link-btn', text: '閉じる', onclick: close })),
    h('div', { class: 'sheet-body' },
      h('h3', { class: 'prt-h', text: '期間' }), rangeRow, custom,
      h('p', { class: 'hint', text: `「1日」「1週間」「1か月」は、いま見ている日(${dayTitle(shownDay())})をもとにします。` }),
      info,
      h('h3', { class: 'prt-h', text: '形' }), thumbs,
      h('h3', { class: 'prt-h', text: '入れるもの' }), parts,
      h('p', { class: 'hint', text: '印刷の画面で、プリンターの代わりに「PDF に保存」を選ぶと PDF になります。体調や場所も入るので、紙・PDF の扱いに気をつけてください。' })),
    h('div', { class: 'sheet-foot' }, goBtn)))
  sheet.hidden = false
  document.body.classList.add('no-scroll')
  refresh()
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
      msg.textContent = `記録 ${n.entries}件・写真 ${n.photos}枚${n.audios ? `・録音 ${n.audios}本` : ''}を書き出しました。${isNativeApp() ? '選んだ保存先に入ります。' : 'スマホの「ダウンロード」に入ります。'}`
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
    const go = n || plan.buttons.length || plan.buttonsAll || (plan.places && plan.places.length)
    msg.textContent = ''
    const lines = [
      `ファイル: ${f.name}${plan.exported_at ? `(${plan.exported_at.slice(0, 16).replace('T', ' ')} に書き出したもの)` : ''}`,
      `新しく足す記録: ${plan.add.length}件`,
      plan.replace.length ? `こちらより新しいので入れ替える記録: ${plan.replace.length}件` : null,
      `すでにあるので、そのままにする記録: ${plan.same}件`,
      `新しく足す写真: ${plan.photos}枚`,
      plan.audios ? `新しく足す録音: ${plan.audios}本` : null,
      plan.places && plan.places.length ? `足す場所: ${plan.places.map(p => p.name).join('・')}` : null,
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
        h('h3', { text: '🖨 印刷・PDF' }),
        h('p', { text: '期間(1日・1週間・1か月・日付を選ぶ)と形(タイムライン・日記帳・一覧表)を選んで、紙や PDF にします。' }),
        h('button', { type: 'button', class: 'primary-btn', text: '印刷の画面を開く', onclick: openPrint })),
      moveExportCard(),
      h('section', { class: 'bk-card' },
        h('h3', { text: 'ファイルに書き出す' }),
        h('p', { text: '記録を文章・写真・録音ごと1つのファイル(.json)にします。ときどき書き出して、PC などに移しておくと安心です。' }),
        h('p', { class: 'warn-note', text: '体調の記録や、行った場所の位置も入るので、ファイルは人に渡さないでください。' }),
        expBtn),
      h('section', { class: 'bk-card' },
        h('h3', { text: 'ファイルから読み込む' }),
        h('p', { text: '書き出したファイルから戻します。今ある記録は消さずに足します(機種変更のときなど)。' }),
        fileIn,
        h('label', { class: 'secondary-btn as-btn', for: 'import-in', text: 'ファイルを選ぶ' }),
        confirmBox),
      msg,
      syncCard(),
      PJ.namesCard(),
      tideCard(),
      h('section', { class: 'bk-note' },
        h('h3', { text: '記録はどこにある?' }),
        h('p', { text: 'この端末のブラウザの中(この住所専用の保存場所)にあります。同期を使うと、合言葉の鍵をかけたものがグーグルドライブのアプリ専用の隠しフォルダにも置かれます(Google にも中身は読めません)。同期を使わなければ、どこにも送りません。' }),
        h('p', { text: 'ブラウザの「サイトのデータを削除」、アプリの削除、機種変更・初期化で消えます。その前に書き出してください。' })),
    )))
  sheet.hidden = false
  document.body.classList.add('no-scroll')
}

// ---------- 統計(移動手段・睡眠・食事) ----------
const PERIODS = [{ key: 'week', label: '今週' }, { key: 'month', label: '今月' }, { key: 'year', label: '今年' }, { key: 'all', label: '全部' }]
function periodStart(key) {
  const d = new Date(); d.setHours(0, 0, 0, 0)
  if (key === 'week') { d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dayOf(d) }   // 月曜から
  if (key === 'month') return `${dayOf(d).slice(0, 8)}01`
  if (key === 'year') return `${dayOf(d).slice(0, 4)}-01-01`
  return '0000-00-00'
}
const STATS_KEY = 'diary.statsPeriod'
// ---------- 1日の円グラフ・勤務時間(v0.17.4。本人「1日の時間を円グラフに」「勤務時間も入れて」) ----------
// 1分ずつ、いちばん優先の高い種類を入れる(勤務中の昼休みは「休憩・食事」、移動は何より優先)
const PIE_CATS = [
  { key: 'none', label: '記録なし', cls: 'pc-none' },
  { key: 'sleep', label: '睡眠', cls: 'pc-sleep', pri: 35 },
  { key: 'work', label: '勤務・作業', cls: 'pc-work', pri: 20 },
  { key: 'move', label: '移動', cls: 'pc-move', pri: 60 },
  { key: 'out', label: '外出', cls: 'pc-out', pri: 40 },
  { key: 'meal', label: '食事・昼休み', cls: 'pc-meal', pri: 50 },
  { key: 'rest', label: '休憩', cls: 'pc-rest', pri: 45 },
  { key: 'other', label: 'そのほか', cls: 'pc-other', pri: 30 },
]
const PIE_IDX = Object.fromEntries(PIE_CATS.map((c, i) => [c.key, i]))
function pieCat(e) {
  if (isMoveEntry(e)) return 'move'
  return ({ 'band-sleep': 'sleep', 'band-work': 'work', 'band-out': 'out', 'band-meal': 'meal', 'band-rest': 'rest' })[BAND_COLOR[e.kind]] || 'other'
}
// その日の 1440分ぶんの種類(PIE_CATS の番号)。記録が1つもない日は null
function dayMinutes(day, all) {
  const d0 = new Date(day + 'T00:00:00').getTime(), d1 = d0 + 86400000
  const now = Date.now()
  const mins = new Uint8Array(1440)
  let any = false
  for (const e of all) {
    if (e.day === day) any = true
    if (!e.span) continue
    const a = new Date(e.at).getTime()
    const b = e.end ? new Date(e.end).getTime() : (e.day <= day && d0 <= now && now < d1 ? now : a)
    if (b <= d0 || a >= d1 || b <= a) continue
    any = true
    const ci = PIE_IDX[pieCat(e)], pri = PIE_CATS[ci].pri
    for (let m = Math.max(0, Math.floor((a - d0) / 60000)); m < Math.min(1440, Math.ceil((b - d0) / 60000)); m++) {
      const cur = mins[m]
      if (!cur || PIE_CATS[cur].pri < pri) mins[m] = ci
    }
  }
  return any ? mins : null
}
const SVGNS = 'http://www.w3.org/2000/svg'
function svgEl(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(SVGNS, tag)
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v))
  for (const k of kids) if (k) el.append(typeof k === 'string' ? document.createTextNode(k) : k)
  return el
}
// ドーナツの1切れ(角度は 0=上、時計回り。単位は割合 0〜1)
function arcPath(f0, f1, R = 92, r = 56, c = 100) {
  if (f1 - f0 >= 0.9999) f1 = f0 + 0.9999
  const pt = (f, rad) => { const t = f * 2 * Math.PI; return [c + rad * Math.sin(t), c - rad * Math.cos(t)] }
  const [x0, y0] = pt(f0, R), [x1, y1] = pt(f1, R), [x2, y2] = pt(f1, r), [x3, y3] = pt(f0, r)
  const big = f1 - f0 > 0.5 ? 1 : 0
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 ${big} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}A${r} ${r} 0 ${big} 0 ${x3.toFixed(2)} ${y3.toFixed(2)}Z`
}
// 時計の円(その日の何時に何をしていたか)
function clockPie(mins, center) {
  const svg = svgEl('svg', { viewBox: '0 0 200 200', class: 'pie', role: 'img', 'aria-label': '1日の円グラフ' })
  let start = 0
  for (let m = 1; m <= 1440; m++) {
    if (m === 1440 || mins[m] !== mins[start]) {
      const c = PIE_CATS[mins[start]]
      svg.append(svgEl('path', { d: arcPath(start / 1440, m / 1440), class: c.cls }, svgEl('title', {}, `${c.label} ${pad(Math.floor(start / 60))}:${pad(start % 60)}〜${pad(Math.floor(m / 60))}:${pad(m % 60)}`)))
      start = m
    }
  }
  for (let hh = 0; hh < 24; hh++) {
    const t = hh / 24 * 2 * Math.PI, big = hh % 6 === 0
    const r1 = big ? 50 : 53
    svg.append(svgEl('line', { x1: 100 + r1 * Math.sin(t), y1: 100 - r1 * Math.cos(t), x2: 100 + 56 * Math.sin(t), y2: 100 - 56 * Math.cos(t), class: 'pie-tick' }))
    if (big) svg.append(svgEl('text', { x: 100 + 41 * Math.sin(t), y: 100 - 41 * Math.cos(t) + 4, class: 'pie-hour' }, String(hh)))
  }
  svg.append(svgEl('text', { x: 100, y: 104, class: 'pie-center' }, center))
  return svg
}
// 割合の円(平均の1日。種類ごとにまとめる)
function sharePie(avg, center) {
  const svg = svgEl('svg', { viewBox: '0 0 200 200', class: 'pie', role: 'img', 'aria-label': '平均の1日の円グラフ' })
  const total = avg.reduce((a, b) => a + b, 0) || 1
  let f = 0
  avg.forEach((v, i) => { if (!v) return; const c = PIE_CATS[i]; svg.append(svgEl('path', { d: arcPath(f, f + v / total), class: c.cls }, svgEl('title', {}, `${c.label} ${fmtDur(v)}`))); f += v / total })
  svg.append(svgEl('text', { x: 100, y: 104, class: 'pie-center' }, center))
  return svg
}
function pieLegend(minsByCat) {
  return h('div', { class: 'pie-legend' }, ...PIE_CATS.map((c, i) => [c, i]).filter(([, i]) => minsByCat[i] >= 1)
    .sort((a, b) => (a[1] === 0) - (b[1] === 0) || minsByCat[b[1]] - minsByCat[a[1]])
    .map(([c, i]) => h('span', { class: 'pie-key' }, h('i', { class: `pie-dot ${c.cls}` }), `${c.label} `, h('strong', { text: fmtDur(minsByCat[i]) }))))
}
// 勤務(出社〜退社)。昼休み・休憩の重なりを引いた「実働」も出す
function workDays(all, inP) {
  const rests = all.filter(e => e.span && e.end && (e.kind === 'lunch' || e.kind === 'break'))
  const byDay = new Map()
  for (const e of all) {
    if (e.kind !== 'arrive' || !e.span || !e.end || !inP(e.day)) continue
    const a = new Date(e.at).getTime(), b = new Date(e.end).getTime()
    let rest = 0
    for (const r of rests) { const x = Math.max(a, new Date(r.at).getTime()), y = Math.min(b, new Date(r.end).getTime()); if (y > x) rest += (y - x) / 60000 }
    const d = byDay.get(e.day) || { day: e.day, gross: 0, net: 0, at: e.at, end: e.end }
    d.gross += (b - a) / 60000; d.net += (b - a) / 60000 - rest
    if (e.at < d.at) d.at = e.at
    if (e.end > d.end) d.end = e.end
    byDay.set(e.day, d)
  }
  return [...byDay.values()].sort((x, y) => (x.day < y.day ? -1 : 1))
}

async function openStats() {
  const sheet = $('#sheet')
  const close = () => { sheet.hidden = true; sheet.replaceChildren(); document.body.classList.remove('no-scroll') }
  const all = await allEntries()
  let period = (() => { try { return localStorage.getItem(STATS_KEY) || 'month' } catch { return 'month' } })()
  let pieDay = today, pieMode = 'day'
  const body = h('div', { class: 'sheet-body' })
  const bars = (rows, unit = 'min') => {
    const max = Math.max(1, ...rows.map(r => r.value))
    return h('div', { class: 'st-bars' }, ...rows.map(r => h('div', { class: 'st-row' },
      h('div', { class: 'st-name' }, h('span', { 'aria-hidden': 'true', text: r.icon || '' }), ` ${r.label}`),
      h('div', { class: 'st-track' }, (() => { const f = h('div', { class: 'st-fill' }); f.style.width = `${Math.max(2, r.value / max * 100)}%`; return f })()),
      h('div', { class: 'st-num' }, h('strong', { text: unit === 'min' ? fmtDur(r.value) : String(r.value) }), r.sub ? h('span', { class: 'st-sub', text: r.sub }) : null))))
  }
  const hmAvg = (list) => {   // 時刻の平均(夜またぎを考えて、正午を基準にする)
    if (!list.length) return '-'
    const mins = list.map(t => { let m = Number(t.slice(11, 13)) * 60 + Number(t.slice(14, 16)); if (m < 12 * 60) m += 24 * 60; return m })
    const a = Math.round(mins.reduce((x, y) => x + y, 0) / mins.length) % (24 * 60)
    return `${pad(Math.floor(a / 60))}:${pad(a % 60)}`
  }
  const paint = () => {
    const from = periodStart(period)
    const inP = (day) => day >= from && day <= today
    // 移動手段
    const byMode = new Map()
    let untimed = 0
    for (const e of all) {
      const spans = legSpans(e).filter(x => !x.live && inP(x.at.slice(0, 10)))
      for (const x of spans) { const r = byMode.get(x.mode) || { min: 0, n: 0 }; r.min += x.min; r.n++; byMode.set(x.mode, r) }
      if (!legsOf(e).length && movesOf(e).length && inP(e.day)) untimed += movesOf(e).length
    }
    const modeRows = MOVES.filter(m => byMode.has(m.key)).map(m => { const r = byMode.get(m.key); return { icon: m.icon, label: m.label, value: Math.round(r.min), sub: `${r.n}回・平均 ${fmtDur(r.min / r.n)}` } })
      .sort((a, b) => b.value - a.value)
    // 通勤(出発 → 出社)
    const byId = new Map(all.map(e => [e.id, e]))
    const commutes = all.filter(e => e.span && e.end && e.end_by && (byId.get(e.end_by) || {}).kind === 'arrive' && inP(e.day))
    const commuteAvg = commutes.length ? commutes.reduce((a, e) => a + durMin(e.at, e.end), 0) / commutes.length : 0
    // 睡眠(起きた日で数える)
    const sleeps = all.filter(e => e.kind === 'sleep' && e.span && e.end && inP(e.end.slice(0, 10)))
    const sleepMins = sleeps.map(e => durMin(e.at, e.end))
    const sleepAvg = sleepMins.length ? sleepMins.reduce((a, b) => a + b, 0) / sleepMins.length : 0
    const recent = [...sleeps].sort((a, b) => (a.end < b.end ? 1 : -1)).slice(0, 7).reverse()
    // 食事
    const meals = all.filter(e => e.kind === 'meal' && e.span && e.end && inP(e.day))
    const mealMins = meals.map(e => durMin(e.at, e.end))
    const mealAvg = mealMins.length ? mealMins.reduce((a, b) => a + b, 0) / mealMins.length : 0
    const mealDays = new Set(meals.map(e => e.day)).size
    const slot = (e) => { const hh = Number(e.at.slice(11, 13)); return hh < 10 ? '朝' : hh < 15 ? '昼' : hh < 18 ? 'おやつ' : '夜' }
    const slots = ['朝', '昼', 'おやつ', '夜'].map(sname => { const l = meals.filter(e => slot(e) === sname); return { label: sname, n: l.length, avg: l.length ? l.reduce((a, e) => a + durMin(e.at, e.end), 0) / l.length : 0 } })

    // 1日の円グラフ
    let pieBox
    if (pieMode === 'day') {
      const mins = dayMinutes(pieDay, all)
      const pick = h('input', { type: 'date', class: 'input pie-date', value: pieDay, max: today, 'aria-label': '円グラフの日' })
      pick.addEventListener('change', () => { if (pick.value) { pieDay = pick.value; paint() } })
      const cnt = new Array(PIE_CATS.length).fill(0)
      if (mins) for (const m of mins) cnt[m]++
      pieBox = h('div', {}, h('div', { class: 'pie-bar' }, pick),
        mins ? h('div', { class: 'pie-wrap' }, clockPie(mins, `${Number(pieDay.slice(5, 7))}/${Number(pieDay.slice(8, 10))}`), pieLegend(cnt))
          : h('p', { class: 'muted', text: 'この日は記録がありません。' }))
    } else {
      const sum = new Array(PIE_CATS.length).fill(0)
      let n = 0
      const days = [...new Set(all.map(e => e.day))].filter(d => inP(d) && d < today)
      for (const d of days) { const mins = dayMinutes(d, all); if (!mins || mins.filter(x => x).length < 8 * 60) continue; n++; for (const m of mins) sum[m]++ }   // 記録が8時間に満たない日は入れない(平均がうすまるので)
      const avg = sum.map(v => (n ? v / n : 0))
      pieBox = n ? h('div', {}, h('p', { class: 'st-line', text: `記録が8時間以上ある ${n}日の平均(今日は入れていません)` }),
        h('div', { class: 'pie-wrap' }, sharePie(avg, '平均の1日'), pieLegend(avg)))
        : h('p', { class: 'muted', text: 'この期間には、記録が8時間以上ある日がまだありません。' })
    }
    // 勤務
    const WL = workLabels()
    const works = workDays(all, inP)
    const wGross = works.reduce((a, d) => a + d.gross, 0), wNet = works.reduce((a, d) => a + d.net, 0)
    const wRecent = works.slice(-7)
    // ふりかえり(v0.18): 遊び・楽しかった度・よく行った場所・写真
    const playKinds = new Set([...PLAY_KINDS, ...CAND_KINDS, ...BUTTONS.filter(b => b.tab === 'play').map(b => b.kind)])
    const inPer = all.filter(e => inP(e.day))
    const plays = inPer.filter(e => playKinds.has(e.kind))
    const playMin = (e) => (e.span && e.end ? durMin(e.at, e.end) : 0)
    const byPlay = new Map()
    for (const e of plays) { const r = byPlay.get(e.kind) || { icon: e.icon, label: e.label, min: 0, n: 0 }; r.min += playMin(e); r.n++; byPlay.set(e.kind, r) }
    const playRows = [...byPlay.values()].sort((a, b) => b.n - a.n || b.min - a.min).map(r => ({ icon: r.icon, label: r.label, value: r.n, sub: r.min ? fmtDur(r.min) : '' }))
    const funs = inPer.filter(e => e.fun)
    const funByDay = new Map()
    for (const e of funs) { const r = funByDay.get(e.day) || { day: e.day, max: 0, sum: 0, n: 0, best: e }; r.sum += e.fun; r.n++; if (e.fun > r.max) { r.max = e.fun; r.best = e } funByDay.set(e.day, r) }
    const bestDay = [...funByDay.values()].sort((a, b) => b.max - a.max || b.sum - a.sum)[0]
    const placeCnt = new Map()
    for (const e of inPer) if (e.place && e.place.id) { const nm = (PLACES.find(x => x.id === e.place.id) || e.place).name; placeCnt.set(nm, (placeCnt.get(nm) || 0) + 1) }
    const topPlaces = [...placeCnt.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    const nPhotos = inPer.reduce((a, e) => a + photosOf(e).length, 0)
    const withCnt = WITH_OPTS.map(o => ({ icon: o.icon, label: o.label, value: inPer.filter(e => (e.with || []).includes(o.key)).length, sub: '' })).filter(r => r.value).sort((a, b) => b.value - a.value)
    const daysRec = new Set(inPer.map(e => e.day)).size
    // スタンプラリー(登録した場所に、いちどでも行ったか。全部の期間)
    const firstVisit = new Map()
    for (const e of all) if (e.place && e.place.id && (!firstVisit.has(e.place.id) || e.day < firstVisit.get(e.place.id))) firstVisit.set(e.place.id, e.day)
    // 続けて記録した日数(今日か昨日まで続いているもの)と、いちばん長かった記録
    const streak = (days) => {
      const set = new Set(days)
      let cur = 0, d = set.has(today) ? today : addDays(today, -1)
      while (set.has(d)) { cur++; d = addDays(d, -1) }
      const sorted = [...set].sort()
      let best = 0, run = 0, prev = null
      for (const x of sorted) { run = prev && addDays(prev, 1) === x ? run + 1 : 1; best = Math.max(best, run); prev = x }
      return { cur, best }
    }
    const stRec = streak(all.map(e => e.day))
    const stWake = streak(all.filter(e => e.kind === 'wake').map(e => e.day))
    const stDiary = streak(all.filter(e => (e.text || '').trim() || photosOf(e).length).map(e => e.day))
    const BADGES = [[3, '🥉'], [7, '🥈'], [30, '🥇'], [100, '🏆'], [365, '👑']]
    const badgeRow = (label, st) => h('div', { class: 'bdg-row' },
      h('div', { class: 'bdg-name' }, h('strong', { text: label }), h('span', { class: 'st-sub', text: `いま ${st.cur}日 ・ いちばん長い ${st.best}日` })),
      h('div', { class: 'bdg-list' }, ...BADGES.map(([n, ic]) => h('span', { class: 'bdg' + (st.best >= n ? ' on' : ''), title: `${n}日続けた` }, h('b', { text: ic }), h('small', { text: `${n}日` })))))
    body.replaceChildren(
      h('div', { class: 'st-periods', role: 'tablist' }, ...PERIODS.map(p => h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': p.key === period ? 'true' : 'false', text: p.label,
        onclick: () => { period = p.key; try { localStorage.setItem(STATS_KEY, period) } catch { /* */ } paint() } }))),
      h('section', { class: 'st-card' }, h('h3', { text: '🎉 ふりかえり' }),
        h('div', { class: 'rv-grid' },
          h('div', { class: 'rv-tile' }, h('small', { text: '記録した日' }), h('strong', { text: `${daysRec}日` })),
          h('div', { class: 'rv-tile' }, h('small', { text: '遊んだ回数' }), h('strong', { text: `${plays.length}回` })),
          h('div', { class: 'rv-tile' }, h('small', { text: '遊んだ時間' }), h('strong', { text: fmtDur(plays.reduce((a, e) => a + playMin(e), 0)) })),
          h('div', { class: 'rv-tile' }, h('small', { text: '写真' }), h('strong', { text: `${nPhotos}枚` }))),
        bestDay ? h('button', { type: 'button', class: 'rv-best', onclick: () => { close(); goDay(bestDay.day) } },
          h('span', { class: 'rv-face', text: FUN_FACES[bestDay.max - 1] }),
          h('span', {}, h('small', { text: 'いちばん楽しかった日' }), h('strong', { text: `${Number(bestDay.day.slice(5, 7))}/${Number(bestDay.day.slice(8, 10))} ${bestDay.best.icon || ''} ${bestDay.best.label}` })),
          h('span', { class: 'rv-go', text: '▶' })) : null,
        funs.length ? h('p', { class: 'st-line', text: `楽しかった度の平均 ${FUN_FACES[Math.round(funs.reduce((a, e) => a + e.fun, 0) / funs.length) - 1]} ${(funs.reduce((a, e) => a + e.fun, 0) / funs.length).toFixed(1)}(${funs.length}件)` }) : null,
        playRows.length ? h('div', {}, h('p', { class: 'st-sub2', text: '遊び(回数)' }), bars(playRows, 'n')) : h('p', { class: 'muted', text: '「遊び」のタブのボタンを押すと、ここに集まります。終わったら、記録のカードで楽しかった度も付けてみてください。' }),
        withCnt.length ? h('div', {}, h('p', { class: 'st-sub2', text: 'だれと(回数)' }), bars(withCnt, 'n')) : null,
        topPlaces.length ? h('p', { class: 'st-line', text: `よく行った場所: ${topPlaces.map(([n, c]) => `${n}(${c}回)`).join('、')}` }) : null),
      h('section', { class: 'st-card' }, h('h3', { text: '🏅 続けた記録' }),
        badgeRow('記録した日', stRec), badgeRow('起床を押した日', stWake), badgeRow('文章か写真を残した日', stDiary)),
      h('section', { class: 'st-card' }, h('h3', { text: '🗺️ スタンプラリー' }),
        PLACES.length ? h('div', {},
          h('p', { class: 'st-line', text: `登録した場所 ${PLACES.length}か所のうち ${PLACES.filter(x => firstVisit.has(x.id)).length}か所に行きました` }),
          h('div', { class: 'stamp-grid' }, ...PLACES.map(x => { const d = firstVisit.get(x.id); return h('div', { class: 'stamp' + (d ? ' on' : '') },
            h('span', { class: 'stamp-mark', text: d ? '📍' : '・' }), h('span', { class: 'stamp-name', text: x.name }), h('small', { text: d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}〜` : 'まだ' })) })))
          : h('p', { class: 'muted', text: '右上の「場所」で行きたい場所・よく行く場所を登録すると、行くたびにスタンプがたまります。' })),
      h('section', { class: 'st-card' }, h('h3', { text: '🕐 1日の円グラフ' }),
        h('div', { class: 'st-periods pie-modes', role: 'tablist' }, ...[['day', 'この日'], ['avg', '期間の平均']].map(([k, l]) => h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': k === pieMode ? 'true' : 'false', text: l,
          onclick: () => { pieMode = k; paint() } }))),
        pieBox,
        h('p', { class: 'hint', text: '時間が重なっているときは、移動 → 食事・昼休み → 休憩 → 外出 → 睡眠 → そのほか → 勤務・作業 の順に優先して色を付けています。' })),
      h('section', { class: 'st-card' }, h('h3', { text: `🏢 ${SPAN_NAME.arrive}(${WL.a}〜${WL.o})` }),
        works.length ? h('div', {},
          h('p', { class: 'st-big', text: `実働 ${fmtDur(wNet)}` }),
          h('p', { class: 'st-line', text: `${works.length}日 ・ 1日平均 実働 ${fmtDur(wNet / works.length)}(${WL.a}〜${WL.o} ${fmtDur(wGross / works.length)})` }),
          h('p', { class: 'st-line', text: `${WL.a}の平均 ${hmAvg(works.map(d => d.at))} ・ ${WL.o}の平均 ${hmAvg(works.map(d => d.end))}` }),
          h('p', { class: 'st-sub2', text: `最近の${SPAN_NAME.arrive}(実働)` }),
          bars(wRecent.map(d => ({ icon: '', label: `${Number(d.day.slice(5, 7))}/${Number(d.day.slice(8, 10))}`, value: Math.round(d.net), sub: `${hm(d.at)}〜${hm(d.end)}` }))),
          h('p', { class: 'hint', text: `実働は、${WL.a}〜${WL.o}から「昼休み」「休憩」の時間を引いたものです。` }))
          : h('p', { class: 'muted', text: `まだ${WL.a}〜${WL.o}の記録がありません。「${WL.a}」と「${WL.o}」を押すと、ここに集まります。` })),
      h('section', { class: 'st-card' }, h('h3', { text: '🚃 移動手段' }),
        modeRows.length ? bars(modeRows) : h('p', { class: 'muted', text: 'まだ時刻のある移動がありません。出発のあと、乗りかえるたびに下の帯の移動手段を押すと、ここに集まります。' }),
        commutes.length ? h('p', { class: 'st-line', text: `🏢 通勤(出発 → ${WL.a}): 平均 ${fmtDur(commuteAvg)}(${commutes.length}回)` }) : null,
        untimed ? h('p', { class: 'hint', text: `時刻のない移動手段の記録が ${untimed}件あります(v0.9 より前の分。回数だけで、時間には入っていません)。` }) : null),
      h('section', { class: 'st-card' }, h('h3', { text: '🌙 睡眠' }),
        sleeps.length ? h('div', {},
          h('p', { class: 'st-big', text: `平均 ${fmtDur(sleepAvg)}` }),
          h('p', { class: 'st-line', text: `${sleeps.length}晩 ・ 寝た時刻の平均 ${hmAvg(sleeps.map(e => e.at))} ・ 起きた時刻の平均 ${hmAvg(sleeps.map(e => e.end))}` }),
          h('p', { class: 'st-line', text: `いちばん長い ${fmtDur(Math.max(...sleepMins))} ・ いちばん短い ${fmtDur(Math.min(...sleepMins))}` }),
          h('p', { class: 'st-sub2', text: '最近の睡眠' }),
          bars(recent.map(e => ({ icon: '', label: `${Number(e.end.slice(5, 7))}/${Number(e.end.slice(8, 10))}`, value: Math.round(durMin(e.at, e.end)), sub: `${hm(e.at)}〜${hm(e.end)}` }))))
          : h('p', { class: 'muted', text: 'まだ睡眠の記録がありません。寝るときに「就寝」、起きたら「起床」を押すと、ここに集まります。' })),
      h('section', { class: 'st-card' }, h('h3', { text: '🍽️ 食事' }),
        meals.length ? h('div', {},
          h('p', { class: 'st-big', text: `1回 平均 ${fmtDur(mealAvg)}` }),
          h('p', { class: 'st-line', text: `${meals.length}回(${mealDays}日・1日あたり ${(meals.length / Math.max(1, mealDays)).toFixed(1)}回)` }),
          bars(slots.filter(x => x.n).map(x => ({ icon: '', label: x.label, value: Math.round(x.avg), sub: `${x.n}回の平均` }))))
          : h('p', { class: 'muted', text: 'まだ終わりまで記録した食事がありません。食べ始めに「食事」、食べ終わったらもう一度「食事」(か「終わった」)を押すと、ここに集まります。' })),
      h('p', { class: 'hint', text: `${PJ.STATS_NOTE}集計はスマホの中だけで計算しています。` }))
  }
  sheet.replaceChildren(h('div', { class: 'sheet-inner', role: 'dialog', 'aria-modal': 'true', 'aria-label': '統計' },
    h('div', { class: 'sheet-top' }, h('h2', { text: '統計' }), h('button', { type: 'button', class: 'link-btn', text: '閉じる', onclick: close })),
    body))
  paint()
  sheet.hidden = false
  document.body.classList.add('no-scroll')
}

// ---------- 場所の一覧(名前・住所・範囲を直す、消す、いまの場所を登録) ----------
async function openPlaces() {
  const sheet = $('#sheet')
  const close = () => { sheet.hidden = true; sheet.replaceChildren(); document.body.classList.remove('no-scroll'); render() }
  const body = h('div', { class: 'sheet-body' })
  const msg = h('p', { class: 'bk-msg', 'aria-live': 'polite' })
  const all = await allEntries()
  const count = (p) => all.filter(e => e.place && e.place.id === p.id).length
  const paint = () => {
    const rows = PLACES.map(p => {
      const name = h('input', { class: 'input', value: p.name, maxlength: '30', 'aria-label': `${p.name}の名前` })
      const addr = h('input', { class: 'input', value: p.addr || '', maxlength: '100', placeholder: '住所(自分で書く。なくてもよい)', 'aria-label': `${p.name}の住所` })
      const r = h('select', { class: 'input bs-tabsel', 'aria-label': `${p.name}の範囲` }, ...RADII.map(x => h('option', { value: String(x), text: `半径 ${fmtDist(x)}` })))
      r.value = String(p.r || 150)
      const save = async () => {
        const nm = name.value.trim()
        if (!nm) { msg.className = 'bk-msg err'; msg.textContent = '名前が空です'; return }
        await savePlaces(PLACES.map(x => (x.id === p.id ? { ...x, name: nm, addr: addr.value.trim(), r: Number(r.value) } : x)))
        msg.className = 'bk-msg ok'; msg.textContent = `「${nm}」を保存しました`
      }
      name.addEventListener('change', save); addr.addEventListener('change', save); r.addEventListener('change', save)
      const n = count(p)
      return h('section', { class: 'pl-row' },
        h('div', { class: 'pl-top' }, h('span', { class: 'pl-icon', 'aria-hidden': 'true', text: '📍' }), name),
        addr,
        h('div', { class: 'pl-sub' }, r, h('span', { class: 'muted', text: `記録 ${n}件` }), h('span', { class: 'spacer' }),
          h('button', { type: 'button', class: 'bs-op del', text: '消す', onclick: async () => {
            if (!confirm(`「${p.name}」の登録を消しますか?(記録は消えません。記録には名前だけ残ります)`)) return
            await savePlaces(PLACES.filter(x => x.id !== p.id)); paint() } })))
    })
    body.replaceChildren(
      h('p', { class: 'hint', text: '名前を付けた場所の近くでボタンを押すと、その名前が自動で付きます。位置はスマホの中だけにしまい、地図や住所を調べるサービスには送りません。' }),
      h('button', { type: 'button', class: 'secondary-btn', text: '📍 いまの場所を登録する', onclick: async (ev) => {
        const btn = ev.currentTarget; btn.disabled = true
        msg.className = 'bk-msg'; msg.textContent = '測っています…'
        const r = await measure()
        btn.disabled = false
        if (r.error) { msg.className = 'bk-msg err'; msg.textContent = r.error; return }
        const near = matchPlace(r.loc, PLACES)
        msg.textContent = near ? `いまは「${near.name}」の範囲の中です。別の名前で登録するなら、下に書いてください。` : `測れました(誤差 ±${r.loc.acc}m)。名前を付けてください。`
        msg.after(placeNamer(r.loc, (pl) => { msg.className = 'bk-msg ok'; msg.textContent = `「${pl.name}」を登録しました`; paint() }))
      } }),
      msg,
      ...(rows.length ? rows : [h('p', { class: 'muted', text: 'まだ登録した場所がありません。' })]))
  }
  sheet.replaceChildren(h('div', { class: 'sheet-inner', role: 'dialog', 'aria-modal': 'true', 'aria-label': '場所' },
    h('div', { class: 'sheet-top' }, h('h2', { text: '場所' }), h('button', { type: 'button', class: 'link-btn', text: '閉じる', onclick: close })),
    body))
  paint()
  sheet.hidden = false
  document.body.classList.add('no-scroll')
}

// ---------- ボタン設定(足す・名前と絵を変える・並べ替える・消す・移動手段を聞く) ----------
// ひな形を選ぶカード(v0.19.1)
// ---------- 自分で作る(v0.21.2。本人「自分で作るは項目設定からいろいろ細かく設定できる仕様に。ボタンのカラーとかまで」「タブの変更も入れよう」) ----------
// v0.21.5 本人「入力手順がわかりにくい」「タブに何があるかもわからないのに決められない」「各項目にすべてのボタンで一覧を」
// → ① ボタンを選ぶ(タブごとに、そのタブに入れられるボタンを全部。もとのボタン・ひな形のボタン・候補を小見出しで) ② タブと仕上げ ③ 見本 → これで始める。
// はじめに(from: 'first')と、ボタン設定の「ひな形から選び直す」→ 自分で作る(from: 'settings'、いまのボタンから始める)
function buttonsByTab(petType) {
  const map = {}
  const seen = new Set()
  const add = (title, home, list, pet = false) => {
    const items = list.filter(b => b && !seen.has(b.kind)).map(b => { seen.add(b.kind); return { ...b, tab: home } })
    if (items.length) (map[home] = map[home] || []).push({ title, home, items, pet })
  }
  for (const t of BASE_TABS) add('いつもの', t.key, DEFAULT_BUTTONS.filter(b => b.tab === t.key))
  add('🎒 学生・🏠 家のこと', 'do', Object.values(XB))
  for (const x of PRIMARY) add(`${x.icon} ${x.label}`, 'do', x.items.map(k => PB[k]))
  for (const x of JOB_GROUPS) add(`${x.icon} ${x.label}`, 'do', x.items.map(k => PB[k]))
  for (const g of CANDIDATES) add(g.group.replace('(最初からあるもの)', ''), g.tab, candItems(g, petType).map(x => candToButton(g, x)), g.tab === 'pet')
  return map
}
// v0.21.6 本人「自分で作るで職種の選択もできるように」→ ① ボタンのいちばん上に職種(いくつでも)。選ぶと、その職種のひな形のボタンにチェックが付く。
// 出社・退社の名前(登校・出勤など)は、あとに選んだ職種のものにする。農業などは4つに分けて選べる
const JOBS = [
  ...PRESETS.filter(p => !['custom', 'primary'].includes(p.key)).map(p => ({ key: p.key, icon: p.icon, label: p.label, preset: p.key, make: () => p.make() })),
  ...PRIMARY.map(x => ({ key: 'pr-' + x.key, icon: x.icon, label: x.label, preset: 'primary', make: () => presetOf('primary').make([x.key]) })),
]
function openBuilder({ from = 'first', onBack = null } = {}) {
  const sheet = $('#sheet')
  const closeSheet = () => { sheet.hidden = true; sheet.replaceChildren(); document.body.classList.remove('no-scroll') }
  let tabs = (from === 'settings' ? TABS : BASE_TABS).map(t => ({ ...t }))
  let sel = (from === 'settings' ? BUTTONS : presetOf('custom').make()).map(b => ({ kind: b.kind, label: b.label, icon: b.icon, tab: b.tab, ...btnExtra(b) }))
  let step = 1, q = '', petType = PET_TYPE, editTab = null, pickIcon = null
  let jobs = []                // 選んだ職種(選んだ順)
  const jobAdded = new Map()   // kind → その職種で足したもの(Set)
  const msg = h('p', { class: 'ed-msg', 'aria-live': 'polite' })
  const body = h('div', { class: 'sheet-body' })
  const title = h('h2')
  const foot = h('div', { class: 'sheet-foot' })
  const visible = () => tabs.filter(t => !t.hidden)
  const tabName = (k) => (tabs.find(t => t.key === k) || {}).label || '?'
  const has = (kind) => sel.some(b => b.kind === kind)
  const snap = () => JSON.stringify([tabs, sel, petType, jobs])
  const first = snap()
  const STEPS = ['ボタン', 'タブと仕上げ', '見本']
  const go = (n) => {
    if (step === 1 && n === 2) {   // ボタンを選んだタブだけ「使う」に
      for (const t of tabs) { if (sel.some(b => b.tab === t.key)) delete t.hidden; else t.hidden = true }
      if (!visible().length) delete tabs[0].hidden
    }
    step = n; msg.textContent = ''; paint(); body.scrollTop = 0
  }
  const homeOf = (home) => (tabs.some(t => t.key === home && !t.hidden) ? home : (visible()[0] || tabs[0]).key)
  const cnt = (k) => sel.filter(b => b.tab === k).length

  // ② のうえ: タブ(名前・並び・使う/使わない・自分のタブ)
  const stepTabs = () => {
    const own = tabs.filter(t => !BASE_TABS.some(b => b.key === t.key))
    const out = [h('h3', { class: 'mk-head', text: '🗂 タブ' }),
      h('p', { class: 'hint', text: 'ボタンを選んだタブだけ「使う」になっています。名前や並びを変えたり、自分のタブ(3つまで)を作れます。' })]
    tabs.forEach((t, i) => {
      const base = BASE_TABS.find(b => b.key === t.key)
      const name = h('input', { class: 'input bs-name', value: t.label, maxlength: '10', placeholder: base ? base.label : 'タブの名前', 'aria-label': 'タブの名前' })
      name.addEventListener('input', () => { t.label = name.value })
      const use = h('input', { type: 'checkbox' }); use.checked = !t.hidden
      use.addEventListener('change', () => {
        if (!use.checked && visible().length <= 1) { use.checked = true; showToast('1つは使うタブを残してください'); return }
        if (use.checked) delete t.hidden
        else {
          t.hidden = true
          const n = cnt(t.key)
          if (n) { const to = visible()[0]; sel.forEach(b => { if (b.tab === t.key) b.tab = to.key }); showToast(`「${t.label}」のボタン ${n}個は「${to.label}」へ移しました`) }
        }
        paint()
      })
      const mv = (d) => { const j = i + d; if (j < 0 || j >= tabs.length) return; [tabs[i], tabs[j]] = [tabs[j], tabs[i]]; paint() }
      out.push(h('div', { class: 'bs-row tb-row' + (t.hidden ? ' tb-hidden' : '') },
        h('label', { class: 'tb-use' }, use, h('span', { text: t.hidden ? '使わない' : `${cnt(t.key)}個` })), name,
        h('div', { class: 'bs-ops' },
          h('button', { type: 'button', class: 'bs-op', 'aria-label': '上へ', text: '↑', disabled: i === 0, onclick: () => mv(-1) }),
          h('button', { type: 'button', class: 'bs-op', 'aria-label': '下へ', text: '↓', disabled: i === tabs.length - 1, onclick: () => mv(1) }),
          base ? null : h('button', { type: 'button', class: 'bs-op del', text: '消す', onclick: () => {
            tabs = tabs.filter(x => x !== t); sel.forEach(b => { if (b.tab === t.key) b.tab = homeOf('do') }); paint() } }))))
    })
    out.push(h('button', { type: 'button', class: 'secondary-btn bs-add', disabled: own.length >= MAX_OWN_TABS, text: own.length >= MAX_OWN_TABS ? `自分のタブは ${MAX_OWN_TABS}つまでです` : '＋ 自分のタブを作る',
      onclick: () => { tabs.push({ key: 't-' + newId().slice(0, 8), label: '' }); paint(); requestAnimationFrame(() => { const a = body.querySelectorAll('.tb-row .bs-name'); a[a.length - 1].focus() }) } }))
    return out
  }
  // ① ボタンを選ぶ(タブごとに全部)
  const stepPick = () => {
    const search = h('input', { type: 'search', class: 'input', placeholder: '🔎 探す(たとえば「カフェ」)', value: q, 'aria-label': 'ボタンを探す' })
    const listBox = h('div', { class: 'mk-list' })
    const btnOf = (b, tabKey) => {
      const cur = sel.find(x => x.kind === b.kind) || b   // 選んであれば、いまの名前(登校など)で見せる
      const el = h('button', { type: 'button', class: 'fp-btn', 'aria-pressed': has(b.kind) ? 'true' : 'false' },
        h('span', { class: 'fp-check', 'aria-hidden': 'true' }), h('span', { class: 'fp-icon', 'aria-hidden': 'true', text: cur.icon }), h('span', { class: 'fp-label', text: cur.label }))
      el.onclick = () => {
        if (has(b.kind)) {
          const at = sel.findIndex(x => x.kind === b.kind), old = sel[at]
          sel = sel.filter(x => x.kind !== b.kind)
          if (old.kind.startsWith('c-')) showToast(`「${old.label}」を外しました`, [{ label: '元に戻す', fn: () => { sel.splice(at, 0, old); paintList() } }])
        } else sel.push({ ...b, tab: tabKey })
        paintList()
      }
      return el
    }
    const paintList = () => {
      const map = buttonsByTab(petType)
      const known = new Set(Object.values(map).flat().flatMap(g => g.items.map(b => b.kind)))
      const word = q.trim()
      listBox.replaceChildren(...tabs.map(t => {
        const secs = [...(map[t.key] || [])]
        const mine = sel.filter(b => b.tab === t.key && !known.has(b.kind))
        if (mine.length) secs.push({ title: '自分で作ったボタン', items: mine })
        const parts = secs.map(g => {
          const items = word ? g.items.filter(b => b.label.includes(word)) : g.items
          if (!items.length) return null
          return h('div', { class: 'mk-sec' },
            secs.length > 1 ? h('h4', { class: 'mk-sub', text: g.title }) : null,
            g.pet && !word ? petTypeRow(petType, (nt) => {
              const old = petType; petType = nt
              for (const b of sel) if (b.icon === petIcon(b.kind, old, b.icon)) b.icon = petIcon(b.kind, nt, b.icon)
              paintList() }) : null,
            h('div', { class: 'fp-list' }, ...items.map(b => btnOf(b, t.key))))
        }).filter(Boolean)
        if (!parts.length) return null
        const n = cnt(t.key)
        const det = h('details', { class: 'fpx-group mk-tabgrp' },
          h('summary', {}, h('span', { text: t.label || '(名前なし)' }), h('span', { class: 'fpx-tab', text: `${secs.reduce((a, g) => a + g.items.length, 0)}個から` }), h('span', { class: 'fpx-cnt' + (n > MAX_PER_TAB ? ' over' : ''), text: n > MAX_PER_TAB ? `${n}個(${MAX_PER_TAB}個まで)` : n ? `${n}個 選択` : '' })),
          ...parts)
        if (word || OPEN[t.key]) det.open = true
        det.addEventListener('toggle', () => { if (!word) OPEN[t.key] = det.open })
        return det
      }).filter(Boolean))
      if (!listBox.children.length) listBox.append(h('p', { class: 'hint', text: '見つかりませんでした。下の「新しいボタン」で作れます。' }))
      count.textContent = `選んでいるボタン ${sel.length}個`
    }
    const count = h('p', { class: 'mk-count' })
    search.addEventListener('input', () => { q = search.value; paintList() })
    const newName = h('input', { class: 'input', maxlength: '12', placeholder: '新しいボタンの名前', 'aria-label': '新しいボタンの名前' })
    const newTab = h('select', { class: 'input bs-tabsel', 'aria-label': '入れるタブ' }, ...tabs.map(t => h('option', { value: t.key, text: t.label || '(名前なし)' })))
    newTab.value = 'do'
    const addNew = () => {
      const label = newName.value.trim()
      if (!label) { newName.focus(); return }
      sel.push({ kind: 'c-' + newId().slice(0, 8), label, icon: '⭐', tab: newTab.value })
      OPEN[newTab.value] = true
      newName.value = ''; showToast(`「${label}」を「${tabName(newTab.value)}」に足しました。絵や色は次の画面で`); paintList()
    }
    newName.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') addNew() })
    paintList()
    // 職種(いくつでも)。選ぶとそのひな形のボタンにチェックが付き、外すとその職種で足したボタンだけ外す
    const NAMED = ['arrive', 'out']
    const toggleJob = (j) => {
      if (jobs.includes(j.key)) {
        jobs = jobs.filter(k => k !== j.key)
        let n = 0
        for (const [kind, by] of [...jobAdded]) {
          if (!by.delete(j.key) || by.size) continue
          jobAdded.delete(kind); sel = sel.filter(b => b.kind !== kind); n++
        }
        // 名前は残っている職種のうち、あとに選んだものへ
        for (const kind of NAMED) {
          const b = sel.find(x => x.kind === kind); if (!b) continue
          const last = [...jobs].reverse().map(k => JOBS.find(z => z.key === k).make().find(x => x.kind === kind)).find(Boolean)
          if (last) { for (const k of ['span', 'askPlace', 'askMove']) delete b[k]; Object.assign(b, { label: last.label, icon: last.icon, ...btnExtra(last) }) }
        }
        showToast(`「${j.label}」を外しました${n ? `(ボタン ${n}個を外しました)` : ''}`)
      } else {
        jobs.push(j.key)
        let n = 0
        const list = j.make()
        list.forEach((b, i) => {
          const cur = sel.find(x => x.kind === b.kind)
          if (!cur) {
            // 職種の並びのとおり、前のボタンのすぐ後ろに入れる(なければ後ろへ)
            const nb = { kind: b.kind, label: b.label, icon: b.icon, tab: b.tab, ...btnExtra(b) }
            let at = -1
            for (let k = i - 1; k >= 0 && at < 0; k--) if (list[k].tab === b.tab) at = sel.findIndex(x => x.kind === list[k].kind)
            if (at < 0) sel.push(nb); else sel.splice(at + 1, 0, nb)
            n++; (jobAdded.get(b.kind) || jobAdded.set(b.kind, new Set()).get(b.kind)).add(j.key)
          } else {
            if (jobAdded.has(b.kind)) jobAdded.get(b.kind).add(j.key)
            if (NAMED.includes(b.kind)) { for (const k of ['span', 'askPlace', 'askMove']) delete cur[k]; Object.assign(cur, { label: b.label, icon: b.icon, ...btnExtra(b) }) }
          }
        })
        showToast(`「${j.label}」のボタン ${n}個にチェックを付けました。いらないものはタブを開いて外せます`)
      }
      paint()
    }
    const jobRow = h('section', { class: 'mk-jobs' },
      h('h3', { class: 'mk-head', text: '👤 職種(いくつでも)' }),
      h('p', { class: 'hint', text: '選ぶと、その職種でよく使うボタンにチェックが付きます。選ばなくても進めます。' }),
      h('div', { class: 'mk-jobrow' }, ...JOBS.map(j => h('button', { type: 'button', class: 'mk-job', 'aria-pressed': jobs.includes(j.key) ? 'true' : 'false', onclick: () => toggleJob(j) },
        h('span', { 'aria-hidden': 'true', text: j.icon }), h('span', { text: j.label })))))
    return [jobRow,
      h('h3', { class: 'mk-head', text: '🔘 ボタン' }),
      h('p', { class: 'hint', text: 'タブを押すと、そのタブに入れられるボタンが全部出ます。使うボタンにチェックを付けてください。' }),
      search, count, listBox,
      h('section', { class: 'mvx-welcome' }, h('h3', { text: '＋ 一覧にないボタンを作る' }),
        h('div', { class: 'mk-new' }, newName, newTab, h('button', { type: 'button', class: 'secondary-btn', text: '足す', onclick: addNew })))]
  }
  // ③ 仕上げる
  const stepFinish = () => {
    const vt = visible()
    if (!vt.some(t => t.key === editTab)) editTab = (vt.find(t => sel.some(b => b.tab === t.key)) || vt[0]).key
    // 隠したタブに入っているボタンは、使うタブへ移す
    sel.forEach(b => { if (!vt.some(t => t.key === b.tab)) b.tab = vt[0].key })
    const out = [...stepTabs(), h('h3', { class: 'mk-head', text: '🎨 ボタン' }), h('p', { class: 'hint', text: 'タブごとに、並び・名前・絵・色・動きを決めます。絵を押すと絵を選べます。' }),
      h('div', { class: 'tabs bs-tabs', role: 'tablist' }, ...vt.map(t => h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': t.key === editTab ? 'true' : 'false',
        text: `${t.label || '(名前なし)'} ${sel.filter(b => b.tab === t.key).length}`, onclick: () => { editTab = t.key; pickIcon = null; paint() } })))]
    const same = sel.filter(b => b.tab === editTab)
    if (same.length > MAX_PER_TAB) out.push(h('p', { class: 'fp-warn', text: `このタブは ${same.length}個です。1つのタブは ${MAX_PER_TAB}個までなので、外すか別のタブへ移してください。` }))
    if (!same.length) out.push(h('p', { class: 'hint', text: 'このタブにはまだボタンがありません。前の画面で選ぶか、ほかのタブのボタンの「動き・タブ」で移せます。' }))
    same.forEach((b, i) => {
      const name = h('input', { class: 'input bs-name', value: b.label, maxlength: '12', 'aria-label': `${b.label}の名前` })
      name.addEventListener('input', () => { b.label = name.value })
      const mv = (d) => { const j = i + d; if (j < 0 || j >= same.length) return; const a = sel.indexOf(same[i]), c = sel.indexOf(same[j]); [sel[a], sel[c]] = [sel[c], sel[a]]; paint() }
      const chk = (key, label) => { const c = h('input', { type: 'checkbox' }); c.checked = key === 'askWith' ? (b.askWith != null ? !!b.askWith : !!b.askFun) : !!b[key]; c.addEventListener('change', () => { if (c.checked) b[key] = true; else if (key === 'askWith') b.askWith = false; else delete b[key] }); return h('label', { class: 'bs-ask' }, c, label) }
      const tabSel = h('select', { class: 'input bs-tabsel', 'aria-label': 'タブ' }, ...vt.map(t => h('option', { value: t.key, text: t.label || '(名前なし)' })))
      tabSel.value = b.tab
      tabSel.addEventListener('change', () => { b.tab = tabSel.value; paint(); showToast(`「${b.label}」を「${tabName(b.tab)}」へ移しました`) })
      out.push(h('div', { class: 'bs-row' },
        h('button', { type: 'button', class: 'bs-icon' + colorCls(b), text: b.icon, 'aria-label': `${b.label}の絵を変える`, onclick: () => { pickIcon = pickIcon === b.kind ? null : b.kind; paint() } }),
        name,
        h('div', { class: 'bs-ops' },
          h('button', { type: 'button', class: 'bs-op', 'aria-label': '上へ', text: '↑', disabled: i === 0, onclick: () => mv(-1) }),
          h('button', { type: 'button', class: 'bs-op', 'aria-label': '下へ', text: '↓', disabled: i === same.length - 1, onclick: () => mv(1) }),
          h('button', { type: 'button', class: 'bs-op del', text: '外す', onclick: () => { const at = sel.indexOf(b); sel = sel.filter(x => x !== b); paint(); showToast(`「${b.label}」を外しました`, [{ label: '元に戻す', fn: () => { sel.splice(at, 0, b); paint() } }]) } })),
        h('div', { class: 'bs-color', role: 'group', 'aria-label': '色' }, h('span', { class: 'bs-color-q', text: '色' }),
          h('button', { type: 'button', class: 'bs-sw none', 'aria-pressed': colorCls(b) ? 'false' : 'true', 'aria-label': '色なし', text: '×', onclick: () => { delete b.color; paint() } }),
          ...BTN_COLORS.map(c => h('button', { type: 'button', class: `bs-sw btn-c-${c.key}`, 'aria-pressed': b.color === c.key ? 'true' : 'false', 'aria-label': c.label, onclick: () => { b.color = c.key; paint() } }))),
        h('details', { class: 'bs-sub mk-more' }, h('summary', { text: '動き・タブ' }),
          h('div', { class: 'mk-checks' }, chk('span', '時間の長さを記録する'), chk('askPlace', '押したら場所を測る'), chk('askMove', '押したら移動手段を聞く'),
            chk('askFun', '楽しかった度を付ける'), chk('askWith', 'だれとを付ける'), chk('askMood', 'ペットのご機嫌を聞く'),
            h('label', { class: 'bs-ask' }, 'タブ ', tabSel)))))
      if (pickIcon === b.kind) out.push(h('div', { class: 'icon-grid', role: 'group', 'aria-label': '絵を選ぶ' },
        ...ICONS.map(ic => h('button', { type: 'button', class: 'icon-pick', 'aria-pressed': ic === b.icon ? 'true' : 'false', text: ic, onclick: () => { b.icon = ic; pickIcon = null; paint() } }))))
    })
    return out
  }
  // ④ 見本
  let viewTab = null
  const stepPreview = () => {
    const vt = visible().filter(t => sel.some(b => b.tab === t.key))
    if (!vt.some(t => t.key === viewTab)) viewTab = (vt[0] || {}).key
    const grid = h('div', { class: 'mk-grid' }, ...sel.filter(b => b.tab === viewTab).map(b => h('div', { class: 'rec-btn' + colorCls(b) },
      h('span', { class: 'rec-icon', 'aria-hidden': 'true', text: b.icon }), h('span', { class: 'rec-label' + (b.label.length > 5 ? ' long' : ''), text: b.label || '(名前なし)' }))))
    const empty = visible().filter(t => !sel.some(b => b.tab === t.key)).map(t => t.label)
    return [h('p', { class: 'hint', text: '下のボタンの欄は、こんなふうに見えます。タブを押すと切りかわります。' }),
      h('div', { class: 'mk-phone' },
        h('div', { class: 'tabs', role: 'tablist' }, ...vt.map(t => h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': t.key === viewTab ? 'true' : 'false', text: t.label, onclick: () => { viewTab = t.key; paint() } }))),
        grid),
      h('p', { class: 'mk-count', text: `タブ ${vt.length}つ・ボタン ${sel.length}個` }),
      empty.length ? h('p', { class: 'hint', text: `ボタンのないタブ(${empty.join('・')})は「使わない」にします(あとから「ボタン設定」の「🗂 タブ」で戻せます)。` }) : null,
      h('p', { class: 'hint', text: 'あとからでも「ボタン設定」でいつでも変えられます。' })]
  }
  const finish = async () => {
    tabs.forEach(t => { t.label = (t.label || '').trim() })
    if (tabs.some(t => !t.label && !BASE_TABS.some(b => b.key === t.key))) { go(2); msg.textContent = '名前が空のタブがあります'; return false }
    sel.forEach(b => { b.label = (b.label || '').trim() })
    if (!sel.length) { go(1); msg.textContent = 'ボタンを1つ以上選んでください'; return false }
    if (sel.some(b => !b.label)) { go(2); msg.textContent = '名前が空のボタンがあります'; return false }
    const over = visible().find(t => sel.filter(b => b.tab === t.key).length > MAX_PER_TAB)
    if (over) { editTab = over.key; go(2); msg.textContent = `「${over.label}」が ${MAX_PER_TAB}個をこえています`; return false }
    for (const t of tabs) if (!t.hidden && !sel.some(b => b.tab === t.key)) t.hidden = true   // ボタンのないタブは使わないに
    if (!tabs.some(t => !t.hidden)) delete tabs[0].hidden
    await saveTabs(tabs)
    if (sel.some(b => b.tab === 'pet' || CANDIDATES.some(g => g.tab === 'pet' && g.items.some(x => x.kind === b.kind)))) { PET_TYPE = petType; await putSetting('petType', petType) }
    // 出社の呼び名(勤務・学校・仕事)は、あとに選んだ職種のひな形のものに
    const lastJob = JOBS.find(z => z.key === jobs[jobs.length - 1])
    await saveButtons(sel.map(b => ({ kind: b.kind, label: b.label, icon: b.icon, tab: b.tab, ...btnExtra(b) })), lastJob ? lastJob.preset : 'custom')
    try { localStorage.setItem(TAB_KEY, (visible().find(t => sel.some(b => b.tab === t.key)) || {}).key || 'flow') } catch { /* */ }
    buildButtons(); closeSheet(); render()
    showToast(`自分で作ったボタン ${sel.length}個で始めます。あとから「ボタン設定」でいつでも変えられます`)
    return true
  }
  const leave = () => { closeSheet(); if (onBack) onBack() }
  const tryClose = () => guardedClose(snap, first, finish, leave, from === 'first')
  const OPEN = {}
  const paint = () => {
    title.textContent = `✏️ 自分で作る(${step}/3)`
    const keep = body.scrollTop
    body.replaceChildren(h('ol', { class: 'mk-steps' }, ...STEPS.map((s, i) => h('li', { class: i + 1 === step ? 'on' : i + 1 < step ? 'done' : '', text: s }))),
      ...(step === 1 ? stepPick() : step === 2 ? stepFinish() : stepPreview()), msg)
    if (step !== 1) requestAnimationFrame(() => { body.scrollTop = keep })
    foot.replaceChildren(
      h('button', { type: 'button', class: 'secondary-btn', text: step === 1 ? (from === 'first' ? '◀ ひな形にもどる' : '◀ やめる') : '◀ もどる', onclick: () => (step === 1 ? tryClose() : go(step - 1)) }),
      h('button', { type: 'button', class: 'primary-btn', text: step === 3 ? `これで始める(${sel.length}個)` : '次へ ▶', onclick: () => (step === 3 ? finish() : go(step + 1)) }))
  }
  sheet.replaceChildren(h('div', { class: 'sheet-inner', role: 'dialog', 'aria-modal': 'true', 'aria-label': '自分で作る' },
    h('div', { class: 'sheet-top' }, title, h('button', { type: 'button', class: 'link-btn', text: '閉じる', onclick: tryClose })),
    body, foot))
  paint()
  sheet.hidden = false
  document.body.classList.add('no-scroll')
}

// v0.21.3: ひな形「農業・漁業など」の種類を選ぶ(いくつでも)。選んだ種類のボタンだけで次のチェックの一覧へ
function primaryPicker(init, onNext) {
  const on = new Set(init)
  const go = h('button', { type: 'button', class: 'primary-btn' })
  const warn = h('p', { class: 'fp-warn', 'aria-live': 'polite' })
  const paint = () => {
    const n = new Set(PRIMARY.filter(x => on.has(x.key)).flatMap(x => x.items)).size
    go.disabled = !on.size
    go.textContent = on.size ? `次へ ▶(${n}個のボタン)` : '1つ以上選んでください'
    warn.textContent = n > MAX_PER_TAB ? `「すること」に入るのは ${MAX_PER_TAB}個までです。次の画面でいくつか外してください` : ''
  }
  go.onclick = () => onNext(PRIMARY.filter(x => on.has(x.key)).map(x => x.key))
  const cards = h('div', { class: 'pz-cards' }, ...PRIMARY.map(x => {
    const el = h('button', { type: 'button', class: 'pz-card pr-card', 'aria-pressed': on.has(x.key) ? 'true' : 'false' },
      h('span', { class: 'fp-check', 'aria-hidden': 'true' }), h('span', { class: 'pz-icon', text: x.icon }), h('span', { class: 'pz-text' }, h('strong', { text: x.label }), h('small', { text: x.desc })))
    el.onclick = () => { if (on.has(x.key)) on.delete(x.key); else on.add(x.key); el.setAttribute('aria-pressed', on.has(x.key) ? 'true' : 'false'); paint() }
    return el
  }))
  paint()
  return { body: [h('p', { class: 'pz-lead', text: 'どんなお仕事ですか?' }), h('p', { class: 'hint', text: 'いくつでも選べます。選んだもののボタンが「すること」に並びます。' }), cards, warn], go }
}
// 種類を決めたひな形(make がその種類のボタンだけを作る)
const primaryPreset = (p, picked) => ({ ...p, picked, make: () => p.make(picked) })
function presetCards(current, onPick) {
  return h('div', { class: 'pz-cards' }, ...PRESETS.map(p => h('button', { type: 'button', class: 'pz-card', 'aria-pressed': p.key === current ? 'true' : 'false', onclick: () => onPick(p) },
    h('span', { class: 'pz-icon', text: p.icon }), h('span', { class: 'pz-text' }, h('strong', { text: p.label }), h('small', { text: p.desc })))))
}
// 最初に開いたとき(ボタンをまだ一度も保存していなくて、記録もないとき)に、ひな形を選んでもらう
// v0.19.8・v0.19.9: ひな形のボタンをタブごとにチェックで並べる(はじめに・ボタン設定の選び直しで共通)
// on は kind の Set。押すたびに on を変えて onChange を呼ぶ。
function buttonChecklist(all, on, onChange) {
  return TABS.map(t => {
    const bs = all.filter(b => b.tab === t.key)
    if (!bs.length) return null
    return h('section', { class: 'fp-group' },
      h('h3', { class: 'fp-tab', text: t.label }),
      h('div', { class: 'fp-list' }, ...bs.map(b => {
        const el = h('button', { type: 'button', class: 'fp-btn', 'aria-pressed': on.has(b.kind) ? 'true' : 'false' },
          h('span', { class: 'fp-check', 'aria-hidden': 'true' }),
          h('span', { class: 'fp-icon', 'aria-hidden': 'true', text: b.icon }),
          h('span', { class: 'fp-label', text: b.label }))
        el.onclick = () => {
          if (on.has(b.kind)) on.delete(b.kind); else on.add(b.kind)
          el.setAttribute('aria-pressed', on.has(b.kind) ? 'true' : 'false')
          onChange()
        }
        return el
      })))
  }).filter(Boolean)
}

async function maybeFirstPreset() {
  if (await getSetting('buttons')) return
  if ((await allEntries()).length) return
  const sheet = $('#sheet')
  const close = () => { sheet.hidden = true; sheet.replaceChildren(); document.body.classList.remove('no-scroll') }
  // 1. ひな形を選ぶ
  const step1 = () => {
    sheet.replaceChildren(h('div', { class: 'sheet-inner', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'はじめに' },
      h('div', { class: 'sheet-top' }, h('h2', { text: 'ようこそ 📔' })),
      h('div', { class: 'sheet-body' },
        h('p', { class: 'pz-lead', text: 'あなたの毎日に近いのは?' }),
        h('p', { class: 'hint', text: '選んだ形でボタンを並べます。次の画面で、使わないボタンを外せます。' }),
        presetCards(null, (p) => (p.key === 'custom' ? openBuilder({ from: 'first', onBack: () => { step1(); sheet.hidden = false; document.body.classList.add('no-scroll') } }) : p.pick ? stepPick(p) : step2(p))),
        h('section', { class: 'mvx-welcome' },
          h('h3', { text: '📲 前のスマホから引っ越す' }),
          h('p', { class: 'hint', text: '前のスマホで作った「引っ越し用ファイル」と合言葉があれば、記録もボタンもそのまま入ります。' }),
          moveImportBox()))))
  }
  // 1.5 v0.21.3: 農業・漁業など → 種類を選ぶ
  const stepPick = (p, init = []) => {
    const pk = primaryPicker(init, (picked) => step2(primaryPreset(p, picked)))
    sheet.replaceChildren(h('div', { class: 'sheet-inner', role: 'dialog', 'aria-modal': 'true', 'aria-label': '仕事の種類' },
      h('div', { class: 'sheet-top' }, h('h2', { text: `${p.icon} ${p.label}` })),
      h('div', { class: 'sheet-body' }, ...pk.body),
      h('div', { class: 'sheet-foot' }, h('button', { type: 'button', class: 'secondary-btn', text: '◀ 選び直す', onclick: step1 }), pk.go)))
  }
  // 2. v0.19.8: ひな形のボタンを全部チェック済みで見せ、使わないものを外してもらう(本人「どのボタンを使うのか選択してもらう」)
  const step2 = (p) => {
    const all = p.make().map(b => ({ kind: b.kind, label: b.label, icon: b.icon, tab: b.tab, ...btnExtra(b) }))
    const on = new Set(all.map(b => b.kind))
    const extra = new Map()   // 候補から選んだもの kind → ボタン
    const count = h('span')
    const go = h('button', { type: 'button', class: 'primary-btn' })
    const chosen = () => [...all.filter(b => on.has(b.kind)), ...extra.values()]
    const paintCount = () => {
      const list = chosen()
      const over = TABS.find(t => list.filter(b => b.tab === t.key).length > MAX_PER_TAB)
      go.textContent = `これで始める(${list.length}個)`
      go.disabled = list.length === 0 || !!over
      count.textContent = !list.length ? '1つ以上選んでください' : over ? `「${over.label}」が ${MAX_PER_TAB}個をこえています。いくつか外してください` : ''
    }
    const groups = buttonChecklist(all, on, paintCount)
    // v0.20.7: その下に、ほかの候補も(最初はチェックなし。まとまりごとに押すと開く)。本人「最初の段階である程度選択できるように」
    const presetKinds = new Set(all.map(b => b.kind))
    let ftype = PET_TYPE
    const more = CANDIDATES.map(g => {
      const items0 = candItems(g, ftype).filter(x => !presetKinds.has(x.kind))
      if (!items0.length) return null
      const tabName = (TABS.find(z => z.key === g.tab) || {}).label
      const cnt = h('span', { class: 'fpx-cnt' })
      const listBox = h('div', { class: 'fp-list' })
      const itemsNow = () => candItems(g, ftype).filter(x => !presetKinds.has(x.kind))
      const paintCnt = () => { const n = itemsNow().filter(x => extra.has(x.kind)).length; cnt.textContent = n ? `${n}個 選択` : '' }
      const paintItems = () => listBox.replaceChildren(...itemsNow().map(x => {
          const el = h('button', { type: 'button', class: 'fp-btn', 'aria-pressed': 'false' },
            h('span', { class: 'fp-check', 'aria-hidden': 'true' }), h('span', { class: 'fp-icon', 'aria-hidden': 'true', text: x.icon }), h('span', { class: 'fp-label', text: x.label }))
          if (extra.has(x.kind)) el.setAttribute('aria-pressed', 'true')
          el.onclick = () => {
            if (extra.has(x.kind)) extra.delete(x.kind); else extra.set(x.kind, candToButton(g, x))
            el.setAttribute('aria-pressed', extra.has(x.kind) ? 'true' : 'false'); paintCnt(); paintCount()
          }
          return el
        }))
      paintItems()
      // ペットは「どんな子?」を先に聞く。変えたら、選んだボタンの絵も変える・合わないボタンは外す
      const typeRow = g.tab === 'pet' ? petTypeRow(ftype, (nt) => {
        ftype = nt
        const ok = new Map(itemsNow().map(x => [x.kind, x]))
        for (const k of [...extra.keys()]) if (CANDIDATES.find(z => z.tab === 'pet').items.some(x => x.kind === k)) { if (ok.has(k)) extra.set(k, candToButton(g, ok.get(k))); else extra.delete(k) }
        paintItems(); paintCnt(); paintCount()
      }) : null
      const det = h('details', { class: 'fpx-group' },
        h('summary', {}, h('span', { text: `${g.group}` }), h('span', { class: 'fpx-tab', text: `→ ${tabName}` }), cnt),
        typeRow, listBox)
      return det
    }).filter(Boolean)
    if (more.length) groups.push(h('section', { class: 'fpx' },
      h('h3', { class: 'fp-tab', text: 'ほかにも使いたいものがあれば' }),
      h('p', { class: 'hint', text: '押すと開きます。チェックしたものが、→ のタブに入ります。あとから「ボタン設定」でも足せます。' }), ...more))
    go.onclick = async () => {
      const list = chosen()
      if (!list.length) return
      if (list.some(b => b.tab === 'pet')) { PET_TYPE = ftype; await putSetting('petType', ftype) }
      await saveButtons(list, p.key)
      buildButtons()
      close()
      showToast(`「${p.label}」のボタン ${list.length}個で始めます。あとから「ボタン設定」でいつでも足したり変えたりできます`)
    }
    paintCount()
    sheet.replaceChildren(h('div', { class: 'sheet-inner', role: 'dialog', 'aria-modal': 'true', 'aria-label': '使うボタン' },
      h('div', { class: 'sheet-top' }, h('h2', { text: `${p.icon || ''} ${p.label}` })),
      h('div', { class: 'sheet-body' },
        h('p', { class: 'pz-lead', text: '使うボタンを選んでください' }),
        h('p', { class: 'hint', text: 'チェックの付いたボタンが並びます。使わないものは押して外してください。このままでよければ、下の「これで始める」へ。' }),
        h('p', { class: 'fp-warn', 'aria-live': 'polite' }, count),
        ...groups),
      h('div', { class: 'sheet-foot' },
        h('button', { type: 'button', class: 'secondary-btn', text: '◀ 選び直す', onclick: () => (p.picked ? stepPick(PRESETS.find(z => z.key === p.key), p.picked) : step1()) }),
        go)))
    sheet.querySelector('.sheet-body').scrollTop = 0
  }
  step1()
  sheet.hidden = false
  document.body.classList.add('no-scroll')
}

function openButtonSettings() {
  const sheet = $('#sheet')
  let list = BUTTONS.map(b => ({ ...b }))
  let pickFor = null          // 絵を選んでいるボタンの kind
  // v0.17.3: 本人「ボタン設定は項目別に表示を」→ 上のタブで1つずつ見せる(最初は、いま下で開いているタブ)
  let tabsEd = TABS.map(t => ({ ...t }))   // タブの設定(保存するまで決まらない。v0.21.1)
  let showTab = TABS.some(t => t.key === currentTab()) ? currentTab() : TABS[0].key
  let candOpen = false        // 候補の一覧を開いているか(v0.18.1)
  let withs = WITH_OPTS.map(o => ({ ...o }))   // だれとの一覧(保存するまで決まらない。v0.18.6)
  let withPick = null
  // (same は下の for の中で決まる)
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
    const keep = body.scrollTop          // 押したあとに画面が動かないように(v0.18.4)
    requestAnimationFrame(() => { body.scrollTop = keep })
    const foot = sheet.querySelector('.sheet-foot')
    if (foot) foot.hidden = !!(pzOpen && pzPick)   // ひな形のチェックの間は「保存する」を出さない(当てはめ忘れを防ぐ)
    if (pzOpen) { pzView(); return }
    body.replaceChildren(h('p', { class: 'hint', text: 'ボタンの名前・絵・並びを変えられます。消しても、そのボタンで記録した分は残ります。最後に「保存する」を押してください。' }),
      h('div', { class: 'tabs bs-tabs', role: 'tablist', 'aria-label': 'どのタブのボタンを見るか' },
        ...tabsEd.map(t => h('button', { type: 'button', role: 'tab', class: 'tab' + (t.hidden ? ' bs-tab-hidden' : ''), 'aria-selected': t.key === showTab ? 'true' : 'false',
          text: `${t.label || '(名前なし)'} ${list.filter(b => b.tab === t.key).length}`, onclick: () => { showTab = t.key; pickFor = null; candOpen = false; paint(); body.scrollTop = 0 } })),
        h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': showTab === '__with' ? 'true' : 'false', text: `👫 だれと ${withs.length}`,
          onclick: () => { showTab = '__with'; pickFor = null; candOpen = false; paint(); body.scrollTop = 0 } }),
        h('button', { type: 'button', role: 'tab', class: 'tab', 'aria-selected': showTab === '__tabs' ? 'true' : 'false', text: '🗂 タブ',
          onclick: () => { showTab = '__tabs'; pickFor = null; candOpen = false; paint(); body.scrollTop = 0 } })))
    if (showTab === '__with') { body.append(withEditor()); body.append(msg); return }
    if (showTab === '__tabs') { body.append(tabEditor()); body.append(msg); return }
    if (!tabsEd.some(x => x.key === showTab)) showTab = tabsEd[0].key
    for (const t of tabsEd.filter(x => x.key === showTab)) {
      const same = list.filter(b => b.tab === t.key)
      const sec = h('section', { class: 'bs-tab' })
      const groups = CANDIDATES.filter(g => g.tab === t.key)
      if (groups.length) sec.append(h('button', { type: 'button', class: 'secondary-btn bs-cand-open', 'aria-expanded': candOpen ? 'true' : 'false', text: candOpen ? '候補を閉じる' : `＋ 候補から「${t.label}」に足す`, onclick: () => { candOpen = !candOpen; paint() } }))
      if (candOpen && groups.length) {
        sec.append(h('div', { class: 'bs-cands' },
          h('p', { class: 'hint', text: same.length >= MAX_PER_TAB ? `1つのタブに置けるのは ${MAX_PER_TAB}個までです。使わないボタンを消すか、別のタブ(「タブを変える」)へ移してください。` : `押すと、このタブの最後に足します(色の付いたものは足してあるもの。もう一度押すと外します。1つのタブに ${MAX_PER_TAB}個まで・いま ${same.length}個)。名前や絵は、足したあとで変えられます。` }),
          ...(t.key === 'pet' ? [petTypeRow(PET_TYPE, async (nt) => {
            const old = PET_TYPE; PET_TYPE = nt; await putSetting('petType', nt)
            for (const b of list) if (b.tab === 'pet' && b.icon === petIcon(b.kind, old, b.icon) && petIcon(b.kind, nt, b.icon) !== b.icon) b.icon = petIcon(b.kind, nt, b.icon)   // 種類の絵のままのボタンは、新しい種類の絵に
            paint()
          })] : []),
          ...groups.map(g => h('div', { class: 'bs-cand-group' }, h('p', { class: 'bs-cand-title', text: g.group }),
            h('div', { class: 'bs-cand-chips' }, ...candItems(g).map(x => {
              // v0.20.6: 色を付けるのは、このタブに足してあるものだけ。ほかのタブにあるものは薄く「(遊び)」と出し、押しても外さない(本人「バグ」)
              const inTab = list.find(b => b.kind === x.kind)
              const have = !!inTab && inTab.tab === t.key
              if (inTab && !have) {
                const where = (TABS.find(z => z.key === inTab.tab) || {}).label || ''
                return h('button', { type: 'button', class: 'chip bs-cand elsewhere', 'aria-pressed': 'false', text: `${x.icon} ${x.label}(${where})`,
                  onclick: () => showToast(`「${inTab.label}」は「${where}」のタブにあります。外すときは「${where}」のタブで押してください`) })
              }
              const full = same.length >= MAX_PER_TAB
              return h('button', { type: 'button', class: 'chip bs-cand', disabled: !have && full, 'aria-pressed': have ? 'true' : 'false', text: `${x.icon} ${x.label}`,
                onclick: () => {
                  if (have) {   // v0.18.5: もう足してある候補は、もう一度押すと消す(本人「追加しすぎたら消すのが大変」)
                    const at = list.findIndex(b => b.kind === x.kind), was = list[at]
                    list = list.filter(b => b.kind !== x.kind); paint()
                    showToast(`「${was.label}」を外しました(保存するまで決まりません)`, [{ label: '元に戻す', fn: () => { list.splice(Math.min(at, list.length), 0, was); paint() } }])
                    return
                  }
                  if (list.filter(b => b.tab === t.key).length >= MAX_PER_TAB) return
                  list.push(candToButton(g, x)); paint() } })
            }))))))
      }
      same.forEach((b, i) => {
        const name = h('input', { class: 'input bs-name', value: b.label, maxlength: '12', 'aria-label': `${b.label || '新しいボタン'}の名前` })
        name.addEventListener('input', () => { b.label = name.value })
        const spanC = h('input', { type: 'checkbox' })
        spanC.checked = !!b.span
        spanC.addEventListener('change', () => { b.span = spanC.checked })
        const askL = h('input', { type: 'checkbox' })
        askL.checked = !!b.askPlace
        askL.addEventListener('change', () => { b.askPlace = askL.checked })
        const askP = h('input', { type: 'checkbox' })
        askP.checked = !!b.askProject
        askP.addEventListener('change', () => { b.askProject = askP.checked })
        const askW = h('input', { type: 'checkbox' })
        askW.checked = b.askWith != null ? !!b.askWith : !!b.askFun
        askW.addEventListener('change', () => { b.askWith = askW.checked })
        const askF = h('input', { type: 'checkbox' })
        askF.checked = !!b.askFun
        askF.addEventListener('change', () => { b.askFun = askF.checked })
        const askMd = h('input', { type: 'checkbox' })
        askMd.checked = !!b.askMood
        askMd.addEventListener('change', () => { b.askMood = askMd.checked })
        const ask = h('input', { type: 'checkbox' })
        ask.checked = !!b.askMove
        ask.addEventListener('change', () => { b.askMove = ask.checked })
        const tabSel = h('select', { class: 'input bs-tabsel', 'aria-label': 'タブを変える' }, ...tabsEd.map(x => h('option', { value: x.key, text: x.label + (x.hidden ? '(隠しています)' : '') })))
        tabSel.value = b.tab
        tabSel.addEventListener('change', () => { if (list.filter(x => x.tab === tabSel.value).length >= MAX_PER_TAB) { tabSel.value = b.tab; showToast(`そのタブは ${MAX_PER_TAB}個でいっぱいです`); return } b.tab = tabSel.value; paint(); showToast(`「${b.label}」を「${(tabsEd.find(x => x.key === b.tab) || {}).label}」へ移しました`) })
        const row = h('div', { class: 'bs-row' },
          h('button', { type: 'button', class: 'bs-icon' + colorCls(b), 'aria-label': `${b.label}の絵を変える`, text: b.icon, onclick: () => { pickFor = pickFor === b.kind ? null : b.kind; paint() } }),
          name,
          h('div', { class: 'bs-ops' },
            h('button', { type: 'button', class: 'bs-op', 'aria-label': '上へ', text: '↑', disabled: i === 0, onclick: () => move(b, -1) }),
            h('button', { type: 'button', class: 'bs-op', 'aria-label': '下へ', text: '↓', disabled: i === same.length - 1, onclick: () => move(b, 1) }),
            h('button', { type: 'button', class: 'bs-op del', 'aria-label': `${b.label}を消す`, text: '消す', onclick: () => {
              // v0.18.4: 確かめの窓はやめて(本人「消すときに出る画面が余分」)、すぐ消して「元に戻す」を出す。保存するまでは決まらない
              const at = list.indexOf(b)
              list = list.filter(x => x !== b); paint()
              showToast(`「${b.label || '新しいボタン'}」を消しました(保存するまで決まりません)`, [{ label: '元に戻す', fn: () => { list.splice(Math.min(at, list.length), 0, b); paint() } }]) } })),
          h('div', { class: 'bs-color', role: 'group', 'aria-label': `${b.label}の色` }, h('span', { class: 'bs-color-q', text: '色' }),
            h('button', { type: 'button', class: 'bs-sw none', 'aria-pressed': colorCls(b) ? 'false' : 'true', 'aria-label': '色なし', title: '色なし', text: '×', onclick: () => { delete b.color; paint() } }),
            ...BTN_COLORS.map(c => h('button', { type: 'button', class: `bs-sw btn-c-${c.key}`, 'aria-pressed': b.color === c.key ? 'true' : 'false', 'aria-label': c.label, title: c.label, onclick: () => { b.color = c.key; paint() } }))),
          h('div', { class: 'bs-sub' }, h('label', { class: 'bs-ask' }, spanC, '時間の長さを記録する(終わりも押す)'), h('label', { class: 'bs-ask' }, askL, '押したら場所を測る'), h('label', { class: 'bs-ask' }, ask, '押したら移動手段を聞く'), h('label', { class: 'bs-ask' }, askF, '楽しかった度を付ける'), h('label', { class: 'bs-ask' }, askMd, 'ペットのご機嫌を聞く'), h('label', { class: 'bs-ask' }, askW, 'だれとを付ける'),
            PJ.ENABLED ? h('label', { class: 'bs-ask' }, askP, '押したら件名を聞く') : null, tabSel))
        sec.append(row)
        if (pickFor === b.kind) {
          sec.append(h('div', { class: 'icon-grid', role: 'group', 'aria-label': '絵を選ぶ' },
            ...ICONS.map(ic => h('button', { type: 'button', class: 'icon-pick', 'aria-pressed': ic === b.icon ? 'true' : 'false', text: ic,
              onclick: () => { b.icon = ic; pickFor = null; paint() } }))))
        }
      })
      sec.append(h('button', { type: 'button', class: 'secondary-btn bs-add', disabled: same.length >= MAX_PER_TAB, text: same.length >= MAX_PER_TAB ? `このタブは ${MAX_PER_TAB}個でいっぱいです` : `＋ 「${t.label}」にボタンを足す`, onclick: () => {
        const nb = { kind: 'c-' + newId().slice(0, 8), label: '', icon: '⭐', tab: t.key }
        list.push(nb); pickFor = null; paint()
        // 足したボタンの名前の欄に、すぐ書けるようにする
        requestAnimationFrame(() => { const el = body.querySelector('.bs-tab').querySelectorAll('.bs-name'); el[el.length - 1].focus() })
      } }))
      body.append(sec)
    }
    body.append(h('button', { type: 'button', class: 'secondary-btn pz-open', text: '📋 ひな形から選び直す', onclick: () => { pzOpen = true; paint(); body.scrollTop = 0 } }), msg)
  }
  // ひな形から選び直す(v0.19.1)。選んだら「置き換える/足りないボタンだけ足す」を選ぶ。保存するまでは決まらない
  let pzOpen = false, pzPick = null
  const pzView = () => {
    body.replaceChildren(h('div', { class: 'pz-back' }, h('button', { type: 'button', class: 'link-btn', text: '← ボタン設定にもどる', onclick: () => { pzOpen = false; pzPick = null; paint() } })))
    if (!pzPick) {
      body.append(h('p', { class: 'hint', text: 'いまの暮らしに近いものを選んでください。これまでの記録は、記録したときの名前のまま残ります。' }), presetCards(PRESET, (p) => {
      if (p.key === 'custom') { guardedClose(snapS, firstS, save, () => { close(); openBuilder({ from: 'settings' }) }); return }
      pzPick = p; paint() }))
      return
    }
    if (pzPick.pick && !pzPick.picked) {   // v0.21.3: 農業・漁業など → 種類を選ぶ
      const pk = primaryPicker([], (picked) => { pzPick = primaryPreset(pzPick, picked); paint(); body.scrollTop = 0 })
      body.append(...pk.body, h('div', { class: 'pz-pickgo' }, pk.go))
      return
    }
    // v0.19.9: 本人「選び直しのときもボタンを選べるように(暮らしが変わったとき)」→ はじめにと同じチェックの一覧
    const p = pzPick, next = p.make()
    const pzKey = p.key + (p.picked ? ':' + p.picked.join(',') : '')
    if (!pzOn || pzOn.key !== pzKey) pzOn = { key: pzKey, set: new Set(next.map(b => b.kind)) }
    const on = pzOn.set
    const replaceBtn = h('button', { type: 'button', class: 'primary-btn' })
    const addBtn = h('button', { type: 'button', class: 'secondary-btn' })
    const missingOf = () => next.filter(b => on.has(b.kind) && !list.some(x => x.kind === b.kind))
    const paintBtns = () => {
      replaceBtn.textContent = on.size ? `選んだボタンで置き換える(${on.size}個)` : '1つ以上選んでください'
      replaceBtn.disabled = !on.size
      const m = missingOf().length
      addBtn.textContent = m ? `選んだ中で足りないボタンだけ足す(${m}個)` : '足りないボタンはありません'
      addBtn.disabled = !m
    }
    const apply = (mode) => {
      const before = list.map(b => ({ ...b })), beforePreset = newPreset
      if (mode === 'replace') list = next.filter(b => on.has(b.kind))
      else for (const b of missingOf()) {
        if (list.filter(x => x.tab === b.tab).length >= MAX_PER_TAB) continue
        let i = -1; list.forEach((x, j) => { if (x.tab === b.tab) i = j })
        list.splice(i < 0 ? list.length : i + 1, 0, b)
      }
      newPreset = p.key; pzOpen = false; pzPick = null; pzOn = null; paint()
      showToast(`「${p.label}」のひな形にしました(保存するまで決まりません)`, [{ label: '元に戻す', fn: () => { list = before; newPreset = beforePreset; paint() } }])
    }
    replaceBtn.onclick = () => apply('replace')
    addBtn.onclick = () => apply('add')
    paintBtns()
    body.append(h('section', { class: 'pz-confirm' },
      h('p', { class: 'pz-title', text: `${p.icon} ${p.label}` }),
      h('p', { class: 'hint', text: '使うボタンにチェックを付けてください。使わないものは押して外します。' }),
      h('button', { type: 'button', class: 'link-btn', text: '← ほかのひな形を選ぶ', onclick: () => { pzPick = null; pzOn = null; paint() } })),
      ...buttonChecklist(next, on, paintBtns),
      h('section', { class: 'pz-confirm fp-actions' },
        replaceBtn,
        h('p', { class: 'hint', text: '今のボタンを、チェックしたボタンだけにします。自分で足したボタンや、名前を変えたボタンも、このひな形の形にもどります。' }),
        addBtn,
        h('p', { class: 'hint', text: '今のボタンはそのまま。チェックしたボタンのうち、今ないものだけを、それぞれのタブの最後に足します。' })))
  }
  let pzOn = null
  let newPreset = PRESET
  // だれとの一覧の編集(v0.18.6)
  // v0.21.1 タブの設定: 名前・使う(隠す)・並び・自分のタブ(3つまで)
  const tabEditor = () => {
    const sec = h('section', { class: 'bs-tab' })
    sec.append(h('p', { class: 'hint', text: 'タブの名前を変えたり、使わないタブを隠したり、並べ替えたりできます。隠したタブのボタンは消えません(下に出なくなるだけ)。自分のタブは3つまで作れます。' }))
    const own = tabsEd.filter(t => !BASE_TABS.some(b => b.key === t.key))
    tabsEd.forEach((t, i) => {
      const base = BASE_TABS.find(b => b.key === t.key)
      const name = h('input', { class: 'input bs-name', value: t.label, maxlength: '10', placeholder: base ? base.label : 'タブの名前', 'aria-label': `${t.label || 'タブ'}の名前` })
      name.addEventListener('input', () => { t.label = name.value })
      const use = h('input', { type: 'checkbox' }); use.checked = !t.hidden
      use.addEventListener('change', () => {
        if (!use.checked && tabsEd.filter(x => !x.hidden).length <= 1) { use.checked = true; showToast('1つは使うタブを残してください'); return }
        if (use.checked) delete t.hidden; else t.hidden = true; paint()
      })
      const mv = (d) => { const j = i + d; if (j < 0 || j >= tabsEd.length) return; [tabsEd[i], tabsEd[j]] = [tabsEd[j], tabsEd[i]]; paint() }
      const n = list.filter(b => b.tab === t.key).length
      sec.append(h('div', { class: 'bs-row tb-row' + (t.hidden ? ' tb-hidden' : '') },
        h('label', { class: 'tb-use', title: '使う' }, use, h('span', { text: t.hidden ? '隠す' : '使う' })),
        name,
        h('div', { class: 'bs-ops' },
          h('button', { type: 'button', class: 'bs-op', 'aria-label': '上へ', text: '↑', disabled: i === 0, onclick: () => mv(-1) }),
          h('button', { type: 'button', class: 'bs-op', 'aria-label': '下へ', text: '↓', disabled: i === tabsEd.length - 1, onclick: () => mv(1) }),
          base ? null : h('button', { type: 'button', class: 'bs-op del', 'aria-label': `${t.label}を消す`, text: '消す', onclick: () => {
            // 自分のタブを消すときは、中のボタンを「すること」へ移す(ボタンは消さない)
            const before = tabsEd.map(x => ({ ...x })), moved = list.filter(b => b.tab === t.key)
            tabsEd = tabsEd.filter(x => x !== t); moved.forEach(b => { b.tab = 'do' }); paint()
            showToast(`タブ「${t.label}」を消しました${moved.length ? `(ボタン ${moved.length}個は「${tabLabelEd('do')}」へ)` : ''}(保存するまで決まりません)`, [{ label: '元に戻す', fn: () => { tabsEd = before; moved.forEach(b => { b.tab = t.key }); paint() } }])
          } })),
        h('div', { class: 'bs-sub tb-sub', text: `ボタン ${n}個${base && t.label !== base.label ? `・もとの名前「${base.label}」` : ''}` })))
    })
    sec.append(h('button', { type: 'button', class: 'secondary-btn bs-add', disabled: own.length >= MAX_OWN_TABS,
      text: own.length >= MAX_OWN_TABS ? `自分のタブは ${MAX_OWN_TABS}つまでです` : '＋ 自分のタブを作る', onclick: () => {
        tabsEd.push({ key: 't-' + newId().slice(0, 8), label: '' }); paint()
        requestAnimationFrame(() => { const ins = body.querySelectorAll('.tb-row .bs-name'); const last = ins[ins.length - 1]; if (last) last.focus() })
      } }))
    if (JSON.stringify(tabsEd.map(t => [t.key, t.label, !!t.hidden])) !== JSON.stringify(BASE_TABS.map(t => [t.key, t.label, false])))
      sec.append(h('button', { type: 'button', class: 'link-btn bs-reset', text: 'タブを最初の形に戻す(自分のタブのボタンは「すること」へ)', onclick: () => {
        const own2 = tabsEd.filter(x => !BASE_TABS.some(b => b.key === x.key)).map(x => x.key)
        list.forEach(b => { if (own2.includes(b.tab)) b.tab = 'do' })
        tabsEd = BASE_TABS.map(x => ({ ...x })); paint() } }))
    return sec
  }
  const tabLabelEd = (key) => (tabsEd.find(t => t.key === key) || {}).label || ''
  const withEditor = () => {
    const moveW = (o, d) => { const i = withs.indexOf(o), j = i + d; if (j < 0 || j >= withs.length) return; [withs[i], withs[j]] = [withs[j], withs[i]]; paint() }
    const sec = h('section', { class: 'bs-tab' }, h('p', { class: 'hint', text: '遊びなどの記録に付ける「だれと」の一覧です。名前の人を足してもかまいません(この端末と、鍵をかけた同期の中だけ)。消しても、付けた記録はそのまま残ります。' }))
    withs.forEach((o, i) => {
      const name = h('input', { class: 'input bs-name', value: o.label, maxlength: '12', 'aria-label': `${o.label || '新しい人'}の名前` })
      name.addEventListener('input', () => { o.label = name.value })
      sec.append(h('div', { class: 'bs-row' },
        h('button', { type: 'button', class: 'bs-icon', 'aria-label': `${o.label}の絵を変える`, text: o.icon, onclick: () => { withPick = withPick === o.key ? null : o.key; paint() } }),
        name,
        h('div', { class: 'bs-ops' },
          h('button', { type: 'button', class: 'bs-op', 'aria-label': '上へ', text: '↑', disabled: i === 0, onclick: () => moveW(o, -1) }),
          h('button', { type: 'button', class: 'bs-op', 'aria-label': '下へ', text: '↓', disabled: i === withs.length - 1, onclick: () => moveW(o, 1) }),
          h('button', { type: 'button', class: 'bs-op del', 'aria-label': `${o.label}を消す`, text: '消す', onclick: () => {
            const at = withs.indexOf(o); withs = withs.filter(x => x !== o); paint()
            showToast(`「${o.label}」を消しました(保存するまで決まりません)`, [{ label: '元に戻す', fn: () => { withs.splice(Math.min(at, withs.length), 0, o); paint() } }]) } }))))
      if (withPick === o.key) sec.append(h('div', { class: 'icon-grid', role: 'group', 'aria-label': '絵を選ぶ' },
        ...WITH_ICONS.map(ic => h('button', { type: 'button', class: 'icon-pick', 'aria-pressed': ic === o.icon ? 'true' : 'false', text: ic, onclick: () => { o.icon = ic; withPick = null; paint() } }))))
    })
    sec.append(h('button', { type: 'button', class: 'secondary-btn bs-add', disabled: withs.length >= MAX_PER_TAB, text: withs.length >= MAX_PER_TAB ? `${MAX_PER_TAB}人まで` : '＋ だれとを足す', onclick: () => {
      withs.push({ key: 'w-' + newId().slice(0, 8), label: '', icon: '🙂' }); paint()
      requestAnimationFrame(() => { const el = body.querySelectorAll('.bs-name'); if (el.length) el[el.length - 1].focus() }) } }))
    if (withs.some((o, i) => DEFAULT_WITH.some(d => d.key === o.key) === false) || withs.length !== DEFAULT_WITH.length)
      sec.append(h('button', { type: 'button', class: 'link-btn bs-reset', text: '最初の一覧に戻す', onclick: () => { withs = DEFAULT_WITH.map(o => ({ ...o })); paint() } }))
    return sec
  }
  const save = async () => {
    tabsEd.forEach(t => { t.label = (t.label || '').trim() })
    if (tabsEd.some(t => !t.label && !BASE_TABS.some(b => b.key === t.key))) { showTab = '__tabs'; paint(); msg.textContent = '名前が空のタブがあります'; return }
    await saveTabs(tabsEd)
    withs.forEach(o => { o.label = (o.label || '').trim() })
    if (withs.some(o => !o.label)) { showTab = '__with'; paint(); msg.textContent = '名前が空の「だれと」があります'; return }
    await saveWiths(withs.map(o => ({ key: o.key, label: o.label, icon: o.icon })))
    list.forEach(b => { b.label = (b.label || '').trim() })
    if (list.some(b => !b.label)) { msg.textContent = '名前が空のボタンがあります'; return }
    await saveButtons(list.map(b => ({ kind: b.kind, label: b.label, icon: b.icon, tab: b.tab, ...btnExtra(b) })), newPreset)
    buildButtons()
    close()
    showToast('ボタンを保存しました')
  }
  const snapS = () => JSON.stringify([list, withs, newPreset, tabsEd])
  const firstS = snapS()
  sheet.replaceChildren(h('div', { class: 'sheet-inner', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'ボタン設定' },
    h('div', { class: 'sheet-top' }, h('h2', { text: 'ボタン設定' }), h('button', { type: 'button', class: 'link-btn', text: '閉じる', onclick: () => guardedClose(snapS, firstS, save, close) })),
    body,
    h('div', { class: 'sheet-foot' }, h('button', { type: 'button', class: 'primary-btn', text: '保存する', onclick: save }))))
  paint()
  sheet.hidden = false
  document.body.classList.add('no-scroll')
}


// ---------- 使う人(v0.19.2。本人「1つの携帯をシェアしている人向けに、ボタン一つで切り替え」) ----------
// 本人と決めたこと: 記録もボタンも人ごとに全部分ける(置き場が別)。切り替えは簡単な4けたの番号(のぞき見よけ。本当の鍵ではない)。
// 番号を付けた人は、切り替えるときと、アプリを開いたときに番号を聞く(開いたときは「開くときも聞く」がオンなら)。
// 番号は人ごとにハッシュにして、1人目の置き場の settings 'users' に置く。
let USERS = []
const ME = () => USERS.find(u => u.id === USER_ID) || { id: USER_ID, name: 'わたし', icon: '🙂' }
const MAX_USERS = 8
const USER_ICONS = ['🙂', '😀', '😎', '🤓', '👩', '👨', '👧', '👦', '👵', '👴', '🐶', '🐱', '🐻', '🐰', '🌸', '🌻', '⭐', '🍀']
const UNLOCK_KEY = 'diary.unlocked'   // sessionStorage: このアプリを開いている間、番号を入れ終わった人の id
const unlocked = () => { try { return sessionStorage.getItem(UNLOCK_KEY) === USER_ID } catch { return false } }
const setUnlocked = (id) => { try { sessionStorage.setItem(UNLOCK_KEY, id) } catch { /* */ } }
function paintUserChip() {
  const me = ME(), b = $('#userbtn')
  b.replaceChildren(h('span', { text: `${me.icon} ${me.name}${me.pin ? ' 🔒' : ''}` }), h('span', { class: 'user-chip-arrow', text: '▾' }))
  b.onclick = () => { closeMovePick(); openUsers() }
}
async function initUsers() {
  USERS = await listUsers()
  if (!USERS.some(u => u.id === USER_ID)) { switchUser('main'); return false }   // 消された人のまま開いたとき
  paintUserChip()
  const me = ME()
  if (me.pin && me.askOnOpen !== false && !unlocked()) {
    await new Promise(resolve => openLock(me, resolve))
  }
  return true
}
// 4けたの番号を聞く窓。ok(true/false)
function pinDialog({ title, sub, onDone, onCancel, extra }) {
  const sheet = $('#sheet')
  const input = h('input', { class: 'pin-input', type: 'password', inputmode: 'numeric', autocomplete: 'off', maxlength: '4', pattern: '[0-9]*', 'aria-label': '4けたの番号' })
  const msg = h('p', { class: 'muted pin-msg', role: 'status' })
  const check = async () => {
    const v = input.value.replace(/\D/g, '')
    if (v.length !== 4) return
    const r = await onDone(v)
    if (r === false) { msg.textContent = '番号が違います'; input.value = ''; input.focus() }
  }
  input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 4); if (input.value.length === 4) check() })
  sheet.replaceChildren(h('div', { class: 'sheet-inner pin-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-top' }, h('h2', { text: title }), onCancel ? h('button', { type: 'button', class: 'link-btn', text: 'やめる', onclick: onCancel }) : null),
    h('div', { class: 'sheet-body' }, sub ? h('p', { class: 'hint', text: sub }) : null, input, msg, extra || null)))
  sheet.hidden = false
  document.body.classList.add('no-scroll')
  setTimeout(() => input.focus(), 50)
}
function closeSheetPlain() { const sheet = $('#sheet'); sheet.hidden = true; sheet.replaceChildren(); document.body.classList.remove('no-scroll') }
// その人の番号が合っているか
const pinOk = async (u, v) => (await pinHash(u.id, v)) === u.pin
// 開いたときの鍵の画面(閉じられない)。ほかの人に切り替えることはできる
function openLock(me, resolve) {
  pinDialog({ title: `${me.icon} ${me.name}`, sub: '4けたの番号を入れてください',
    onDone: async (v) => { if (!(await pinOk(me, v))) return false; setUnlocked(me.id); closeSheetPlain(); resolve() },
    extra: h('div', { class: 'us-others' }, ...USERS.filter(u => u.id !== me.id).map(u => h('button', { type: 'button', class: 'secondary-btn', text: `${u.icon} ${u.name}にする`, onclick: () => goUser(u, () => openLock(me, resolve)) })),
      forgotBtn(me, () => openLock(me, resolve))) })
}
// 番号を忘れたとき: 1人目の番号で外せる(1人目が番号を付けていなければ、だれでも外せる)。1人目自身は外せない
function forgotBtn(u, back) {
  if (u.id === 'main') return h('p', { class: 'hint', text: '1人目の番号を忘れると、開けなくなります(記録は消えません)。' })
  const main = USERS.find(x => x.id === 'main')
  const drop = async () => { USERS = USERS.map(x => (x.id === u.id ? { ...x, pin: undefined } : x)); await saveUsers(USERS); setUnlocked(u.id); switchUser(u.id) }
  return h('button', { type: 'button', class: 'link-btn', text: '番号を忘れたとき', onclick: () => {
    if (!main.pin) { if (confirm(`${u.name}の番号を外して開きますか?`)) drop(); return }
    pinDialog({ title: '番号を外す', sub: `${main.icon} ${main.name}(1人目)の番号を入れると、${u.name}の番号を外せます。`,
      onCancel: back,
      onDone: async (v) => { if (!(await pinOk(main, v))) return false; await drop() } })
  } })
}
// ほかの人に切り替える(番号があれば聞く)
function goUser(u, back) {
  if (!u.pin) { setUnlocked(u.id); switchUser(u.id); return }
  pinDialog({ title: `${u.icon} ${u.name}にする`, sub: '4けたの番号を入れてください', onCancel: back,
    onDone: async (v) => { if (!(await pinOk(u, v))) return false; setUnlocked(u.id); switchUser(u.id) },
    extra: forgotBtn(u, back) })
}
// 使う人の画面
function openUsers() {
  const sheet = $('#sheet')
  const body = h('div', { class: 'sheet-body' })
  let edit = null   // 直している人(いまの人か、新しく足す人)
  const close = () => closeSheetPlain()
  const paint = () => {
    if (edit) { paintEdit(); return }
    body.replaceChildren(
      h('p', { class: 'hint', text: '1台のスマホを何人かで使うときに。人ごとに、記録・ボタン・場所・同期が全部別々になります。' }),
      h('div', { class: 'us-list' }, ...USERS.map(u => h('div', { class: 'us-row' + (u.id === USER_ID ? ' is-me' : '') },
        h('button', { type: 'button', class: 'us-pick', disabled: u.id === USER_ID, onclick: () => goUser(u, () => { openUsers() }) },
          h('span', { class: 'us-icon', text: u.icon }), h('span', { class: 'us-name', text: u.name }), u.pin ? h('span', { class: 'us-lock', text: '🔒' }) : null,
          h('span', { class: 'us-now', text: u.id === USER_ID ? 'いま' : '切り替える' })),
        u.id === USER_ID ? h('button', { type: 'button', class: 'bs-op', text: '直す', onclick: () => { edit = { ...u, isNew: false }; paint() } }) : null))),
      h('button', { type: 'button', class: 'secondary-btn', disabled: USERS.length >= MAX_USERS, text: USERS.length >= MAX_USERS ? `${MAX_USERS}人まで` : '＋ 使う人を足す', onclick: () => { edit = { id: newId().slice(0, 8), name: '', icon: USER_ICONS[USERS.length % USER_ICONS.length], isNew: true }; paint() } }),
      h('p', { class: 'hint', text: '番号は「のぞき見よけ」です。スマホにくわしい人なら中身を見ることができるので、大事な秘密は書かないでください。' }))
  }
  const paintEdit = () => {
    const e = edit
    const name = h('input', { class: 'us-name-input', type: 'text', maxlength: '12', value: e.name, placeholder: '名前(例: ママ・たろう)', 'aria-label': '名前' })
    name.addEventListener('input', () => { e.name = name.value })
    const pin1 = h('input', { class: 'pin-input small', type: 'password', inputmode: 'numeric', maxlength: '4', autocomplete: 'off', placeholder: '4けた', 'aria-label': '番号' })
    const pin2 = h('input', { class: 'pin-input small', type: 'password', inputmode: 'numeric', maxlength: '4', autocomplete: 'off', placeholder: 'もう一度', 'aria-label': '番号をもう一度' })
    for (const el of [pin1, pin2]) el.addEventListener('input', () => { el.value = el.value.replace(/\D/g, '').slice(0, 4) })
    const askOpen = h('input', { type: 'checkbox', checked: e.askOnOpen !== false })
    const msg = h('p', { class: 'muted', role: 'status' })
    const save = async () => {
      e.name = (e.name || '').trim()
      if (!e.name) { msg.textContent = '名前を入れてください'; return }
      if (USERS.some(u => u.id !== e.id && u.name === e.name)) { msg.textContent = '同じ名前の人がいます'; return }
      const p1 = pin1.value, p2 = pin2.value
      if (p1 || p2) {
        if (p1.length !== 4) { msg.textContent = '番号は4けたの数字です'; return }
        if (p1 !== p2) { msg.textContent = '2つの番号がちがいます'; return }
      }
      const u = { id: e.id, name: e.name, icon: e.icon, askOnOpen: askOpen.checked }
      if (p1) u.pin = await pinHash(e.id, p1); else if (!e.isNew && e.pin && !e.dropPin) u.pin = e.pin
      if (e.isNew) USERS = [...USERS, u]; else USERS = USERS.map(x => (x.id === u.id ? u : x))
      await saveUsers(USERS)
      if (e.isNew) { setUnlocked(u.id); switchUser(u.id); return }
      edit = null; paintUserChip(); paint(); showToast('保存しました')
    }
    body.replaceChildren(
      h('button', { type: 'button', class: 'link-btn us-back', text: '← 使う人の一覧にもどる', onclick: () => { edit = null; paint() } }),
      h('h3', { class: 'us-title', text: e.isNew ? '使う人を足す' : '自分を直す' }),
      h('label', { class: 'us-field' }, h('span', { text: '名前' }), name),
      h('div', { class: 'us-field' }, h('span', { text: '絵' }), h('div', { class: 'icon-grid' }, ...USER_ICONS.map(ic => h('button', { type: 'button', class: 'icon-pick', 'aria-pressed': ic === e.icon ? 'true' : 'false', text: ic, onclick: () => { e.name = name.value; e.icon = ic; paint() } })))),
      h('div', { class: 'us-field' }, h('span', { text: e.pin && !e.dropPin ? '番号(いまは付いています。変えるときだけ入れる)' : '番号(付けなくてもよい)' }), h('div', { class: 'us-pins' }, pin1, pin2),
        e.pin && !e.dropPin ? h('button', { type: 'button', class: 'link-btn', text: '番号を外す', onclick: () => { e.name = name.value; e.dropPin = true; paint() } }) : null,
        h('label', { class: 'us-check' }, askOpen, h('span', { text: 'アプリを開くときも番号を聞く' })),
        e.id === 'main' ? h('p', { class: 'hint', text: '1人目の番号は、忘れると外せません(ほかの人の番号は、1人目の番号で外せます)。' }) : null),
      h('button', { type: 'button', class: 'primary-btn us-save', text: e.isNew ? '足して、この人に切り替える' : '保存する', onclick: save }),
      msg,
      !e.isNew && e.id !== 'main' ? h('button', { type: 'button', class: 'link-btn us-del', text: 'この人を消す(記録も全部)', onclick: async () => {
        const n = (await allEntries()).length
        if (!confirm(`${e.name}を消しますか?\nこの人の記録 ${n}件・写真・ボタン・場所も全部消えます。元に戻せません。`)) return
        USERS = USERS.filter(x => x.id !== e.id); await saveUsers(USERS)
        await dropUserData(e.id).catch(() => { /* 開いたままなら次に開いたときに消える */ })
        switchUser('main') } }) : '')
  }
  sheet.replaceChildren(h('div', { class: 'sheet-inner', role: 'dialog', 'aria-modal': 'true', 'aria-label': '使う人' },
    h('div', { class: 'sheet-top' }, h('h2', { text: '👤 使う人' }), h('button', { type: 'button', class: 'link-btn', text: '閉じる', onclick: close })),
    body))
  paint()
  sheet.hidden = false
  document.body.classList.add('no-scroll')
}

// ---------- お試しモード(v0.18.2。本人「デバッグ必要だから裏メニューとして」) ----------
// 入り方: 足もとの版の数字(v0.18.2 など)を、続けて5回押す → ?try を付けて開き直す。
// お試しモードでは別の置き場(diary-try)を使い、同期はしない。上の帯から「全部消す」「本番にもどる」。
function setupTryMode() {
  if (!ED.DEBUG_MENU) return   // 公開版には裏メニューを付けない
  const ver = $('#version')
  let taps = 0, timer = null
  ver.addEventListener('click', () => {
    taps++; clearTimeout(timer); timer = setTimeout(() => { taps = 0 }, 1500)
    if (taps < 5) return
    taps = 0
    if (TRY_MODE) { if (confirm('本番の日記にもどりますか?')) location.href = location.pathname }
    else if (confirm('🧪 お試しモードで開きますか?\n本番の記録とは別の箱で動きます。お試しで押したものは本番に入りません(同期もしません)。')) location.href = `${location.pathname}?try`
  })
  if (!TRY_MODE) return
  document.title = `🧪 お試し ${document.title}`
  document.body.classList.add('try-mode')
  const bar = h('div', { class: 'try-bar', role: 'note' },
    h('strong', { text: '🧪 お試しモード' }), h('span', { class: 'try-sub', text: '本番の記録とは別です' }),
    h('span', { class: 'spacer' }),
    h('button', { type: 'button', class: 'try-btn', text: '全部消す', onclick: async () => {
      if (!confirm('お試しの記録・写真・設定を全部消しますか?(本番の記録は消えません)')) return
      await wipeTry(); try { localStorage.removeItem('diary.try.draft') } catch { /* */ }
      location.reload() } }),
    h('button', { type: 'button', class: 'try-btn', text: '本番へ', onclick: () => { location.href = location.pathname } }))
  document.querySelector('.top').prepend(bar)
}

// ---------- グーグルドライブで同期(v0.13。中身は鍵をかけてから送る。sync.js) ----------
// Google Cloud で作った「OAuth クライアント ID」(秘密ではない。ここに入れておけば各端末で入れずに済む)
const DEFAULT_CLIENT_ID = ED.CLIENT_ID
const SYNC_AFTER_LOGIN = 'diary.syncAfterLogin' + USER_SUFFIX
let syncing = false
async function syncCfg() { return { clientId: DEFAULT_CLIENT_ID, ...((await getSetting('sync')) || {}) } }
function paintSyncFoot(cfg) {
  const on = !!(cfg && cfg.lastSync)
  $('#where').textContent = on ? '記録はこの端末と、鍵をかけてグーグルドライブに' : '記録はこの端末の中だけ'
  $('#sync-btn').title = on ? `最後の同期: ${cfg.lastSync.slice(5, 16).replace('T', ' ')}` : 'グーグルドライブで、ほかの端末と記録を合わせる'
}

// 合言葉を聞く窓。mode: 'new' = 初めて決める(2回入れる)、'enter' = ほかの端末で決めた合言葉を入れる
function askPass(mode, note = '') {
  return new Promise((resolve) => {
    const sheet = $('#sheet')
    const p1 = h('input', { type: 'password', class: 'input', autocomplete: mode === 'new' ? 'new-password' : 'current-password', 'aria-label': '合言葉' })
    const p2 = h('input', { type: 'password', class: 'input', autocomplete: 'new-password', 'aria-label': '合言葉(もう一度)' })
    const msg = h('p', { class: 'ed-msg', 'aria-live': 'polite', text: note })
    const close = (v) => { sheet.hidden = true; sheet.replaceChildren(); document.body.classList.remove('no-scroll'); resolve(v) }
    const ok = () => {
      const v = p1.value
      if (mode === 'new') {
        if (v.length < 8) { msg.textContent = '8文字以上にしてください(長いほど安全です)'; return }
        if (v !== p2.value) { msg.textContent = '2回の合言葉がちがいます'; return }
      } else if (!v) { msg.textContent = '合言葉を入れてください'; return }
      close(v)
    }
    const onKey = (ev) => { if (ev.key === 'Enter') ok() }
    p1.addEventListener('keydown', onKey); p2.addEventListener('keydown', onKey)
    sheet.replaceChildren(h('div', { class: 'sheet-inner', role: 'dialog', 'aria-modal': 'true', 'aria-label': '同期の合言葉' },
      h('div', { class: 'sheet-top' }, h('h2', { text: mode === 'new' ? '同期の合言葉を決める' : '同期の合言葉' }), h('button', { type: 'button', class: 'link-btn', text: 'やめる', onclick: () => close(null) })),
      h('div', { class: 'sheet-body' },
        mode === 'new'
          ? h('div', { class: 'bk-note' }, h('h3', { text: '大事なこと' }),
            h('p', { text: '記録は、この合言葉で鍵をかけてからグーグルドライブに置きます。Google にも、ほかの人にも中身は読めません。' }),
            h('p', { class: 'warn', text: '合言葉を忘れると、ドライブの分は誰にも開けません(Google にも)。紙などに控えておいてください。' }),
            h('p', { text: `${ED.TEXT.devices}で同じ合言葉を使います。この端末では、次からは聞きません。` }))
          : h('p', { text: 'ほかの端末で決めた合言葉を入れてください。この端末では、次からは聞きません。' }),
        h('div', {}, h('span', { class: 'ed-label', text: '合言葉' }), p1),
        mode === 'new' ? h('div', {}, h('span', { class: 'ed-label', text: '合言葉(もう一度)' }), p2) : null,
        msg),
      h('div', { class: 'sheet-foot' }, h('button', { type: 'button', class: 'primary-btn', text: 'これで鍵をかける', onclick: ok }))))
    sheet.hidden = false
    document.body.classList.add('no-scroll')
    p1.focus()
  })
}

// 同期: ドライブの中身を読み、この端末と合わせ、合わせたものをドライブに置く
async function runSync(report = (t) => showToast(t)) {
  if (TRY_MODE) { report('お試しモードでは同期しません(本番の記録を守るため)'); return }
  if (syncing) return
  const cfg = await syncCfg()
  if (!cfg.clientId) { report('先に、バックアップの画面で「Google のクライアント ID」を入れてください'); openBackup(); return }
  if (!navigator.onLine) { report('電波がないので同期できません'); return }
  const token = S.tokenNow()
  if (!token) {
    try { sessionStorage.setItem(SYNC_AFTER_LOGIN, '1') } catch { /* */ }
    S.login(cfg.clientId)       // Google のログインへ移動して、もどってきたら続きをする
    return
  }
  syncing = true
  const btn = $('#sync-btn'); btn.disabled = true; btn.classList.add('busy')
  try {
    report('同期しています…')
    const files = await S.listFiles(token)
    const byName = new Map(files.map(f => [f.name, f]))
    const mainF = byName.get(S.MAIN)
    let k = await getSetting('syncKey')       // { key: CryptoKey(取り出せない形), salt }
    let remote = null
    if (mainF) {
      const buf = await S.download(token, mainF.id)
      const salt = S.saltOf(buf)
      for (let tries = 0; ; tries++) {
        if (!k || k.salt !== S.b64(salt)) {
          const pass = await askPass('enter', tries ? '合言葉がちがいます。もう一度入れてください' : '')
          if (pass == null) { report('同期をやめました'); return }
          k = { key: await S.deriveKey(pass, salt), salt: S.b64(salt) }
        }
        try { remote = JSON.parse(new TextDecoder().decode(await S.open(k.key, buf))); break } catch (err) {
          if (err.message !== 'WRONG_PASS') throw err
          k = null
          if (tries >= 4) { report('合言葉がちがうので、同期をやめました'); return }
        }
      }
      await putSetting('syncKey', k)
    } else if (!k) {
      const pass = await askPass('new')
      if (pass == null) { report('同期をやめました'); return }
      const salt = crypto.getRandomValues(new Uint8Array(16))
      k = { key: await S.deriveKey(pass, salt), salt: S.b64(salt) }
      await putSetting('syncKey', k)
    }
    if (remote && remote.app !== 'diary-sync') throw new Error('ドライブの中身が日記のものではありません')
    const salt = S.unb64(k.salt)
    report('記録を合わせています…')

    // 1. 記録(消した印も)
    const local = await allEntries()
    const tombsL = (await getSetting('tombs')) || {}
    const { entries, tombs } = S.mergeEntries(local, (remote && remote.entries) || [], tombsL, (remote && remote.tombs) || {})
    const keep = new Set(entries.map(e => e.id))
    const localBy = new Map(local.map(e => [e.id, e]))
    let added = 0, changed = 0, removed = 0, gotP = 0, gotA = 0
    for (const e of local) if (!keep.has(e.id)) { await deleteEntry(e.id, tombs[e.id]); removed++ }
    const meta = { photos: (remote && remote.photoMeta) || {}, audios: (remote && remote.audioMeta) || {} }
    for (const e of entries) {
      const cur = localBy.get(e.id)
      if (cur && JSON.stringify(cur) === JSON.stringify(e)) continue
      // 写真・録音で、この端末にないものはドライブから取る
      for (const pid of photosOf(e)) {
        if (await getPhoto(pid)) continue
        const f = byName.get(S.blobName('p', pid))
        if (!f) continue
        const bytes = await S.open(k.key, await S.download(token, f.id))
        const m = meta.photos[pid] || {}
        await savePhoto({ id: pid, blob: new Blob([bytes], { type: m.mime || 'image/jpeg' }), w: m.w || 0, h: m.h || 0, created_at: m.created_at || e.at }); gotP++
      }
      for (const aid of audiosOf(e)) {
        if (await getAudio(aid)) continue
        const f = byName.get(S.blobName('a', aid))
        if (!f) continue
        const bytes = await S.open(k.key, await S.download(token, f.id))
        const m = meta.audios[aid] || {}
        await saveAudio({ id: aid, blob: new Blob([bytes], { type: m.mime || 'audio/webm' }), mime: m.mime || '', sec: m.sec || 0, created_at: m.created_at || e.at }); gotA++
      }
      await putEntry(e)
      if (cur) changed++; else added++
    }
    await putSetting('tombs', tombs)

    // 2. 設定: ボタンは新しく保存したほう、場所・お薬などは合わせる、件名リストは新しく書き出したほう
    const rs = (remote && remote.settings) || {}
    const myButtons = await getSetting('buttons')
    if (rs.buttons && Array.isArray(rs.buttons.buttons) && (!myButtons || (rs.buttons.updated_at || '') > (myButtons.updated_at || ''))) {
      await putSetting('buttons', rs.buttons); BUTTONS = rs.buttons.buttons; if (rs.buttons.preset) { PRESET = rs.buttons.preset; applyPresetNames() } buildButtons()
    }
    if (Array.isArray(rs.places)) {
      const add = rs.places.filter(p => p && typeof p.id === 'string' && !PLACES.some(x => x.id === p.id))
      if (add.length) await savePlaces([...PLACES, ...add])
    }
    for (const key of ['meds', 'symptoms']) {
      const add = ((rs.lists || {})[key] || []).filter(x => typeof x === 'string' && !LISTS[key].includes(x))
      if (add.length) await LISTS.save(key, [...LISTS[key], ...add])
    }
    { const add = cleanWiths((rs.lists || {}).withs).filter(o => !WITH_OPTS.some(x => x.key === o.key)); if (add.length) await saveWiths([...WITH_OPTS, ...add]) }
    { const add = cleanTabs((rs.lists || {}).tabs).filter(t => !TABS.some(x => x.key === t.key)); if (add.length) await saveTabs([...TABS, ...add]) }   // v0.21.1 自分のタブ
    // 件名リスト(この版で使うときだけ。projects.js)
    const { got: gotK, note: pjNote } = await PJ.syncPull(rs, byName, (id) => S.download(token, id), (buf) => S.open(k.key, buf))
    if (rs.tide && !TIDE) { TIDE = rs.tide; await putSetting('tide', TIDE) }

    // 3. 写真・録音で、ドライブにないものを送る(鍵をかけて)。使われなくなったものはドライブから消す
    report('ドライブに送っています…')
    const now = await allEntries()
    const photoMeta = {}, audioMeta = {}
    let sentP = 0, sentA = 0
    const want = new Set()
    for (const e of now) {
      for (const pid of photosOf(e)) {
        const name = S.blobName('p', pid); want.add(name)
        const p = await getPhoto(pid)
        if (!p) { if (meta.photos[pid]) photoMeta[pid] = meta.photos[pid]; continue }
        photoMeta[pid] = { w: p.w || 0, h: p.h || 0, mime: p.blob.type || 'image/jpeg', created_at: p.created_at || '' }
        if (!byName.has(name)) { await S.upload(token, name, await S.seal(k.key, salt, new Uint8Array(await p.blob.arrayBuffer()), false)); sentP++ }
      }
      for (const aid of audiosOf(e)) {
        const name = S.blobName('a', aid); want.add(name)
        const a = await getAudio(aid)
        if (!a) { if (meta.audios[aid]) audioMeta[aid] = meta.audios[aid]; continue }
        audioMeta[aid] = { mime: a.mime || a.blob.type || '', sec: a.sec || 0, created_at: a.created_at || '' }
        if (!byName.has(name)) { await S.upload(token, name, await S.seal(k.key, salt, new Uint8Array(await a.blob.arrayBuffer()), false)); sentA++ }
      }
    }
    for (const f of files) if (/^[pa]-.+\.enc$/.test(f.name) && !want.has(f.name)) await S.remove(token, f.id).catch(() => {})

    // ドライブ側から見て変わったもの(この端末で書いた・直した・消した分)
    const remoteBy = new Map(((remote && remote.entries) || []).map(e => [e.id, JSON.stringify(e)]))
    const sentE = now.filter(e => remoteBy.get(e.id) !== JSON.stringify(e)).length
    const sentD = Object.keys(tombs).filter(id => !((remote && remote.tombs) || {})[id] && remoteBy.has(id)).length
    // 4. 本体(記録と設定)を、鍵をかけて置く
    const body = { app: 'diary-sync', format: 1, version: VERSION, saved_at: stamp(new Date()), entries: now, tombs, photoMeta, audioMeta,
      settings: { buttons: await getSetting('buttons'), places: PLACES, lists: { meds: LISTS.meds, symptoms: LISTS.symptoms, withs: WITH_OPTS, tabs: TABS }, projects: PJ.data(), tide: TIDE } }
    await S.upload(token, S.MAIN, await S.seal(k.key, salt, new TextEncoder().encode(JSON.stringify(body))), mainF && mainF.id)

    const next = { ...cfg, lastSync: stamp(new Date()) }
    delete next.lastResult
    await putSetting('sync', { ...next, lastResult: { added, changed, removed, sentP, sentA, gotP, gotA } })
    paintSyncFoot(next)
    await render()
    const parts = [added && `受け取った記録 ${added}件`, changed && `新しくなった記録 ${changed}件`, removed && `ほかで消した記録 ${removed}件`,
      (gotP || gotA) && `受け取った写真・録音 ${gotP + gotA}`, sentE && `送った記録 ${sentE}件`, sentD && `消したことを伝えた記録 ${sentD}件`,
      (sentP || sentA) && `送った写真・録音 ${sentP + sentA}`, gotK && `新しい件名リスト ${gotK}件`].filter(Boolean)
    report(`同期しました${parts.length ? `(${parts.join('・')})` : '(変わったところはありません)'}${pjNote ? `。${pjNote}` : ''}`)
  } catch (err) {
    if (err instanceof S.AuthError) {
      try { sessionStorage.setItem(SYNC_AFTER_LOGIN, '1') } catch { /* */ }
      report('ログインし直します…'); setTimeout(() => S.login(cfg.clientId), 800)
    } else report(`同期できませんでした: ${err.message || err}`)
  } finally {
    syncing = false; btn.disabled = false; btn.classList.remove('busy')
  }
}

// バックアップの画面の「グーグルドライブで同期」の欄
function syncCard() {
  const status = h('p')
  const msg = h('p', { class: 'bk-msg', 'aria-live': 'polite' })
  const idIn = h('input', { type: 'text', class: 'input', placeholder: '123456789-xxxx.apps.googleusercontent.com', 'aria-label': 'Google のクライアント ID', spellcheck: 'false', autocapitalize: 'off' })
  const paint = async () => {
    const cfg = await syncCfg()
    idIn.value = cfg.clientId || ''
    const k = await getSetting('syncKey')
    status.textContent = cfg.lastSync ? `最後の同期: ${cfg.lastSync.slice(0, 16).replace('T', ' ')}` : 'まだ同期していません。'
    forgetBtn.hidden = !k
  }
  const saveId = async () => {
    const v = idIn.value.trim()
    if (v && !/\.apps\.googleusercontent\.com$/.test(v)) { msg.className = 'bk-msg err'; msg.textContent = 'クライアント ID の形がちがいます(…apps.googleusercontent.com で終わります)'; return false }
    await putSetting('sync', { ...((await getSetting('sync')) || {}), clientId: v }); return true
  }
  const goBtn = h('button', { type: 'button', class: 'primary-btn', text: '同期する', onclick: async () => { if (await saveId()) { $('#sheet').hidden = true; $('#sheet').replaceChildren(); document.body.classList.remove('no-scroll'); runSync() } } })
  const forgetBtn = h('button', { type: 'button', class: 'small-btn', text: 'この端末の鍵を消す', onclick: async () => {
    if (!confirm('この端末に覚えている同期の鍵を消します。次の同期で合言葉を聞きます(記録は消えません)。')) return
    await putSetting('syncKey', null); S.forgetToken(); msg.className = 'bk-msg ok'; msg.textContent = '鍵を消しました。'; paint()
  } })
  paint()
  return h('div', { class: 'bk-card' }, h('h3', { text: 'グーグルドライブで同期(鍵つき)' }),
    h('p', { text: `${ED.TEXT.devices}の記録を合わせます。中身はこの端末で合言葉の鍵をかけてから、ドライブのアプリ専用の隠しフォルダに置きます(Google にも読めません)。消した記録は、ほかの端末からも消えます。` }),
    status,
    h('div', {}, h('span', { class: 'ed-label', text: 'Google のクライアント ID(最初に1回)' }), idIn),
    ED.SETUP_GUIDE ? h('p', { class: 'hint' }, 'クライアント ID は、使う人が自分の Google アカウントで作ります(無料)。作り方: ', h('a', { href: ED.SETUP_GUIDE, target: '_blank', rel: 'noopener', text: 'グーグルドライブ同期の準備' })) : null,
    ED.SETUP_GUIDE ? h('p', { class: 'hint' }, '準備のときに入れる場所 → 承認済みの JavaScript 生成元: ', h('code', { text: location.origin }), ' / 承認済みのリダイレクト URI: ', h('code', { text: S.redirectUri() })) : null,
    h('div', { class: 'bk-row' }, goBtn, forgetBtn), msg)
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
  if (!(await initUsers())) return
  await loadButtons()
  await PJ.load()
  await loadLists()
  buildButtons()
  initDock()
  $('#write').addEventListener('click', () => { closeMovePick(); openEditor(null) })
  $('#record').addEventListener('click', () => { closeMovePick(); openEditor(null, { kind: 'memo', record: true }) })
  $('#btnset').addEventListener('click', () => { closeMovePick(); openButtonSettings() })
  $('#places').addEventListener('click', () => { closeMovePick(); openPlaces() })
  $('#stats').addEventListener('click', () => { closeMovePick(); openStats() })
  $('#export').addEventListener('click', openBackup)
  $('#day-prev').addEventListener('click', () => goDay(addDays(shownDay(), -1)))
  $('#day-next').addEventListener('click', () => goDay(addDays(shownDay(), 1)))
  $('#day-today').addEventListener('click', () => goDay(null))
  $('#day-pick').addEventListener('change', (ev) => { if (ev.target.value) goDay(ev.target.value) })
  // 広い画面(タブレット・パソコン)では、← → のキーでも日を動かす(入力中は動かさない)
  document.addEventListener('keydown', (ev) => {
    if (!$('#sheet').hidden || /INPUT|TEXTAREA|SELECT/.test((ev.target || {}).tagName || '')) return
    if (ev.key === 'ArrowLeft') goDay(addDays(shownDay(), -1))
    else if (ev.key === 'ArrowRight' && viewDay) goDay(addDays(shownDay(), 1))
  })
  $('#version').textContent = `v${VERSION}`
  setupTryMode()
  $('#sync-btn').addEventListener('click', () => { closeMovePick(); runSync() })
  paintSyncFoot(await syncCfg())
  // Google のログインからもどってきたとき
  const back = S.takeRedirect()
  let resume = false
  try { resume = sessionStorage.getItem(SYNC_AFTER_LOGIN) === '1'; sessionStorage.removeItem(SYNC_AFTER_LOGIN) } catch { /* */ }
  if (back && back.error) setTimeout(() => showToast(back.error), 300)
  else if (back && back.ok && resume) setTimeout(() => runSync(), 300)
  $('#ios-install').hidden = !(isIOS() && !isStandalone())
  await render()
  await maybeFirstPreset()
  askPersist().then(ok => { $('#persist').textContent = ok ? '・ 消されない設定' : '' })
  setInterval(() => { if (!$('#sheet').hidden) return; if (dayOf(new Date()) !== today) render(); else { renderOngoing(); document.querySelectorAll('.live-dur').forEach(el => { el.textContent = `${el.dataset.word || '続いています'} ・ ${fmtDur(durMin(el.dataset.at, new Date()))}` }); document.querySelectorAll('.live-legs').forEach(el => { if (el._entry) el.textContent = legsText(el._entry) }); document.querySelectorAll('.tl-move.live').forEach(el => { if (el._fill) el._fill() }) } }, 60 * 1000)
  document.addEventListener('visibilitychange', () => { if (!document.hidden && $('#sheet').hidden) render() })
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !window.Capacitor) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* なくても動く */ })
  }
}

main().catch(err => {
  $('#error').hidden = false
  $('#error').textContent = `うまく動きませんでした: ${err && err.message ? err.message : err}`
})
