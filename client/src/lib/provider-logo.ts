const productLogos: Record<string, string> = {
  anthropic: 'claude',
  openai: 'codex',
  xai: 'grok',
}

export function providerLogoPath(provider: string) {
  return `/icons/providers/${productLogos[provider] ?? provider}.svg`
}
