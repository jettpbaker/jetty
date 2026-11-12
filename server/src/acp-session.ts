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

export function jettyMcpServers(binding: { url: string; token: string } | undefined) {
  return binding
    ? [
        {
          type: 'http',
          name: 'jetty',
          url: binding.url,
          headers: [{ name: 'Authorization', value: `Bearer ${binding.token}` }],
        },
      ]
    : []
}
