import { createSignal, For } from 'solid-js'
import type { Api } from 'datatables.net-dt'
import {
  CSV_COLUMNS,
  DEFAULT_CSV_COLUMN_IDS,
  DEFAULT_CSV_EXPORT_PREFERENCES,
  getBrowserTimeZone,
  getCsvColumnHeader,
  getVisibleCsvColumnIds,
  resolveCsvColumnIds,
  type CsvColumnId,
  type CsvDateFormat,
  type CsvExportPreferences,
} from '../csv-export'
import { useModalBehavior } from '../modal'
import type { Product } from '../util'
// @ts-expect-error missing types
import styles from '../style.module.css'

const sameColumnIds = (left: readonly CsvColumnId[], right: readonly CsvColumnId[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index])

export function CsvExportSettingsDialog({
  table,
  preferences,
  onCancel,
  onApply,
}: {
  table: Api<Product>
  preferences: CsvExportPreferences
  onCancel: () => void
  onApply: (preferences: CsvExportPreferences) => void
}) {
  const initialColumnIds = resolveCsvColumnIds(preferences)
  const [selectedColumnIds, setSelectedColumnIds] = createSignal<CsvColumnId[]>(initialColumnIds)
  const [dateFormat, setDateFormat] = createSignal<CsvDateFormat>(preferences.dateFormat)
  const [usesDefaultColumns, setUsesDefaultColumns] = createSignal(preferences.columnIds === null)
  let dialogRef: HTMLElement | undefined

  const setColumns = (columnIds: readonly CsvColumnId[], useDefaults = false): void => {
    const selected = new Set(columnIds)
    setSelectedColumnIds(DEFAULT_CSV_COLUMN_IDS.filter((id) => selected.has(id)))
    setUsesDefaultColumns(useDefaults)
  }

  const toggleColumn = (id: CsvColumnId, checked: boolean): void => {
    const selected = new Set(selectedColumnIds())
    if (checked) selected.add(id)
    else selected.delete(id)
    setColumns([...selected])
  }

  const selectVisible = (): void => {
    const visible = table
      .columns()
      .indexes()
      .toArray()
      .map((index) => table.column(index).visible())
    setColumns(getVisibleCsvColumnIds(visible))
  }

  const resetDefaults = (): void => {
    setColumns(DEFAULT_CSV_COLUMN_IDS, true)
    setDateFormat(DEFAULT_CSV_EXPORT_PREFERENCES.dateFormat)
  }

  const apply = (): void => {
    const columnIds = selectedColumnIds()
    if (!columnIds.length) return

    onApply({
      columnIds:
        usesDefaultColumns() && sameColumnIds(columnIds, DEFAULT_CSV_COLUMN_IDS)
          ? null
          : [...columnIds],
      dateFormat: dateFormat(),
    })
  }

  const { handleKeyDown, stopPropagation } = useModalBehavior({
    dialog: () => dialogRef,
    onEscape: onCancel,
  })

  return (
    <div
      class={styles.modal_backdrop}
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
    >
      <section
        ref={dialogRef}
        class={`${styles.modal} ${styles.modal_wide}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hb_extractor-csv-settings-title"
        aria-describedby="hb_extractor-csv-settings-description"
        tabindex="-1"
        on:keydown={handleKeyDown}
        on:keypress={stopPropagation}
        on:keyup={stopPropagation}
      >
        <header class={styles.modal_header}>
          <div>
            <p class={styles.modal_eyebrow}>CSV export</p>
            <h2 id="hb_extractor-csv-settings-title" class={styles.modal_title}>
              Export options
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

        <div class={styles.modal_body} data-modal-scroll-body>
          <p id="hb_extractor-csv-settings-description" class={styles.csv_settings_intro}>
            Choose which fields to include in CSV exports. Applied settings are remembered across
            page reloads.
          </p>

          <div class={styles.csv_settings_section_header}>
            <div>
              <h3>Columns</h3>
              <span class={styles.csv_settings_count} aria-live="polite">
                {selectedColumnIds().length} of {CSV_COLUMNS.length} selected
              </span>
            </div>
            <div class={styles.csv_settings_actions}>
              <button type="button" onClick={() => setColumns(DEFAULT_CSV_COLUMN_IDS)}>
                Select all
              </button>
              <button type="button" onClick={selectVisible}>
                Select visible
              </button>
              <button type="button" onClick={() => setColumns([])}>
                Clear all
              </button>
              <button type="button" onClick={resetDefaults}>
                Reset to default
              </button>
            </div>
          </div>

          <div class={styles.csv_column_grid}>
            <For each={CSV_COLUMNS}>
              {(column) => (
                <label class={styles.csv_column_option}>
                  <input
                    type="checkbox"
                    checked={selectedColumnIds().includes(column.id)}
                    onChange={(event) => toggleColumn(column.id, event.currentTarget.checked)}
                  />
                  <span>
                    <strong>{column.label}</strong>
                    <small>{getCsvColumnHeader(column.id)}</small>
                  </span>
                </label>
              )}
            </For>
          </div>

          <div class={styles.csv_date_settings}>
            <div>
              <label for="csvDateFormat">Date and time format</label>
              <p>
                Human-readable timestamps use your browser's local time zone ({getBrowserTimeZone()}
                ). Date-only values remain date-only.
              </p>
            </div>
            <select
              id="csvDateFormat"
              class={styles.select}
              value={dateFormat()}
              onChange={(event) => setDateFormat(event.currentTarget.value as CsvDateFormat)}
            >
              <option value="iso">ISO 8601</option>
              <option value="human">Human-readable</option>
            </select>
          </div>
        </div>

        <footer class={styles.modal_footer}>
          <button type="button" class={styles.modal_secondary_button} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            class={`${styles.modal_primary_button} ${styles.csv_settings_apply}`}
            onClick={apply}
            disabled={!selectedColumnIds().length}
          >
            Apply
          </button>
        </footer>
      </section>
    </div>
  )
}
