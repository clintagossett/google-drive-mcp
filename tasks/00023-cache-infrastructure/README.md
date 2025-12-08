# Task 00023: Resource Cache Infrastructure

**GitHub Issue:** #23
**Epic:** #22 (MCP Best Practices Alignment)
**Phase:** 1 - Fix Context Overflow (CRITICAL)
**Blocked By:** None
**Blocks:** #24, #25, #26

---

## Resume (Start Here)

**Last Updated:** 2025-12-08 (Session 1)

### Current Status: COMPLETE ✅

**Phase:** All deliverables implemented and tested.

### Summary

Implemented foundational cache infrastructure with:
- Constants for character limits and TTL
- Document cache with TTL management
- Resource URI parser for all `gdrive://` patterns
- Updated resource handler to serve cached chunks
- 58 unit tests (100% passing)

---

## Objective

Create the foundational caching and Resource serving infrastructure that enables the Cache as Resource pattern.

---

## Deliverables

- [x] Add `CHARACTER_LIMIT = 25000` constant
- [x] Add `CACHE_TTL_MS = 30 * 60 * 1000` constant (30 min)
- [x] Create `documentCache` Map for storing fetched content
- [x] Implement cache TTL management (cleanup expired entries)
- [x] Implement Resource URI parser for `gdrive://` scheme
- [x] Update `ReadResourceRequestSchema` handler to serve cached chunks

---

## Implementation

### Constants

```typescript
const CHARACTER_LIMIT = 25000;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
```

### Cache Storage

```typescript
const documentCache = new Map<string, {
  content: any;      // Original API response
  text: string;      // Extracted text content
  fetchedAt: number; // Timestamp for TTL
}>();
```

### Resource URI Patterns

```
gdrive://docs/{docId}/content              → full cached text
gdrive://docs/{docId}/chunk/{start}-{end}  → text slice
gdrive://docs/{docId}/structure            → headings/sections only
gdrive://sheets/{spreadsheetId}/values/{range} → cell values
gdrive://files/{fileId}/content/{start}-{end}  → exported file content
```

---

## Testing

- [x] Cache stores and retrieves content correctly
- [x] Cache TTL expiration removes stale entries
- [x] Resource URI parsing handles all patterns
- [x] Chunk boundaries work correctly (no off-by-one errors)
- [x] Invalid URIs return helpful errors
- [x] Cache miss returns helpful error with guidance

**Test Results:** 58 tests added, all passing (1231 total tests in suite)

---

## Files Changed

| File | Changes |
|------|---------|
| `src/index.ts` | Added cache infrastructure (~300 lines): constants, CacheEntry interface, documentCache Map, cacheStore/cacheGet/cacheCleanup/cacheStats functions, ParsedResourceUri interface, parseResourceUri function, serveCachedContent function, updated ReadResourceRequestSchema handler |
| `tests/unit/cache_infrastructure.test.ts` | New file with 58 unit tests covering: constants, cache storage, TTL expiration, cleanup, stats, URI parsing (legacy/docs/sheets/files), serve cached content, chunk boundaries |

---

## Notes

This is the foundation for Phase 1. Issues #24, #25, and #26 depend on this being complete.
