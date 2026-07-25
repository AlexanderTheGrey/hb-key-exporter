import { createSignal, onCleanup, Show, type Accessor } from 'solid-js'
import type { Api } from 'datatables.net-dt'
import {
  createClaimPlan,
  type ClaimFailure,
  type ClaimPlan,
  type ClaimReport,
  type ClaimSuccess,
} from '../claim-report'
import { forEachConcurrent } from '../concurrency'
import {
  hasSearchBuilderCriteria,
  invertSearchBuilderGroup,
  type WithSearchBuilder,
} from '../table-filter'
import { hasRedeemedKeyValue, serializeRedeemedKeyValue } from '../redeemed-key'
import { copyToClipboard, redeem, showErrorToast, showFlashToast, type Product } from '../util'
import { BulkRevealConfirmation, BulkRevealResults } from './BulkRevealDialogs'
// @ts-expect-error missing types
import styles from '../style.module.css'

const CLAIM_CONCURRENCY = 4

type PendingConfirmation = {
  plan: ClaimPlan<Product>
  gift: boolean
  resolve: (confirmed: boolean) => void
}

const claimProducts = async (
  products: Product[],
  gift: boolean
): Promise<{
  successes: ClaimSuccess<Product>[]
  failures: ClaimFailure<Product>[]
  updated: Set<Product>
}> => {
  const successes: ClaimSuccess<Product>[] = []
  const failures: ClaimFailure<Product>[] = []
  const updated = new Set<Product>()

  await forEachConcurrent(products, CLAIM_CONCURRENCY, async (product, index) => {
    try {
      product.redeemed_key_val = await redeem(product, gift)
      product.type = gift ? 'Gift' : 'Key'
      product.is_gift = gift
      updated.add(product)
      successes.push({ index, product })
    } catch (error) {
      console.error('Error redeeming product:', product.machine_name, error)
      failures.push({ index, product, error })
    }
  })

  successes.sort((left, right) => left.index - right.index)
  failures.sort((left, right) => left.index - right.index)

  return { successes, failures, updated }
}

const exportASF = (products: Product[]): string =>
  products
    .filter(
      (product) =>
        !product.is_gift &&
        hasRedeemedKeyValue(product.redeemed_key_val) &&
        product.key_type === 'steam'
    )
    .map(
      (product) => `${product.human_name}\t${serializeRedeemedKeyValue(product.redeemed_key_val)}`
    )
    .join('\n')

const exportKeys = (products: Product[]): string =>
  products
    .filter((product) => !product.is_gift && hasRedeemedKeyValue(product.redeemed_key_val))
    .map((product) => serializeRedeemedKeyValue(product.redeemed_key_val))
    .join('\n')

const escapeCsvField = (value: string, delimiter: string): string => {
  const needsQuotes =
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r') ||
    (delimiter ? value.includes(delimiter) : false) ||
    value.trim() !== value

  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value
}

const serializeField = (value: unknown): string => {
  if (value == null) return ''
  if (typeof value === 'object') return JSON.stringify(value) ?? ''
  return String(value)
}

const exportCSV = (products: Product[], delimiter: string): string => {
  if (!products.length) return ''

  const header = Object.keys(products[0]).flatMap((name) =>
    name === 'redeemed_date' ? ['redeemed_date_label', 'redeemed_date_iso'] : [name]
  )

  const getCsvValue = (product: Product, name: string): unknown => {
    if (name === 'redeemed_date_label') return product.redeemed_date?.label ?? ''
    if (name === 'redeemed_date_iso') return product.redeemed_date?.iso ?? ''
    return product[name as keyof Product]
  }

  return [
    header.map((name) => escapeCsvField(name, delimiter)).join(delimiter),
    ...products.map((product) =>
      header
        .map((name) => escapeCsvField(serializeField(getCsvValue(product, name)), delimiter))
        .join(delimiter)
    ),
  ].join('\r\n')
}

