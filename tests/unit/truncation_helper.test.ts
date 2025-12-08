import { describe, it, expect } from 'vitest';

// -----------------------------------------------------------------------------
// Truncation Helper Unit Tests (Issue #25)
// -----------------------------------------------------------------------------
// These tests verify the truncateResponse helper function

// Constants (matches src/index.ts)
const CHARACTER_LIMIT = 25000;

// Truncation result interface
interface TruncationResult {
  text: string;
  truncated: boolean;
  originalLength?: number;
}

// Recreate truncateResponse for testing
function truncateResponse(
  content: string,
  options?: {
    limit?: number;
    hint?: string;
  }
): TruncationResult {
  const limit = options?.limit ?? CHARACTER_LIMIT;

  if (content.length <= limit) {
    return { text: content, truncated: false };
  }

  const hint = options?.hint ??
    "Use returnMode: 'summary' or narrower parameters to manage response size.";

  return {
    text: content.slice(0, limit) +
      `\n\n--- TRUNCATED ---\n` +
      `Response truncated from ${content.length.toLocaleString()} to ${limit.toLocaleString()} characters.\n` +
      hint,
    truncated: true,
    originalLength: content.length
  };
}

// =============================================================================
// TEST SUITES
// =============================================================================

describe('Truncation Helper - Issue #25', () => {
  // ---------------------------------------------------------------------------
  // Content Under Limit Tests
  // ---------------------------------------------------------------------------
  describe('Content Under Limit', () => {
    it('should return content unchanged when under limit', () => {
      const content = 'Hello, World!';
      const result = truncateResponse(content);

      expect(result.text).toBe(content);
      expect(result.truncated).toBe(false);
      expect(result.originalLength).toBeUndefined();
    });

    it('should return empty string unchanged', () => {
      const result = truncateResponse('');

      expect(result.text).toBe('');
      expect(result.truncated).toBe(false);
    });

    it('should return content exactly at limit unchanged', () => {
      const content = 'x'.repeat(CHARACTER_LIMIT);
      const result = truncateResponse(content);

      expect(result.text).toBe(content);
      expect(result.truncated).toBe(false);
    });

    it('should return content exactly at custom limit unchanged', () => {
      const content = 'x'.repeat(100);
      const result = truncateResponse(content, { limit: 100 });

      expect(result.text).toBe(content);
      expect(result.truncated).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Content Over Limit Tests
  // ---------------------------------------------------------------------------
  describe('Content Over Limit', () => {
    it('should truncate content over default limit', () => {
      const content = 'x'.repeat(CHARACTER_LIMIT + 1000);
      const result = truncateResponse(content);

      expect(result.truncated).toBe(true);
      expect(result.originalLength).toBe(CHARACTER_LIMIT + 1000);
      expect(result.text).toContain('--- TRUNCATED ---');
    });

    it('should truncate content over custom limit', () => {
      const content = 'Hello, World! This is a test.';
      const result = truncateResponse(content, { limit: 10 });

      expect(result.truncated).toBe(true);
      expect(result.originalLength).toBe(content.length);
      expect(result.text.startsWith('Hello, Wor')).toBe(true);
    });

    it('should truncate one character over limit', () => {
      const content = 'x'.repeat(CHARACTER_LIMIT + 1);
      const result = truncateResponse(content);

      expect(result.truncated).toBe(true);
      expect(result.originalLength).toBe(CHARACTER_LIMIT + 1);
    });
  });

  // ---------------------------------------------------------------------------
  // Truncation Message Format Tests
  // ---------------------------------------------------------------------------
  describe('Truncation Message Format', () => {
    it('should include TRUNCATED marker', () => {
      const content = 'x'.repeat(100);
      const result = truncateResponse(content, { limit: 50 });

      expect(result.text).toContain('--- TRUNCATED ---');
    });

    it('should include original size in message', () => {
      const content = 'x'.repeat(1000);
      const result = truncateResponse(content, { limit: 100 });

      expect(result.text).toContain('1,000');  // Formatted with comma
    });

    it('should include truncated size in message', () => {
      const content = 'x'.repeat(1000);
      const result = truncateResponse(content, { limit: 100 });

      expect(result.text).toContain('100');
    });

    it('should include default hint when not provided', () => {
      const content = 'x'.repeat(100);
      const result = truncateResponse(content, { limit: 50 });

      expect(result.text).toContain("returnMode: 'summary'");
    });

    it('should preserve content before truncation marker', () => {
      const content = 'ABCDEFGHIJ' + 'x'.repeat(100);
      const result = truncateResponse(content, { limit: 10 });

      expect(result.text.startsWith('ABCDEFGHIJ')).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Custom Hint Tests
  // ---------------------------------------------------------------------------
  describe('Custom Hints', () => {
    it('should use custom hint when provided', () => {
      const content = 'x'.repeat(100);
      const customHint = 'Use sheets_batchGetValues with specific ranges.';
      const result = truncateResponse(content, { limit: 50, hint: customHint });

      expect(result.text).toContain(customHint);
      expect(result.text).not.toContain("returnMode: 'summary'");
    });

    it('should use empty hint when provided', () => {
      const content = 'x'.repeat(100);
      const result = truncateResponse(content, { limit: 50, hint: '' });

      // Empty hint should still work, message just ends with empty string
      expect(result.text).toContain('--- TRUNCATED ---');
    });

    it('should use tool-specific hint', () => {
      const content = 'x'.repeat(100);
      const hint = 'Use gdrive://docs/abc123/chunk/0-5000 to access document content.';
      const result = truncateResponse(content, { limit: 50, hint });

      expect(result.text).toContain('gdrive://docs/abc123/chunk/0-5000');
    });
  });

  // ---------------------------------------------------------------------------
  // Edge Cases
  // ---------------------------------------------------------------------------
  describe('Edge Cases', () => {
    it('should handle limit of 0', () => {
      const content = 'Hello';
      const result = truncateResponse(content, { limit: 0 });

      expect(result.truncated).toBe(true);
      expect(result.text.startsWith('')).toBe(true);
      expect(result.text).toContain('--- TRUNCATED ---');
    });

    it('should handle very large content', () => {
      const content = 'x'.repeat(1000000); // 1 million characters
      const result = truncateResponse(content);

      expect(result.truncated).toBe(true);
      expect(result.originalLength).toBe(1000000);
      expect(result.text.length).toBeLessThan(CHARACTER_LIMIT + 500); // Some overhead for message
    });

    it('should handle unicode content', () => {
      const content = '🎉'.repeat(50) + 'x'.repeat(100);
      const result = truncateResponse(content, { limit: 100 });

      expect(result.truncated).toBe(true);
      // Unicode emojis are 2 code units each in JavaScript
      expect(result.text).toContain('--- TRUNCATED ---');
    });

    it('should handle newlines in content', () => {
      const content = 'Line 1\nLine 2\nLine 3\n' + 'x'.repeat(100);
      const result = truncateResponse(content, { limit: 20 });

      expect(result.truncated).toBe(true);
      expect(result.text).toContain('--- TRUNCATED ---');
    });

    it('should handle content with only whitespace', () => {
      const content = ' '.repeat(100);
      const result = truncateResponse(content, { limit: 50 });

      expect(result.truncated).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Return Value Structure Tests
  // ---------------------------------------------------------------------------
  describe('Return Value Structure', () => {
    it('should return object with text and truncated for non-truncated content', () => {
      const result = truncateResponse('Hello');

      expect(result).toHaveProperty('text');
      expect(result).toHaveProperty('truncated');
      expect(typeof result.text).toBe('string');
      expect(typeof result.truncated).toBe('boolean');
    });

    it('should return object with originalLength for truncated content', () => {
      const content = 'x'.repeat(100);
      const result = truncateResponse(content, { limit: 50 });

      expect(result).toHaveProperty('originalLength');
      expect(typeof result.originalLength).toBe('number');
    });

    it('should not include originalLength for non-truncated content', () => {
      const result = truncateResponse('Hello');

      expect(result.originalLength).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Integration-like Tests
  // ---------------------------------------------------------------------------
  describe('Realistic Usage', () => {
    it('should truncate large document response', () => {
      // Simulate a large Google Doc response
      const docContent = JSON.stringify({
        title: 'My Document',
        body: { content: 'x'.repeat(50000) }
      });

      const result = truncateResponse(docContent);

      expect(result.truncated).toBe(true);
      expect(result.text).toContain('--- TRUNCATED ---');
    });

    it('should not truncate small document response', () => {
      const docContent = JSON.stringify({
        title: 'My Document',
        body: { content: 'Hello, World!' }
      });

      const result = truncateResponse(docContent);

      expect(result.truncated).toBe(false);
      expect(result.text).toBe(docContent);
    });

    it('should work with sheets-specific hint', () => {
      const values = JSON.stringify([['A1', 'B1'], ['A2', 'B2']].concat(
        Array(1000).fill(['x', 'y'])
      ));

      const result = truncateResponse(values, {
        limit: 100,
        hint: 'Use sheets_batchGetValues with specific range like "Sheet1!A1:B10".'
      });

      expect(result.truncated).toBe(true);
      expect(result.text).toContain('sheets_batchGetValues');
    });
  });
});
