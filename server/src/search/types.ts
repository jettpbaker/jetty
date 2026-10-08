export type EmbedItem = { title: string; text: string }

export type EmbedClient = {
  id: string
  embedDocuments(items: EmbedItem[]): Promise<Float32Array[]>
  embedQuery(query: string): Promise<Float32Array>
}
