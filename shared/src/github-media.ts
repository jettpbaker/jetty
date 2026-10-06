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

export function githubMediaPath(source: URL) {
  return `/github-media?url=${encodeURIComponent(source.href)}`
}
