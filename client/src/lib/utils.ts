import { createCn } from 'cn/config'

// index.css adds a 13px text size. Unknown to cn, `text-13` reads as a colour, so a text colour
// beside it would drop it.
export const cn = createCn({ extend: { classGroups: { 'font-size': [{ text: ['13'] }] } } })
