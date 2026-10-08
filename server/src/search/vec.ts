export function l2(vector: Float32Array): Float32Array {
  let sum = 0
  for (let i = 0; i < vector.length; i++) sum += vector[i]! * vector[i]!
  const norm = Math.sqrt(sum) || 1
  const out = new Float32Array(vector.length)
  for (let i = 0; i < vector.length; i++) out[i] = vector[i]! / norm
  return out
}

export function dot(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`embedding dim mismatch ${a.length} vs ${b.length}`)
  }
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!
  return sum
}

export function floatsToBlob(vector: Float32Array): Uint8Array {
  return new Uint8Array(
    vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength)
  )
}

export function blobToFloats(blob: Uint8Array): Float32Array {
  const copy = new Uint8Array(blob.byteLength)
  copy.set(blob)
  if (copy.byteLength % 4 !== 0) throw new Error('embedding blob is not float32')
  return new Float32Array(copy.buffer)
}
