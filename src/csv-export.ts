import { serializeRedeemedKeyValue } from './redeemed-key'
import type { Product } from './util'

export type CsvDateFormat = 'iso' | 'human'

export type CsvColumnId =
  | 'machine_name'
  | 'category'
  | 'category_id'
  | 'category_human_name'
  | 'human_name'
  | 'key_type'
  | 'direct_redeem'
  | 'type'
  | 'redeemed_key_val'
  | 'is_gift'
  | 'is_expired'
  | 'expiry_date'
  | 'steam_app_id'
  | 'created'
  | 'keyindex'
  | 'owned'
  | 'redeemed_status'
  | 'redeemed_date'
  | 'exclusive_countries'
  | 'disallowed_countries'

export type CsvExportPreferences = {
  /** null means use the current default set, including default columns added in future versions. */
  columnIds: CsvColumnId[] | null
  dateFormat: CsvDateFormat
}

type CsvDateKind = 'date-only' | 'date-time' | 'expiry'

type CsvColumnDefinition = {
  id: CsvColumnId
  label: string
  header: string
  getValue: (product: Product) => unknown
  dateKind?: CsvDateKind
}

const CSV_EXPORT_SETTINGS_KEY = 'hb-key-exporter:csv-export-preferences'
const CSV_EXPORT_SETTINGS_VERSION = 1

export const DEFAULT_CSV_EXPORT_PREFERENCES: Readonly<CsvExportPreferences> = Object.freeze({
  columnIds: null,
  dateFormat: 'iso',
})

const humanDateOnlyFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  timeZone: 'UTC',
})

const humanDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
  hour12: true,
  timeZoneName: 'short',
})

const csvColumnDefinitions: readonly CsvColumnDefinition[] = [
  {
    id: 'machine_name',
    label: 'Machine name',
    header: 'machine_name',
    getValue: (product) => product.machine_name,
  },
  {
    id: 'category',
    label: 'Category',
    header: 'category',
    getValue: (product) => product.category,
  },
  {
    id: 'category_id',
    label: 'Bundle ID',
    header: 'category_id',
    getValue: (product) => product.category_id,
  },
  {
    id: 'category_human_name',
    label: 'Bundle name',
    header: 'category_human_name',
    getValue: (product) => product.category_human_name,
  },
  {
    id: 'human_name',
    label: 'Name',
    header: 'human_name',
    getValue: (product) => product.human_name,
  },
  {
    id: 'key_type',
    label: 'Key type',
    header: 'key_type',
    getValue: (product) => product.key_type,
  },
  {
    id: 'direct_redeem',
    label: 'Direct redeem',
    header: 'direct_redeem',
    getValue: (product) => product.direct_redeem,
  },
  { id: 'type', label: 'Format', header: 'type', getValue: (product) => product.type },
  {
    id: 'redeemed_key_val',
    label: 'Key / redemption value',
    header: 'redeemed_key_val',
    getValue: (product) =>
      product.redeemed_key_val ? serializeRedeemedKeyValue(product.redeemed_key_val) : '',
  },
  { id: 'is_gift', label: 'Gift', header: 'is_gift', getValue: (product) => product.is_gift },
  {
    id: 'is_expired',
    label: 'Expired',
    header: 'is_expired',
    getValue: (product) => product.is_expired,
  },
  {
    id: 'expiry_date',
    label: 'Expiration date',
    header: 'expiry_date',
    getValue: (product) => product.expiry_date ?? '',
    dateKind: 'expiry',
  },
  {
    id: 'steam_app_id',
    label: 'Steam app ID',
    header: 'steam_app_id',
    getValue: (product) => product.steam_app_id ?? '',
  },
  {
    id: 'created',
    label: 'Purchased',
    header: 'created',
    getValue: (product) => product.created,
    dateKind: 'date-time',
  },
  {
    id: 'keyindex',
    label: 'Key index',
    header: 'keyindex',
    getValue: (product) => product.keyindex ?? '',
  },
  { id: 'owned', label: 'Owned', header: 'owned', getValue: (product) => product.owned },
  {
    id: 'redeemed_status',
    label: 'Redeemed status',
    header: 'redeemed_status',
    getValue: (product) => product.redeemed_date?.label ?? '',
  },
  {
    id: 'redeemed_date',
    label: 'Redeemed date',
    header: 'redeemed_date',
    getValue: (product) => product.redeemed_date?.iso ?? '',
    dateKind: 'date-only',
  },
  {
    id: 'exclusive_countries',
    label: 'Exclusive countries',
    header: 'exclusive_countries',
    getValue: (product) => product.exclusive_countries.join(';'),
  },
  {
    id: 'disallowed_countries',
    label: 'Disallowed countries',
    header: 'disallowed_countries',
    getValue: (product) => product.disallowed_countries.join(';'),
  },
]

export const CSV_COLUMNS: readonly Readonly<Pick<CsvColumnDefinition, 'id' | 'label'>>[] =
  csvColumnDefinitions.map(({ id, label }) => Object.freeze({ id, label }))

export const DEFAULT_CSV_COLUMN_IDS: readonly CsvColumnId[] = csvColumnDefinitions.map(
  ({ id }) => id
)

const csvColumnIds = new Set<CsvColumnId>(DEFAULT_CSV_COLUMN_IDS)
const csvColumnById = new Map(csvColumnDefinitions.map((definition) => [definition.id, definition]))

