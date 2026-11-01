import { defineConfig } from 'vitepress'

const repo = 'https://github.com/lowlysre/setup-filemoverexpress'

export default defineConfig({
  title: 'Setup File Mover Express',
  description:
    "An independent GitHub Action to install and configure AWS Labs' File Mover Express CLI for S3 transfers.",
  base: '/setup-filemoverexpress/',
  cleanUrls: true,
  lastUpdated: true,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/setup-filemoverexpress/logo.svg' }],
    ['meta', { property: 'og:image', content: 'https://lowlysre.github.io/setup-filemoverexpress/social-card.png' }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }]
  ],
  themeConfig: {
    logo: '/logo.svg',
    search: { provider: 'local' },
    nav: [
      { text: 'Tutorial', link: '/tutorials/first-upload' },
      { text: 'How-to guides', link: '/how-to/aws-credentials' },
      { text: 'Reference', link: '/reference/inputs' },
      { text: 'Explanation', link: '/explanation/how-it-works' }
    ],
    sidebar: [
      {
        text: 'Tutorials',
        items: [{ text: 'Your first upload', link: '/tutorials/first-upload' }]
      },
      {
        text: 'How-to guides',
        items: [
          { text: 'Pin a version', link: '/how-to/versions' },
          { text: 'Authenticate with configure-aws-credentials', link: '/how-to/aws-credentials' },
          { text: 'Configure buckets and transfer profiles', link: '/how-to/transfer-profiles' },
          { text: 'Test against S3-compatible endpoints or moto', link: '/how-to/s3-compatible-endpoints' },
          { text: 'Fail the job on transfer errors', link: '/how-to/fail-on-errors' },
          { text: 'Upload and download faster', link: '/how-to/transfers' },
          { text: 'Use self-hosted runners', link: '/how-to/self-hosted-runners' }
        ]
      },
      {
        text: 'Reference',
        items: [
          { text: 'Inputs', link: '/reference/inputs' },
          { text: 'Outputs', link: '/reference/outputs' },
          { text: 'Environment variables', link: '/reference/environment' },
          { text: 'Supported platforms', link: '/reference/platforms' },
          { text: 'CLI behavior in CI', link: '/reference/cli' }
        ]
      },
      {
        text: 'Explanation',
        items: [
          { text: 'How it works', link: '/explanation/how-it-works' },
          { text: 'Security model', link: '/explanation/security' },
          { text: 'Credentials and interop', link: '/explanation/credentials' },
          { text: 'Exit codes', link: '/explanation/exit-codes' },
          { text: 'Caching', link: '/explanation/caching' }
        ]
      }
    ],
    socialLinks: [{ icon: 'github', link: repo }],
    editLink: {
      pattern: `${repo}/edit/main/docs/:path`,
      text: 'Edit this page on GitHub'
    },
    footer: {
      message:
        'Built and maintained by <a href="https://github.com/lowlysre">lowlysre</a>. Not affiliated with or endorsed by AWS. Released under the Apache-2.0 License.',
      copyright: 'Copyright 2026 lowlysre. File Mover Express is a separate open source project from AWS Labs.'
    }
  }
})
