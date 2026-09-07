import { createEffect, onCleanup, onMount, type Accessor } from 'solid-js'

const TABBABLE_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  '[contenteditable="true"]',
  '[tabindex]',
].join(',')

const activeDialogs = new Set<HTMLElement>()
let modalSessionRestoreTarget: HTMLElement | null = null

const isRendered = (element: HTMLElement): boolean => {
  if (element.hidden || element.closest('[hidden]') || !element.getClientRects().length)
    return false

  const style = getComputedStyle(element)
  return style.visibility !== 'hidden' && style.visibility !== 'collapse'
}

const isAvailable = (element: HTMLElement): boolean =>
  !element.matches(':disabled') && !element.closest('[inert]')

const isTabbable = (element: HTMLElement): boolean =>
  element.tabIndex >= 0 && isAvailable(element) && isRendered(element)

const getTabbableElements = (dialog: HTMLElement): HTMLElement[] =>
  Array.from(dialog.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter(isTabbable)

const focusDialog = (dialog: HTMLElement): void => {
  const active = document.activeElement
  if (active instanceof HTMLElement && dialog.contains(active)) return

  const autofocus = dialog.querySelector<HTMLElement>('[autofocus]')
  if (autofocus && isTabbable(autofocus)) autofocus.focus()
  if (!dialog.contains(document.activeElement)) dialog.focus()
}

const canRestoreFocus = (target: HTMLElement): boolean =>
  target.isConnected && isAvailable(target) && isRendered(target)

const isInsideActiveDialog = (target: HTMLElement): boolean =>
  Array.from(activeDialogs).some((dialog) => dialog.contains(target))

export const useModalBehavior = ({
  dialog,
  onEscape,
  escapeDisabled,
}: {
  dialog: Accessor<HTMLElement | undefined>
  onEscape: () => void
  escapeDisabled?: Accessor<boolean>
}) => {
  const restoreFocusTarget =
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  let mountedDialog: HTMLElement | null = null
  let participatedInModalSession = false

  const handleKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation()

    if (event.key === 'Escape') {
      event.preventDefault()
      if (!escapeDisabled?.()) onEscape()
      return
    }

    if (event.key !== 'Tab') return

    const currentDialog = dialog()
    if (!currentDialog) return

    const tabbable = getTabbableElements(currentDialog)
    if (!tabbable.length) {
      event.preventDefault()
      currentDialog.focus()
      return
    }

    const first = tabbable[0]
    const last = tabbable[tabbable.length - 1]
    const active = document.activeElement
    const activeIndex = active instanceof HTMLElement ? tabbable.indexOf(active) : -1

    if (active === currentDialog || activeIndex === -1) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    } else if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const stopPropagation = (event: Event): void => event.stopPropagation()

  onMount(() => {
    mountedDialog = dialog() ?? null
    if (!mountedDialog) return

    if (!activeDialogs.size && !modalSessionRestoreTarget) {
      modalSessionRestoreTarget = restoreFocusTarget
    }

    activeDialogs.add(mountedDialog)
    participatedInModalSession = true
    const currentDialog = mountedDialog
    queueMicrotask(() => focusDialog(currentDialog))
  })

  onCleanup(() => {
    if (mountedDialog) {
      activeDialogs.delete(mountedDialog)
      mountedDialog = null
    }

    if (!participatedInModalSession) return
    requestAnimationFrame(() => {
      if (activeDialogs.size) {
        if (
          restoreFocusTarget &&
          canRestoreFocus(restoreFocusTarget) &&
          isInsideActiveDialog(restoreFocusTarget)
        ) {
          restoreFocusTarget.focus({ preventScroll: true })
          return
        }

        const active = document.activeElement
        if (!(active instanceof HTMLElement) || !isInsideActiveDialog(active)) {
          const fallbackDialog = Array.from(activeDialogs).pop()
          if (fallbackDialog) focusDialog(fallbackDialog)
        }
        return
      }

      const sessionTarget = modalSessionRestoreTarget
      modalSessionRestoreTarget = null
      if (sessionTarget && canRestoreFocus(sessionTarget)) {
        sessionTarget.focus({ preventScroll: true })
      }
    })
  })

  if (escapeDisabled) {
    createEffect(() => {
      if (!escapeDisabled()) return

      queueMicrotask(() => {
        const currentDialog = dialog()
        if (!currentDialog) return

        const active = document.activeElement
        if (
          !(active instanceof HTMLElement) ||
          !currentDialog.contains(active) ||
          (active !== currentDialog && !isTabbable(active))
        ) {
          currentDialog.focus()
        }
      })
    })
  }

  return { handleKeyDown, stopPropagation }
}
