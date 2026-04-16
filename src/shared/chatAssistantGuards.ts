/**
 * Stops models from continuing into an imaginary "next user" turn (self-dialogue,
 * quoted user prompts, template role headers, etc.).
 *
 * Used as API `stop` sequences and as a final truncation pass if a backend omits them.
 */

export const CHAT_ASSISTANT_SELF_PROMPT_STOP_SEQUENCES: readonly string[] = [
  '<|im_s' + 'tart|>user',
  '<|im_s' + 'tart|>system',
  '<|im_s' + 'tart|>tool',
  '\n\nUser:',
  '\n\nHuman:',
  '\n\n### User',
  '\n\n### Instruction',
  '\n\n### Human',
  '<|user|>'
]

const TRUNCATE_MARKERS: readonly string[] = CHAT_ASSISTANT_SELF_PROMPT_STOP_SEQUENCES

/**
 * If the model still emitted the start of a simulated user turn, drop that suffix.
 */
export function truncateSimulatedUserContinuation(text: string): string {
  let cut = text.length
  for (const m of TRUNCATE_MARKERS) {
    const i = text.indexOf(m)
    if (i >= 0 && i < cut) cut = i
  }
  if (cut >= text.length) return text
  return text.slice(0, cut).replace(/\s+\z/, '')
}

export function mergeChatAssistantStopSequences(
  opts?: { skipDefaultAntiSelfPromptStops?: boolean; extraStopSequences?: string[] }
): string[] | undefined {
  if (opts?.skipDefaultAntiSelfPromptStops) {
    const ex = opts.extraStopSequences?.filter((s) => s.length > 0) ?? []
    return ex.length > 0 ? ex : undefined
  }
  const out: string[] = [...CHAT_ASSISTANT_SELF_PROMPT_STOP_SEQUENCES]
  for (const s of opts?.extraStopSequences ?? []) {
    if (s && !out.includes(s)) out.push(s)
  }
  return out.length > 0 ? out : undefined
}
