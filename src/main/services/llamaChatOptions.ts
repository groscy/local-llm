import type Store from 'electron-store'

const DEF_TEMPERATURE = 0.8
const DEF_TOP_P = 0.95

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo
  return Math.min(hi, Math.max(lo, n))
}

/** OpenAI-style sampling for llama-server `/v1/chat/completions` (read from store). */
export function llamaSamplingFromStore(store: Store<Record<string, unknown>>): {
  temperature: number
  topP: number
  frequencyPenalty: number
  presencePenalty: number
} {
  const rawT = store.get('llamaTemperature')
  const rawP = store.get('llamaTopP')
  const rawF = store.get('llamaFrequencyPenalty')
  const rawPr = store.get('llamaPresencePenalty')
  return {
    temperature: typeof rawT === 'number' && Number.isFinite(rawT) ? clamp(rawT, 0, 2) : DEF_TEMPERATURE,
    topP: typeof rawP === 'number' && Number.isFinite(rawP) ? clamp(rawP, 0, 1) : DEF_TOP_P,
    frequencyPenalty:
      typeof rawF === 'number' && Number.isFinite(rawF) ? clamp(rawF, -2, 2) : 0,
    presencePenalty:
      typeof rawPr === 'number' && Number.isFinite(rawPr) ? clamp(rawPr, -2, 2) : 0
  }
}
