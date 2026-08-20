export function Refresh({ refresh }: { refresh: () => void | Promise<void> }) {
  return (
    <button type="button" onClick={() => void refresh()} title="Reload products">
      <i class="hb hb-refresh"></i>
    </button>
  )
}
