import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { transformImage } from '../src/runtime/server/utils/image'

async function solidPng(width: number, height: number) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer()
}

describe('transformImage', () => {
  it('resizes within a box and converts format', async () => {
    const input = await solidPng(512, 512)
    const result = await transformImage(input, { width: 64, format: 'webp' })

    expect(result.format).toBe('webp')
    expect(result.mime).toBe('image/webp')
    expect(result.width).toBe(64)
    expect(result.height).toBe(64)

    // The stored bytes really are a 64px webp.
    const meta = await sharp(result.data).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.width).toBe(64)
  })

  it('does not enlarge by default', async () => {
    const input = await solidPng(32, 32)
    const result = await transformImage(input, { width: 256, format: 'png' })

    expect(result.width).toBe(32)
    expect(result.height).toBe(32)
  })

  it('preserves animation for animated inputs', async () => {
    const red = await solidPng(8, 8)
    const blue = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 4,
        background: { r: 0, g: 0, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer()

    // A 2-frame animated webp.
    const animated = await sharp([red, blue], { join: { animated: true } })
      .webp()
      .toBuffer()

    const result = await transformImage(animated, {
      width: 4,
      format: 'webp',
      animated: true,
    })

    const meta = await sharp(result.data, { animated: true }).metadata()
    expect(meta.format).toBe('webp')
    expect(meta.pages).toBe(2)
  })

  it('keeps the input format when none is given', async () => {
    const input = await solidPng(40, 40)
    const result = await transformImage(input, { width: 20 })

    expect(result.format).toBe('png')
    expect(result.mime).toBe('image/png')
    expect(result.width).toBe(20)
  })
})
