/** A chapter slug from the knowledge graph, as a heading: 'rational-numbers' → 'Rational numbers'. */
export function chapterTitle(slug: string): string {
  const words = slug.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}
