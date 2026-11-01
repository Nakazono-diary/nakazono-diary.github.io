// 写真を小さくする(長い辺 1600px の JPEG)。描き直すので、写真に入っている撮影場所(GPS)などの情報は消える。
const MAX = 1600
const QUALITY = 0.82

export async function shrinkPhoto(file) {
  let src, w, h
  try {
    src = await createImageBitmap(file, { imageOrientation: 'from-image' })
    w = src.width; h = src.height
  } catch {
    // createImageBitmap が使えないブラウザ向け
    src = await new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('写真を読めませんでした'))
      img.src = URL.createObjectURL(file)
    })
    w = src.naturalWidth; h = src.naturalHeight
  }
  const scale = Math.min(1, MAX / Math.max(w, h))
  const cw = Math.round(w * scale), ch = Math.round(h * scale)
  const canvas = document.createElement('canvas')
  canvas.width = cw; canvas.height = ch
  canvas.getContext('2d').drawImage(src, 0, 0, cw, ch)
  if (src.close) src.close()
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', QUALITY))
  if (!blob) throw new Error('写真を小さくできませんでした')
  return { blob, w: cw, h: ch }
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}
