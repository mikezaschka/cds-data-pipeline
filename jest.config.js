/** @type {import('jest').Config} */
module.exports = {
    setupFiles: ['<rootDir>/test/support/jest-setup-env.js'],
    testMatch: ['<rootDir>/test/**/*.test.js'],
    testPathIgnorePatterns: [
        '/node_modules/',
        '<rootDir>/test/fixtures/',
    ],
    testTimeout: 120000,
    maxConcurrency: 1,
    forceExit: true,
}
