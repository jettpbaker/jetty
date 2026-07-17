const query = matchMedia('(prefers-color-scheme: dark)')

function apply(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark)
}

export function syncTheme() {
  apply(query.matches)
  query.addEventListener('change', (event) => apply(event.matches))
}
