module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/**/?(*.)+(spec|test).[tj]s?(x)'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  maxWorkers: 1,
  setupFiles: ['<rootDir>/jest.setup.js'],
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  resetModules: true,
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', {
      tsconfig: {
        allowJs: true,
        esModuleInterop: true
      },
      isolatedModules: true
    }]
  }
};
