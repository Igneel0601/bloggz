import type { CollectionAfterChangeHook } from 'payload'

// When a post is published (the admin "Publish" button, or publish-draft
// --publish), ping the portfolio's on-demand revalidate endpoint so the new
// post shows on the next visit instead of waiting for ISR.
//
// Only fires for published docs — draft autosaves (status: draft) are ignored,
// so editing doesn't spam the endpoint. Needs PORTFOLIO_REVALIDATE_URL and
// REVALIDATE_SECRET (the latter must match portfolio's value).
export const revalidatePortfolio: CollectionAfterChangeHook = async ({ doc, req }) => {
  const url = process.env.PORTFOLIO_REVALIDATE_URL
  const secret = process.env.REVALIDATE_SECRET
  if (!url || !secret) return doc
  if ((doc as { _status?: string })._status !== 'published') return doc

  const slug = (doc as { slug?: string }).slug ?? ''
  const endpoint = `${url}?secret=${encodeURIComponent(secret)}&slug=${encodeURIComponent(slug)}`
  try {
    const res = await fetch(endpoint, { method: 'POST' })
    if (res.ok) req.payload.logger.info(`revalidated portfolio for /writing/${slug}`)
    else req.payload.logger.error(`portfolio revalidate returned ${res.status}`)
  } catch (e) {
    req.payload.logger.error(`portfolio revalidate failed: ${(e as Error).message}`)
  }
  return doc
}
