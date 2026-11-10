// The language of this build (specs/014-shared-core, S1): `#language` is `src/languages/<APP_LANG>.ts`, `en` by default
// (tsconfig.json / tsconfig.pl.json, vite.config.ts, vitest.config.ts). Everything that differs between
// English Reader and Polish Reader lives in those files; the rest of the app is language-neutral.
export * from '#language'
