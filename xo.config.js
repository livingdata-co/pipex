// Shared XO configuration for all apps

// Base config for .js files - disable TypeScript parsing
const jsFilesConfig = {
  files: ['**/*.js'],
  languageOptions: {
    parserOptions: {
      project: null
    }
  }
}

// Shared rules for all files
const rules = {
  semicolon: false,
  space: 2,
  rules: {
    // TypeScript
    '@typescript-eslint/naming-convention': 'off',
    '@typescript-eslint/no-unused-vars': ['error', {
      vars: 'all',
      varsIgnorePattern: '^_',
      args: 'after-used',
      argsIgnorePattern: '^_',
      ignoreRestSiblings: true
    }],

    // Stylistic - formatting
    'object-curly-newline': 'off',
    '@stylistic/object-curly-newline': 'off',
    '@stylistic/function-paren-newline': 'off',
    'comma-dangle': ['error', 'never'],
    '@stylistic/comma-dangle': ['error', 'never'],

    // Unicorn
    'unicorn/prevent-abbreviations': 'off',
    'unicorn/prefer-event-target': 'off',
    'unicorn/no-array-callback-reference': 'off',

    // Sequential processing required
    'no-await-in-loop': 'off',

    // Import
    'import/no-unassigned-import': 'off',
    'import/order': 'off',
    'import-x/no-unassigned-import': 'off',
    'import-x/order': 'off',
    'import-x/no-extraneous-dependencies': 'off',

    // Node.js
    'n/no-extraneous-import': 'off'
  }
}

const ignoreExamples = {
  ignores: ['example/**']
}

const testOverrides = {
  files: ['**/__tests__/**'],
  rules: {
    '@typescript-eslint/no-unsafe-call': 'off',
    '@typescript-eslint/no-unsafe-assignment': 'off',
    '@typescript-eslint/no-unsafe-return': 'off',
    '@typescript-eslint/no-unsafe-argument': 'off',
    'ava/no-ignored-test-files': 'off',
    'ava/no-import-test-files': 'off'
  }
}

const config = [
  ignoreExamples,
  jsFilesConfig,
  rules,
  testOverrides
]

export default config
