/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    // resolve .js ESM imports to .ts sources in tests
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^auto-tracking-angular$': '<rootDir>/src/index.ts',
    '^auto-tracking-angular/config$': '<rootDir>/src/config.ts',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: 'tsconfig.test.json' }],
  },
  // CLI and XLSX integration tests legitimately perform filesystem and subprocess I/O.
  testTimeout: 60000,
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
};
