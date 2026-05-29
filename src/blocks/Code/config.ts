import type { Block } from 'payload'

export const Code: Block = {
  slug: 'code',
  interfaceName: 'CodeBlock',
  fields: [
    {
      name: 'language',
      type: 'select',
      defaultValue: 'typescript',
      options: [
        { label: 'TypeScript', value: 'typescript' },
        { label: 'JavaScript', value: 'javascript' },
        { label: 'TSX', value: 'tsx' },
        { label: 'JSX', value: 'jsx' },
        { label: 'Python', value: 'python' },
        { label: 'C++', value: 'cpp' },
        { label: 'C', value: 'c' },
        { label: 'Java', value: 'java' },
        { label: 'Go', value: 'go' },
        { label: 'Rust', value: 'rust' },
        { label: 'Bash', value: 'bash' },
        { label: 'Shell', value: 'shell' },
        { label: 'SQL', value: 'sql' },
        { label: 'JSON', value: 'json' },
        { label: 'YAML', value: 'yaml' },
        { label: 'HTML', value: 'html' },
        { label: 'CSS', value: 'css' },
        { label: 'Markdown', value: 'markdown' },
        { label: 'Plain text', value: 'plaintext' },
      ],
    },
    {
      name: 'code',
      type: 'code',
      label: false,
      required: true,
    },
  ],
}
