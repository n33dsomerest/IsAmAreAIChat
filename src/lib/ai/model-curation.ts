/**
 * The OpenRouter models this product actually offers.
 *
 * The upstream catalogue exposes several hundred entries, so `free` mode alone
 * would leave the picker full of models nobody chose. This allowlist is the
 * editorial decision, kept in code so a re-sync cannot quietly undo it.
 *
 * Every id here is a `:free` variant — the context windows below are the ones
 * those variants actually report, which is why they differ from the paid twins
 * (`nemotron-3-ultra` is 262k paid but 1M free, for example).
 */
export const CURATED_OPENROUTER: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'openrouter/free', label: 'Auto Router' },
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'NVIDIA: Nemotron 3 Ultra' },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', label: 'NVIDIA: Nemotron 3 Super' },
  { id: 'nvidia/nemotron-3.5-lightning:free', label: 'NVIDIA: Nemotron 3.5 Lightning' },
  { id: 'poolside/laguna-s-2.1:free', label: 'Poolside: Laguna S 2.1' },
  { id: 'thinkingmachines/inkling:free', label: 'Thinking Machines: Inkling' },
  { id: 'cohere/north-mini-code:free', label: 'Cohere: North Mini Code' },
];

const CURATED_BY_ID = new Map(CURATED_OPENROUTER.map((m) => [m.id, m.label]));

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
export function isCuratedOpenRouter(id: string): boolean {
  return CURATED_BY_ID.has(id);
}

/**
 * The label to show in the picker.
 *
 * OpenRouter appends "(free)" to every no-cost model and names the router
 * "Free Models Router". The price is already implied by the tier, so the word
 * is noise in the UI — and an explicit rename is how `openrouter/free` becomes
 * "Auto Router".
 */
export function curatedLabel(remoteModelId: string, upstreamName: string): string {
  const override = CURATED_BY_ID.get(remoteModelId);
  if (override) return override;
  return upstreamName.replace(/\s*\(free\)\s*$/i, '').trim() || remoteModelId;
}