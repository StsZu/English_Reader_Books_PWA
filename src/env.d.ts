/** True in dev and `--mode test` builds; false in production. Gates test fixtures (FR-33). */
declare const __TEST_MODE__: boolean
/** Build time and commit, e.g. «27.10.2026 13:05 · f5eee21» (specs/007-version). */
declare const __APP_VERSION__: string
