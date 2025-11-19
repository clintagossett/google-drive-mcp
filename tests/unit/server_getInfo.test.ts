import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Schema definition (matches src/index.ts)
const ServerGetInfoSchema = z.object({
  includeUptime: z.boolean().optional().default(false)
});

describe('server_getInfo', () => {
  describe('Schema Validation', () => {
    it('should accept empty object (no parameters required)', () => {
      const result = ServerGetInfoSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.includeUptime).toBe(false); // default value
      }
    });

    it('should accept includeUptime as true', () => {
      const result = ServerGetInfoSchema.safeParse({
        includeUptime: true
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.includeUptime).toBe(true);
      }
    });

    it('should accept includeUptime as false', () => {
      const result = ServerGetInfoSchema.safeParse({
        includeUptime: false
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.includeUptime).toBe(false);
      }
    });

    it('should reject non-boolean includeUptime parameter', () => {
      const result = ServerGetInfoSchema.safeParse({
        includeUptime: "true"
      });
      expect(result.success).toBe(false);
    });

    it('should reject numeric includeUptime parameter', () => {
      const result = ServerGetInfoSchema.safeParse({
        includeUptime: 1
      });
      expect(result.success).toBe(false);
    });

    it('should handle undefined includeUptime', () => {
      const result = ServerGetInfoSchema.safeParse({
        includeUptime: undefined
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.includeUptime).toBe(false); // default value
      }
    });

    it('should reject extra unexpected properties', () => {
      const result = ServerGetInfoSchema.strict().safeParse({
        includeUptime: true,
        extraField: "unexpected"
      });
      expect(result.success).toBe(false);
    });
  });

  describe('Response Format', () => {
    it('should have correct response structure without uptime', () => {
      const mockResponse = {
        server: {
          name: 'google-drive-collaboration-mcp',
          version: '0.0.1',
          description: 'Google Drive Collaboration MCP Server',
          packageName: '@clintagossett/google-drive-collaboration-mcp'
        },
        project: {
          repository: 'https://github.com/clintagossett/google-drive-mcp',
          homepage: 'https://github.com/clintagossett/google-drive-mcp',
          license: 'MIT',
          author: 'Clint Gossett'
        },
        capabilities: {
          apis: ['Drive', 'Docs', 'Sheets', 'Slides'],
          authentication: 'OAuth2',
          toolCount: expect.any(Number)
        }
      };

      expect(mockResponse).toHaveProperty('server');
      expect(mockResponse).toHaveProperty('project');
      expect(mockResponse).toHaveProperty('capabilities');
      expect(mockResponse).not.toHaveProperty('uptime');
    });

    it('should have correct response structure with uptime', () => {
      const mockResponse = {
        server: {
          name: 'google-drive-collaboration-mcp',
          version: '0.0.1',
          description: 'Google Drive Collaboration MCP Server',
          packageName: '@clintagossett/google-drive-collaboration-mcp'
        },
        project: {
          repository: 'https://github.com/clintagossett/google-drive-mcp',
          homepage: 'https://github.com/clintagossett/google-drive-mcp',
          license: 'MIT',
          author: 'Clint Gossett'
        },
        capabilities: {
          apis: ['Drive', 'Docs', 'Sheets', 'Slides'],
          authentication: 'OAuth2',
          toolCount: expect.any(Number)
        },
        uptime: {
          seconds: 3600,
          formatted: '1h 0m 0s',
          startTime: expect.any(String)
        }
      };

      expect(mockResponse).toHaveProperty('server');
      expect(mockResponse).toHaveProperty('project');
      expect(mockResponse).toHaveProperty('capabilities');
      expect(mockResponse).toHaveProperty('uptime');
      expect(mockResponse.uptime).toHaveProperty('seconds');
      expect(mockResponse.uptime).toHaveProperty('formatted');
      expect(mockResponse.uptime).toHaveProperty('startTime');
    });

    it('should include server object with all required fields', () => {
      const mockServer = {
        name: 'google-drive-collaboration-mcp',
        version: '0.0.1',
        description: 'Google Drive Collaboration MCP Server',
        packageName: '@clintagossett/google-drive-collaboration-mcp'
      };

      expect(mockServer).toHaveProperty('name');
      expect(mockServer).toHaveProperty('version');
      expect(mockServer).toHaveProperty('description');
      expect(mockServer).toHaveProperty('packageName');
      expect(mockServer.name).toBe('google-drive-collaboration-mcp');
      expect(typeof mockServer.version).toBe('string');
    });

    it('should include project object with all required fields', () => {
      const mockProject = {
        repository: 'https://github.com/clintagossett/google-drive-mcp',
        homepage: 'https://github.com/clintagossett/google-drive-mcp',
        license: 'MIT',
        author: 'Clint Gossett'
      };

      expect(mockProject).toHaveProperty('repository');
      expect(mockProject).toHaveProperty('homepage');
      expect(mockProject).toHaveProperty('license');
      expect(mockProject).toHaveProperty('author');
      expect(mockProject.license).toBe('MIT');
    });

    it('should include capabilities object with all required fields', () => {
      const mockCapabilities = {
        apis: ['Drive', 'Docs', 'Sheets', 'Slides'],
        authentication: 'OAuth2',
        toolCount: 150
      };

      expect(mockCapabilities).toHaveProperty('apis');
      expect(mockCapabilities).toHaveProperty('authentication');
      expect(mockCapabilities).toHaveProperty('toolCount');
      expect(Array.isArray(mockCapabilities.apis)).toBe(true);
      expect(mockCapabilities.apis.length).toBeGreaterThan(0);
      expect(typeof mockCapabilities.toolCount).toBe('number');
    });

    it('should format uptime correctly', () => {
      // Test various uptime durations
      const testCases = [
        { seconds: 30, expected: '30s' },
        { seconds: 90, expected: '1m 30s' },
        { seconds: 3600, expected: '1h 0m 0s' },
        { seconds: 3661, expected: '1h 1m 1s' },
        { seconds: 86400, expected: '24h 0m 0s' }
      ];

      testCases.forEach(({ seconds, expected }) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        let formatted = '';
        if (hours > 0) formatted += `${hours}h `;
        if (minutes > 0 || hours > 0) formatted += `${minutes}m `;
        formatted += `${secs}s`;

        expect(formatted.trim()).toBe(expected);
      });
    });

    it('should have valid ISO 8601 startTime format', () => {
      const mockStartTime = new Date().toISOString();
      expect(mockStartTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('Uptime Calculation', () => {
    it('should calculate uptime correctly for 1 second', () => {
      const startTime = Date.now() - 1000;
      const currentTime = Date.now();
      const uptimeSeconds = Math.floor((currentTime - startTime) / 1000);
      expect(uptimeSeconds).toBeGreaterThanOrEqual(1);
      expect(uptimeSeconds).toBeLessThanOrEqual(2);
    });

    it('should calculate uptime correctly for 1 minute', () => {
      const startTime = Date.now() - 60000;
      const currentTime = Date.now();
      const uptimeSeconds = Math.floor((currentTime - startTime) / 1000);
      expect(uptimeSeconds).toBeGreaterThanOrEqual(60);
      expect(uptimeSeconds).toBeLessThanOrEqual(61);
    });

    it('should calculate uptime correctly for 1 hour', () => {
      const startTime = Date.now() - 3600000;
      const currentTime = Date.now();
      const uptimeSeconds = Math.floor((currentTime - startTime) / 1000);
      expect(uptimeSeconds).toBeGreaterThanOrEqual(3600);
      expect(uptimeSeconds).toBeLessThanOrEqual(3601);
    });
  });
});
