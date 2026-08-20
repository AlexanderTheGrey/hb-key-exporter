export interface ClaimProduct {
  category_human_name: string
  direct_redeem: boolean
  human_name: string
  is_expired?: boolean
  key_type: string
}

export type ClaimSuccess<T extends ClaimProduct = ClaimProduct> = {
  index: number
  product: T
}

export type ClaimFailure<T extends ClaimProduct = ClaimProduct> = ClaimSuccess<T> & {
  error: unknown
}

export type ClaimTypeCount = {
  label: string
  count: number
}

export type ClaimPlan<T extends ClaimProduct = ClaimProduct> = {
  products: T[]
  typeCounts: ClaimTypeCount[]
  keylessCount: number
  expiredCount: number
  bundleCount: number
}

export type ClaimReport<T extends ClaimProduct = ClaimProduct> = {
  gift: boolean
  successes: ClaimSuccess<T>[]
  failures: ClaimFailure<T>[]
  typeCounts: ClaimTypeCount[]
  keylessCount: number
  exportCopied: boolean
  exportEmpty: boolean
}

export type ClaimResultGroup<T extends ClaimProduct = ClaimProduct> = {
  bundleName: string
  successes: ClaimSuccess<T>[]
  failures: ClaimFailure<T>[]
}

export const getErrorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message || 'Failed to reveal key'
    : error == null
      ? 'Failed to reveal key'
      : String(error)

export const isKeylessProduct = (product: ClaimProduct): boolean =>
  product.direct_redeem || product.key_type.toLowerCase() === 'keyless'

export const getClaimTypeLabel = (product: ClaimProduct): string => {
  if (isKeylessProduct(product)) return 'Keyless (direct redemption)'

  const type = product.key_type.trim()
  if (!type) return 'Unknown'
  if (type.toLowerCase() === 'gog') return 'GOG'

  return type.charAt(0).toUpperCase() + type.slice(1)
}

export const createClaimPlan = <T extends ClaimProduct>(products: T[]): ClaimPlan<T> => {
  const counts = new Map<string, number>()
  const bundles = new Set<string>()
  let keylessCount = 0
  let expiredCount = 0

  for (const product of products) {
    const label = getClaimTypeLabel(product)
    counts.set(label, (counts.get(label) ?? 0) + 1)
    bundles.add(product.category_human_name || 'Unknown bundle')
    if (isKeylessProduct(product)) keylessCount++
    if (product.is_expired) expiredCount++
  }

  return {
    products,
    typeCounts: Array.from(counts, ([label, count]) => ({ label, count })).sort(
      (left, right) => right.count - left.count || left.label.localeCompare(right.label)
    ),
    keylessCount,
    expiredCount,
    bundleCount: bundles.size,
  }
}

export const groupClaimResults = <T extends ClaimProduct>(
  report: ClaimReport<T>
): ClaimResultGroup<T>[] => {
  const groups = new Map<string, ClaimResultGroup<T>>()
  const results: Array<ClaimSuccess<T> | ClaimFailure<T>> = [
    ...report.successes,
    ...report.failures,
  ].sort((left, right) => left.index - right.index)

  for (const result of results) {
    const bundleName = result.product.category_human_name || 'Unknown bundle'
    let group = groups.get(bundleName)

    if (!group) {
      group = { bundleName, successes: [], failures: [] }
      groups.set(bundleName, group)
    }

    if ('error' in result) {
      group.failures.push(result)
    } else {
      group.successes.push(result)
    }
  }

  return Array.from(groups.values())
}

export const formatClaimLog = <T extends ClaimProduct>(report: ClaimReport<T>): string => {
  const requested = report.successes.length + report.failures.length
  const action = report.gift ? 'Gift-link creation' : 'Key reveal'
  const lines = [
    `${action} results`,
    `Requested: ${requested}`,
    `Succeeded: ${report.successes.length}`,
    `Failed: ${report.failures.length}`,
    `Export copied to clipboard: ${report.exportCopied ? 'Yes' : 'No'}`,
    `Keyless/direct-redemption items: ${report.keylessCount}`,
    '',
    'Type breakdown:',
    ...report.typeCounts.map(({ label, count }) => `- ${label}: ${count}`),
  ]

  for (const group of groupClaimResults(report)) {
    lines.push('', `Bundle: ${group.bundleName}`)

    for (const { product } of group.successes) {
      lines.push(`  SUCCESS - ${product.human_name} [${getClaimTypeLabel(product)}]`)
    }

    for (const { product, error } of group.failures) {
      const type = getClaimTypeLabel(product)
      lines.push(`  FAILED - ${product.human_name} [${type}]: ${getErrorMessage(error)}`)
    }
  }

  return lines.join('\n')
}
