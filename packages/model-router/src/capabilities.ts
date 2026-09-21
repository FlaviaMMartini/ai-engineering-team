/**
 * Only the capabilities the product's known MVP agents actually need
 * (Architect: reasoning + structured_output; Developer: reasoning + code +
 * tool_use; QA's interpretation step: reasoning) plus the two obvious
 * near-term additions (vision, long_context). Not an attempt to enumerate
 * every capability a vendor might advertise — add one only when an agent
 * actually needs it.
 */
export type ModelCapability = 'reasoning' | 'code' | 'tool_use' | 'vision' | 'structured_output' | 'long_context';

export const ALL_MODEL_CAPABILITIES: readonly ModelCapability[] = [
  'reasoning',
  'code',
  'tool_use',
  'vision',
  'structured_output',
  'long_context'
];
