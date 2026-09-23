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
  return url
}

export function githubMediaPath(source: URL) {
  return `/github-media?url=${encodeURIComponent(source.href)}`
}
