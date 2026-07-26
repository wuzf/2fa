import { describe, it, expect } from 'vitest';

import { APP_VERSION, compareVersions } from '../../src/utils/version.js';
import pkg from '../../package.json';

describe('version utils', () => {
	describe('APP_VERSION', () => {
		it('should match package.json version', () => {
			expect(APP_VERSION).toBe(pkg.version);
		});

		it('should be a valid semver string', () => {
			expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
		});
	});

	describe('compareVersions', () => {
		it('should return 0 for equal versions', () => {
			expect(compareVersions('1.5.0', '1.5.0')).toBe(0);
		});

		it('should ignore leading v prefix', () => {
			expect(compareVersions('v1.5.0', '1.5.0')).toBe(0);
			expect(compareVersions('V1.5.0', 'v1.5.0')).toBe(0);
		});

		it('should compare major versions', () => {
			expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
			expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
		});

		it('should compare minor versions', () => {
			expect(compareVersions('1.6.0', '1.5.9')).toBe(1);
			expect(compareVersions('1.5.0', '1.6.0')).toBe(-1);
		});

		it('should compare patch versions', () => {
			expect(compareVersions('1.5.1', '1.5.0')).toBe(1);
			expect(compareVersions('1.5.0', '1.5.1')).toBe(-1);
		});

		it('should compare numerically, not lexically', () => {
			expect(compareVersions('1.10.0', '1.9.0')).toBe(1);
			expect(compareVersions('v1.10.0', 'v1.2.0')).toBe(1);
		});

		it('should handle versions with different segment counts', () => {
			expect(compareVersions('1.5', '1.5.0')).toBe(0);
			expect(compareVersions('1.5.1', '1.5')).toBe(1);
			expect(compareVersions('1', '1.0.1')).toBe(-1);
		});

		it('should treat invalid segments as 0', () => {
			expect(compareVersions('1.x.0', '1.0.0')).toBe(0);
			expect(compareVersions('abc', '0.0.0')).toBe(0);
		});
	});
});
