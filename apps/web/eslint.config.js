import tseslint from 'typescript-eslint';

// One rule for now: an effect must not return a value by accident. React calls whatever an
// effect returns as its cleanup, so `useEffect(() => something())` crashes the page when
// something() returns a non-function, like scrollIntoView() does in newer browsers.
export default tseslint.config({
  files: ['src/**/*.{ts,tsx}'],
  languageOptions: { parser: tseslint.parser },
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector:
          'CallExpression[callee.name=/^use(Layout|Insertion)?Effect$/] > ArrowFunctionExpression[expression=true]',
        message:
          'Wrap the effect body in braces. React treats a returned value as the cleanup function.'
      }
    ]
  }
});
