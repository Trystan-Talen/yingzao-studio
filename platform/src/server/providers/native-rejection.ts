const envelopeKeys = new Set(['error', 'request_id', 'requestId']);
const errorKeys = new Set(['code', 'type', 'message', 'param', 'request_id', 'requestId']);
const routingCodes = new Set([
  'no_available_channel',
  'no_available_channels',
  'channel_not_found',
]);
const errorTypes = new Set([
  'shell_api_error',
  'upstream_error',
  'new_api_error',
  'one_api_error',
  'api_error',
  'server_error',
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Recognize only complete, known routing rejections, never a substring in an arbitrary
 * diagnostic. An accepted task/result/usage or an unrecognized envelope keeps 5xx uncertain.
 * Callers must invoke this only after a failed submission response has ended in full.
 */
export function isExplicitNativeNonExecution(status: number, value: unknown): boolean {
  if (status < 500 || status > 599) return false;
  const envelope = record(value);
  const error = record(envelope?.error);
  if (
    !envelope ||
    !error ||
    Object.keys(envelope).some((key) => !envelopeKeys.has(key)) ||
    Object.keys(error).some((key) => !errorKeys.has(key)) ||
    Object.values(envelope).some((entry) => entry !== error && typeof entry !== 'string') ||
    Object.values(error).some((entry) => entry !== null && typeof entry !== 'string')
  )
    return false;
  const code = error.code;
  if (typeof code === 'string' && code !== '' && !routingCodes.has(code)) return false;
  if (typeof error.type === 'string' && error.type !== '' && !errorTypes.has(error.type))
    return false;
  // The observed router does not attach a task or model parameter. Unknown parameter
  // contents may describe an already accepted task, so they cannot prove non-execution.
  if (error.param !== undefined && error.param !== null && error.param !== '') return false;
  if (typeof error.message !== 'string' || error.message.length > 1500) return false;
  const message = error.message
    .trim()
    .replace(/^status_code=(?:500|502|503),\s*/, '')
    .replace(/\s*\(request id: [a-z\d_-]{1,200}\)$/i, '')
    .replace(/\s*（request id: [a-z\d_-]{1,200}）$/i, '');
  const detailed =
    /^Current group [a-z\d_.:-]{1,100} has no available channels for model [a-z\d_./:-]{1,200}(?: under billing mode \[(?:pay-as-you-go|pay-per-request)(?:,\s*(?:pay-as-you-go|pay-per-request))*\])?\.?$/i.test(
      message,
    ) ||
    /^当前分组\s+[^\s，。；（）]{1,100}\s+下(?:对于)?模型\s+[a-z\d_./:-]{1,200}\s+无可用(?:渠道|通道)[。.]?$/i.test(
      message,
    );
  return (
    detailed ||
    (typeof code === 'string' &&
      routingCodes.has(code) &&
      /^(?:No available channels?|无可用(?:渠道|通道))[。.]?$/i.test(message))
  );
}
