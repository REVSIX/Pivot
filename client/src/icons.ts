const paths: Record<string, string> = {
  brand:
    '<path d="M3 17 10 7l8 11 5-7"/><circle cx="10" cy="7" r="2.6"/><circle cx="18" cy="18" r="2.6"/>',
  folder: '<path d="M3 6h7l2 3h9v10H3z"/>',
  chevron: '<path d="m8 10 4 4 4-4"/>',
  command: '<path d="m4 6 6 6-6 6m9 0h7"/>',
  code: '<path d="m7 7-5 5 5 5m10-10 5 5-5 5m-4-13-3 16"/>',
  sim: '<path d="m12 2 9 5v10l-9 5-9-5V7zm0 10v10M3 7l9 5 9-5"/>',
  wave: '<path d="M2 14h4l3-8 5 14 3-11 2 5h3"/>',
  play: '<path d="m7 4 13 8-13 8z" fill="currentColor" stroke="none"/>',
  pause: '<path d="M7 5v14m9-14v14" stroke-width="4"/>',
  run: '<path d="M19 10a7 7 0 1 0 0 6m0-12v6h-6"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  down: '<path d="M12 3v12m-5-5 5 5 5-5m-13 7v3h16v-3"/>',
  spotify:
    '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><g stroke="#191a23" stroke-linecap="round"><path d="M6 9q6-3 12 1m-11 2q5-2 10 1m-9 2q4-1.5 8 1"/></g>',
}
export function icon(name: string) {
  return (
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (paths[name] || '') +
    '</svg>'
  )
}
