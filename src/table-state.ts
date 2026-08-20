import type { Api, SearchInput } from 'datatables.net-dt'
import type { Product } from './util'
import type { SearchBuilderGroup, WithSearchBuilder } from './table-filter'

export interface TableState {
  searchBuilder: SearchBuilderGroup
  globalSearch: SearchInput<Product>
  columnSearches: string[]
  order: Array<[number, 'asc' | 'desc']>
  pageLength: number
  page: number
}

export const captureTableState = (dt: Api<Product>): TableState => ({
  searchBuilder: (dt as WithSearchBuilder<Api<Product>>).searchBuilder.getDetails(true),
  globalSearch: dt.search(),
  columnSearches: dt.columns().search().toArray().map(String),
  order: dt.order() as Array<[number, 'asc' | 'desc']>,
  pageLength: dt.page.len(),
  page: dt.page(),
})

export const restoreTableState = (dt: Api<Product>, state: TableState): void => {
  const searchBuilder = (dt as WithSearchBuilder<Api<Product>>).searchBuilder
  searchBuilder.rebuild(state.searchBuilder, false)
  dt.search(state.globalSearch)
  state.columnSearches.forEach((search, index) => dt.column(index).search(search))
  dt.order(state.order)
  dt.page.len(state.pageLength)
  dt.draw(false)

  const lastPage = Math.max(0, dt.page.info().pages - 1)
  dt.page(Math.min(state.page, lastPage)).draw('page')
}
