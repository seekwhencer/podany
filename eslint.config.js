// eslint.config.js — Podany frontend lint.
// Phase-0-Guardrail: verbietet globale document.*-Selector-Lookups außerhalb von dom.js.
// Konzept: QUERYSELECTOR_REPLACE.md
export default [
  {
    ignores: [
      'public/dist/**',
      'node_modules/**',
      '**/*.test.js',   // Tests mock document strukturell; hier nicht prüfen
    ],
  },
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.object.name="document"][callee.property.name="querySelector"]',
          message: 'Verboten: captured element references oder Registry statt document.querySelector (QUERYSELECTOR_REPLACE.md).',
        },
        {
          selector: 'CallExpression[callee.object.name="document"][callee.property.name="querySelectorAll"]',
          message: 'Verboten: captured element references oder Registry statt document.querySelectorAll (QUERYSELECTOR_REPLACE.md).',
        },
        {
          selector: 'CallExpression[callee.object.name="document"][callee.property.name^="getElementsBy"]',
          message: 'Verboten: captured element references oder Registry statt getElementsBy* (QUERYSELECTOR_REPLACE.md).',
        },
        {
          selector: 'CallExpression[callee.object.name="document"][callee.property.name="getElementById"]',
          message: 'Verboten außerhalb dom.js: elements.byId() oder gecachtes Ref statt document.getElementById (QUERYSELECTOR_REPLACE.md).',
        },
      ],
    },
  },
  {
    // Root-resource acquisition after dom.js was removed (R8). main.js is the
    // app bootstrapper (not a component/service) and owns fetching the static
    // non-UI resources defined in the HTML (§6.2): the audio engine, the YT
    // container and the mount roots. Components/services only ever receive these
    // as passed references (app.dom) — they never query the global document.
    files: ['public/js/main.js'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
];
