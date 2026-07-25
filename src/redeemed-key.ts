export type RedeemedKeyValue = string | Record<string, unknown>

export const hasRedeemedKeyValue = (value: unknown): value is RedeemedKeyValue =>
  typeof value === 'string'
    ? value.length > 0
    : value !== null && typeof value === 'object' && !Array.isArray(value)

export const serializeRedeemedKeyValue = (value: unknown): string => {
  if (!hasRedeemedKeyValue(value)) return ''
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? '')
}
