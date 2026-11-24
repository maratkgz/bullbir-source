// Tests that need the Firebase Emulator Suite (rules, Admin SDK, auth bridge).
// Run only through `npm run test:emulator`, which starts the emulators first.
// They never touch a real Firebase project: the project id starts with "demo-".
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/emulator/**/*.test.{js,ts}'],
    environment: 'node',
    // Emulator tests share one database — run files one after another.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
})
