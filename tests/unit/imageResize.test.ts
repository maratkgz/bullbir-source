import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS module without type declarations
import { AVATAR_IMAGE, BANNER_IMAGE, coverCrop } from '../../src/utils/imageResize.js'

describe('coverCrop', () => {
  it('crops the sides of a wide photo into a square, centred', () => {
    expect(coverCrop(4000, 3000, 256, 256)).toEqual({ sx: 500, sy: 0, sw: 3000, sh: 3000 })
  })

  it('crops top and bottom of a tall phone photo into a 3:1 banner, centred', () => {
    expect(coverCrop(3000, 4000, 1200, 400)).toEqual({ sx: 0, sy: 1500, sw: 3000, sh: 1000 })
  })

  it('keeps an image that already has the target ratio', () => {
    expect(coverCrop(1200, 400, 1200, 400)).toEqual({ sx: 0, sy: 0, sw: 1200, sh: 400 })
  })
})

describe('size caps stay under the Firestore rules', () => {
  it('avatar ≤ 200 KB and banner ≤ 450 KB', () => {
    expect(AVATAR_IMAGE.maxBytes).toBeLessThanOrEqual(200_000)
    expect(BANNER_IMAGE.maxBytes).toBeLessThanOrEqual(450_000)
  })
})
