import type { Config } from 'jest';

const config: Config = {
	preset: 'ts-jest',
	testEnvironment: 'node',
	roots: ['<rootDir>/tests'],
	testMatch: ['**/*.test.ts', '**/*.e2e.test.ts'],
	moduleFileExtensions: ['ts', 'js', 'json'],
	clearMocks: true,
	maxWorkers: 1,
	transform: {
		'^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
	},
};

export default config;

