import type { CollectionAfterChangeHook, CollectionAfterDeleteHook } from 'payload'

// Ping the portfolio's on-demand revalidate endpoint so /writing reflects the
// change on the next visit (instead of waiting for ISR). Needs
// PORTFOLIO_REVALIDATE_URL + REVALIDATE_SECRET (the latter must match
// portfolio's value); a domain change is just an env edit.
async function ping(slug: string, logger: { info: (m: string) => void; error: (m: string) => void }) {
  const url = process.env.PORTFOLIO_REVALIDATE_URL
  const secret = process.env.REVALIDATE_SECRET
  if (!url || !secret) return
  try {
    const endpoint = `${url}?secret=${encodeURIComponent(secret)}&slug=${encodeURIComponent(slug)}`
    const res = await fetch(endpoint, { method: 'POST' })
    if (res.ok) logger.info(`revalidated portfolio for /writing/${slug || '(index)'}`)
    else logger.error(`portfolio revalidate returned ${res.status}`)
  } catch (e) {
    logger.error(`portfolio revalidate failed: ${(e as Error).message}`)
  }
}

// On publish, on edits to a published post, AND on unpublish. The `previousDoc`
// check catches unpublish (published -> draft): the post must drop off /writing,
// so we revalidate when it IS or WAS published. Pure draft churn (never
// published) is skipped, so editing a fresh draft doesn't spam the endpoint.
export const revalidatePortfolio: CollectionAfterChangeHook = async ({ doc, previousDoc, req }) => {
  const isPub = (doc as { _status?: string })._status === 'published'
  const wasPub = (previousDoc as { _status?: string } | undefined)?._status === 'published'
  if (isPub || wasPub) {
    await ping((doc as { slug?: string }).slug ?? '', req.payload.logger)
  }
  return doc
}

// On delete — always revalidate so a removed post drops off /writing (and its
// own page 404s) without waiting for the ISR window.
export const revalidatePortfolioOnDelete: CollectionAfterDeleteHook = async ({ doc, req }) => {
  await ping((doc as { slug?: string })?.slug ?? '', req.payload.logger)
  return doc
}
