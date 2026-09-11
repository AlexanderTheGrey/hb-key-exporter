import { onCleanup, onMount, type Accessor, type Setter } from 'solid-js'
import { hasNonRetryableClaim, isKeylessProduct, markNonRetryableClaim } from '../claim-report'
import { hasRedeemedKeyValue, serializeRedeemedKeyValue } from '../redeemed-key'
import { captureProductReference, resolveProductReference } from '../product-reference'
import {
  getRegionCountryCodes,
  hasRegionRestrictions,
  isRegionRedeemableIn,
  parseRegionRestrictions,
  serializeRegionRestrictions,
  type RegionRestrictions,
} from '../region'
import { restoreTableState, type TableState } from '../table-state'
import {
  clearSteamSupportNotice,
  copyToClipboard,
  redeem,
  RedeemError,
  fetchRedeemedDate,
  setRedeemedDate,
  showErrorToast,
  showFlashToast,
  showSteamSupportNotice,
  type Product,
} from '../util'
import DataTable, { type Api } from 'datatables.net-dt'
import { hm } from '@violentmonkey/dom'
// @ts-expect-error missing types
import styles from '../style.module.css'

const PAGING_POSITION_TOLERANCE = 0.5

export function Table({
  products,
  latestProducts,
  currentDt,
  steamId,
  setDt,
  waitForProductRefresh,
  requestKeylessConfirmation,
  finishKeylessRedemption,
  initialState,
  onStateRestored,
}: {
  products: Product[]
  latestProducts: Accessor<Product[] | undefined>
  currentDt: Accessor<Api<Product> | null>
  steamId: Accessor<string | null>
  setDt: Setter<Api<Product> | null>
  waitForProductRefresh: () => Promise<void>
  requestKeylessConfirmation: (product: Product, gift: boolean) => Promise<boolean>
  finishKeylessRedemption: () => void
  initialState?: TableState | null
  onStateRestored?: () => void
}) {
  let tableRef!: HTMLTableElement

  onMount(() => {
    console.debug('Mounting table with', products.length, 'products')

    const renderCellValue = (data: unknown, type: string): string | undefined => {
      if (data == null || data === '') return type === 'display' ? '-' : ''
      if (type !== 'display') return String(data)
      return undefined
    }

    const displayDash = (data: unknown, type: string): string =>
      !data ? (type === 'display' ? '-' : '') : String(data)

    const displayYesNoBadge = (
      data: unknown,
      type: string,
      noClassName = styles.no_badge
    ): string => {
      const value = displayDash(data, type)

      if (type !== 'display' || (value !== 'Yes' && value !== 'No')) {
        return value
      }

      return hm('span', {
        class: `${styles.yes_no_badge} ${value === 'Yes' ? styles.yes_badge : noClassName}`,
        innerText: value,
      }) as unknown as string
    }

    const displayTooltipDash = (title: string, className?: string): string =>
      hm('span', {
        class: className,
        title,
        innerText: '-',
      }) as unknown as string

    const displayOwned = (data: unknown, type: string, row: Product): string => {
      if (data) return displayYesNoBadge(data, type)
      if (type !== 'display') return ''

      if (row.key_type !== 'steam') {
        return displayTooltipDash('Ownership detection is only available for Steam keys.')
      }

      if (!row.steam_app_id) {
        return displayTooltipDash(
          "Humble's API returned an empty Steam app ID.",
          `${styles.yes_no_badge} ${styles.info_badge}`
        )
      }

      return displayTooltipDash('Steam ownership data could not be loaded.')
    }

    const displayDateOnly = (iso: string): string =>
      iso.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, y, m, d) => `${Number(m)}/${Number(d)}/${y}`)

    const dateFormatter = new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
    })

    const timeFormatter = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })

    const isUtcDateMarker = (value: string): boolean =>
      /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(value)

    const parseDate = (value: unknown): Date | null => {
      const date = new Date(String(value))
      return Number.isNaN(date.getTime()) ? null : date
    }

    const displayDateTime = (value: unknown): string => {
      const s = String(value)

      if (isUtcDateMarker(s)) return displayDateOnly(s.slice(0, 10))

      const date = parseDate(s)
      if (!date) return s

      const datePart = dateFormatter.format(date)
      const timePart = timeFormatter.format(date)

      return [
        `<span class="${styles.date_time_part}">${datePart}</span>`,
        `<span class="${styles.date_time_part}">${timePart}</span>`,
      ].join(' ')
    }

    const formatLocalDateKey = (date: Date): string => {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')

      return `${year}-${month}-${day}`
    }

    const localDateKey = (value: unknown): string => {
      const s = String(value)
      if (isUtcDateMarker(s)) return s.slice(0, 10)

      const date = parseDate(s)
      return date ? formatLocalDateKey(date) : s
    }

    const displayDate = (data: unknown, type: string): string => {
      if (!data) return type === 'display' ? '-' : ''

      const s = String(data)

      if (type === 'filter') return localDateKey(s)

      if (type === 'display') return displayDateTime(s)

      return s
    }

    /** Steam Support URL for a given appId */
    const steamSupportUrl = (appId: number) =>
      `https://help.steampowered.com/en/wizard/HelpWithGame?appid=${appId}`

    const steamRegistrationUrl = (key: string): string =>
      `https://store.steampowered.com/account/registerkey?key=${encodeURIComponent(key)}`

    const searchDateKey = (value: string): string => {
      const s = value.trim()
      if (!s) return ''
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s

      return localDateKey(s)
    }

    type DateCondition = {
      search?: (value: string, comparison: string[]) => boolean
      [key: string]: unknown
    }

    const dateConditions = (
      DataTable as typeof DataTable & {
        Criteria?: {
          dateConditions?: Record<string, DateCondition>
        }
      }
    ).Criteria?.dateConditions

    const setDateCondition = (
      condition: string,
      search: (value: string, comparison: string[]) => boolean
    ): void => {
      const dateCondition = dateConditions?.[condition]
      if (dateCondition) dateCondition.search = search
    }

    setDateCondition('=', (value, comparison) => {
      const left = searchDateKey(value)
      const right = searchDateKey(comparison[0] ?? '')
      return left !== '' && right !== '' && left === right
    })

    setDateCondition('!=', (value, comparison) => {
      const left = searchDateKey(value)
      const right = searchDateKey(comparison[0] ?? '')
      return left !== '' && right !== '' && left !== right
    })

    setDateCondition('<', (value, comparison) => {
      const left = searchDateKey(value)
      const right = searchDateKey(comparison[0] ?? '')
      return left !== '' && right !== '' && left < right
    })

    setDateCondition('>', (value, comparison) => {
      const left = searchDateKey(value)
      const right = searchDateKey(comparison[0] ?? '')
      return left !== '' && right !== '' && left >= right
    })

    setDateCondition('between', (value, comparison) => {
      const left = searchDateKey(value)
      const min = searchDateKey(comparison[0] ?? '')
      const max = searchDateKey(comparison[1] ?? '')
      return left !== '' && min !== '' && max !== '' && left >= min && left <= max
    })

    setDateCondition('!between', (value, comparison) => {
      const left = searchDateKey(value)
      const min = searchDateKey(comparison[0] ?? '')
      const max = searchDateKey(comparison[1] ?? '')
      return left !== '' && min !== '' && max !== '' && (left < min || left > max)
    })

    const todayDateKey = (): string => formatLocalDateKey(new Date())
    const isDateKey = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value)
    const expiryDateSearchBuilderType = 'date-expiry'
    const emptyDateCondition = dateConditions?.null
    const expiryDateConditions =
      dateConditions && emptyDateCondition
        ? {
            ...dateConditions,
            expired: {
              ...emptyDateCondition,
              conditionName: 'Expired',
              search: (value: string) => {
                const date = searchDateKey(value)
                return isDateKey(date) && date < todayDateKey()
              },
            },
            notExpired: {
              ...emptyDateCondition,
              conditionName: 'Not Expired',
              search: (value: string) => {
                const date = searchDateKey(value)
                return date === '' || (isDateKey(date) && date >= todayDateKey())
              },
            },
          }
        : undefined

    type SearchBuilderCriteria = {
      classes: {
        input: string
        value: string
      }
    }
    type SearchBuilderValue = {
      0?: HTMLElement
      on: (event: string, listener: () => void) => SearchBuilderValue
      off: (event?: string) => SearchBuilderValue
      remove: () => void
    }
    type SearchBuilderInput = SearchBuilderValue[]
    type SearchBuilderInputCallback = (criteria: SearchBuilderCriteria, input: unknown) => void
    type SearchBuilderCondition = {
      conditionName?: string
      init?: (
        criteria: SearchBuilderCriteria,
        callback: SearchBuilderInputCallback,
        preDefined?: string[] | null
      ) => SearchBuilderValue
      inputValue?: (elements: SearchBuilderInput) => string[]
      isInputValid?: (elements: SearchBuilderInput) => boolean
      search?: (value: string, comparison: string[]) => boolean
      [key: string]: unknown
    }

    const noValueCondition =
      (
        DataTable as typeof DataTable & {
          ext?: {
            searchBuilder?: {
              conditions?: {
                string?: Record<string, SearchBuilderCondition>
              }
            }
          }
        }
      ).ext?.searchBuilder?.conditions?.string?.null ?? emptyDateCondition

    const regionSearchBuilderType = 'region'
    const countryDisplayNames = new Intl.DisplayNames(undefined, { type: 'region' })
    const countryOptions = getRegionCountryCodes(products)
      .map((code) => ({ code, name: countryDisplayNames.of(code) ?? code }))
      .sort((left, right) => left.name.localeCompare(right.name))

    const getCountrySelect = (elements: SearchBuilderInput): HTMLSelectElement | null => {
      const element = elements[0]?.[0]
      return element instanceof HTMLSelectElement ? element : null
    }

    const createCountryCondition = (
      conditionName: string,
      search: (restrictions: RegionRestrictions, countryCode: string) => boolean
    ): SearchBuilderCondition => ({
      conditionName,
      init: (criteria, callback, preDefined = null) => {
        const select = document.createElement('select')
        select.classList.add(criteria.classes.value, criteria.classes.input)
        select.setAttribute('aria-label', 'Country')

        const placeholder = document.createElement('option')
        placeholder.value = ''
        placeholder.textContent = 'Country'
        placeholder.disabled = true
        placeholder.selected = true
        select.append(placeholder)

        for (const { code, name } of countryOptions) {
          const option = document.createElement('option')
          option.value = code
          option.textContent = name === code ? code : `${name} (${code})`
          select.append(option)
        }

        const selectedCountry = preDefined?.[0]?.trim().toUpperCase() ?? ''
        if (
          selectedCountry &&
          !Array.from(select.options).some((option) => option.value === selectedCountry)
        ) {
          const option = document.createElement('option')
          const name = countryDisplayNames.of(selectedCountry) ?? selectedCountry
          option.value = selectedCountry
          option.textContent =
            name === selectedCountry ? selectedCountry : `${name} (${selectedCountry})`
          select.append(option)
        }

        select.value = selectedCountry

        const jquery = DataTable.use('jq') as (element: HTMLElement) => SearchBuilderValue
        const input = jquery(select)
        input.on('change.dtsb', () => callback(criteria, select))
        return input
      },
      inputValue: (elements) => [getCountrySelect(elements)?.value ?? ''],
      isInputValid: (elements) => Boolean(getCountrySelect(elements)?.value),
      search: (value, comparison) => {
        const countryCode = comparison[0]
        return countryCode ? search(parseRegionRestrictions(value), countryCode) : false
      },
    })

    const regionConditions = noValueCondition
      ? {
          regionRestricted: {
            ...noValueCondition,
            conditionName: 'Has restrictions',
            search: (value: string) => hasRegionRestrictions(parseRegionRestrictions(value)),
          },
          regionUnrestricted: {
            ...noValueCondition,
            conditionName: 'No restrictions',
            search: (value: string) => !hasRegionRestrictions(parseRegionRestrictions(value)),
          },
          regionRedeemable: createCountryCondition('Redeemable in', isRegionRedeemableIn),
          regionNotRedeemable: createCountryCondition(
            'Not redeemable in',
            (restrictions, countryCode) => !isRegionRedeemableIn(restrictions, countryCode)
          ),
        }
      : undefined

    const countryNames = (codes: string[]): string =>
      codes
        .map((code) => countryDisplayNames.of(code) ?? code)
        .sort((left, right) => left.localeCompare(right))
        .join(', ')

    const regionHeaderTooltip =
      'The padlock indicates country restrictions reported by Humble and may not exactly reflect Steam activation restrictions for the assigned key.'
    const ownedHeaderTooltip =
      "Relies on the Steam app ID returned by Humble's API and may be inaccurate when keys contain multiple app IDs."
    const redeemedHeaderTooltip =
      'Uses Steam Support app ID data, which may be inaccurate when the key contains multiple app IDs.'
    const redeemedDataCaveat =
      "Uses Steam Support app ID data, which may be inaccurate when the key's package (sub ID) contains multiple app IDs."

    const regionTooltip = (row: Product): string => {
      const exclusive = row.exclusive_countries
      const disallowed = row.disallowed_countries
      const details: string[] = []

      if (exclusive.length) {
        details.push(`Redeemable only in: ${countryNames(exclusive)}.`)
      }
      if (disallowed.length) {
        details.push(`Unavailable in: ${countryNames(disallowed)}.`)
      }
      if (!details.length) details.push('No region restrictions reported by Humble.')

      return details.join('\n')
    }

    const regionPopover = document.createElement('div')
    regionPopover.className = styles.region_tooltip
    regionPopover.role = 'tooltip'
    regionPopover.hidden = true
    document.body.append(regionPopover)

    const regionPopoverShowDelay = 500
    const regionPopoverHideDelay = 120
    let regionPopoverAnchor: HTMLElement | null = null
    let regionPopoverShowTimer: number | null = null
    let regionPopoverHideTimer: number | null = null

    const cancelRegionPopoverShow = (): void => {
      if (regionPopoverShowTimer == null) return
      window.clearTimeout(regionPopoverShowTimer)
      regionPopoverShowTimer = null
    }

    const cancelRegionPopoverHide = (): void => {
      if (regionPopoverHideTimer == null) return
      window.clearTimeout(regionPopoverHideTimer)
      regionPopoverHideTimer = null
    }

    const hideRegionPopover = (force = false): void => {
      cancelRegionPopoverShow()
      cancelRegionPopoverHide()

      if (
        !force &&
        (regionPopoverAnchor?.matches(':hover, :focus') || regionPopover.matches(':hover'))
      ) {
        return
      }

      regionPopover.hidden = true
      regionPopoverAnchor = null
    }

    const scheduleRegionPopoverHide = (): void => {
      cancelRegionPopoverShow()
      cancelRegionPopoverHide()
      regionPopoverHideTimer = window.setTimeout(() => hideRegionPopover(), regionPopoverHideDelay)
    }

    const positionRegionPopover = (anchor: HTMLElement): void => {
      const anchorRect = anchor.getBoundingClientRect()
      const tooltipRect = regionPopover.getBoundingClientRect()
      const margin = 8
      const gap = 6
      const centeredLeft = anchorRect.left + anchorRect.width / 2 - tooltipRect.width / 2
      const left = Math.min(
        Math.max(margin, centeredLeft),
        Math.max(margin, window.innerWidth - tooltipRect.width - margin)
      )
      const below = anchorRect.bottom + gap
      const top =
        below + tooltipRect.height <= window.innerHeight - margin
          ? below
          : Math.max(margin, anchorRect.top - tooltipRect.height - gap)

      regionPopover.style.left = `${Math.round(left)}px`
      regionPopover.style.top = `${Math.round(top)}px`
    }

    const showRegionPopover = (anchor: HTMLElement, text: string): void => {
      cancelRegionPopoverShow()
      cancelRegionPopoverHide()
      regionPopoverAnchor = anchor
      regionPopover.textContent = text
      regionPopover.hidden = false
      positionRegionPopover(anchor)
    }

    const scheduleRegionPopoverShow = (anchor: HTMLElement, text: string): void => {
      cancelRegionPopoverShow()
      cancelRegionPopoverHide()

      if (!regionPopover.hidden) {
        showRegionPopover(anchor, text)
        return
      }

      regionPopoverShowTimer = window.setTimeout(() => {
        regionPopoverShowTimer = null
        if (anchor.matches(':hover')) showRegionPopover(anchor, text)
      }, regionPopoverShowDelay)
    }

    regionPopover.addEventListener('mouseenter', cancelRegionPopoverHide)
    regionPopover.addEventListener('mouseleave', scheduleRegionPopoverHide)

    const closeRegionPopover = (): void => hideRegionPopover(true)
    window.addEventListener('resize', closeRegionPopover)
    window.addEventListener('scroll', closeRegionPopover, true)

    let dt!: Api<Product>

    const pageJumpInput = document.createElement('input')
    pageJumpInput.className = styles.page_jump_input
    pageJumpInput.type = 'text'
    pageJumpInput.inputMode = 'numeric'
    pageJumpInput.pattern = '[0-9]*'
    pageJumpInput.autocomplete = 'off'
    pageJumpInput.enterKeyHint = 'go'
    pageJumpInput.setAttribute('aria-label', 'Jump to page')
    pageJumpInput.title = 'Enter a page number and press Enter'

    const pageJumpTotal = document.createElement('span')
    const pageJump = document.createElement('label')
    pageJump.className = styles.page_jump
    pageJump.append('Jump to', pageJumpInput, 'of', pageJumpTotal)

    let measuredPagingNumberCharacters = 0

    const syncPageJump = (): void => {
      const info = dt.page.info()
      const hasPages = info.pages > 0

      pageJumpInput.disabled = !hasPages
      pageJumpInput.value = hasPages ? String(info.page + 1) : ''
      const pageDigits = Math.max(1, String(info.pages).length)
      const pageNumberCharacters = pageDigits + Math.floor((pageDigits - 1) / 3)

      pageJumpInput.maxLength = pageDigits
      // Include the input padding and borders plus a small buffer for fractional-pixel text metrics.
      pageJumpInput.style.width = `calc(${pageDigits}ch + 1.2em + 4px)`
      pageJumpTotal.textContent = String(info.pages)

      const pageControls = pageJump.parentElement
      if (!pageControls) return

      pageControls.style.setProperty(
        '--hb-paging-number-content-width',
        `${pageNumberCharacters}ch`
      )

      if (pageNumberCharacters === measuredPagingNumberCharacters) return

      // DataTables renders page numbers as buttons and ellipses as spans, which can resolve
      // relative widths differently. Measure a real number button so every slot occupies the same
      // space and the surrounding navigation controls stay fixed while paging.
      pageControls.style.removeProperty('--hb-paging-number-slot-width')
      pageControls.style.removeProperty('--hb-paging-number-slot-margin-left')

      const pageNumberButton = pageControls.querySelector<HTMLElement>(
        '.dt-paging .dt-paging-button:not(.first):not(.previous):not(.next):not(.last)'
      )
      if (!pageNumberButton) return

      const width = pageNumberButton.getBoundingClientRect().width
      if (width <= 0) return

      pageControls.style.setProperty('--hb-paging-number-slot-width', `${width}px`)
      pageControls.style.setProperty(
        '--hb-paging-number-slot-margin-left',
        window.getComputedStyle(pageNumberButton).marginLeft
      )
      measuredPagingNumberCharacters = pageNumberCharacters
    }

    const jumpToPage = (): void => {
      const info = dt.page.info()
      const requestedPage = Number(pageJumpInput.value)

      if (!Number.isInteger(requestedPage) || requestedPage < 1 || info.pages === 0) {
        syncPageJump()
        return
      }

      const page = Math.min(requestedPage, info.pages) - 1
      pageJumpInput.value = String(page + 1)

      if (page !== info.page) dt.page(page).draw('page')
    }

    pageJumpInput.addEventListener('focus', () => pageJumpInput.select())
    pageJumpInput.addEventListener('change', jumpToPage)
    pageJumpInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        jumpToPage()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        syncPageJump()
        pageJumpInput.blur()
      }
    })

    const revealProduct = async (row: Product, gift: boolean): Promise<void> => {
      const keyless = isKeylessProduct(row)
      let keylessConfirmed = false
      let currentProduct: Product | undefined

      try {
        const reference = captureProductReference(products, row)

        if (keyless) {
          keylessConfirmed = await requestKeylessConfirmation(row, gift)
          if (!keylessConfirmed) return
        }

        // A Steam notice can schedule a refresh just before a reveal or while a keyless
        // confirmation is open. Let it finish, then operate on the current product object.
        await waitForProductRefresh()
        const beforeRedeem = latestProducts()
        if (!beforeRedeem) throw new Error('Product data is unavailable. Please try again.')

        currentProduct = resolveProductReference(reference, beforeRedeem)
        if (hasRedeemedKeyValue(currentProduct.redeemed_key_val) || currentProduct.is_gift) return

        if (hasNonRetryableClaim(currentProduct, gift)) {
          showFlashToast(
            'Retry for this operation is disabled until the page is refreshed.',
            'warning'
          )
          return
        }

        const value = await redeem(currentProduct, gift)

        // The table can be rebuilt while Humble is processing the request. Re-resolve the product
        // before mutating/invalidation so we never write to a stale row or destroyed DataTable.
        await waitForProductRefresh()
        const afterRedeem = latestProducts()
        if (!afterRedeem) throw new Error('Product data is unavailable. Please try again.')

        const latestProduct = resolveProductReference(reference, afterRedeem)
        latestProduct.redeemed_key_val = value
        latestProduct.type = gift ? 'Gift' : 'Key'
        latestProduct.is_gift = gift

        currentDt()
          ?.rows((_index, product) => product === latestProduct)
          .invalidate('data')
          .draw(false)

        if (copyToClipboard(serializeRedeemedKeyValue(value))) {
          showFlashToast(
            keyless
              ? 'Redemption result copied to clipboard'
              : gift
                ? 'Link copied to clipboard'
                : 'Key copied to clipboard'
          )
        }
      } catch (error) {
        if (currentProduct && error instanceof RedeemError && error.nonRetryable) {
          markNonRetryableClaim(currentProduct, gift)
          currentDt()
            ?.rows((_index, product) => product === currentProduct)
            .invalidate('data')
            .draw(false)

          const message = error.message || 'Failed to reveal key'
          showFlashToast(
            `${message} Humble marked this attempt non-retryable. Retry for this operation is disabled until the page is refreshed.`,
            'error'
          )
        } else {
          showErrorToast(error)
        }
      } finally {
        if (keylessConfirmed) finishKeylessRedemption()
      }
    }

    setDt(
      () =>
        (dt = new DataTable<Product>(tableRef, {
          pageLength: 10,
          lengthMenu: [
            [10, 25, 50, 100, 500, 1000, 5000, -1],
            [10, 25, 50, 100, 500, '1,000', '5,000', 'All'],
          ],
          language: {
            searchBuilder: {
              data: 'Field',
            },
          },
          columnDefs: [
            {
              targets: [7, 9],
              render: displayDate,
            },
            {
              targets: [11],
              data: null,
              defaultContent: '',
            },
          ],
          order: [[7, 'desc']],
          columns: [
            {
              title: `Type<span class="${styles.header_note}" title="${regionHeaderTooltip}"></span>`,
              data: 'key_type',
              type: 'html-utf8',
              searchBuilder: {
                orthogonal: { display: 'filter' },
              },
              render: (data, type, row) => {
                const value = renderCellValue(data, type)
                if (value !== undefined) return value

                const platformIcon = hm(
                  'i',
                  {
                    class: `hb hb-key hb-${data}`,
                    onclick: () => showFlashToast(JSON.stringify(row, null, 2)),
                  },
                  hm('span', { class: 'hidden', innerText: String(data) })
                )

                if (!hasRegionRestrictions(row)) return platformIcon

                const tooltip = regionTooltip(row)
                return hm('span', { class: styles.platform_icon }, [
                  platformIcon,
                  hm('span', {
                    class: styles.region_lock,
                    tabindex: 0,
                    'aria-label': tooltip,
                    innerText: '🔒',
                    onmouseenter: (event: MouseEvent) =>
                      scheduleRegionPopoverShow(event.currentTarget as HTMLElement, tooltip),
                    onmouseleave: scheduleRegionPopoverHide,
                    onfocus: (event: FocusEvent) =>
                      showRegionPopover(event.currentTarget as HTMLElement, tooltip),
                    onblur: scheduleRegionPopoverHide,
                    onkeydown: (event: KeyboardEvent) => {
                      if (event.key !== 'Escape') return
                      hideRegionPopover(true)
                      ;(event.currentTarget as HTMLElement).blur()
                    },
                  }),
                ]) as unknown as string
              },
              className: styles.platform,
            },
            {
              title: 'Name',
              data: 'human_name',
              type: 'html-utf8',
              render: (data, type, row) => {
                const value = renderCellValue(data, type)
                if (value !== undefined) return value

                return row.steam_app_id
                  ? hm('a', {
                      href: `https://store.steampowered.com/app/${row.steam_app_id}`,
                      target: '_blank',
                      innerText: String(data),
                    })
                  : String(data)
              },
            },
            { title: 'Category', data: 'category', type: 'string-utf8' },
            {
              title: 'Bundle Name',
              data: 'category_human_name',
              type: 'html-utf8',
              render: (data, type, row) => {
                const value = renderCellValue(data, type)
                if (value !== undefined) return value

                return hm('a', {
                  href: `https://www.humblebundle.com/download?key=${row.category_id}`,
                  target: '_blank',
                  innerText: String(data),
                })
              },
            },
            {
              title: 'Format',
              data: 'type',
              type: 'string-utf8',
              render: displayDash,
            },
            {
              title: 'Revealed',
              data: (row: Product) =>
                row.is_gift || hasRedeemedKeyValue(row.redeemed_key_val) ? 'Yes' : 'No',
              type: 'string-utf8',
              render: (data, type) => displayYesNoBadge(data, type, styles.warning_badge),
            },
            {
              title: `Owned<span class="${styles.header_note}" title="${ownedHeaderTooltip}"></span>`,
              data: 'owned',
              type: 'string-utf8',
              render: displayOwned,
            },
            { title: 'Purchased', data: 'created', type: 'date' },
            {
              // ---------------------------------------------------------------
              // "Redeemed" column — Steam Support app-level data
              // ---------------------------------------------------------------
              title: `Redeemed<span class="${styles.header_note}" title="${redeemedHeaderTooltip}"></span>`,
              data: null,
              type: 'date',
              className: 'dt-right',
              render: (_, type, row) => {
                // For SearchBuilder / sorting: emit only the ISO date string so
                // DataTables never sees the display label text.
                if (type !== 'display') {
                  return row.redeemed_date?.iso ?? ''
                }

                // ── Not owned on this Steam account — nothing to show ───────────────────
                if (!row.steam_app_id || row.owned !== 'Yes') return '-'

                // ── Already fetched ─────────────────────────────────────────
                if (row.redeemed_date) {
                  const { label, iso } = row.redeemed_date
                  return hm(
                    'a',
                    {
                      href: steamSupportUrl(row.steam_app_id),
                      target: '_blank',
                      title: 'Open Steam Support page',
                    },
                    [
                      `${label}: `,
                      hm('span', {
                        class: styles.date_time_part,
                        innerText: displayDateOnly(iso),
                      }),
                    ]
                  ) as unknown as string
                }

                // ── Not yet fetched: show a fetch button ────────────────────────────────
                const fetchBtn = hm(
                  'button',
                  {
                    class: styles.btn,
                    type: 'button',
                    title: 'Fetch redeemed date from Steam Support',
                    onclick: async (e: MouseEvent) => {
                      const target = e.currentTarget as HTMLButtonElement
                      target.disabled = true
                      target.innerHTML = '<i class="hb hb-spin hb-spinner"></i>'
                      const appId = row.steam_app_id!
                      const steamIdAtRequest = steamId()
                      try {
                        const result = await fetchRedeemedDate(appId)
                        if (result) {
                          if (steamId() !== steamIdAtRequest) {
                            throw new Error(
                              'Steam account changed while fetching. Please try again.'
                            )
                          }

                          setRedeemedDate(appId, result, steamIdAtRequest)
                          clearSteamSupportNotice(appId)

                          // A product refresh may replace the table while Steam Support is loading.
                          // Wait for it to settle, then update the current product objects/table.
                          await waitForProductRefresh()
                          if (steamId() !== steamIdAtRequest) {
                            throw new Error(
                              'Steam account changed while fetching. Please try again.'
                            )
                          }

                          const currentProducts = latestProducts()
                          if (!currentProducts) {
                            throw new Error('Product data is unavailable. Please try again.')
                          }

                          for (const product of currentProducts) {
                            if (product.steam_app_id === appId) product.redeemed_date = result
                          }

                          currentDt()
                            ?.rows((_idx, product) => product.steam_app_id === appId)
                            .invalidate('data')
                            .draw('page')
                        } else {
                          showSteamSupportNotice(appId)
                          target.disabled = false
                          target.innerHTML = '<i class="hb hb-clock"></i>'
                        }
                      } catch (err) {
                        showSteamSupportNotice(appId)
                        showErrorToast(err, 'Failed to fetch')
                        target.disabled = false
                        target.innerHTML = '<i class="hb hb-clock"></i>'
                      }
                    },
                  },
                  hm('i', { class: 'hb hb-clock' })
                )

                // ── Not yet fetched: show Steam Support link + fetch button ──────────────
                const supportLink = hm(
                  'a',
                  {
                    class: styles.btn,
                    href: steamSupportUrl(row.steam_app_id),
                    target: '_blank',
                    title: 'Open Steam Support page',
                    style: 'margin-right:2px;',
                  },
                  hm('i', { class: 'hb hb-steam' })
                )

                return hm('span', { class: styles.redeemed_actions }, [
                  supportLink,
                  fetchBtn,
                ]) as unknown as string
              },
            },
            {
              title: 'Exp. Date',
              data: 'expiry_date',
              type: 'date',
              ...(expiryDateConditions && { searchBuilderType: expiryDateSearchBuilderType }),
            },
            {
              title: 'Region',
              data: 'exclusive_countries',
              type: 'string-utf8',
              render: (_data, _type, row) => serializeRegionRestrictions(row),
              visible: false,
              orderable: false,
              searchable: false,
              searchBuilder: {
                orthogonal: { display: 'region', search: 'region' },
              },
              ...(regionConditions && { searchBuilderType: regionSearchBuilderType }),
            },
            {
              title: '',
              orderable: false,
              searchable: false,
              data: (row: Product) => {
                const actions = []
                const keyless = isKeylessProduct(row)

                if (hasRedeemedKeyValue(row.redeemed_key_val)) {
                  actions.push(
                    hm(
                      'button',
                      {
                        class: styles.btn,
                        title: 'Copy to clipboard',
                        type: 'button',
                        onclick: () => {
                          if (copyToClipboard(serializeRedeemedKeyValue(row.redeemed_key_val))) {
                            showFlashToast('Copied to clipboard')
                          }
                        },
                      },
                      hm('i', { class: 'hb hb-key hb-clipboard' })
                    )
                  )
                }

                if (
                  typeof row.redeemed_key_val === 'string' &&
                  row.redeemed_key_val &&
                  !row.is_gift &&
                  row.key_type === 'steam'
                ) {
                  actions.push(
                    hm(
                      'a',
                      {
                        class: styles.btn,
                        href: steamRegistrationUrl(row.redeemed_key_val),
                        target: '_blank',
                      },
                      hm('i', { class: 'hb hb-shopping-cart-light', title: 'Redeem' })
                    )
                  )
                }

                if (
                  typeof row.redeemed_key_val === 'string' &&
                  row.redeemed_key_val &&
                  row.is_gift &&
                  !row.is_expired
                ) {
                  actions.push(
                    hm(
                      'a',
                      {
                        class: styles.btn,
                        href: row.redeemed_key_val,
                        target: '_blank',
                      },
                      hm('i', { class: 'hb hb-shopping-cart-light', title: 'Redeem' })
                    )
                  )
                }

                if (!hasRedeemedKeyValue(row.redeemed_key_val) && !row.is_gift) {
                  const revealNonRetryable = hasNonRetryableClaim(row, false)
                  const giftNonRetryable = hasNonRetryableClaim(row, true)
                  const revealTitle = keyless
                    ? row.is_expired
                      ? 'Attempt direct redemption to the linked account (marked expired); no transferable key will be shown'
                      : 'Redeem directly to the linked account; no transferable key will be shown'
                    : row.is_expired
                      ? 'Attempt reveal (marked expired)'
                      : 'Reveal'
                  const giftTitle = keyless
                    ? row.is_expired
                      ? 'Attempt gift-link creation (marked expired); Humble may redeem this directly to the linked account'
                      : 'Create gift link; Humble may redeem this directly to the linked account'
                    : row.is_expired
                      ? 'Attempt gift-link creation (marked expired)'
                      : 'Create gift link'
                  const nonRetryableTitle =
                    'Non-retryable this session; refresh the page to try again'

                  actions.push(
                    hm(
                      'button',
                      {
                        class: styles.btn,
                        type: 'button',
                        disabled: revealNonRetryable,
                        title: revealNonRetryable ? nonRetryableTitle : revealTitle,
                        'aria-label': revealNonRetryable ? nonRetryableTitle : revealTitle,
                        onclick: () => void revealProduct(row, false),
                      },
                      hm('i', {
                        class: keyless ? 'hb hb-link' : 'hb hb-magic',
                        'aria-hidden': 'true',
                      })
                    ),
                    hm(
                      'button',
                      {
                        class: styles.btn,
                        type: 'button',
                        disabled: giftNonRetryable,
                        title: giftNonRetryable ? nonRetryableTitle : giftTitle,
                        'aria-label': giftNonRetryable ? nonRetryableTitle : giftTitle,
                        onclick: () => void revealProduct(row, true),
                      },
                      hm('i', {
                        class: 'hb hb-gift',
                        'aria-hidden': 'true',
                      })
                    )
                  )
                }

                return hm('div', { class: styles.row_actions }, actions)
              },
            },
          ],
          data: products,
          layout: {
            top1: {
              searchBuilder: {
                columns: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
                conditions: {
                  ...(expiryDateConditions && {
                    [expiryDateSearchBuilderType]: expiryDateConditions,
                  }),
                  ...(regionConditions && { [regionSearchBuilderType]: regionConditions }),
                },
              },
            },
            bottomEnd: [pageJump, 'paging'],
          },
          createdRow: function (row, data: Product) {
            if (data.is_expired) {
              row.classList.add(styles.expired)
            }
          },
        }))
    )

    if (initialState) {
      try {
        restoreTableState(dt, initialState)
      } catch (error) {
        showErrorToast(error, 'Failed to restore table filters')
      } finally {
        onStateRestored?.()
      }
    }

    const container = dt.table().container() as HTMLElement
    const tableLayoutCell = container.querySelector<HTMLElement>(
      '.dt-layout-table > .dt-layout-cell'
    )

    let pagingTop: number | null = null
    let pagingRestoreFrame: number | null = null

    const clearPagingHeightReservation = (): void => {
      tableLayoutCell?.style.removeProperty('min-height')
    }

    const cancelPagingRestore = (): void => {
      if (pagingRestoreFrame == null) return

      cancelAnimationFrame(pagingRestoreFrame)
      pagingRestoreFrame = null
    }

    const resetPagingPositionStability = (): void => {
      pagingTop = null
      cancelPagingRestore()
      clearPagingHeightReservation()
    }

    const getPaging = () => container.querySelector<HTMLElement>('.dt-paging')

    const rememberPagingTop = (): void => {
      cancelPagingRestore()

      const rect = getPaging()?.getBoundingClientRect()
      pagingTop = rect && rect.bottom > 0 && rect.top < window.innerHeight ? rect.top : null

      // Each page transition starts from the table's natural height. Any extra height retained from
      // the previous transition is only a fallback for a scroll-boundary shortfall.
      clearPagingHeightReservation()
    }

    const clearPagingHeightReservationForNonPagingDraw = (): void => {
      if (pagingTop != null) return

      cancelPagingRestore()
      clearPagingHeightReservation()
    }

    const restorePagingTop = (): void => {
      if (pagingTop == null) return

      const previousTop = pagingTop
      pagingTop = null

      cancelPagingRestore()
      pagingRestoreFrame = requestAnimationFrame(() => {
        pagingRestoreFrame = null

        const paging = getPaging()
        if (!paging) return

        const nextTop = paging.getBoundingClientRect().top
        const scrollDelta = nextTop - previousTop

        if (Math.abs(scrollDelta) > PAGING_POSITION_TOLERANCE) {
          window.scrollBy({ top: scrollDelta, behavior: 'auto' })
        }

        if (!tableLayoutCell) return

        // Scrolling can be clamped at the top of the document when a shorter page replaces a
        // taller one. Reserve only that uncompensated remainder below the table so the paging
        // controls stay at the same viewport position without constraining any row content.
        const residual = previousTop - paging.getBoundingClientRect().top
        if (residual <= PAGING_POSITION_TOLERANCE) return

        const naturalHeight = tableLayoutCell.getBoundingClientRect().height
        tableLayoutCell.style.minHeight = `${naturalHeight + residual}px`

        // Account for box-model/subpixel differences so the fallback remains exact rather than
        // accumulating a small error across repeated transitions.
        const correction = previousTop - paging.getBoundingClientRect().top
        if (Math.abs(correction) <= PAGING_POSITION_TOLERANCE) return

        const currentMinHeight = Number.parseFloat(tableLayoutCell.style.minHeight)
        if (!Number.isFinite(currentMinHeight)) return

        tableLayoutCell.style.minHeight = `${Math.max(naturalHeight, currentMinHeight + correction)}px`
      })
    }

    syncPageJump()
    dt.on('page', rememberPagingTop)
    dt.on('draw', clearPagingHeightReservationForNonPagingDraw)
    dt.on('draw', restorePagingTop)
    dt.on('draw', syncPageJump)
    // The table can initialize while the exporter is hidden. Re-measure paging geometry when
    // DataTables recalculates its layout after the table becomes visible.
    dt.on('column-sizing', syncPageJump)
    dt.on('draw', closeRegionPopover)
    window.addEventListener('resize', resetPagingPositionStability)

    // Warnings when selecting certain column filters

    const searchBuilderRoot = container.querySelector('.dtsb-searchBuilder') as HTMLElement | null

    type WarningRule = {
      element: HTMLElement
      show: (selectedColumns: string[]) => boolean
    }

    const makeWarning = (text: string): HTMLElement =>
      hm('div', {
        class: 'warning-wrapper',
        innerText: text,
        hidden: true,
      }) as HTMLElement

    const getSelectedColumns = (): string[] =>
      Array.from(
        searchBuilderRoot?.querySelectorAll<HTMLSelectElement>('select.dtsb-data') ?? []
      ).map((select) => select.selectedOptions[0]?.text.trim() ?? '')

    const warnings: WarningRule[] = [
      {
        element: makeWarning(
          '⚠️ "Owned" column: Keys containing multiple app IDs/content can incorrectly appear owned because Humble\'s API does not return package IDs. This column shows a dash when ownership detection is not supported, Humble\'s API does not provide a Steam app ID, or Steam ownership data cannot be loaded.'
        ),
        show: (selectedColumns) => selectedColumns.includes('Owned'),
      },
      {
        element: makeWarning(`⚠️ "Redeemed" column: ${redeemedDataCaveat}`),
        show: (selectedColumns) => selectedColumns.includes('Redeemed'),
      },
      {
        element: makeWarning(
          '⚠️ "Region" uses country restriction data reported by Humble and may not exactly reflect Steam activation restrictions for the assigned key.'
        ),
        show: (selectedColumns) => selectedColumns.includes('Region'),
      },
    ]

    for (const warning of warnings) {
      container.insertAdjacentElement('beforebegin', warning.element)
    }

    const refreshWarnings = (): void => {
      const selectedColumns = getSelectedColumns()

      for (const warning of warnings) {
        warning.element.hidden = !warning.show(selectedColumns)
      }
    }

    const handleSearchBuilderChange = (event: Event): void => {
      refreshWarnings()

      const target = event.target
      if (!(target instanceof HTMLSelectElement) || !target.classList.contains('dtsb-data')) return

      const criterion = target.closest('.dtsb-criteria')
      if (!criterion || !event.isTrusted) return

      // SearchBuilder resets its internal condition/value state when the field changes, but v1.8.2
      // can leave old multi-value controls in the DOM. Run after its handler and remove any stale
      // controls only when the freshly populated condition selector is still at its placeholder.
      queueMicrotask(() => {
        if (!criterion.isConnected) return

        const condition = criterion.querySelector<HTMLSelectElement>('select.dtsb-condition')
        const valueContainer = criterion.querySelector<HTMLElement>('.dtsb-inputCont')
        if (!condition || condition.value !== '' || !valueContainer) return

        const jquery = DataTable.use('jq') as (element: HTMLElement) => SearchBuilderValue
        for (const child of Array.from(valueContainer.children)) {
          jquery(child as HTMLElement).remove()
        }
      })
    }

    refreshWarnings()

    searchBuilderRoot?.addEventListener('change', handleSearchBuilderChange)

    const observer = searchBuilderRoot ? new MutationObserver(refreshWarnings) : null

    if (searchBuilderRoot) {
      observer?.observe(searchBuilderRoot, {
        subtree: true,
        childList: true,
      })
    }

    onCleanup(() => {
      dt.off('page', rememberPagingTop)
      dt.off('draw', clearPagingHeightReservationForNonPagingDraw)
      dt.off('draw', restorePagingTop)
      dt.off('draw', syncPageJump)
      dt.off('column-sizing', syncPageJump)
      dt.off('draw', closeRegionPopover)

      cancelPagingRestore()
      window.removeEventListener('resize', resetPagingPositionStability)
      window.removeEventListener('resize', closeRegionPopover)
      window.removeEventListener('scroll', closeRegionPopover, true)
      regionPopover.removeEventListener('mouseenter', cancelRegionPopoverHide)
      regionPopover.removeEventListener('mouseleave', scheduleRegionPopoverHide)
      cancelRegionPopoverShow()
      cancelRegionPopoverHide()
      regionPopover.remove()

      searchBuilderRoot?.removeEventListener('change', handleSearchBuilderChange)
      observer?.disconnect()
      for (const warning of warnings) warning.element.remove()

      dt.destroy()
      setDt((current) => (current === dt ? null : current))
    })
  })
  console.debug('Table Loaded')
  return <table ref={tableRef} id="hb_extractor-table" class="display compact"></table>
}
