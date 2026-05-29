/**
 * publish-draft.ts — convert a Markdown draft to Lexical and write it into
 * Payload via the Local API (NOT raw SQL).
 *
 * Using payload.create/update means Payload manages the `_posts_v` version
 * rows, so the post shows up in the admin AND on the site — unlike a raw
 * INSERT, which produces an admin-invisible "ghost" post.
 *
 * Usage (run from the bloggz repo root):
 *   pnpm publish-draft <file.md> [--dry-run] [--publish]
 *
 *   --dry-run   Parse + convert and print fields/Lexical. No DB writes.
 *   --publish   Create/update as published instead of draft.
 *
 * The Markdown drafts live in the sibling `blogs` repo, so pass a path like:
 *   ../blogs/outsider/posts/2_india-stack-mcp-gap_28-05-26.md
 */

import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import yaml from 'js-yaml'
import { getPayload } from 'payload'
import config from '../src/payload.config'

// ---------------------------------------------------------------------------
// Lexical node factories — same shapes proven in seed-test-post.ts and
// validated against portfolio/components/writing/PostBody.tsx.
// Text format bitmask: bold=1 italic=2 strikethrough=4 underline=8 code=16
// ---------------------------------------------------------------------------
const FMT = { bold: 1, italic: 2, strike: 4, underline: 8, code: 16 }

const text = (value: string, format = 0) => ({
  type: 'text',
  text: value,
  version: 1,
  format,
  mode: 'normal',
  style: '',
  detail: 0,
})

const el = (type: string, children: unknown[], extra: Record<string, unknown> = {}) => ({
  type,
  format: '',
  indent: 0,
  version: 1,
  direction: 'ltr',
  children,
  ...extra,
})

const paragraph = (children: unknown[]) => el('paragraph', children)
const heading = (tag: string, children: unknown[]) => el('heading', children, { tag })
const quote = (children: unknown[]) => el('quote', children)
const listitem = (children: unknown[], value: number) => el('listitem', children, { value })
const list = (listType: 'bullet' | 'number', children: unknown[]) =>
  el('list', children, { listType, start: 1, tag: listType === 'number' ? 'ol' : 'ul' })

// Checklist (listType 'check') — items carry a `checked` boolean.
const checkitem = (children: unknown[], value: number, checked: boolean) =>
  el('listitem', children, { value, checked })
const checklist = (children: unknown[]) =>
  el('list', children, { listType: 'check', start: 1, tag: 'ul' })

// Table nodes — shapes mirror the Payload editor's EXPERIMENTAL_TableFeature.
// A cell wraps its content in a paragraph; headerState 0 = body, 1 = header.
const tablecell = (content: string, isHeader: boolean) => ({
  type: 'tablecell',
  format: '',
  indent: 0,
  colSpan: 1,
  rowSpan: 1,
  version: 1,
  children: [paragraph(parseInline(content))],
  direction: null,
  headerState: isHeader ? 1 : 0,
  backgroundColor: null,
})
const tablerow = (cells: unknown[]) => ({
  type: 'tablerow',
  format: '',
  indent: 0,
  version: 1,
  children: cells,
  direction: null,
})
const table = (rows: unknown[], ncols: number) => ({
  type: 'table',
  format: '',
  indent: 0,
  version: 1,
  children: rows,
  colWidths: Array(ncols).fill(92),
  direction: null,
})

// Standalone image `![alt](url)` -> a placeholder MediaBlock carrying the source
// URL. A later async pass downloads + uploads it to the media collection and
// rewrites `media` to the real id (MediaBlock can't hold a raw URL).
const mediaPlaceholder = (alt: string, url: string) => ({
  type: 'block',
  version: 2,
  format: '',
  fields: {
    id: randomBytes(12).toString('hex'),
    blockName: '',
    blockType: 'mediaBlock',
    media: null as number | null,
    __src: url,
    __alt: alt,
  },
})
// Languages supported by the custom Code block (bloggz/src/blocks/Code/config.ts).
const SUPPORTED_LANGS = new Set([
  'typescript', 'javascript', 'tsx', 'jsx', 'python', 'cpp', 'c', 'java', 'go',
  'rust', 'bash', 'shell', 'sql', 'json', 'yaml', 'html', 'css', 'markdown', 'plaintext',
])
const LANG_ALIASES: Record<string, string> = {
  'c++': 'cpp', py: 'python', sh: 'bash', js: 'javascript', ts: 'typescript',
  yml: 'yaml', md: 'markdown', text: 'plaintext', plain: 'plaintext',
}
const normalizeLang = (l: string) => {
  const x = (l || '').trim().toLowerCase()
  return LANG_ALIASES[x] ?? x
}

