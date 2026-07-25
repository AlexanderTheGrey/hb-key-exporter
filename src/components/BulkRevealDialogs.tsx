import { For, Show } from 'solid-js'
import {
  formatClaimLog,
  getClaimTypeLabel,
  getErrorMessage,
  groupClaimResults,
  type ClaimPlan,
  type ClaimReport,
} from '../claim-report'
import { copyToClipboard, showFlashToast, type Product } from '../util'
// @ts-expect-error missing types
import styles from '../style.module.css'

const pluralize = (count: number, singular: string, plural = `${singular}s`): string =>
  count === 1 ? singular : plural

export function BulkRevealConfirmation({
  plan,
  gift,
  onCancel,
  onConfirm,
}: {
  plan: ClaimPlan<Product>
  gift: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const count = plan.products.length
  const action = gift ? 'create gift links for' : 'reveal'
  const keylessWarning = gift
    ? [
        'These may redeem directly to the third-party account linked to your Humble Bundle',
        'account instead of producing transferable gift links.',
      ].join(' ')
    : [
        'Revealing them will redeem them immediately to the third-party account linked to',
        'your Humble Bundle account; they will not produce transferable keys.',
      ].join(' ')

  return (
    <div
      class={styles.modal_backdrop}
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
      onKeyDown={(event) => event.key === 'Escape' && onCancel()}
    >
      <section
        class={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hb_extractor-confirm-title"
        tabindex="-1"
      >
        <header class={styles.modal_header}>
          <div>
            <p class={styles.modal_eyebrow}>Bulk reveal confirmation</p>
            <h2 id="hb_extractor-confirm-title" class={styles.modal_title}>
              {gift ? 'Create gift links and export?' : 'Reveal keys and export?'}
            </h2>
          </div>
          <button
            type="button"
            class={styles.modal_close}
            aria-label="Cancel"
            title="Cancel"
            onClick={onCancel}
          >
            ×
          </button>
        </header>

        <div class={styles.modal_body}>
          <p class={styles.modal_lead}>
            The exporter is about to {action} <strong>{count}</strong>{' '}
            {pluralize(count, 'unrevealed item')} across <strong>{plan.bundleCount}</strong>{' '}
            {pluralize(plan.bundleCount, 'bundle')}.
          </p>

          <div class={styles.modal_stats}>
            <div class={styles.modal_stat}>
              <strong>{count}</strong>
              <span>Items</span>
            </div>
            <div class={styles.modal_stat}>
              <strong>{plan.bundleCount}</strong>
              <span>Bundles</span>
            </div>
            <div class={styles.modal_stat}>
              <strong>{plan.typeCounts.length}</strong>
              <span>Types</span>
            </div>
          </div>

          <div class={styles.type_breakdown}>
            <h3>Type breakdown</h3>
            <ul>
              <For each={plan.typeCounts}>
                {({ label, count: typeCount }) => (
                  <li>
                    <span>{label}</span>
                    <strong>{typeCount}</strong>
                  </li>
                )}
              </For>
            </ul>
          </div>

          <Show when={plan.keylessCount > 0}>
            <div class={styles.modal_warning} role="alert">
              <strong>Keyless redemption warning</strong>
              <p>
                {plan.keylessCount} {pluralize(plan.keylessCount, 'item')} Humble marks for direct
                redemption. {keylessWarning} Verify that the correct account is linked before
                continuing.
              </p>
            </div>
          </Show>

          <p class={styles.modal_note}>Nothing will be revealed or exported unless you confirm.</p>
        </div>

        <footer class={styles.modal_footer}>
          <button type="button" class={styles.modal_secondary_button} onClick={onCancel}>
            Cancel
          </button>
          <button type="button" class={styles.modal_primary_button} onClick={onConfirm} autofocus>
            {gift ? 'Create & Export' : 'Reveal & Export'}
          </button>
        </footer>
      </section>
    </div>
  )
}

export function BulkRevealResults({
  report,
  onClose,
}: {
  report: ClaimReport<Product>
  onClose: () => void
}) {
  const groups = groupClaimResults(report)
  const requested = report.successes.length + report.failures.length

  const copyLog = (): void => {
    if (copyToClipboard(formatClaimLog(report))) {
      showFlashToast('Log copied to clipboard')
    }
  }

  return (
    <div
      class={styles.modal_backdrop}
      role="presentation"
      onKeyDown={(event) => event.key === 'Escape' && onClose()}
    >
      <section
        class={`${styles.modal} ${styles.modal_wide}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hb_extractor-results-title"
        tabindex="-1"
      >
        <header class={styles.modal_header}>
          <div>
            <p class={styles.modal_eyebrow}>Bulk reveal complete</p>
            <h2 id="hb_extractor-results-title" class={styles.modal_title}>
              Reveal results
            </h2>
          </div>
          <button
            type="button"
            class={styles.modal_close}
            aria-label="Close results"
            title="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div class={styles.modal_body}>
          <div class={styles.result_summary} aria-live="polite">
            <div class={styles.result_summary_item}>
              <strong>{requested}</strong>
              <span>Attempted</span>
            </div>
            <div class={`${styles.result_summary_item} ${styles.result_success_summary}`}>
              <strong>{report.successes.length}</strong>
              <span>Succeeded</span>
            </div>
            <div class={`${styles.result_summary_item} ${styles.result_failure_summary}`}>
              <strong>{report.failures.length}</strong>
              <span>Failed</span>
            </div>
          </div>

          <div
            class={`${styles.export_status} ${
              report.exportCopied ? styles.export_status_success : styles.export_status_failure
            }`}
          >
            {report.exportCopied ? (
              <>
                Export copied to clipboard. <strong>Paste it before copying the log.</strong>
              </>
            ) : (
              'The reveal finished, but the export could not be copied to your clipboard.'
            )}
          </div>

          <div class={styles.result_groups}>
            <For each={groups}>
              {(group) => (
                <details class={styles.result_bundle} open={group.failures.length > 0}>
                  <summary>
                    <span>{group.bundleName}</span>
                    <span class={styles.result_bundle_counts}>
                      <span class={styles.result_count_success}>
                        {group.successes.length} succeeded
                      </span>
                      <Show when={group.failures.length > 0}>
                        <span class={styles.result_count_failure}>
                          {group.failures.length} failed
                        </span>
                      </Show>
                    </span>
                  </summary>

                  <div class={styles.result_bundle_body}>
                    <Show when={group.successes.length > 0}>
                      <h4>Successfully revealed</h4>
                      <ul class={styles.result_list}>
                        <For each={group.successes}>
                          {({ product }) => (
                            <li class={styles.result_success}>
                              <span class={styles.result_icon} aria-hidden="true">
                                ✓
                              </span>
                              <span>
                                <strong>{product.human_name}</strong>
                                <small>{getClaimTypeLabel(product)}</small>
                              </span>
                            </li>
                          )}
                        </For>
                      </ul>
                    </Show>

                    <Show when={group.failures.length > 0}>
                      <h4>Failed</h4>
                      <ul class={styles.result_list}>
                        <For each={group.failures}>
                          {({ product, error }) => (
                            <li class={styles.result_failure}>
                              <span class={styles.result_icon} aria-hidden="true">
                                ×
                              </span>
                              <span>
                                <strong>{product.human_name}</strong>
                                <small>
                                  {getClaimTypeLabel(product)} — {getErrorMessage(error)}
                                </small>
                              </span>
                            </li>
                          )}
                        </For>
                      </ul>
                    </Show>
                  </div>
                </details>
              )}
            </For>
          </div>
        </div>

        <footer class={styles.modal_footer}>
          <button type="button" class={styles.modal_secondary_button} onClick={onClose}>
            Close
          </button>
          <button type="button" class={styles.modal_primary_button} onClick={copyLog} autofocus>
            Copy Log
          </button>
        </footer>
      </section>
    </div>
  )
}
