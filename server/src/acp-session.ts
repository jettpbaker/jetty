import type { AgentImage } from './agent'

export function acpPrompt(text: string, images?: AgentImage[]) {
  return [
    ...(text ? [{ type: 'text', text }] : []),
    ...(images ?? []).map((image) => ({
      type: 'image',
      data: image.base64data,
      mimeType: image.mimeType,
    })),
  ]
}
