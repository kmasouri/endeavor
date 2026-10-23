const js = require('@eslint/js');
const tseslint = require('typescript-eslint');

// Import patterns for each layer, used by the rules below.
const layer = (name) => [`**/${name}`, `**/${name}/**`];

const noData = {
  group: layer('data'),
  message: 'Only services use repositories. Call a service instead.'
};

const noIntegrations = {
  group: layer('integrations'),
  message: 'Only services use integrations. Call a service instead.'
};

// Only imports from src/shared (and packages) are allowed.
const onlyShared = (message) => ({
  group: [
    ...layer('routes'),
    ...layer('handlers'),
    ...layer('services'),
    ...layer('data'),
    ...layer('integrations'),
    ...layer('plugins'),
    ...layer('observability'),
    ...layer('schemas')
  ],
  message
});

module.exports = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json'
      }
    }
  },
  {
    // Repositories and integrations are only used by services. Routes go through handlers,
    // handlers go through a service.
    files: ['src/routes/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [noData, noIntegrations] }]
    }
  },
  {
    // Handlers are below routes, so they never import from routes. Types come from src/schemas.
    files: ['src/handlers/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            noData,
            noIntegrations,
            {
              group: layer('routes'),
              message: 'Handlers never import from routes. Import types from src/schemas.'
            }
          ]
        }
      ]
    }
  },
  {
    // Services never use each other. If two services need the same thing, give both the
    // repository or integration it lives in. This keeps services free of import loops.
    files: ['src/services/**/*.ts'],
    ignores: ['src/services/index.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: layer('services'),
              message: 'Services never import other services. Use a repository or integration.'
            },
            {
              // A sibling feature folder, like '../orders' from inside services/items/.
              regex: '^\\.\\./[^./]',
              message: 'Services never import other services. Use a repository or integration.'
            }
          ]
        }
      ]
    }
  },
  {
    // Schemas describe request input and nothing else, so they only use src/shared.
    files: ['src/schemas/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [onlyShared('Schemas only import from zod and src/shared.')] }
      ]
    }
  },
  {
    // Repositories and integrations talk to the outside world. They only use src/shared.
    files: ['src/data/**/*.ts', 'src/integrations/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [onlyShared('Repositories and integrations only import from src/shared.')]
        }
      ]
    }
  }
);
