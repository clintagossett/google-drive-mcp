/**
 * Custom assertions for MCP testing
 */

import { expect } from 'vitest';

/**
 * Asserts that a response is a valid MCP tool response
 */
export function assertValidMCPResponse(response: any) {
  expect(response).toBeDefined();
  expect(response).toHaveProperty('content');
  expect(Array.isArray(response.content)).toBe(true);
  expect(response.content.length).toBeGreaterThan(0);
  expect(response.content[0]).toHaveProperty('type');
  expect(response.content[0]).toHaveProperty('text');
}

/**
 * Asserts that a response indicates success
 */
export function assertSuccess(response: any) {
  assertValidMCPResponse(response);
  expect(response.isError).not.toBe(true);
}

/**
 * Asserts that a response indicates an error
 */
export function assertError(response: any) {
  assertValidMCPResponse(response);
  expect(response.isError).toBe(true);
}

/**
 * Asserts that response text contains expected content
 */
export function assertResponseContains(response: any, expected: string) {
  assertValidMCPResponse(response);
  const text = response.content[0].text;
  expect(text).toContain(expected);
}
