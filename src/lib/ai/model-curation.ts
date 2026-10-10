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