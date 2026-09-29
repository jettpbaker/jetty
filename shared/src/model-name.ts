export function claudeModelName(value: string, displayName: string, description = ''): string {
  const lead = description.split(' · ')[0]?.replace(/ with 1M context$/i, '')
  const clean = displayName.replace(/\s*\(1M context\)$/i, '')
  if (lead?.startsWith(`${clean} `) && /\d/.test(lead)) return lead
  if (/\d/.test(clean)) return clean
  return clean || lead || value
}

export function modelLabelText(model: {
  provider: string
  id: string
  name: string
  contextWindow?: '1m'
}): string {
  return model.provider === 'claude' ? claudeModelName(model.id, model.name) : model.name
}

// Providers rename a model's context variant (`opus` ↔ `opus[1m]`), stranding saved IDs.
export function baseModelId(id: string) {
  return id.replace(/\[1m\]$/i, '').toLowerCase()
}

type CatalogModel = { provider: string; id: string; resolvedId?: string }

// A saved model ID may be an alias (`opus[1m]`), the model it resolves to (`claude-opus-5-5`),
// or either with the context suffix flipped; the live catalog lists whichever the CLI reports now.
export function findProviderModel<T extends CatalogModel>(
  catalog: readonly T[],
  provider: string | undefined,
  id: string | null | undefined
): T | undefined {
  if (!provider || !id) return undefined
  const own = catalog.filter((model) => model.provider === provider)
  const base = baseModelId(id)
  return (
    own.find((model) => model.id === id || model.resolvedId === id) ??
    own.find(
      (model) =>
        baseModelId(model.id) === base ||
        (model.resolvedId !== undefined && baseModelId(model.resolvedId) === base)
    )
  )
}

// claude-sonnet-5 → Sonnet 5, claude-opus-5-5[1m] → Opus 5.5; aliases like `sonnet` stay a family name.
export function claudeModelLabel(id: string) {
  const [family = '', ...version] = baseModelId(id)
    .replace(/^claude-/, '')
    .split('-')
  const label = family.charAt(0).toUpperCase() + family.slice(1)
  const numbers = version.filter((part) => /^\d{1,2}$/.test(part))
  return numbers.length ? `${label} ${numbers.join('.')}` : label
}

// A pinned model the CLI no longer lists still reads as a name rather than an ID.
export function catalogModelName(
  catalog: readonly (CatalogModel & { name: string; contextWindow?: '1m' })[] | undefined,
  provider: string | undefined,
  id: string | undefined
) {
  const model = catalog && findProviderModel(catalog, provider, id)
  if (model) return modelLabelText(model)
  return provider === 'claude' && id ? claudeModelLabel(id) : id
}
