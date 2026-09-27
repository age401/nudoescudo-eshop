/**
 * Which deployment this is. SITE_ENV=staging marks the test copy of the shop
 * (staging.tcg.nudoescudo.com): a visible banner, noindex for search engines
 * and a [STAGING] prefix on every email. Empty/unset means production.
 *
 * It is baked in at build time too (Docker build arg), so statically rendered
 * pages carry the banner as well.
 */
export const isStaging = process.env.SITE_ENV === "staging";