// Fenced code -> always the custom Code block. The Payload editor has NO
// standalone `code` node type (parseEditorState throws "type 'code' not
// found"), so we must never emit one. Unknown/missing languages fall back to
// 'plaintext'. Block shape matches editor output: 24-hex id, version 2.
const codeFence = (lang: string, value: string) => {
  const norm = normalizeLang(lang)
  const language = norm && SUPPORTED_LANGS.has(norm) ? norm : 'plaintext'
  return {
    type: 'block',
    version: 2,
    format: '',
    fields: {
      id: randomBytes(12).toString('hex'),
      blockName: '',
      blockType: 'code',
      language,
      code: value,
    },
  }
}

const horizontalrule = () => ({ type: 'horizontalrule', version: 1 })

// GitHub-style admonition keyword -> Banner block `style` (info|warning|error|success).
const ADMONITION: Record<string, string> = {
  NOTE: 'info', INFO: 'info', IMPORTANT: 'info',
  TIP: 'success', SUCCESS: 'success',
  WARNING: 'warning',
  CAUTION: 'error', ERROR: 'error',
}

// Banner block: `> [!WARNING]` admonition. Body becomes the banner's nested
// rich-text content ({ root } tree, like the editor produces).
const banner = (style: string, bodyLines: string[]) => {
  const txt = bodyLines.map((l) => l.trim()).filter(Boolean).join(' ')
  return {
    type: 'block',
    version: 2,
    format: '',
    fields: {
      id: randomBytes(12).toString('hex'),
      blockName: '',
      blockType: 'banner',
      style,
      content: { root: root([paragraph(parseInline(txt))]) },
    },
  }
}
// Link node uses version 3 (matches editor output); plain `el` would emit v1.
// External (http/https) links open in a new tab so source citations don't
// navigate the reader away; internal/relative links stay in the same tab.
const link = (url: string, children: unknown[]) => ({
  type: 'link',
  format: '',
  indent: 0,
  version: 3,
  direction: 'ltr',
  children,
  fields: { url, newTab: /^https?:\/\//.test(url), linkType: 'custom' },
})
const root = (children: unknown[]) => ({
  type: 'root',
  format: '',
  indent: 0,
  version: 1,
  direction: 'ltr',
  children,
})

// ---------------------------------------------------------------------------
// Inline parser — `code`, **bold**, *italic*/_italic_, ~~strike~~, [t](url).
// ---------------------------------------------------------------------------
function parseInline(str: string, base = 0): unknown[] {
  if (!str) return []
  const patterns = [
    { re: /`([^`]+)`/, kind: 'code' },
    { re: /\[([^\]]+)\]\(([^)]+)\)/, kind: 'link' },
    { re: /\*\*([^*]+)\*\*/, kind: 'bold' },
    { re: /__([^_]+)__/, kind: 'bold' },
    { re: /~~([^~]+)~~/, kind: 'strike' },
    { re: /\*([^*]+)\*/, kind: 'italic' },
    { re: /_([^_]+)_/, kind: 'italic' },
  ]
  let best: { re: RegExp; kind: string; m: RegExpExecArray } | null = null
  for (const p of patterns) {
    const m = p.re.exec(str)
    if (m && (best === null || m.index < best.m.index)) best = { ...p, m }
  }
  if (!best) return [text(str, base)]

  const { m, kind } = best
  const before = str.slice(0, m.index)
  const after = str.slice(m.index + m[0].length)
  const out: unknown[] = []
  if (before) out.push(text(before, base))

  if (kind === 'code') out.push(text(m[1], base | FMT.code))
  else if (kind === 'link') out.push(link(m[2], parseInline(m[1], base)))
  else if (kind === 'bold') out.push(...parseInline(m[1], base | FMT.bold))
  else if (kind === 'italic') out.push(...parseInline(m[1], base | FMT.italic))
  else if (kind === 'strike') out.push(...parseInline(m[1], base | FMT.strike))

  out.push(...parseInline(after, base))
  return out
}

// ---------------------------------------------------------------------------
// Block parser — Markdown body -> Lexical block nodes.
// ---------------------------------------------------------------------------
function markdownToLexical(md: string) {
  const lines = md.replace(/\r\n/g, '\n').split('\n')
  const blocks: unknown[] = []
  let i = 0
  const isBlank = (s: string) => s.trim() === ''
  const HR = /^(-{3,}|\*{3,}|_{3,})\s*$/
  const HEADING = /^(#{1,6})\s+(.*)$/
  const FENCE = /^```(.*)$/
  const QUOTE = /^>\s?(.*)$/
  const CHECK = /^[-*+]\s+\[([ xX])\]\s+(.*)$/
  const ULIST = /^[-*+]\s+(.*)$/
  const OLIST = /^\d+\.\s+(.*)$/
  const TROW = /^\|(.+)\|\s*$/
  const TSEP = /^\|[\s:|-]+\|\s*$/
  const IMAGE = /^!\[([^\]]*)\]\(([^)]+)\)\s*$/
  const splitCells = (r: string) =>
    r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim())

  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) { i++; continue }

    const fence = FENCE.exec(line)
    if (fence) {
      const lang = fence[1]
      i++
      const buf: string[] = []
      while (i < lines.length && !FENCE.test(lines[i])) { buf.push(lines[i]); i++ }
      i++
      blocks.push(codeFence(lang, buf.join('\n')))
      continue
    }
    if (HR.test(line)) { blocks.push(horizontalrule()); i++; continue }

    // standalone image -> media placeholder (resolved to a real upload later)
    const img = IMAGE.exec(line)
    if (img) { blocks.push(mediaPlaceholder(img[1], img[2])); i++; continue }
    const h = HEADING.exec(line)
    if (h) {
      const level = Math.min(h[1].length, 4)
      blocks.push(heading(`h${level}`, parseInline(h[2].trim())))
      i++
      continue
    }
    if (QUOTE.test(line)) {
      const buf: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) { buf.push(QUOTE.exec(lines[i])![1]); i++ }
      // `> [!WARNING]` GitHub-style admonition -> Banner block
      const adm = /^\[!(\w+)\]\s*(.*)$/.exec((buf[0] ?? '').trim())
      if (adm && ADMONITION[adm[1].toUpperCase()]) {
        blocks.push(banner(ADMONITION[adm[1].toUpperCase()], [adm[2], ...buf.slice(1)]))
        continue
      }
      blocks.push(quote(parseInline(buf.join(' ').trim())))
      continue
    }

    // table: a `| ... |` line immediately followed by a `|---|` separator
    if (TROW.test(line) && i + 1 < lines.length && TSEP.test(lines[i + 1])) {
      const headerCells = splitCells(line)
      i += 2 // consume header + separator
      const rows: unknown[] = [tablerow(headerCells.map((c) => tablecell(c, true)))]
      while (i < lines.length && TROW.test(lines[i]) && !TSEP.test(lines[i])) {
        rows.push(tablerow(splitCells(lines[i]).map((c) => tablecell(c, false))))
        i++
      }
      blocks.push(table(rows, headerCells.length))
      continue
    }

    // checklist: `- [ ]` / `- [x]` (must come before the plain list check)
    if (CHECK.test(line)) {
      const items: unknown[] = []
      while (i < lines.length && CHECK.test(lines[i])) {
        const m = CHECK.exec(lines[i])!
        items.push(checkitem(parseInline(m[2].trim()), items.length + 1, m[1].toLowerCase() === 'x'))
        i++
      }
      blocks.push(checklist(items))
      continue
    }

    if (ULIST.test(line) || OLIST.test(line)) {
      const ordered = OLIST.test(line)
      const items: unknown[] = []
      while (i < lines.length && (ULIST.test(lines[i]) || OLIST.test(lines[i]))) {
        const m = (ordered ? OLIST : ULIST).exec(lines[i]) || ULIST.exec(lines[i]) || OLIST.exec(lines[i])
        items.push(listitem(parseInline(m![1].trim()), items.length + 1))
        i++
      }
      blocks.push(list(ordered ? 'number' : 'bullet', items))
      continue
    }
    const buf: string[] = []
    while (
      i < lines.length && !isBlank(lines[i]) && !HR.test(lines[i]) && !HEADING.test(lines[i]) &&
      !FENCE.test(lines[i]) && !QUOTE.test(lines[i]) && !ULIST.test(lines[i]) && !OLIST.test(lines[i]) &&
      !TROW.test(lines[i]) && !IMAGE.test(lines[i])
    ) { buf.push(lines[i]); i++ }
    blocks.push(paragraph(parseInline(buf.join(' ').trim())))
  }
  return root(blocks)
}

