import { AutoModel, AutoTokenizer, env } from '@huggingface/transformers'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { EmbedClient, EmbedItem } from './types'

import { dot, l2 } from './vec'

// Retrieval prompts from the EmbeddingGemma model card.
export const QUERY_PREFIX = 'task: search result | query: '
export const MODEL_ID = 'onnx-community/embeddinggemma-300m-ONNX'
export const MODEL_DTYPE = 'q8'
export const EMBEDDER_ID = `${MODEL_ID}@${MODEL_DTYPE}`

const BATCH = 8

env.cacheDir = join(process.env.JETTY_HOME!, 'models')
env.allowLocalModels = true
env.allowRemoteModels = true

type Session = {
  embed: (texts: string[]) => Promise<Float32Array[]>
}

let sessionPromise: Promise<Session> | null = null

export function documentPrompt(title: string, text: string): string {
  const safe =
    title
      .replace(/[\r\n|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim() || 'none'
  return `title: ${safe} | text: ${text}`
}

export function queryPrompt(query: string): string {
  return QUERY_PREFIX + query
}

export async function loadEmbedder(): Promise<void> {
  await getSession()
}

async function getSession(): Promise<Session> {
  if (!sessionPromise) {
    sessionPromise = createSession().catch((err) => {
      sessionPromise = null
      throw err
    })
  }
  return sessionPromise
}

async function createSession(): Promise<Session> {
  console.error(`loading EmbeddingGemma ${MODEL_ID} (${MODEL_DTYPE}, cpu)`)
  try {
    const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, { progress_callback: progress })
    const model = await AutoModel.from_pretrained(MODEL_ID, {
      dtype: MODEL_DTYPE,
      device: 'cpu',
      // Streaming cached weights for progress retains an extra buffer in Transformers.js.
      progress_callback: modelIsCached() ? undefined : progress,
    })
    return {
      async embed(texts: string[]): Promise<Float32Array[]> {
        const inputs = await tokenizer(texts, { padding: true, truncation: true, max_length: 512 })
        const output = await model(inputs)
        try {
          return sentenceVectors(output)
        } finally {
          dispose(output)
          dispose(inputs)
        }
      },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to load EmbeddingGemma (${MODEL_ID}, ${MODEL_DTYPE}).\n${message}`)
  }
}

function modelIsCached() {
  const directory = join(env.cacheDir!, MODEL_ID, 'onnx')
  return ['model_quantized.onnx', 'model_quantized.onnx_data'].every((file) =>
    existsSync(join(directory, file))
  )
}

type TensorLike = { dims?: number[]; data?: Float32Array; dispose?: () => void }

function sentenceVectors(output: unknown): Float32Array[] {
  const record = output as { sentence_embedding?: TensorLike }
  const tensor = record.sentence_embedding
  if (!tensor?.dims || !tensor.data)
    throw new Error('EmbeddingGemma returned no sentence_embedding')
  if (tensor.dims.length !== 2) {
    throw new Error(`expected sentence_embedding [batch, dim], got ${tensor.dims.join('x')}`)
  }
  const rows = tensor.dims[0]!
  const dim = tensor.dims[1]!
  if (dim !== 768) throw new Error(`expected 768 dimensions, got ${dim}`)
  if (tensor.data.length !== rows * dim)
    throw new Error('sentence_embedding length does not match dims')
  const vectors: Float32Array[] = []
  for (let i = 0; i < rows; i++) vectors.push(l2(tensor.data.slice(i * dim, (i + 1) * dim)))
  return vectors
}

function dispose(value: unknown): void {
  if (!value || typeof value !== 'object') return
  for (const nested of Object.values(value as Record<string, unknown>)) {
    if (
      nested &&
      typeof nested === 'object' &&
      'dispose' in nested &&
      typeof nested.dispose === 'function'
    ) {
      nested.dispose()
    }
  }
}

async function embedTexts(texts: string[]): Promise<Float32Array[]> {
  const session = await getSession()
  const out: Float32Array[] = []
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH)
    const vectors = await session.embed(batch)
    if (vectors.length !== batch.length) throw new Error('embedding batch size mismatch')
    out.push(...vectors)
  }
  return out
}

export const gemmaEmbedder: EmbedClient = {
  id: EMBEDDER_ID,
  embedDocuments(items: EmbedItem[]) {
    return embedTexts(items.map((item) => documentPrompt(item.title, item.text)))
  },
  async embedQuery(query: string) {
    const [vector] = await embedTexts([queryPrompt(query)])
    return vector!
  },
}

export async function selfCheckEmbeddingGemma(): Promise<number[]> {
  const docs = [
    "Venus is often called Earth's twin because of its similar size and proximity.",
    'Mars, known for its reddish appearance, is often referred to as the Red Planet.',
    'Jupiter, the largest planet in our solar system, has a prominent red spot.',
    'Saturn, famous for its rings, is sometimes mistaken for the Red Planet.',
  ]
  const query = await gemmaEmbedder.embedQuery('Which planet is known as the Red Planet?')
  const vectors = await gemmaEmbedder.embedDocuments(docs.map((text) => ({ title: 'none', text })))
  const scores = vectors.map((vector) => dot(query, vector))
  const best = scores.indexOf(Math.max(...scores))
  if (best !== 1) {
    throw new Error(
      `EmbeddingGemma self-check failed (expected Mars). scores=${scores.map((n) => n.toFixed(3)).join(', ')}`
    )
  }
  return scores
}

const downloaded = new Map<string, number>()
function progress(event: { status: string; loaded?: number; file?: string }) {
  if (event.status !== 'progress' || !event.file?.includes('.onnx')) return
  downloaded.set(event.file, event.loaded ?? 0)
  const bytes = [...downloaded.values()].reduce((sum, loaded) => sum + loaded, 0)
  process.send?.({
    type: 'progress',
    percent: Math.min(100, Math.floor((bytes / 316_000_000) * 100)),
  })
}
