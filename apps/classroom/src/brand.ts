/**
 * The product's identity, in one place.
 *
 * The name is deliberately a single constant that nothing hard-codes around:
 * rename here and the whole app follows — splash, header, manifest fallback,
 * document title, empty states, everything. Renaming a product later is normal;
 * having to grep for it is not.
 *
 * Anything user-visible that names the product MUST read from here. If you find
 * the literal string in a component, that is a bug.
 */
export const BRAND = {
  /**
   * Product name. Change this one line to rename the app.
   *
   * "Qrie AI" rather than bare "Qrie": this constant is used where the product
   * is NAMED — the wordmark, the tab title, the manifest, "Back to Qrie AI".
   * Running prose keeps the short form, because "Qrie AI is a one-on-one live
   * AI tutor" says AI twice and reads like a machine wrote it. Every brand
   * does this; it is why a footer says "© Qrie Learning Co." and a sentence
   * says "Qrie".
   */
  name: 'Qrie AI',
  /** Used where the name needs a qualifier, e.g. an empty state or a share title. */
  tagline: 'Learn with a tutor who never runs out of patience',
  /** Greeting prefix on Home. Kept separate so a rename does not reword the greeting. */
  greeting: 'Namaste',
} as const;

/** `<title>` and anywhere the product is named alongside a screen. */
export const pageTitle = (screen?: string): string =>
  screen ? `${screen} · ${BRAND.name}` : BRAND.name;
