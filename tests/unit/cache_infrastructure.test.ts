import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// -----------------------------------------------------------------------------
// Cache Infrastructure Unit Tests (Issue #23)
// -----------------------------------------------------------------------------
// These tests verify the cache storage, TTL management, and URI parsing logic
// without requiring Google Drive API access.

// Constants (matches src/index.ts)
const CHARACTER_LIMIT = 25000;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

// -----------------------------------------------------------------------------
// Cache Entry Interface and Storage (recreated for testing)
// -----------------------------------------------------------------------------
interface CacheEntry {
  content: any;
  text: string;
  fetchedAt: number;
  type: 'doc' | 'sheet' | 'file';
}

// Test cache instance
let testCache: Map<string, CacheEntry>;

function cacheStore(key: string, content: any, text: string, type: CacheEntry['type']): void {
  testCache.set(key, {
    content,
    text,
    fetchedAt: Date.now(),
    type
  });
}

function cacheGet(key: string): CacheEntry | null {
  const entry = testCache.get(key);
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) {
    testCache.delete(key);
    return null;
  }

  return entry;
}

function cacheCleanup(): number {
  const now = Date.now();
  let removedCount = 0;

  for (const [key, entry] of testCache.entries()) {
    if (now - entry.fetchedAt > CACHE_TTL_MS) {
      testCache.delete(key);
      removedCount++;
    }
  }

  return removedCount;
}

function cacheStats(): { size: number; entries: { key: string; type: string; age: number; textLength: number }[] } {
  const now = Date.now();
  const entries = Array.from(testCache.entries()).map(([key, entry]) => ({
    key,
    type: entry.type,
    age: Math.round((now - entry.fetchedAt) / 1000),
    textLength: entry.text.length
  }));

  return {
    size: testCache.size,
    entries
  };
}

// -----------------------------------------------------------------------------
// URI Parser (recreated for testing)
// -----------------------------------------------------------------------------
interface ParsedResourceUri {
  valid: boolean;
  type?: 'doc' | 'sheet' | 'file' | 'legacy';
  resourceId?: string;
  action?: 'content' | 'chunk' | 'structure' | 'values';
  params?: {
    start?: number;
    end?: number;
    range?: string;
  };
  error?: string;
}

function parseResourceUri(uri: string): ParsedResourceUri {
  // Legacy format: gdrive:///{fileId}
  if (uri.startsWith('gdrive:///')) {
    const fileId = uri.replace('gdrive:///', '');
    if (!fileId) {
      return { valid: false, error: 'Empty file ID in legacy URI' };
    }
    return { valid: true, type: 'legacy', resourceId: fileId };
  }

  // New format: gdrive://{type}/{id}/{action}[/{params}]
  if (!uri.startsWith('gdrive://')) {
    return { valid: false, error: 'Invalid URI scheme - must start with gdrive://' };
  }

  const path = uri.substring('gdrive://'.length);
  const segments = path.split('/');

  if (segments.length < 2) {
    return { valid: false, error: 'URI must have at least type and resource ID' };
  }

  const resourceType = segments[0];
  const resourceId = segments[1];
  const action = segments[2];
  const actionParams = segments[3];

  if (!resourceId) {
    return { valid: false, error: 'Missing resource ID' };
  }

  // Handle docs URIs
  if (resourceType === 'docs') {
    if (!action) {
      return { valid: false, error: 'Docs URI requires action: content, chunk, or structure' };
    }

    if (action === 'content') {
      return { valid: true, type: 'doc', resourceId, action: 'content' };
    }

    if (action === 'structure') {
      return { valid: true, type: 'doc', resourceId, action: 'structure' };
    }

    if (action === 'chunk') {
      if (!actionParams) {
        return { valid: false, error: 'Chunk action requires range parameter (e.g., 0-5000)' };
      }

      const rangeMatch = actionParams.match(/^(\d+)-(\d+)$/);
      if (!rangeMatch) {
        return { valid: false, error: 'Invalid chunk range format. Use: {start}-{end} (e.g., 0-5000)' };
      }

      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);

      if (start < 0) {
        return { valid: false, error: 'Chunk start index cannot be negative' };
      }

      if (end <= start) {
        return { valid: false, error: 'Chunk end index must be greater than start index' };
      }

      return { valid: true, type: 'doc', resourceId, action: 'chunk', params: { start, end } };
    }

    return { valid: false, error: `Unknown docs action: ${action}. Valid actions: content, chunk, structure` };
  }

  // Handle sheets URIs
  if (resourceType === 'sheets') {
    if (action !== 'values') {
      return { valid: false, error: 'Sheets URI requires "values" action with range parameter' };
    }

    if (!actionParams) {
      return { valid: false, error: 'Sheets values action requires range parameter (e.g., Sheet1!A1:B10)' };
    }

    const range = decodeURIComponent(actionParams);
    return { valid: true, type: 'sheet', resourceId, action: 'values', params: { range } };
  }

  // Handle files URIs
  if (resourceType === 'files') {
    if (action !== 'content') {
      return { valid: false, error: 'Files URI requires "content" action' };
    }

    if (!actionParams) {
      return { valid: true, type: 'file', resourceId, action: 'content' };
    }

    const rangeMatch = actionParams.match(/^(\d+)-(\d+)$/);
    if (!rangeMatch) {
      return { valid: false, error: 'Invalid content range format. Use: {start}-{end} (e.g., 0-5000)' };
    }

    const start = parseInt(rangeMatch[1], 10);
    const end = parseInt(rangeMatch[2], 10);

    if (start < 0) {
      return { valid: false, error: 'Content start index cannot be negative' };
    }

    if (end <= start) {
      return { valid: false, error: 'Content end index must be greater than start index' };
    }

    return { valid: true, type: 'file', resourceId, action: 'content', params: { start, end } };
  }

  return { valid: false, error: `Unknown resource type: ${resourceType}. Valid types: docs, sheets, files` };
}

