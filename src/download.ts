const padTimestampPart = (value: number): string => String(value).padStart(2, '0')

export const formatLocalTimestamp = (date: Date): string =>
  [
    date.getFullYear(),
    padTimestampPart(date.getMonth() + 1),
    padTimestampPart(date.getDate()),
  ].join('') +
  '-' +
  [
    padTimestampPart(date.getHours()),
    padTimestampPart(date.getMinutes()),
    padTimestampPart(date.getSeconds()),
  ].join('')

export const downloadTextFile = (
  text: string,
  filename: string,
  mimeType = 'text/plain;charset=utf-8'
): void => {
  let url: string | null = null

  try {
    url = URL.createObjectURL(new Blob([text], { type: mimeType }))

    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.style.display = 'none'
    document.body.append(link)

    try {
      link.click()
    } finally {
      link.remove()
    }

    const objectUrl = url
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
    url = null
  } catch (error) {
    if (url) URL.revokeObjectURL(url)
    throw error
  }
}
