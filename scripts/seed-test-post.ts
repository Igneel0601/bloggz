import { getPayload } from 'payload'
import config from '../src/payload.config'

const t = (text: string, format = 0) => ({
  type: 'text',
  text,
  version: 1,
  format,
  mode: 'normal' as const,
  style: '',
  detail: 0,
})

const para = (children: ReturnType<typeof t>[]) => ({
  type: 'paragraph',
  format: '',
  indent: 0,
  version: 1,
  direction: 'ltr' as const,
  children,
})

const heading = (tag: 'h2' | 'h3', text: string) => ({
  type: 'heading',
  tag,
  format: '',
  indent: 0,
  version: 1,
  direction: 'ltr' as const,
  children: [t(text)],
})

const lexicalContent = {
  root: {
    type: 'root',
    format: '',
    indent: 0,
    version: 1,
    direction: 'ltr' as const,
    children: [
      heading('h2', 'Why I spun up a separate CMS'),
      para([
        t('The portfolio repo was starting to feel like a haunted attic. Sanity studio in one corner, MDX case studies in another, a parallax background slowly devouring CPU cycles in the basement. Every time I wanted to write a short post — a thought, a wonder, a half-baked rant — I had to think about which system it belonged to and whether shipping it would also redeploy six unrelated GSAP scenes.'),
      ]),
      para([
        t('So bloggz exists now. It is a write-only surface. No public site, no marketing pages, no SEO theatre. Just an admin panel where I open a tab, type, and hit save. The portfolio reads from it over the network and renders posts inside its own typography, scenes, and layout. Two repos, one job each.'),
      ]),
      heading('h3', 'What it actually is'),
      para([
        t('Payload v3, Postgres on Neon, Lexical for the body. The admin sits at /admin and that is the only route that matters. Posts are stored as structured JSON — not HTML — so the portfolio gets full control of how a paragraph or a heading looks. The CMS only owns the '),
        t('shape', 1),
        t(' of the content; the rendering layer is downstream.'),
      ]),
      para([
        t('I picked the website template by accident during the wizard and then stripped Pages, Header, Footer, Forms, Redirects, and Search back out. The admin sidebar now shows four collections: Posts, Media, Categories, Users. Quieter, smaller, easier to reason about.'),
      ]),
      heading('h3', 'What I want from this'),
      para([
        t('Low friction. Open laptop, type, publish. No deploys, no PRs, no Git dance for a 200-word thought. If a post turns into something more — a case study, a long essay — it can graduate to MDX in the portfolio repo. Until then, this is the scratch pad.'),
      ]),
    ],
  },
}

const run = async () => {
  const payload = await getPayload({ config })

  const existing = await payload.find({
    collection: 'posts',
    where: { slug: { equals: 'hello-from-local-api' } },
    limit: 1,
  })

  const data = {
    title: 'Why I spun up a separate CMS',
    slug: 'hello-from-local-api',
    _status: 'published' as const,
    publishedAt: new Date().toISOString(),
    content: lexicalContent as never,
  }

  const post = existing.docs.length > 0
    ? await payload.update({ collection: 'posts', id: existing.docs[0].id, data })
    : await payload.create({ collection: 'posts', data })

  console.log('Created post:')
  console.log('  id:', post.id)
  console.log('  title:', post.title)
  console.log('  slug:', post.slug)
  console.log('  status:', (post as { _status?: string })._status)
  process.exit(0)
}

run().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
