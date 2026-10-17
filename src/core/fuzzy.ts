// Fuzzy matching for the command palette: query characters must appear in order; consecutive
// runs, word starts and an early first match score higher. Pure.

export interface FuzzyMatch {
  score: number
  /** Indexes into the text that matched, for highlighting. */
  indices: number[]
}

const isWordStart = (text: string, i: number): boolean => i === 0 || /[\s/_\-.()[\]{}:]/.test(text[i - 1]) || (/[a-z]/.test(text[i - 1]) && /[A-Z]/.test(text[i]))

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.trim().toLowerCase()
  if (!q) return { score: 0, indices: [] }
  const t = text.toLowerCase()

  // A substring that starts a word ("user" in "Get user") is the strongest signal. A mid-word
  // substring ("lu" in "Flux") isn't: initials ("lu" → "List users") should beat it, so those fall
  // through to the scored subsequence match below.
  for (let sub = t.indexOf(q); sub >= 0; sub = t.indexOf(q, sub + 1)) {
    if (!isWordStart(text, sub)) continue
    const indices = Array.from({ length: q.length }, (_, k) => sub + k)
    return { score: 1000 - sub - text.length * 0.1, indices }
  }

  let score = 0
  let ti = 0
  let prev = -2
  const indices: number[] = []
  for (const ch of q) {
    if (ch === ' ') continue
    let found = -1
    // Prefer the next occurrence that starts a word, if there is one before the plain next match ends the search.
    for (let j = ti; j < t.length; j++) {
      if (t[j] !== ch) continue
      if (found < 0) found = j
      if (isWordStart(text, j)) {
        found = j
        break
      }
    }
    if (found < 0) return null
    score += 10
    if (found === prev + 1) score += 15
    if (isWordStart(text, found)) score += 40
    // Jumping to the start of a word is how initials work; jumping into the middle of a word isn't,
    // and is what makes a match look random.
    else if (prev >= 0 && found !== prev + 1) score -= 40 + Math.min(found - prev - 1, 10) * 3
    if (indices.length === 0) score -= found * 0.5
    indices.push(found)
    prev = found
    ti = found + 1
  }
  // Drop scattered, weak matches ("user" in "Use no envi-r-onment"): they're noise in a palette.
  if (score < q.replace(/ /g, '').length * 25) return null
  return { score: score - text.length * 0.1, indices }
}

/** Split text into plain/highlighted segments for rendering. */
export function highlightSegments(text: string, indices: number[]): { text: string; hit: boolean }[] {
  const set = new Set(indices)
  const out: { text: string; hit: boolean }[] = []
  for (let i = 0; i < text.length; i++) {
    const hit = set.has(i)
    const last = out[out.length - 1]
    if (last && last.hit === hit) last.text += text[i]
    else out.push({ text: text[i], hit })
  }
  return out
}
