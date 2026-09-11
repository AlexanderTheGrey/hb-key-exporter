export interface ClaimProduct {
  category_id: string
  category_human_name: string
  direct_redeem: boolean
  human_name: string
  is_expired?: boolean
  keyindex?: number
  key_type: string
  machine_name: string
}

export type ClaimSuccess<T extends ClaimProduct = ClaimProduct> = {
  index: number
  product: T
}

export type ClaimFailure<T extends ClaimProduct = ClaimProduct> = ClaimSuccess<T> & {
  error: unknown
  nonRetryable: boolean
}

export type ClaimSkipped<T extends ClaimProduct = ClaimProduct> = ClaimSuccess<T>

export type ExportDestination = 'clipboard' | 'download'

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
  skippedCount: number
}

export type ClaimReport<T extends ClaimProduct = ClaimProduct> = {
  gift: boolean
  successes: ClaimSuccess<T>[]
  failures: ClaimFailure<T>[]
  skipped: ClaimSkipped<T>[]
  typeCounts: ClaimTypeCount[]
  keylessCount: number
  exportDestination: ExportDestination
  exportSucceeded: boolean
  exportEmpty: boolean
  exportFilename: string | null
}

export type ClaimResultGroup<T extends ClaimProduct = ClaimProduct> = {
  bundleName: string
  successes: ClaimSuccess<T>[]
  failures: ClaimFailure<T>[]
  skipped: ClaimSkipped<T>[]
}

/**
 * Reveal/gift operations Humble reported as non-retryable during this page
 * session. This state intentionally lives only in memory so reloading the page
 * always permits another attempt.
 */
const nonRetryableClaims = new Set<string>()

const nonRetryableClaimKey = (product: ClaimProduct, gift: boolean): string =>
  JSON.stringify([
    product.category_id,
    product.machine_name,
    product.keyindex ?? null,
    gift ? 'gift' : 'key',
  ])

export const markNonRetryableClaim = (product: ClaimProduct, gift: boolean): void => {
  nonRetryableClaims.add(nonRetryableClaimKey(product, gift))
}

export const hasNonRetryableClaim = (product: ClaimProduct, gift: boolean): boolean =>
  nonRetryableClaims.has(nonRetryableClaimKey(product, gift))

export const countNonRetryableFailures = <T extends ClaimProduct>(
  failures: readonly ClaimFailure<T>[]
): number => failures.reduce((count, failure) => count + Number(failure.nonRetryable), 0)

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

export const createClaimPlan = <T extends ClaimProduct>(
  products: T[],
  skippedCount = 0
): ClaimPlan<T> => {
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
    skippedCount,
  }
}

export const groupClaimResults = <T extends ClaimProduct>(
  report: ClaimReport<T>
): ClaimResultGroup<T>[] => {
  const groups = new Map<string, ClaimResultGroup<T>>()
  const results = [
    ...report.successes.map((result) => ({ kind: 'success' as const, result })),
    ...report.failures.map((result) => ({ kind: 'failure' as const, result })),
    ...report.skipped.map((result) => ({ kind: 'skipped' as const, result })),
  ].sort((left, right) => left.result.index - right.result.index)

  for (const { kind, result } of results) {
    const bundleName = result.product.category_human_name || 'Unknown bundle'
    let group = groups.get(bundleName)

    if (!group) {
      group = { bundleName, successes: [], failures: [], skipped: [] }
      groups.set(bundleName, group)
    }

    if (kind === 'success') group.successes.push(result)
    else if (kind === 'failure') group.failures.push(result)
    else group.skipped.push(result)
  }

  return Array.from(groups.values())
}

export const formatClaimLog = <T extends ClaimProduct>(report: ClaimReport<T>): string => {
  const attempted = report.successes.length + report.failures.length
  const nonRetryableCount = countNonRetryableFailures(report.failures)
  const action = report.gift ? 'Gift-link creation' : 'Key reveal'
  const lines = [
    `${action} results`,
    `Attempted: ${attempted}`,
    `Succeeded: ${report.successes.length}`,
    `Failed: ${report.failures.length}`,
    ...(nonRetryableCount ? [`  Non-retryable: ${nonRetryableCount}`] : []),
    ...(report.skipped.length ? [`Skipped: ${report.skipped.length}`] : []),
    report.exportDestination === 'clipboard'
      ? `Export copied to clipboard: ${report.exportSucceeded ? 'Yes' : 'No'}`
      : `Export download started: ${report.exportSucceeded ? 'Yes' : 'No'}`,
    ...(report.exportFilename ? [`Export filename: ${report.exportFilename}`] : []),
    `Keyless/direct-redemption items: ${report.keylessCount}`,
    ...(report.typeCounts.length
      ? [
          '',
          'Type breakdown:',
          ...report.typeCounts.map(({ label, count }) => `- ${label}: ${count}`),
        ]
      : []),
  ]

  if (nonRetryableCount || report.skipped.length) {
    lines.push(
      '',
      'Items marked non-retryable are skipped for the rest of this page session. Refresh the page to try them again.'
    )
  }

  for (const group of groupClaimResults(report)) {
    lines.push('', `Bundle: ${group.bundleName}`)
    const groupNonRetryableCount = countNonRetryableFailures(group.failures)
    const groupSummary = [
      `${group.successes.length} succeeded`,
      ...(group.failures.length
        ? [
            `${group.failures.length} failed${
              groupNonRetryableCount ? ` (${groupNonRetryableCount} non-retryable)` : ''
            }`,
          ]
        : []),
      ...(group.skipped.length ? [`${group.skipped.length} skipped`] : []),
    ]
    lines.push(`  Results: ${groupSummary.join(', ')}`)

    for (const { product } of group.successes) {
      lines.push(`  SUCCESS - ${product.human_name} [${getClaimTypeLabel(product)}]`)
    }

    for (const { product, error, nonRetryable } of group.failures) {
      const type = getClaimTypeLabel(product)
      const status = nonRetryable ? 'NON-RETRYABLE' : 'FAILED'
      lines.push(`  ${status} - ${product.human_name} [${type}]: ${getErrorMessage(error)}`)
    }

    for (const { product } of group.skipped) {
      const type = getClaimTypeLabel(product)
      lines.push(
        `  SKIPPED - ${product.human_name} [${type}]: Previously marked non-retryable this session. Refresh the page to try again.`
      )
    }
  }

  return `${lines.join('\n')}\n`
}
