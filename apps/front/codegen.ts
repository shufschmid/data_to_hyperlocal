import type { CodegenConfig } from '@graphql-codegen/cli'

// Optional but recommended: generates TypeScript types from the *live* Directus
// GraphQL schema, so a renamed field breaks the build instead of returning
// undefined at runtime.
//
//   1. run the backend (`cd ../directus && npm run dev`)
//   2. put an admin token in DIRECTUS_TOKEN (admin UI → your user → Token)
//   3. npm run codegen
//
// Until you run it, the hand-written interfaces in src/graphql/*.ts are the types.
// Generated output goes to src/graphql/generated/ and is gitignored.
const config: CodegenConfig = {
  schema: [
    {
      [`${process.env.DIRECTUS_URL ?? 'http://localhost:8055'}/graphql`]: {
        headers: { Authorization: `Bearer ${process.env.DIRECTUS_TOKEN ?? ''}` }
      }
    }
  ],
  documents: ['src/**/*.ts', 'src/**/*.tsx', '!src/graphql/generated/**'],
  ignoreNoDocuments: true,
  generates: {
    'src/graphql/generated/': {
      preset: 'client',
      config: { useTypeImports: true }
    }
  }
}

export default config
