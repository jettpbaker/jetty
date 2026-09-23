import { unifiedEmojiUrl } from '@/lib/fluent_emoji'
import EmojiPicker, { EmojiStyle } from 'emoji-picker-react'
import { missingEmoji } from 'virtual:fluent-emoji'

import './project_emoji_picker.css'

export default function ProjectEmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  return (
    <div className='project-emoji-picker'>
      <EmojiPicker
        width='100%'
        height={320}
        emojiStyle={EmojiStyle.APPLE}
        getEmojiUrl={unifiedEmojiUrl}
        hiddenEmojis={missingEmoji}
        skinTonesDisabled
        lazyLoadEmojis
        searchPlaceholder='Search emoji'
        autoFocusSearch={false}
        previewConfig={{ showPreview: false }}
        onEmojiClick={({ emoji }) => onSelect(emoji)}
      />
    </div>
  )
}
