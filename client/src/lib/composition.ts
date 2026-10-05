// Safari sends the keydown that commits a composition after compositionend, so only its
// keyCode (229) says it belongs to the IME.
export function inComposition(event: KeyboardEvent) {
  return event.isComposing || event.keyCode === 229
}