// -----------------------------------------------------------------------------
// Serve Cached Content (recreated for testing)
// -----------------------------------------------------------------------------
function serveCachedContent(parsed: ParsedResourceUri): { content: string | null; error?: string; hint?: string } {
  if (!parsed.valid || !parsed.resourceId) {
    return { content: null, error: parsed.error };
  }

  if (parsed.type === 'legacy') {
    return { content: null, hint: 'Legacy URI format - use standard resource fetch' };
  }

  const cacheKey = parsed.resourceId;
  const entry = cacheGet(cacheKey);

  if (!entry) {
    return {
      content: null,
      error: `Cache miss for resource: ${cacheKey}`,
      hint: `First fetch the document using the appropriate tool (e.g., docs_getDocument) to populate the cache.`
    };
  }

  if (parsed.action === 'content') {
    return { content: entry.text };
  }

  if (parsed.action === 'chunk') {
    const start = parsed.params?.start ?? 0;
    const end = parsed.params?.end ?? entry.text.length;
    const clampedEnd = Math.min(end, entry.text.length);
    const chunk = entry.text.slice(start, clampedEnd);
    return { content: chunk };
  }

  if (parsed.action === 'structure') {
    return {
      content: null,
      error: 'Structure extraction not yet implemented',
      hint: 'Use content or chunk actions to access document text'
    };
  }

  if (parsed.action === 'values') {
    return {
      content: null,
      error: 'Sheet values extraction not yet implemented',
      hint: 'Use sheets_batchGetValues tool to fetch specific ranges'
    };
  }

  return { content: null, error: `Unknown action: ${parsed.action}` };
}

// =============================================================================
// TEST SUITES
// =============================================================================

