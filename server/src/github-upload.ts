import { MAX_TURN_IMAGE_BYTES } from '@jetty/shared/wire'

import { checkBackoff, ghToken, observeRateLimit, restGet, validRepo } from './pull-requests'
import { StoreError } from './store'

// Videos share the existing RPC payload budget; larger uploads need a streamed transport.
const uploadTypes: Record<string, { mimeType: string; maxBytes: number }> = {
  png: { mimeType: 'image/png', maxBytes: 10 * 1024 * 1024 },
  jpg: { mimeType: 'image/jpeg', maxBytes: 10 * 1024 * 1024 },
  jpeg: { mimeType: 'image/jpeg', maxBytes: 10 * 1024 * 1024 },
  gif: { mimeType: 'image/gif', maxBytes: 10 * 1024 * 1024 },
  webp: { mimeType: 'image/webp', maxBytes: 10 * 1024 * 1024 },
  svg: { mimeType: 'image/svg+xml', maxBytes: 10 * 1024 * 1024 },
  mp4: { mimeType: 'video/mp4', maxBytes: MAX_TURN_IMAGE_BYTES },
  mov: { mimeType: 'video/quicktime', maxBytes: MAX_TURN_IMAGE_BYTES },
  webm: { mimeType: 'video/webm', maxBytes: MAX_TURN_IMAGE_BYTES },
}

export async function uploadGithubAttachment(params: {
  repo: string
  name: string
  mimeType: string
  base64data: string
}) {
  if (
    !validRepo(params.repo) ||
    !params.name ||
    params.name.length > 255 ||
    [...params.name].some((char) => char < ' ' || char === '/' || char === '\\')
  )
    throw new StoreError('invalid_params', 'Invalid attachment name or repository')
  const type = uploadTypes[params.name.split('.').at(-1)?.toLowerCase() ?? '']
  if (!type || type.mimeType !== params.mimeType)
    throw new StoreError(
      'invalid_params',
      'Attach a supported image or video with a matching file extension'
    )
  if (params.base64data.length > Math.ceil(type.maxBytes / 3) * 4)
    throw new StoreError(
      'invalid_params',
      `Attachment exceeds ${type.maxBytes / (1024 * 1024)} MiB`
    )
  if (params.base64data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(params.base64data))
    throw new StoreError('invalid_params', 'Invalid attachment encoding')
  const bytes = Buffer.from(params.base64data, 'base64')
  if (!bytes.length || bytes.length > type.maxBytes)
    throw new StoreError('invalid_params', 'Attachment is empty or too large')
  checkBackoff()
  const token = await ghToken()
  if (!token) throw new StoreError('internal', 'Sign in with gh auth login to upload attachments')
  const repository = (await restGet(`repos/${params.repo}`, { revalidate: true })) as {
    id?: number
    permissions?: { push?: boolean }
  }
  if (!repository.permissions?.push)
    throw new StoreError('not_found', 'Attaching files requires write access to the repository')
  if (!repository.id) throw new StoreError('internal', 'GitHub did not return the repository ID')
  const target = new URL('https://uploads.github.com/user-attachments/assets')
  target.search = new URLSearchParams({
    name: params.name,
    content_type: type.mimeType,
    repository_id: String(repository.id),
  }).toString()
  // This is the CLI's raw-byte upload protocol; redirects never receive the token.
  const response = await fetch(target, {
    method: 'POST',
    body: bytes,
    redirect: 'error',
    signal: AbortSignal.timeout(120_000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/octet-stream',
    },
  })
  const text = await response.text()
  let result: { url?: string; message?: string } = {}
  try {
    result = JSON.parse(text)
  } catch {
    result = { message: text.slice(0, 200) }
  }
  observeRateLimit(response.headers, result, response.status, result.message)
  if (!response.ok) {
    if (response.status === 404)
      throw new StoreError(
        'not_found',
        'GitHub refused the upload. Check repository write access and token type.'
      )
    throw new StoreError(
      response.status === 422 ? 'invalid_params' : 'internal',
      result.message ?? `GitHub upload failed (${response.status})`
    )
  }
  if (
    !result.url ||
    !/^https:\/\/github\.com\/user-attachments\/assets\/[A-Za-z0-9-]+$/.test(result.url)
  )
    throw new StoreError('internal', 'GitHub did not return an attachment URL')
  return { url: result.url }
}
