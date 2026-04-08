import type { RuntimeAdapter } from './types'
import { LlamaCppAdapter } from './llamaCppAdapter'
import { OllamaAdapter } from './ollamaAdapter'

export type { RuntimeAdapter, ChatMessage } from './types'
export { LlamaCppAdapter, OllamaAdapter }

export function createRuntime(
  kind: 'llamacpp' | 'ollama',
  opts?: { ollamaBaseUrl?: string }
): RuntimeAdapter {
  if (kind === 'ollama') return new OllamaAdapter(opts?.ollamaBaseUrl ?? 'http://127.0.0.1:11434')
  return new LlamaCppAdapter()
}
