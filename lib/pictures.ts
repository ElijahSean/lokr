/**
 * Browser-side picture validation and metadata-stripping re-encode.
 *
 * File extensions and declared MIME types are untrusted. The first bytes pick
 * the decoder, then a canvas redraw drops EXIF and other source-file metadata.
 */

export const NOTE_PICTURE_LIMIT = 5
export const NOTE_PICTURE_MAX_BYTES = 5 * 1024 * 1024
export const NOTE_PICTURE_MAX_DIMENSION = 4096

export type PictureType = 'png' | 'jpeg' | 'webp' | 'gif'

export interface ProcessedPicture {
  bytes: Uint8Array
  type: Exclude<PictureType, 'gif'>
  mime: string
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value)
}

/** Identifies only the four accepted formats from their binary signatures. */
export function sniffPictureType(bytes: Uint8Array): PictureType {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) return 'webp'
  if (
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
    startsWith(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) return 'gif'
  throw new Error('Choose a PNG, JPEG, WebP or GIF picture.')
}

export function pictureMime(type: PictureType): string {
  if (type === 'jpeg') return 'image/jpeg'
  return `image/${type}`
}

export function assertPictureSize(size: number): void {
  if (!Number.isFinite(size) || size < 1 || size > NOTE_PICTURE_MAX_BYTES) {
    throw new Error('Pictures must be 5 MB or smaller.')
  }
}

function outputTypeFor(input: PictureType): Exclude<PictureType, 'gif'> {
  return input === 'gif' ? 'png' : input
}

async function canvasBlob(
  canvas: HTMLCanvasElement,
  mime: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (blob) resolve(blob)
      else reject(new Error('This picture could not be re-encoded.'))
    }, mime, quality)
  })
}

/** Redraws one validated image, stripping metadata and reducing extreme dimensions. */
export async function reencodePicture(bytes: Uint8Array): Promise<ProcessedPicture> {
  assertPictureSize(bytes.byteLength)
  const inputType = sniffPictureType(bytes)
  const sourceBytes = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer
  const source = new Blob([sourceBytes], { type: pictureMime(inputType) })
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(source)
  } catch {
    throw new Error('This picture could not be decoded.')
  }

  try {
    const scale = Math.min(1, NOTE_PICTURE_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This browser cannot process pictures.')
    context.drawImage(bitmap, 0, 0, width, height)

    const outputType = outputTypeFor(inputType)
    const outputMime = pictureMime(outputType)
    const output = await canvasBlob(
      canvas,
      outputMime,
      outputType === 'jpeg' || outputType === 'webp' ? 0.92 : undefined,
    )
    assertPictureSize(output.size)
    const outputBytes = new Uint8Array(await output.arrayBuffer())
    if (sniffPictureType(outputBytes) !== outputType) {
      throw new Error('This browser did not produce a supported picture.')
    }
    return { bytes: outputBytes, type: outputType, mime: outputMime }
  } finally {
    bitmap.close()
  }
}