const tableColumnCsvIds: readonly (readonly CsvColumnId[])[] = [
  ['key_type'],
  ['human_name'],
  ['category'],
  ['category_human_name'],
  ['type'],
  ['redeemed_key_val', 'is_gift'],
  ['owned'],
  ['created'],
  ['redeemed_status', 'redeemed_date'],
  ['expiry_date'],
  ['exclusive_countries', 'disallowed_countries'],
  [],
]

const isCsvColumnId = (value: unknown): value is CsvColumnId =>
  typeof value === 'string' && csvColumnIds.has(value as CsvColumnId)

const normalizeColumnIds = (values: readonly unknown[]): CsvColumnId[] => {
  const selected = new Set(values.filter(isCsvColumnId))
  return DEFAULT_CSV_COLUMN_IDS.filter((id) => selected.has(id))
}

const isCsvDateFormat = (value: unknown): value is CsvDateFormat =>
  value === 'iso' || value === 'human'

const cloneDefaultPreferences = (): CsvExportPreferences => ({
  columnIds: null,
  dateFormat: DEFAULT_CSV_EXPORT_PREFERENCES.dateFormat,
})

export const normalizeCsvExportPreferences = (value: unknown): CsvExportPreferences => {
  if (!value || typeof value !== 'object') return cloneDefaultPreferences()

  const candidate = value as {
    version?: unknown
    columnIds?: unknown
    dateFormat?: unknown
  }

  if (candidate.version !== CSV_EXPORT_SETTINGS_VERSION) return cloneDefaultPreferences()

  let columnIds: CsvColumnId[] | null = null
  if (candidate.columnIds !== null) {
    if (!Array.isArray(candidate.columnIds)) return cloneDefaultPreferences()
    const normalized = normalizeColumnIds(candidate.columnIds)
    if (!normalized.length) return cloneDefaultPreferences()
    columnIds = normalized
  }

  return {
    columnIds,
    dateFormat: isCsvDateFormat(candidate.dateFormat) ? candidate.dateFormat : 'iso',
  }
}

export const loadCsvExportPreferences = (): CsvExportPreferences => {
  try {
    return normalizeCsvExportPreferences(GM_getValue(CSV_EXPORT_SETTINGS_KEY, null))
  } catch (error) {
    console.warn('Failed to load CSV export preferences:', error)
    return cloneDefaultPreferences()
  }
}

export const saveCsvExportPreferences = (preferences: CsvExportPreferences): void => {
  GM_setValue(CSV_EXPORT_SETTINGS_KEY, {
    version: CSV_EXPORT_SETTINGS_VERSION,
    columnIds: preferences.columnIds,
    dateFormat: preferences.dateFormat,
  })
}

export const resolveCsvColumnIds = (preferences: CsvExportPreferences): CsvColumnId[] =>
  preferences.columnIds ? [...preferences.columnIds] : [...DEFAULT_CSV_COLUMN_IDS]

export const getVisibleCsvColumnIds = (visibleTableColumns: readonly boolean[]): CsvColumnId[] => {
  const selected = new Set<CsvColumnId>()

  visibleTableColumns.forEach((visible, index) => {
    if (!visible) return
    for (const id of tableColumnCsvIds[index] ?? []) selected.add(id)
  })

  return DEFAULT_CSV_COLUMN_IDS.filter((id) => selected.has(id))
}

export const getBrowserTimeZone = (): string =>
  Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time'

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

const formatDateOnly = (value: string): string => {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return value

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return value
  }

  return humanDateOnlyFormatter.format(date)
}

const formatHumanDate = (value: unknown, kind: CsvDateKind): string => {
  const serialized = serializeField(value)
  if (!serialized) return ''

  if (kind === 'date-only') return formatDateOnly(serialized)
  if (kind === 'expiry' && /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(serialized)) {
    return formatDateOnly(serialized.slice(0, 10))
  }

  const date = new Date(serialized)
  return Number.isNaN(date.getTime()) ? serialized : humanDateTimeFormatter.format(date)
}

export const getCsvColumnHeader = (id: CsvColumnId): string => csvColumnById.get(id)?.header ?? id

const getColumnValue = (
  product: Product,
  definition: CsvColumnDefinition,
  dateFormat: CsvDateFormat
): string => {
  const value = definition.getValue(product)
  if (dateFormat === 'human' && definition.dateKind) {
    return formatHumanDate(value, definition.dateKind)
  }
  return serializeField(value)
}

export const exportCSV = (
  products: Product[],
  delimiter: string,
  preferences: CsvExportPreferences
): string => {
  if (!products.length) return ''

  const selectedIds = resolveCsvColumnIds(preferences)
  const definitions = selectedIds.flatMap((id) => {
    const definition = csvColumnById.get(id)
    return definition ? [definition] : []
  })
  if (!definitions.length) return ''

  const rows = [
    definitions
      .map((definition) => escapeCsvField(getCsvColumnHeader(definition.id), delimiter))
      .join(delimiter),
    ...products.map((product) =>
      definitions
        .map((definition) =>
          escapeCsvField(getColumnValue(product, definition, preferences.dateFormat), delimiter)
        )
        .join(delimiter)
    ),
  ]

  return `${rows.join('\n')}\n`
}
