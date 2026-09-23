// Product marks from SVGL. Keep provider identifiers stable in saved configs.
const productLogos: Record<string, string> = {
  anthropic: 'claude',
  claude: 'claude',
  openai: 'codex',
  codex: 'codex',
  xai: 'grok',
  grok: 'grok',
}
export function providerLogoPath(provider: string) {
  return `/icons/providers/${productLogos[provider] ?? provider}.svg`
}
