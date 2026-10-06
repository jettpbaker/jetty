const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

// Where GitHub stores images and videos uploaded into PR descriptions and comments.
const sources: { host: string; path: RegExp; query?: string }[] = [
  { host: 'github.com', path: new RegExp(`^/user-attachments/assets/${uuid}$`, 'i') },
  { host: 'github.com', path: new RegExp(`^/[\\w.-]+/[\\w.-]+/assets/\\d+/${uuid}$`, 'i') },
  { host: 'user-images.githubusercontent.com', path: /^\/\d+\/[\w.-]+$/ },
  { host: 'private-user-images.githubusercontent.com', path: /^\/\d+\/[\w.-]+$/, query: 'jwt' },
]

// The GitHub attachment a URL points at, or null for anything else.
export function githubMediaSource(value: string): URL | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
  const source = sources.find(
    (candidate) => candidate.host === url.hostname && candidate.path.test(url.pathname)
  )
  if (!source) return null
  const keys = [...url.searchParams.keys()]
  if (keys.length > 0 && !(keys.length === 1 && keys[0] === source.query)) return null
  url.hash = ''
  return canonicalAttachment(url)
}

// A rendered private attachment carries a jwt that dies in minutes. The uuid in the filename is
// the same asset as github.com/user-attachments/assets/<uuid>, which the proxy can sign again.
function canonicalAttachment(url: URL): URL {
  if (url.hostname !== 'private-user-images.githubusercontent.com') return url
  const id = new RegExp(uuid, 'i').exec(url.pathname.split('/').pop() ?? '')?.[0]
  if (!id) return url
  return new URL(`https://github.com/user-attachments/assets/${id}`)
}

function githubName(value: string) {
  return /^[A-Za-z0-9_.-]+$/.test(value) && value !== '.' && value !== '..'
}

// `owner/repo/123`. The proxy URL is built in the browser, so anything else is dropped.
export function githubMediaPull(value: string | null | undefined): string | null {
  if (!value) return null
  const parts = value.split('/')
  if (parts.length !== 3) return null
  const [owner, repo, number] = parts
  if (!owner || !repo || !number || !githubName(owner) || !githubName(repo)) return null
  if (!/^[1-9]\d*$/.test(number)) return null
  const parsed = Number(number)
  if (!Number.isSafeInteger(parsed)) return null
  return `${owner}/${repo}/${parsed}`
}

export function githubMediaPath(source: URL, pull?: string | null) {
  const base = `/github-media?url=${encodeURIComponent(source.href)}`
  const pr = githubMediaPull(pull)
  return pr ? `${base}&pr=${encodeURIComponent(pr)}` : base
}
