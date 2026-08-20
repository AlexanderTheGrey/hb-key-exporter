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

const CLAIM_CONCURRENCY = 5

type PendingConfirmation = {
  plan: ClaimPlan<Product>
  gift: boolean
  resolve: (confirmed: boolean) => void
}

const claimProducts = async (
  products: Product[],
  gift: boolean,
  onProgress?: (completed: number) => void
): Promise<{
  successes: ClaimSuccess<Product>[]
  failures: ClaimFailure<Product>[]
  updated: Set<Product>
}> => {
  const successes: ClaimSuccess<Product>[] = []
  const failures: ClaimFailure<Product>[] = []
  const updated = new Set<Product>()
  let completed = 0

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
    } finally {
      onProgress?.(++completed)
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

  const header = Object.keys(products[0]).flatMap((name) => {
    if (name === 'redeemed_date') return ['redeemed_date_label', 'redeemed_date_iso']
    if (name === 'exclusive_countries') return ['Exclusive Countries']
    if (name === 'disallowed_countries') return ['Disallowed Countries']
    return [name]
  })

  const getCsvValue = (product: Product, name: string): unknown => {
    if (name === 'redeemed_date_label') return product.redeemed_date?.label ?? ''
    if (name === 'redeemed_date_iso') return product.redeemed_date?.iso ?? ''
    if (name === 'Exclusive Countries') return product.exclusive_countries.join(';')
    if (name === 'Disallowed Countries') return product.disallowed_countries.join(';')
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

type ExportType = 'asf' | 'keys' | 'csv'

const getEmptyExportMessage = (type: ExportType, products: Product[]): string => {
  if (!products.length) return 'Empty export: no rows in table'
  if (type === 'asf') return 'Empty export: no revealed Steam keys in table'
  if (type === 'keys') return 'Empty export: no revealed keys in table'

  return 'Empty export'
}

export function Actions({ dt }: { dt: Accessor<Api<Product> | null> }) {
  const [exportType, setExportType] = createSignal<ExportType>('csv')
  const [claim, setClaim] = createSignal(false)
  const [claimType, setClaimType] = createSignal('key')
  const [exporting, setExporting] = createSignal(false)
  const [bulkRevealProcessing, setBulkRevealProcessing] = createSignal(false)
  const [bulkRevealProgress, setBulkRevealProgress] = createSignal(0)
  const [separator, setSeparator] = createSignal(',')
  const [pendingConfirmation, setPendingConfirmation] = createSignal<PendingConfirmation | null>(
    null
  )
  const [claimReport, setClaimReport] = createSignal<ClaimReport<Product> | null>(null)

  const cancelConfirmation = (): void => {
    if (bulkRevealProcessing()) return

    const pending = pendingConfirmation()
    if (!pending) return

    setPendingConfirmation(null)
    pending.resolve(false)
  }

  const confirmReveal = (): void => {
    const pending = pendingConfirmation()
    if (!pending || bulkRevealProcessing()) return

    setBulkRevealProcessing(true)
    pending.resolve(true)
  }

  const confirmBulkReveal = (plan: ClaimPlan<Product>, gift: boolean): Promise<boolean> => {
    setBulkRevealProcessing(false)
    setBulkRevealProgress(0)
    return new Promise((resolve) => setPendingConfirmation({ plan, gift, resolve }))
  }

  onCleanup(() => pendingConfirmation()?.resolve(false))

  const invertFilter = (): void => {
    const table = dt()
    if (!table) return

    try {
      const searchBuilder = (table as WithSearchBuilder<Api<Product>>).searchBuilder
      const details = searchBuilder.getDetails(true)

      if (!hasSearchBuilderCriteria(details)) {
        const hasTextSearch =
          Boolean(table.search()) || table.columns().search().toArray().some(Boolean)

        throw new Error(
          hasTextSearch
            ? 'Invert filter only supports conditions created with "Add Condition"; text searches cannot be inverted.'
            : 'Add at least one condition with "Add Condition" before inverting the filter.'
        )
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

        const { successes, failures, updated } = await claimProducts(
          claimable,
          claimAsGift,
          setBulkRevealProgress
        )

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
          exportEmpty: false,
        }
      }

      const delimiter = separator() || ','
      const text =
        exportType() === 'asf'
          ? exportASF(toExport)
          : exportType() === 'keys'
            ? exportKeys(toExport)
            : exportCSV(toExport, delimiter)
      if (!text) {
        showFlashToast(getEmptyExportMessage(exportType(), toExport), 'warning')

        if (report) {
          setPendingConfirmation(null)
          setClaimReport({ ...report, exportCopied: false, exportEmpty: true })
        }
        return
      }

      const exportCopied = copyToClipboard(text)

      if (report) {
        setPendingConfirmation(null)
        setClaimReport({ ...report, exportCopied })
      } else if (exportCopied) {
        showFlashToast('Exported to clipboard')
      }
    } catch (error) {
      showErrorToast(error, 'Export failed')
    } finally {
      setPendingConfirmation(null)
      setBulkRevealProcessing(false)
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
        <label for="claim" class={styles.checkbox_label}>
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
          title="Invert conditions created with Add Condition"
        >
          Invert filter
        </button>
        <select
          name="export"
          id="export"
          class={styles.select}
          value={exportType()}
          onChange={(event) => setExportType(event.currentTarget.value as ExportType)}
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
          {exporting() && !pendingConfirmation() && !bulkRevealProcessing() ? (
            <i class="hb hb-spin hb-spinner"></i>
          ) : (
            'Export'
          )}
        </button>
      </div>

      <Show when={pendingConfirmation()} keyed>
        {(pending) => (
          <BulkRevealConfirmation
            plan={pending.plan}
            gift={pending.gift}
            processing={bulkRevealProcessing}
            progress={bulkRevealProgress}
            onCancel={cancelConfirmation}
            onConfirm={confirmReveal}
          />
        )}
      </Show>

      <Show when={claimReport()} keyed>
        {(report) => <BulkRevealResults report={report} onClose={() => setClaimReport(null)} />}
      </Show>
    </>
  )
}
