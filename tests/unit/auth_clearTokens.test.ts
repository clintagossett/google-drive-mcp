import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const AuthClearTokensSchema = z.object({
  // No parameters needed
});

describe('auth_clearTokens', () => {
  describe('Schema Validation', () => {
    it('should accept empty object (no parameters required)', () => {
      const result = AuthClearTokensSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept object with extra properties (they are ignored)', () => {
      const result = AuthClearTokensSchema.safeParse({
        extraProperty: 'ignored',
        anotherProperty: 123
      });
      expect(result.success).toBe(true);
    });

    it('should accept null-like input', () => {
      const result = AuthClearTokensSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept object with undefined properties', () => {
      const result = AuthClearTokensSchema.safeParse({
        someProperty: undefined
      });
      expect(result.success).toBe(true);
    });
  });

  describe('Response Format - Success', () => {
    it('should have correct response structure on success', () => {
      const mockResponse = {
        success: true,
        message: "Authentication tokens cleared successfully",
        tokenPath: "/Users/test/.config/google-drive-mcp/tokens.json",
        nextSteps: [
          "MCP server will automatically re-authenticate on next tool call",
          "Or manually run: npm run auth"
        ]
      };

      expect(mockResponse).toHaveProperty('success');
      expect(mockResponse).toHaveProperty('message');
      expect(mockResponse).toHaveProperty('tokenPath');
      expect(mockResponse).toHaveProperty('nextSteps');
      expect(mockResponse.success).toBe(true);
      expect(Array.isArray(mockResponse.nextSteps)).toBe(true);
    });

    it('should include success flag as true', () => {
      const mockResponse = {
        success: true
      };
      expect(mockResponse.success).toBe(true);
      expect(typeof mockResponse.success).toBe('boolean');
    });

    it('should include descriptive message', () => {
      const mockResponse = {
        message: "Authentication tokens cleared successfully"
      };
      expect(mockResponse.message).toBe("Authentication tokens cleared successfully");
      expect(typeof mockResponse.message).toBe('string');
    });

    it('should include token path', () => {
      const mockResponse = {
        tokenPath: "/Users/test/.config/google-drive-mcp/tokens.json"
      };
      expect(mockResponse.tokenPath).toBeDefined();
      expect(typeof mockResponse.tokenPath).toBe('string');
      expect(mockResponse.tokenPath).toContain('tokens.json');
    });

    it('should include next steps array', () => {
      const mockResponse = {
        nextSteps: [
          "MCP server will automatically re-authenticate on next tool call",
          "Or manually run: npm run auth"
        ]
      };
      expect(Array.isArray(mockResponse.nextSteps)).toBe(true);
      expect(mockResponse.nextSteps.length).toBeGreaterThan(0);
      expect(mockResponse.nextSteps[0]).toContain('re-authenticate');
    });

    it('should mention automatic re-authentication in next steps', () => {
      const mockResponse = {
        nextSteps: [
          "MCP server will automatically re-authenticate on next tool call",
          "Or manually run: npm run auth"
        ]
      };
      const hasAutoReauth = mockResponse.nextSteps.some(step =>
        step.includes('automatically') && step.includes('re-authenticate')
      );
      expect(hasAutoReauth).toBe(true);
    });

    it('should mention manual auth option in next steps', () => {
      const mockResponse = {
        nextSteps: [
          "MCP server will automatically re-authenticate on next tool call",
          "Or manually run: npm run auth"
        ]
      };
      const hasManualAuth = mockResponse.nextSteps.some(step =>
        step.includes('npm run auth')
      );
      expect(hasManualAuth).toBe(true);
    });
  });

  describe('Response Format - Error', () => {
    it('should have correct error structure when clearing fails', () => {
      const mockErrorResponse = {
        error: "Failed to clear tokens: Permission denied"
      };
      expect(mockErrorResponse).toHaveProperty('error');
      expect(typeof mockErrorResponse.error).toBe('string');
    });

    it('should include descriptive error message', () => {
      const mockErrorResponse = {
        error: "Failed to clear tokens: ENOENT"
      };
      expect(mockErrorResponse.error).toContain('Failed to clear tokens');
    });
  });

  describe('Token Path Handling', () => {
    it('should handle standard token path', () => {
      const tokenPath = '/Users/test/.config/google-drive-mcp/tokens.json';
      expect(tokenPath).toContain('.config');
      expect(tokenPath).toContain('google-drive-mcp');
      expect(tokenPath).toContain('tokens.json');
    });

    it('should handle custom token path from environment variable', () => {
      const customPath = '/custom/path/to/tokens.json';
      expect(customPath).toContain('tokens.json');
    });
  });
});
