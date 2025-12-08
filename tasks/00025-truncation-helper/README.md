# Task 00025: Implement Truncation Helper

**GitHub Issue:** #25
**Epic:** #22 (MCP Best Practices Alignment)
**Phase:** 1 - Fix Context Overflow (CRITICAL)
**Blocked By:** #23 (Cache Infrastructure)
**Blocks:** #26 (Update Priority Tools)

---

## Resume (Start Here)

**Last Updated:** 2025-12-08 (Session 1)

### Current Status: PENDING

**Phase:** Waiting for #23 (Cache Infrastructure) to complete.

### Next Steps

1. Create `truncateResponse` helper function
2. Implement actionable truncation messages
3. Support custom hints per tool
4. Export for use by all tools
5. Write tests

---

## Objective

Create reusable truncation helper with actionable messages for `returnMode: "full"` fallback and any other large responses.

---

## Implementation

```typescript
function truncateResponse(
  content: string,
  options?: {
    limit?: number;
    hint?: string;
  }
): { text: string; truncated: boolean } {
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
    truncated: true
  };
}
```

---

## Deliverables

- [ ] Create `truncateResponse` helper function
- [ ] Truncation message includes original size
- [ ] Truncation message includes actionable hint
- [ ] Custom hints supported for tool-specific guidance
- [ ] Helper exported for use by all tools

---

## Testing

- [ ] Content under limit returned unchanged
- [ ] Content over limit truncated correctly
- [ ] Truncation message format is correct
- [ ] Custom hints work properly
- [ ] Edge cases (exactly at limit, empty string)

---

## Files Changed

_(To be filled during implementation)_
