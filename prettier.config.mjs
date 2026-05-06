/** @type {import("prettier").Config} */
const config = {
  printWidth: 100,
  singleQuote: true,
  semi: true,
  trailingComma: 'none',
  arrowParens: 'always',
  plugins: ['prettier-plugin-tailwindcss']
};

export default config;