// ---------------------------------------------------------------------------
function parseFrontmatter(raw: string): { fm: Record<string, unknown>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(raw)
  if (!m) return { fm: {}, body: raw }
  return { fm: (yaml.load(m[1]) as Record<string, unknown>) || {}, body: m[2] }
}

const slugify = (s: string) =>
  String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// Download an image URL and upload it into the media collection; returns its id.
async function uploadImage(
  payload: Awaited<ReturnType<typeof getPayload>>,
  url: string,
  alt: string,
): Promise<number> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch ${res.status}`)
  const ct = (res.headers.get('content-type') || '').split(';')[0]
  if (!ct.startsWith('image/')) throw new Error(`not an image (${ct || 'unknown'})`)
  const buf = Buffer.from(await res.arrayBuffer())
  const ext = ct.split('/')[1] || 'png'
  const name = `${slugify(alt) || 'image'}-${Date.now()}.${ext}`
  const created = await payload.create({
    collection: 'media',
    data: { alt: alt || name },
    file: { data: buf, mimetype: ct, name, size: buf.length },
  })
  return created.id as number
}

// Walk the tree; replace each media placeholder with a real MediaBlock (after
// uploading), or fall back to a link if the image can't be fetched. Returns the
// (possibly replaced) node so callers can swap it in.
async function resolveNode(
  node: any,
  payload: Awaited<ReturnType<typeof getPayload>>,
): Promise<any> {
  if (node?.type === 'block' && node.fields?.blockType === 'mediaBlock' && node.fields.__src) {
    const src: string = node.fields.__src
    const alt: string = node.fields.__alt || ''
    try {
      const mediaId = await uploadImage(payload, src, alt)
      return {
        type: 'block',
        version: 2,
        format: '',
        fields: { id: node.fields.id, blockName: '', blockType: 'mediaBlock', media: mediaId },
      }
    } catch (e) {
      console.warn(`  image skipped (${(e as Error).message}), linking instead: ${src}`)
      return paragraph([link(src, [text(alt || src)])])
    }
  }
  if (Array.isArray(node?.children)) {
    const out = []
    for (const c of node.children) out.push(await resolveNode(c, payload))
    node.children = out
  }
  if (node?.fields?.content?.root) {
    node.fields.content.root = await resolveNode(node.fields.content.root, payload)
  }
  return node
}

// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const publish = args.includes('--publish')
  const file = args.find((a) => !a.startsWith('--'))
  if (!file) {
    console.error('Usage: pnpm publish-draft <file.md> [--dry-run] [--publish]')
    process.exit(1)
  }

  const raw = fs.readFileSync(path.resolve(file), 'utf8')
  const { fm, body } = parseFrontmatter(raw)
  const title = fm.title as string
  const slug = (fm.slug as string) || slugify(title || path.basename(file, '.md'))
  const description = (fm.description as string) ?? undefined
  const dropCap = fm.drop_cap === true
  const willPublish = publish // routine always drafts; --publish overrides
  const category = typeof fm.category === 'string' ? fm.category.trim() : ''
  const publishedAt = fm.date ? new Date(String(fm.date)).toISOString() : undefined
  const content = { root: markdownToLexical(body.trim()) }

  if (!title) { console.error('ERROR: frontmatter is missing `title`.'); process.exit(1) }

  if (dryRun) {
    console.log('=== FIELD MAPPING (dry-run, no DB) ===')
    console.log({ title, slug, description, dropCap, _status: willPublish ? 'published' : 'draft', category, publishedAt })
    console.log('\n=== LEXICAL ===')
    console.log(JSON.stringify(content, null, 2))
    console.log(`\n(${content.root.children.length} top-level blocks)`)
    return
  }

  const payload = await getPayload({ config })

  // resolve image placeholders: download each ![](url) and upload to media
  content.root = await resolveNode(content.root, payload)

  // category (find-or-create) -> single id
  const categoryIds: number[] = []
  if (category) {
    const catSlug = slugify(category)
    const found = await payload.find({
      collection: 'categories',
      where: { slug: { equals: catSlug } },
      limit: 1,
    })
    if (found.docs.length) categoryIds.push(found.docs[0].id as number)
    else {
      const created = await payload.create({
        collection: 'categories',
        data: { title: category, slug: catSlug },
      })
      categoryIds.push(created.id as number)
    }
  }

  const data: Record<string, unknown> = {
    title,
    slug,
    content,
    dropCap,
    categories: categoryIds,
    // set meta.title explicitly so Payload's SEO plugin doesn't auto-generate a
    // doubled "Title Title"
    meta: { title, description },
    _status: willPublish ? 'published' : 'draft',
    ...(publishedAt ? { publishedAt } : {}),
  }

  const existing = await payload.find({
    collection: 'posts',
    where: { slug: { equals: slug } },
    limit: 1,
    draft: true,
  })

  let result
  if (existing.docs.length) {
    result = await payload.update({
      collection: 'posts',
      id: existing.docs[0].id,
      data,
      draft: !willPublish,
    })
    console.log(`Updated post id=${result.id} (slug=${slug})`)
  } else {
    result = await payload.create({
      collection: 'posts',
      data,
      draft: !willPublish,
    })
    console.log(`Created post id=${result.id} (slug=${slug})`)
  }
  console.log(`_status=${willPublish ? 'published' : 'draft'}, ${categoryIds.length} categories.`)
  process.exit(0)
}

main().catch((err) => {
  console.error('publish-draft failed:', err)
  process.exit(1)
})
