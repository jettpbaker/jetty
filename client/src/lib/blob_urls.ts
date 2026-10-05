// The media lightbox can be showing an unsent image when its upload is acknowledged; that image's
// blob URL lives on until the lightbox lets go of it, so its Copy and Download keep working.
const shown = new Set<string>()
const released = new Set<string>()

export function revokeBlobUrl(url: string) {
  if (shown.has(url)) released.add(url)
  else URL.revokeObjectURL(url)
}

export function showBlobUrls(urls: Iterable<string>) {
  shown.clear()
  for (const url of urls) if (url.startsWith('blob:')) shown.add(url)
  for (const url of released)
    if (!shown.has(url)) {
      released.delete(url)
      URL.revokeObjectURL(url)
    }
}