export function Actions({ dt }: { dt: Accessor<Api<Product> | null> }) {
  const [exportType, setExportType] = createSignal('csv')
  const [claim, setClaim] = createSignal(false)
  const [claimType, setClaimType] = createSignal('key')
  const [exporting, setExporting] = createSignal(false)
  const [separator, setSeparator] = createSignal(',')
  const [pendingConfirmation, setPendingConfirmation] = createSignal<PendingConfirmation | null>(
    null
  )
  const [claimReport, setClaimReport] = createSignal<ClaimReport<Product> | null>(null)

  const finishConfirmation = (confirmed: boolean): void => {
    const pending = pendingConfirmation()
    if (!pending) return

    setPendingConfirmation(null)
    pending.resolve(confirmed)
  }

  const confirmBulkReveal = (plan: ClaimPlan<Product>, gift: boolean): Promise<boolean> =>
    new Promise((resolve) => setPendingConfirmation({ plan, gift, resolve }))

  onCleanup(() => finishConfirmation(false))

  const invertFilter = (): void => {
    const table = dt()
    if (!table) return

    try {
      const searchBuilder = (table as WithSearchBuilder<Api<Product>>).searchBuilder
      const details = searchBuilder.getDetails(true)

      if (!hasSearchBuilderCriteria(details)) {
        throw new Error('Add at least one table filter before inverting it.')
      }

      searchBuilder.rebuild(invertSearchBuilderGroup(details), false)
      table.draw(false)
      showFlashToast('Table filter inverted')
    } catch (error) {
      showErrorToast(error, 'Failed to invert table filter')
    }
  }

  const exportToClipboard = async (): Promise<void> => {
    const table = dt()
    if (!table) return

    setExporting(true)

    try {
      const toExport = table.rows({ search: 'applied' }).data().toArray() as Product[]
      const claimAsGift = claimType() === 'gift'
      const claimable = claim()
        ? toExport.filter((product) => !hasRedeemedKeyValue(product.redeemed_key_val))
        : []
      let report: ClaimReport<Product> | null = null

      if (claimable.length) {
        const plan = createClaimPlan(claimable)
        const confirmed = await confirmBulkReveal(plan, claimAsGift)
        if (!confirmed) return

        const { successes, failures, updated } = await claimProducts(claimable, claimAsGift)

        if (updated.size) {
          table
            .rows((_index, product) => updated.has(product))
            .invalidate('data')
            .draw(false)
        }

        report = {
          gift: claimAsGift,
          successes,
          failures,
          typeCounts: plan.typeCounts,
          keylessCount: plan.keylessCount,
          exportCopied: false,
        }
      }

      const delimiter = separator() || ','
      const text =
        exportType() === 'asf'
          ? exportASF(toExport)
          : exportType() === 'keys'
            ? exportKeys(toExport)
            : exportCSV(toExport, delimiter)
      const exportCopied = copyToClipboard(text)

      if (report) {
        setClaimReport({ ...report, exportCopied })
      } else if (exportCopied) {
        showFlashToast('Exported to clipboard')
      }
    } catch (error) {
      showErrorToast(error, 'Export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div class={styles.actions}>
        <label for="separator">
          CSV Separator&nbsp;
          <input
            type="text"
            name="separator"
            id="separator"
            value=","
            onInput={(event) => setSeparator(event.target.value)}
            style={{ width: '5ch', 'text-align': 'center' }}
            required
          />
        </label>
      </div>
      <div class={styles.actions}>
        <label for="claim">
          <input
            type="checkbox"
            id="claim"
            name="claim"
            checked={claim()}
            onChange={(event) => setClaim(event.target.checked)}
          />
          Reveal unrevealed keys
        </label>
        <select
          name="claimType"
          id="claimType"
          class={styles.select}
          classList={{ hidden: !claim() }}
          onChange={(event) => setClaimType(event.target.value)}
        >
          <option value="" disabled>
            What to claim
          </option>
          <option value="key" selected>
            Key
          </option>
          <option value="gift">Gift link</option>
        </select>
        <button
          type="button"
          class={styles.btn}
          onClick={invertFilter}
          disabled={!dt() || exporting()}
          title="Replace the current advanced filter with its logical opposite"
        >
          Invert filter
        </button>
        <select
          name="export"
          id="export"
          class={styles.select}
          value={exportType()}
          onChange={(event) => setExportType(event.target.value)}
        >
          <option value="asf">ASF</option>
          <option value="keys">Keys</option>
          <option value="csv">CSV</option>
        </select>
        <button
          type="button"
          class="primary-button"
          onClick={exportToClipboard}
          disabled={!dt() || !exportType() || exporting()}
        >
          {exporting() ? <i class="hb hb-spin hb-spinner"></i> : 'Export'}
        </button>
      </div>

      <Show when={pendingConfirmation()} keyed>
        {(pending) => (
          <BulkRevealConfirmation
            plan={pending.plan}
            gift={pending.gift}
            onCancel={() => finishConfirmation(false)}
            onConfirm={() => finishConfirmation(true)}
          />
        )}
      </Show>

      <Show when={claimReport()} keyed>
        {(report) => <BulkRevealResults report={report} onClose={() => setClaimReport(null)} />}
      </Show>
    </>
  )
}
