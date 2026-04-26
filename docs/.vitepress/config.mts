import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

const guideConcepts = [
  { text: 'Overview', link: '/guide/concepts/' },
  { text: 'Terminology', link: '/guide/concepts/terminology' },
  { text: 'Inference rules', link: '/guide/concepts/inference' },
  { text: 'Consumption views', link: '/guide/concepts/consumption-views' },
  {
    text: 'Change history and pipeline replication',
    link: '/guide/concepts/change-tracking-and-pipeline',
  },
]

const guideSources = [
  { text: 'Overview', link: '/guide/sources/' },
  { text: 'OData V2 / V4', link: '/guide/sources/odata' },
  { text: 'REST', link: '/guide/sources/rest' },
  { text: 'CQN', link: '/guide/sources/cqn' },
  { text: 'Custom source adapter', link: '/guide/sources/custom' },
]

const guideTargets = [
  { text: 'Overview', link: '/guide/targets/' },
  { text: 'Local DB', link: '/guide/targets/db' },
  { text: 'OData', link: '/guide/targets/odata' },
  { text: 'Custom target adapter', link: '/guide/targets/custom' },
]

const guideRecipes = [
  { text: 'Overview', link: '/guide/recipes/' },
  { text: 'Built-in replicate', link: '/guide/recipes/built-in-replicate' },
  { text: 'Built-in materialize', link: '/guide/recipes/built-in-materialize' },
  { text: 'Multi-source fan-in', link: '/guide/recipes/multi-source' },
  {
    text: 'Custom source adapter',
    link: '/guide/recipes/custom-source-adapter',
  },
  {
    text: 'Custom target adapter',
    link: '/guide/recipes/custom-target-adapter',
  },
  { text: 'Event hooks', link: '/guide/recipes/event-hooks' },
  {
    text: 'External scheduling (JSS)',
    link: '/guide/recipes/external-scheduling-jss',
  },
  {
    text: 'Internal scheduling (queued)',
    link: '/guide/recipes/internal-scheduling-queued',
  },
]

// https://vitepress.dev/reference/site-config
export default withMermaid(
  defineConfig({
    title: 'cds-data-pipeline',
    description:
      'CAP application-layer data pipeline engine — scheduled READ → MAP → WRITE between services, with tracker, retry, management API, and event hooks.',
    base: '/cds-data-pipeline/',
    lastUpdated: true,

    mermaid: {},

    markdown: {
      lineNumbers: true,
      languageAlias: {
        cds: 'typescript',
      },
      languageLabel: {
        cds: 'CDS',
      },
    },

    themeConfig: {
      search: {
        provider: 'local',
      },

      editLink: {
        pattern:
          'https://github.com/mikezaschka/cds-data-pipeline/edit/main/docs/:path',
        text: 'Edit this page on GitHub',
      },

      socialLinks: [
        {
          icon: 'github',
          link: 'https://github.com/mikezaschka/cds-data-pipeline',
        },
        { icon: 'npm', link: 'https://www.npmjs.com/package/cds-data-pipeline' },
      ],

      nav: [
        { text: 'Home', link: '/' },
        {
          text: 'Guide',
          link: '/guide/introduction',
          activeMatch: '^/guide/',
        },
        {
          text: 'Reference',
          link: '/reference/features',
          activeMatch: '^/reference/',
        },
      ],

      sidebar: {
        '/guide/': [
          {
            text: 'Getting started',
            collapsed: false,
            items: [
              { text: 'Introduction', link: '/guide/introduction' },
              { text: 'Get started', link: '/guide/get-started' },
            ],
          },
          {
            text: 'Concepts',
            collapsed: true,
            items: guideConcepts,
          },
          {
            text: 'Sources',
            collapsed: true,
            items: guideSources,
          },
          {
            text: 'Targets',
            collapsed: true,
            items: guideTargets,
          },
          {
            text: 'Recipes',
            collapsed: true,
            items: guideRecipes,
          },
        ],
        '/reference/': [
          { text: 'Features', link: '/reference/features' },
          { text: 'Management Service', link: '/reference/management-service' },
        ],
      },

      footer: {
        message: 'Released under the MIT License.',
        copyright: 'Copyright © Mike Zaschka',
      },
    },
  }),
)
