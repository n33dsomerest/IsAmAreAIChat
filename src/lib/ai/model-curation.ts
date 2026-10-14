/**
 * The TokenHarbor models this product actually offers.
 *
 * The upstream catalogue exposes 69 entries, only 5 of which are no-cost, so
 * `free` mode alone would still leave two models nobody chose in the picker.
 * This allowlist is the editorial decision, kept in code so a re-sync cannot
 * quietly undo it.
 *
 * Every id here is a `:free` variant. TokenHarbor suffixes those and publishes a
 * paid twin alongside each one, so dropping the suffix silently spends real
 * money — the paid route answers 402 `balance_zero` instead of failing loudly.
 */
export const CURATED_TOKENHARBOR: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'mimo-v2.6-flash:free', label: 'MiMo V2.6 Flash (Free)' },
  { id: 'claude-haiku-5.5:free', label: 'Claude Haiku 5.5 (Free)' },
  { id: 'deepseek-v4-flash:free', label: 'DeepSeek V4 Flash (Free)' },
];

/**
 * The model a new chat starts on.
 *
 * MiMo V2.6 Flash is the cheapest of the three on TokenHarbor's own numbers and
 * it is the one that answers without a reasoning preamble, so it is the model a
 * user meets first without having to think about which one to pick.
 */
export const DEFAULT_MODEL_REMOTE_ID = 'mimo-v2.6-flash:free';

const CURATED_BY_ID = new Map(CURATED_TOKENHARBOR.map((m) => [m.id, m.label]));

/**
 * The OKMD models that actually read an image.
 *
 * OKMD's `/models` returns nothing but id, name, created and owner — no
 * modality, no architecture — so there is nothing to derive vision from. This
 * list was measured instead: every model was sent the same 1x1 red PNG and
 * asked to name the colour. Eleven of twenty-nine answered "red"; the rest
 * returned nothing or guessed another colour.
 *
 * Measured rather than documented, so re-check it if OKMD changes its
 * catalogue.
 */
export const OKMD_VISION = new Set([
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.5-flash',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite',
  'gemini-3.1-flash-lite-preview',
  'gemini-2.5-flash-lite',
  'llama-4-maverick',
  'llama-4-scout',
  'mistral-medium-3.1',
  'nova-pro-v1',
]);

/** True when a model on this provider has been measured to read images. */
export function hasKnownVision(providerSlug: string, remoteModelId: string): boolean {
  if (providerSlug === 'okmd') return OKMD_VISION.has(remoteModelId);
  return false;
}

/** True when this id is one of the models we deliberately offer. */
export function isCuratedTokenHarbor(id: string): boolean {
  return CURATED_BY_ID.has(id);
}

/**
 * The label to show in the picker.
 *
 * TokenHarbor ships a marketing label ("MiMo V2.6 Flash (Free)") that already
 * reads well, but the parenthetical duplicates what the provider grouping in the
 * picker already says — so the suffix is stripped from everything that is not
 * explicitly curated below, and curated entries keep their hand-written name.
 */
export function curatedLabel(remoteModelId: string, upstreamName: string): string {
  const override = CURATED_BY_ID.get(remoteModelId);
  if (override) return override;
  return upstreamName.replace(/\s*\(free\)\s*$/i, '').trim() || remoteModelId;
}