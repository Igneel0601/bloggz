import type { CollectionConfig } from 'payload'

import {
  FixedToolbarFeature,
  InlineToolbarFeature,
  lexicalEditor,
} from '@payloadcms/richtext-lexical'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'node:fs/promises'

import { anyone } from '../access/anyone'
import { authenticated } from '../access/authenticated'
import { syncMediaBlob } from '../utilities/mediaBlob'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)
const staticDir = path.resolve(dirname, '../../public/media')

export const Media: CollectionConfig = {
  slug: 'media',
  folders: true,
  access: {
    create: authenticated,
    delete: authenticated,
    read: anyone,
    update: authenticated,
  },
  hooks: {
    // After every upload, copy bytes from disk into the `media_blob` table
    // so the portfolio's /api/bloggz-media route can serve them without
    // Bloggz running. The local disk file remains as the source of truth
    // during the Bloggz dev session.
    afterChange: [
      async ({ doc }) => {
        if (!doc?.filename) return doc
        try {
          const data = await fs.readFile(path.join(staticDir, doc.filename))
          await syncMediaBlob(doc.filename, data, doc.mimeType ?? 'application/octet-stream')
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
            console.error('[media_blob] sync failed', doc.filename, err)
          }
        }
        return doc
      },
    ],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      //required: true,
    },
    {
      name: 'caption',
      type: 'richText',
      editor: lexicalEditor({
        features: ({ rootFeatures }) => {
          return [...rootFeatures, FixedToolbarFeature(), InlineToolbarFeature()]
        },
      }),
    },
  ],
  upload: {
    // Upload to the public/media directory in Next.js making them publicly accessible even outside of Payload
    staticDir,
    adminThumbnail: 'thumbnail',
    focalPoint: true,
    imageSizes: [
      {
        name: 'thumbnail',
        width: 300,
      },
      {
        name: 'square',
        width: 500,
        height: 500,
      },
      {
        name: 'small',
        width: 600,
      },
      {
        name: 'medium',
        width: 900,
      },
      {
        name: 'large',
        width: 1400,
      },
      {
        name: 'xlarge',
        width: 1920,
      },
      {
        name: 'og',
        width: 1200,
        height: 630,
        crop: 'center',
      },
    ],
  },
}
