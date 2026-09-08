import type { Product } from './util'

export type ProductReference = {
  key: string
  occurrence: number
}

const getProductReferenceKey = (product: Product): string =>
  JSON.stringify([product.category_id, product.machine_name, product.keyindex ?? null])

const groupProductsByReferenceKey = (products: readonly Product[]): Map<string, Product[]> => {
  const groups = new Map<string, Product[]>()

  for (const product of products) {
    const key = getProductReferenceKey(product)
    const group = groups.get(key)
    if (group) group.push(product)
    else groups.set(key, [product])
  }

  return groups
}

export const captureProductReferences = (
  allProducts: readonly Product[],
  selectedProducts: readonly Product[]
): ProductReference[] => {
  const groups = groupProductsByReferenceKey(allProducts)

  return selectedProducts.map((product) => {
    const key = getProductReferenceKey(product)
    const group = groups.get(key)
    if (!group?.length) {
      throw new Error('Product data changed before the operation could start. Please try again.')
    }

    const occurrence = group.indexOf(product)
    if (occurrence >= 0) return { key, occurrence }
    if (group.length === 1) return { key, occurrence: 0 }

    throw new Error('Product data changed before the operation could start. Please try again.')
  })
}

export const captureProductReference = (
  allProducts: readonly Product[],
  product: Product
): ProductReference => captureProductReferences(allProducts, [product])[0]

export const resolveProductReferences = (
  references: readonly ProductReference[],
  products: readonly Product[]
): Product[] => {
  const groups = groupProductsByReferenceKey(products)

  return references.map(({ key, occurrence }) => {
    const product = groups.get(key)?.[occurrence]
    if (!product) {
      throw new Error('Product data changed while the operation was in progress. Please try again.')
    }
    return product
  })
}

export const resolveProductReference = (
  reference: ProductReference,
  products: readonly Product[]
): Product => resolveProductReferences([reference], products)[0]

export const applyRedeemedProductState = (target: Product, source: Product): void => {
  target.redeemed_key_val = source.redeemed_key_val
  target.type = source.type
  target.is_gift = source.is_gift
}
