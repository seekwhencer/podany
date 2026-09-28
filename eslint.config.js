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
    // dom.js ist die einzige sanctioned Stelle für getElementById / q / qa.
    files: ['public/js/dom.js'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },
];