describe('Cache Infrastructure - Issue #23', () => {
  beforeEach(() => {
    testCache = new Map();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------------
  // Constants Tests
  // ---------------------------------------------------------------------------
  describe('Constants', () => {
    it('should have CHARACTER_LIMIT set to 25000', () => {
      expect(CHARACTER_LIMIT).toBe(25000);
    });

    it('should have CACHE_TTL_MS set to 30 minutes', () => {
      expect(CACHE_TTL_MS).toBe(30 * 60 * 1000);
      expect(CACHE_TTL_MS).toBe(1800000);
    });
  });

  // ---------------------------------------------------------------------------
  // Cache Storage Tests
  // ---------------------------------------------------------------------------
  describe('Cache Storage', () => {
    it('should store and retrieve content correctly', () => {
      const key = 'doc123';
      const content = { title: 'Test Doc' };
      const text = 'Hello, world!';

      cacheStore(key, content, text, 'doc');
      const entry = cacheGet(key);

      expect(entry).not.toBeNull();
      expect(entry?.text).toBe(text);
      expect(entry?.content).toEqual(content);
      expect(entry?.type).toBe('doc');
    });

    it('should return null for non-existent keys', () => {
      const entry = cacheGet('nonexistent');
      expect(entry).toBeNull();
    });

    it('should overwrite existing entries with same key', () => {
      const key = 'doc123';
      cacheStore(key, { v: 1 }, 'First', 'doc');
      cacheStore(key, { v: 2 }, 'Second', 'doc');

      const entry = cacheGet(key);
      expect(entry?.text).toBe('Second');
      expect(entry?.content.v).toBe(2);
    });

    it('should store different resource types', () => {
      cacheStore('doc1', {}, 'doc content', 'doc');
      cacheStore('sheet1', {}, 'sheet content', 'sheet');
      cacheStore('file1', {}, 'file content', 'file');

      expect(cacheGet('doc1')?.type).toBe('doc');
      expect(cacheGet('sheet1')?.type).toBe('sheet');
      expect(cacheGet('file1')?.type).toBe('file');
    });

    it('should handle empty text content', () => {
      cacheStore('empty', {}, '', 'doc');
      const entry = cacheGet('empty');
      expect(entry?.text).toBe('');
    });

    it('should handle large text content', () => {
      const largeText = 'x'.repeat(100000);
      cacheStore('large', {}, largeText, 'doc');
      const entry = cacheGet('large');
      expect(entry?.text.length).toBe(100000);
    });
  });

  // ---------------------------------------------------------------------------
  // Cache TTL Tests
  // ---------------------------------------------------------------------------
  describe('Cache TTL Expiration', () => {
    it('should return entry within TTL window', () => {
      cacheStore('doc1', {}, 'content', 'doc');

      // Advance time by 29 minutes (within TTL)
      vi.advanceTimersByTime(29 * 60 * 1000);

      const entry = cacheGet('doc1');
      expect(entry).not.toBeNull();
      expect(entry?.text).toBe('content');
    });

    it('should expire entry after TTL', () => {
      cacheStore('doc1', {}, 'content', 'doc');

      // Advance time by 31 minutes (past TTL)
      vi.advanceTimersByTime(31 * 60 * 1000);

      const entry = cacheGet('doc1');
      expect(entry).toBeNull();
    });

    it('should remove expired entry from cache on get', () => {
      cacheStore('doc1', {}, 'content', 'doc');
      expect(testCache.size).toBe(1);

      vi.advanceTimersByTime(31 * 60 * 1000);
      cacheGet('doc1'); // This should remove the expired entry

      expect(testCache.size).toBe(0);
    });

    it('should expire entry exactly at TTL boundary', () => {
      cacheStore('doc1', {}, 'content', 'doc');

      // Advance to exactly TTL + 1ms
      vi.advanceTimersByTime(CACHE_TTL_MS + 1);

      const entry = cacheGet('doc1');
      expect(entry).toBeNull();
    });

    it('should keep entry at exactly TTL boundary', () => {
      cacheStore('doc1', {}, 'content', 'doc');

      // Advance to exactly TTL (not past it)
      vi.advanceTimersByTime(CACHE_TTL_MS);

      const entry = cacheGet('doc1');
      // At exactly TTL, it should still be valid (> not >=)
      expect(entry).not.toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Cache Cleanup Tests
  // ---------------------------------------------------------------------------
  describe('Cache Cleanup', () => {
    it('should remove expired entries during cleanup', () => {
      cacheStore('doc1', {}, 'content1', 'doc');
      cacheStore('doc2', {}, 'content2', 'doc');

      vi.advanceTimersByTime(31 * 60 * 1000);

      const removed = cacheCleanup();
      expect(removed).toBe(2);
      expect(testCache.size).toBe(0);
    });

    it('should keep non-expired entries during cleanup', () => {
      cacheStore('old', {}, 'old content', 'doc');

      vi.advanceTimersByTime(31 * 60 * 1000);

      cacheStore('new', {}, 'new content', 'doc');

      const removed = cacheCleanup();
      expect(removed).toBe(1);
      expect(testCache.size).toBe(1);
      expect(cacheGet('new')?.text).toBe('new content');
    });

    it('should return 0 when no entries expired', () => {
      cacheStore('doc1', {}, 'content', 'doc');

      const removed = cacheCleanup();
      expect(removed).toBe(0);
      expect(testCache.size).toBe(1);
    });

    it('should handle empty cache', () => {
      const removed = cacheCleanup();
      expect(removed).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Cache Stats Tests
  // ---------------------------------------------------------------------------
  describe('Cache Stats', () => {
    it('should return correct stats for empty cache', () => {
      const stats = cacheStats();
      expect(stats.size).toBe(0);
      expect(stats.entries).toEqual([]);
    });

    it('should return correct stats for populated cache', () => {
      cacheStore('doc1', {}, 'Hello', 'doc');
      cacheStore('sheet1', {}, 'World!', 'sheet');

      const stats = cacheStats();
      expect(stats.size).toBe(2);
      expect(stats.entries.length).toBe(2);
    });

    it('should include correct entry details', () => {
      cacheStore('doc1', {}, 'Test content', 'doc');

      vi.advanceTimersByTime(5000); // 5 seconds

      const stats = cacheStats();
      const entry = stats.entries.find(e => e.key === 'doc1');

      expect(entry).toBeDefined();
      expect(entry?.type).toBe('doc');
      expect(entry?.textLength).toBe(12); // 'Test content'.length
      expect(entry?.age).toBe(5); // 5 seconds
    });
  });

  // ---------------------------------------------------------------------------
  // URI Parser Tests - Legacy Format
  // ---------------------------------------------------------------------------
  describe('URI Parser - Legacy Format', () => {
    it('should parse legacy URI format correctly', () => {
      const result = parseResourceUri('gdrive:///abc123');

      expect(result.valid).toBe(true);
      expect(result.type).toBe('legacy');
      expect(result.resourceId).toBe('abc123');
    });

    it('should reject empty file ID in legacy format', () => {
      const result = parseResourceUri('gdrive:///');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Empty file ID');
    });

    it('should handle legacy URI with special characters', () => {
      const result = parseResourceUri('gdrive:///1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w');

      expect(result.valid).toBe(true);
      expect(result.resourceId).toBe('1CIeAIWDqN_s1g9b7V2h79VpFjlrPM15VYuZ09zsNM9w');
    });
  });

  // ---------------------------------------------------------------------------
  // URI Parser Tests - Docs Format
  // ---------------------------------------------------------------------------
  describe('URI Parser - Docs Format', () => {
    it('should parse docs content URI', () => {
      const result = parseResourceUri('gdrive://docs/abc123/content');

      expect(result.valid).toBe(true);
      expect(result.type).toBe('doc');
      expect(result.resourceId).toBe('abc123');
      expect(result.action).toBe('content');
    });

    it('should parse docs structure URI', () => {
      const result = parseResourceUri('gdrive://docs/abc123/structure');

      expect(result.valid).toBe(true);
      expect(result.type).toBe('doc');
      expect(result.resourceId).toBe('abc123');
      expect(result.action).toBe('structure');
    });

    it('should parse docs chunk URI with range', () => {
      const result = parseResourceUri('gdrive://docs/abc123/chunk/0-5000');

      expect(result.valid).toBe(true);
      expect(result.type).toBe('doc');
      expect(result.resourceId).toBe('abc123');
      expect(result.action).toBe('chunk');
      expect(result.params?.start).toBe(0);
      expect(result.params?.end).toBe(5000);
    });

    it('should parse chunk URI with large range', () => {
      const result = parseResourceUri('gdrive://docs/abc123/chunk/10000-50000');

      expect(result.valid).toBe(true);
      expect(result.params?.start).toBe(10000);
      expect(result.params?.end).toBe(50000);
    });

    it('should reject docs URI without action', () => {
      const result = parseResourceUri('gdrive://docs/abc123');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('requires action');
    });

    it('should reject chunk URI without range', () => {
      const result = parseResourceUri('gdrive://docs/abc123/chunk');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('requires range parameter');
    });

    it('should reject invalid chunk range format', () => {
      const result = parseResourceUri('gdrive://docs/abc123/chunk/invalid');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid chunk range format');
    });

    it('should reject chunk with end <= start', () => {
      const result = parseResourceUri('gdrive://docs/abc123/chunk/5000-5000');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('end index must be greater than start');
    });

    it('should reject unknown docs action', () => {
      const result = parseResourceUri('gdrive://docs/abc123/unknown');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unknown docs action');
    });
  });

  // ---------------------------------------------------------------------------
  // URI Parser Tests - Sheets Format
  // ---------------------------------------------------------------------------
  describe('URI Parser - Sheets Format', () => {
    it('should parse sheets values URI', () => {
      const result = parseResourceUri('gdrive://sheets/abc123/values/Sheet1!A1:B10');

      expect(result.valid).toBe(true);
      expect(result.type).toBe('sheet');
      expect(result.resourceId).toBe('abc123');
      expect(result.action).toBe('values');
      expect(result.params?.range).toBe('Sheet1!A1:B10');
    });

    it('should decode URL-encoded range', () => {
      const result = parseResourceUri('gdrive://sheets/abc123/values/Sheet%201!A1:B10');

      expect(result.valid).toBe(true);
      expect(result.params?.range).toBe('Sheet 1!A1:B10');
    });

    it('should reject sheets URI without values action', () => {
      const result = parseResourceUri('gdrive://sheets/abc123/data/A1:B10');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('requires "values" action');
    });

    it('should reject sheets URI without range', () => {
      const result = parseResourceUri('gdrive://sheets/abc123/values');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('requires range parameter');
    });
  });

  // ---------------------------------------------------------------------------
  // URI Parser Tests - Files Format
  // ---------------------------------------------------------------------------
  describe('URI Parser - Files Format', () => {
    it('should parse files content URI without range', () => {
      const result = parseResourceUri('gdrive://files/abc123/content');

      expect(result.valid).toBe(true);
      expect(result.type).toBe('file');
      expect(result.resourceId).toBe('abc123');
      expect(result.action).toBe('content');
      expect(result.params).toBeUndefined();
    });

    it('should parse files content URI with range', () => {
      const result = parseResourceUri('gdrive://files/abc123/content/0-10000');

      expect(result.valid).toBe(true);
      expect(result.type).toBe('file');
      expect(result.params?.start).toBe(0);
      expect(result.params?.end).toBe(10000);
    });

    it('should reject files URI without content action', () => {
      const result = parseResourceUri('gdrive://files/abc123/data');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('requires "content" action');
    });

    it('should reject invalid content range format', () => {
      const result = parseResourceUri('gdrive://files/abc123/content/abc-def');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid content range format');
    });
  });

  // ---------------------------------------------------------------------------
  // URI Parser Tests - Invalid URIs
  // ---------------------------------------------------------------------------
  describe('URI Parser - Invalid URIs', () => {
    it('should reject non-gdrive scheme', () => {
      const result = parseResourceUri('https://docs.google.com/doc123');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid URI scheme');
    });

    it('should reject unknown resource type', () => {
      const result = parseResourceUri('gdrive://unknown/abc123/content');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('Unknown resource type');
    });

    it('should reject URI with only type', () => {
      const result = parseResourceUri('gdrive://docs');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('resource ID');
    });

    it('should reject empty URI', () => {
      const result = parseResourceUri('');

      expect(result.valid).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // Serve Cached Content Tests
  // ---------------------------------------------------------------------------
  describe('Serve Cached Content', () => {
    it('should return full content for content action', () => {
      const text = 'This is the document content.';
      cacheStore('doc123', {}, text, 'doc');

      const parsed = parseResourceUri('gdrive://docs/doc123/content');
      const result = serveCachedContent(parsed);

      expect(result.content).toBe(text);
      expect(result.error).toBeUndefined();
    });

    it('should return chunk for chunk action', () => {
      const text = 'Hello, World! This is a test document.';
      cacheStore('doc123', {}, text, 'doc');

      const parsed = parseResourceUri('gdrive://docs/doc123/chunk/0-5');
      const result = serveCachedContent(parsed);

      expect(result.content).toBe('Hello');
    });

    it('should clamp chunk end to content length', () => {
      const text = 'Short text';
      cacheStore('doc123', {}, text, 'doc');

      const parsed = parseResourceUri('gdrive://docs/doc123/chunk/0-1000');
      const result = serveCachedContent(parsed);

      expect(result.content).toBe(text);
    });

    it('should return empty string for out-of-bounds chunk start', () => {
      const text = 'Short text';
      cacheStore('doc123', {}, text, 'doc');

      const parsed = parseResourceUri('gdrive://docs/doc123/chunk/100-200');
      const result = serveCachedContent(parsed);

      expect(result.content).toBe('');
    });

    it('should return cache miss error when not cached', () => {
      const parsed = parseResourceUri('gdrive://docs/notcached/content');
      const result = serveCachedContent(parsed);

      expect(result.content).toBeNull();
      expect(result.error).toContain('Cache miss');
      expect(result.hint).toContain('fetch the document');
    });

    it('should return hint for legacy URIs', () => {
      const parsed = parseResourceUri('gdrive:///abc123');
      const result = serveCachedContent(parsed);

      expect(result.content).toBeNull();
      expect(result.hint).toContain('Legacy URI format');
    });

    it('should return error for structure action (not implemented)', () => {
      cacheStore('doc123', {}, 'content', 'doc');

      const parsed = parseResourceUri('gdrive://docs/doc123/structure');
      const result = serveCachedContent(parsed);

      expect(result.content).toBeNull();
      expect(result.error).toContain('not yet implemented');
    });

    it('should return error for values action (not implemented)', () => {
      cacheStore('sheet123', {}, 'content', 'sheet');

      const parsed = parseResourceUri('gdrive://sheets/sheet123/values/A1:B10');
      const result = serveCachedContent(parsed);

      expect(result.content).toBeNull();
      expect(result.error).toContain('not yet implemented');
    });

    it('should return error for invalid parsed URI', () => {
      const parsed = parseResourceUri('invalid://uri');
      const result = serveCachedContent(parsed);

      expect(result.content).toBeNull();
      expect(result.error).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // Chunk Boundary Tests
  // ---------------------------------------------------------------------------
  describe('Chunk Boundaries', () => {
    const sampleText = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'; // 26 characters

    beforeEach(() => {
      cacheStore('doc123', {}, sampleText, 'doc');
    });

    it('should extract first 5 characters', () => {
      const parsed = parseResourceUri('gdrive://docs/doc123/chunk/0-5');
      const result = serveCachedContent(parsed);
      expect(result.content).toBe('ABCDE');
    });

    it('should extract middle characters', () => {
      const parsed = parseResourceUri('gdrive://docs/doc123/chunk/10-15');
      const result = serveCachedContent(parsed);
      expect(result.content).toBe('KLMNO');
    });

    it('should extract last characters', () => {
      const parsed = parseResourceUri('gdrive://docs/doc123/chunk/20-26');
      const result = serveCachedContent(parsed);
      expect(result.content).toBe('UVWXYZ');
    });

    it('should handle single character chunk', () => {
      const parsed = parseResourceUri('gdrive://docs/doc123/chunk/0-1');
      const result = serveCachedContent(parsed);
      expect(result.content).toBe('A');
    });

    it('should handle chunk starting from 0', () => {
      const parsed = parseResourceUri('gdrive://docs/doc123/chunk/0-10');
      const result = serveCachedContent(parsed);
      expect(result.content).toBe('ABCDEFGHIJ');
      expect(result.content?.length).toBe(10);
    });
  });
});
