export interface SearchBuilderCriterion {
  condition: string
  data: string
  value: string[]
  [key: string]: unknown
}

export interface SearchBuilderGroup {
  criteria: Array<SearchBuilderCriterion | SearchBuilderGroup>
  logic: 'AND' | 'OR'
  [key: string]: unknown
}

const inverseConditions: Record<string, string> = {
  '!=': '=',
  '!between': 'between',
  '!contains': 'contains',
  '!ends': 'ends',
  '!null': 'null',
  '!starts': 'starts',
  // Table.tsx defines date ">" as on-or-after, making it the exact inverse of "<".
  '<': '>',
  '=': '!=',
  '>': '<',
  between: '!between',
  contains: '!contains',
  ends: '!ends',
  null: '!null',
  starts: '!starts',
}

const isGroup = (value: unknown): value is SearchBuilderGroup =>
  value !== null &&
  typeof value === 'object' &&
  Array.isArray((value as Partial<SearchBuilderGroup>).criteria)

export const hasSearchBuilderCriteria = (
  group: Partial<SearchBuilderGroup> | null | undefined
): group is SearchBuilderGroup =>
  Array.isArray(group?.criteria) &&
  group.criteria.some((criterion) =>
    isGroup(criterion)
      ? hasSearchBuilderCriteria(criterion)
      : typeof criterion.condition === 'string' && criterion.condition.length > 0
  )

export const invertSearchBuilderGroup = (group: SearchBuilderGroup): SearchBuilderGroup => ({
  ...group,
  logic: group.logic === 'AND' ? 'OR' : 'AND',
  criteria: group.criteria.map((criterion) => {
    if (isGroup(criterion)) return invertSearchBuilderGroup(criterion)

    if (!criterion.condition) return { ...criterion }

    const condition = inverseConditions[criterion.condition]
    if (!condition) {
      throw new Error(`The "${criterion.condition}" filter condition cannot be inverted.`)
    }

    return { ...criterion, condition }
  }),
})

export interface SearchBuilderApi<TableApi = unknown> {
  getDetails: (deFormatDates?: boolean) => SearchBuilderGroup
  rebuild: (state?: SearchBuilderGroup, redraw?: boolean) => TableApi
}

export type WithSearchBuilder<TableApi> = TableApi & {
  searchBuilder: SearchBuilderApi<TableApi>
}
