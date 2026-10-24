import { describe, expect, it } from 'vitest'
import {
  NOTE_PICTURE_MAX_BYTES,
  assertPictureSize,
  pictureMime,
  sniffPictureType,
} from '@/lib/pictures'

describe('picture signature validation', () => {
  it.each([
    ['PNG', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'png'],
    ['JPEG', [0xff, 0xd8, 0xff, 0xe1], 'jpeg'],
    ['WebP', [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], 'webp'],
    ['GIF87a', [...new TextEncoder().encode('GIF87a')], 'gif'],
    ['GIF89a', [...new TextEncoder().encode('GIF89a')], 'gif'],
  ])('recognises %s from bytes', (_label, signature, expected) => {
    expect(sniffPictureType(new Uint8Array(signature as number[]))).toBe(expected)
  })

  it('refuses executable bytes even when a filename could claim they are an image', () => {
    expect(() => sniffPictureType(new Uint8Array([0x4d, 0x5a, 0x90, 0x00]))).toThrow(
      'PNG, JPEG, WebP or GIF',
    )
  })

  it('enforces the 5 MB boundary', () => {
    expect(() => assertPictureSize(NOTE_PICTURE_MAX_BYTES)).not.toThrow()
    expect(() => assertPictureSize(NOTE_PICTURE_MAX_BYTES + 1)).toThrow('5 MB')
    expect(() => assertPictureSize(0)).toThrow('5 MB')
  })

  it('maps detected types to browser MIME types', () => {
    expect(pictureMime('jpeg')).toBe('image/jpeg')
    expect(pictureMime('png')).toBe('image/png')
    expect(pictureMime('webp')).toBe('image/webp')
    expect(pictureMime('gif')).toBe('image/gif')
  })
})
