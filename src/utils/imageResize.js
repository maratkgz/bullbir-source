// Shrinks a user-picked photo in the browser so it can be stored inside the profile doc
// (Firestore rules cap avatar ~200 KB and banner ~450 KB as data URLs).

/** Source rectangle that "cover"-crops (sw×sh) into the target aspect ratio, centred. */
export function coverCrop(sw, sh, tw, th) {
  const targetRatio = tw / th
  const srcRatio = sw / sh
  if (srcRatio > targetRatio) {
    const w = Math.round(sh * targetRatio)
    return { sx: Math.round((sw - w) / 2), sy: 0, sw: w, sh }
  }
  const h = Math.round(sw / targetRatio)
  return { sx: 0, sy: Math.round((sh - h) / 2), sw, sh: h }
}

/** Approximate bytes of a base64 data URL. */
export const dataUrlBytes = (url) => url.length

async function loadImage(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file) } catch { /* fall back to <img> (e.g. older Safari) */ }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image-decode')) }
    img.src = url
  })
}

/**
 * Resize + crop a picked image to width×height and encode it as JPEG, lowering quality until
 * the data URL fits maxBytes.
 * @returns {Promise<string>} data:image/jpeg;base64,…
 */
export async function imageToDataUrl(file, { width, height, maxBytes }) {
  const img = await loadImage(file)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  const { sx, sy, sw, sh } = coverCrop(img.width, img.height, width, height)
  ctx.fillStyle = '#ffffff' // transparent PNG/GIF areas become white, not black, in JPEG
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, width, height)
  if (typeof img.close === 'function') img.close()

  for (const quality of [0.85, 0.75, 0.65, 0.55, 0.45]) {
    const url = canvas.toDataURL('image/jpeg', quality)
    if (dataUrlBytes(url) <= maxBytes) return url
  }
  throw new Error('image-too-big')
}

export const AVATAR_IMAGE = { width: 256, height: 256, maxBytes: 190_000 }
export const BANNER_IMAGE = { width: 1200, height: 400, maxBytes: 440_000 }
