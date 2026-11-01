// 場所: スマホが自分で測った位置と、本人が名前を付けて登録した場所。
// 位置は記録と一緒にスマホの中にしまうだけ。住所を調べるサービス・地図には送らない(地図も出さない)。

// 2点の距離(メートル)
export function distance(a, b) {
  const R = 6371000, rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)))
}

// いちばん近い登録の場所(範囲の中にあるものだけ)
export function matchPlace(loc, places) {
  if (!loc) return null
  let best = null, bestD = Infinity
  for (const p of places) {
    const d = distance(loc, p)
    if (d <= (p.r || 150) && d < bestD) { best = p; bestD = d }
  }
  return best
}

// いまの位置を測る。取れなければ理由を返す
export function measure() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve({ error: 'このブラウザでは位置を測れません' }); return }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ loc: { lat: Math.round(pos.coords.latitude * 1e6) / 1e6, lon: Math.round(pos.coords.longitude * 1e6) / 1e6, acc: Math.round(pos.coords.accuracy) } }),
      (err) => resolve({ error: err.code === 1 ? '位置の使用が許可されていません(ブラウザの設定で、このサイトの「位置情報」を許可してください)'
        : err.code === 3 ? '時間内に位置が取れませんでした(屋内や地下だと取りにくいです)' : '位置が取れませんでした' }),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 })
  })
}

export const RADII = [50, 100, 150, 300, 500, 1000]
export const fmtDist = (m) => (m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${Math.round(m)}m`)
