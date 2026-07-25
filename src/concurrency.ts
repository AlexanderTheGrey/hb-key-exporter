export const forEachConcurrent = async <T>(
  items: readonly T[],
  concurrency: number,
  callback: (item: T, index: number) => Promise<void>
): Promise<void> => {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('Concurrency must be a positive integer')
  }

  let nextIndex = 0

  const worker = async (): Promise<void> => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      await callback(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()))
}
