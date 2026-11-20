/** A size as a person reads one — the file viewer's band, and an attached file's tile. */

/** Bytes under a kilobyte, then one decimal at most. A kilobyte is 1024 bytes. */
export const sizeOf = (bytes: number): string => {
  if (bytes < 1024) return `${String(bytes)} bytes`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : String(Math.round(kb))} KB`
  const mb = kb / 1024
  return `${mb < 10 ? mb.toFixed(1) : String(Math.round(mb))} MB`
}
