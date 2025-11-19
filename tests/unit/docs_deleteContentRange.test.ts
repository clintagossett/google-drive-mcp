import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createMCPClient, closeMCPClient, callTool } from '../helpers/mcp-client.js';
import { assertValidMCPResponse, assertSuccess } from '../helpers/assertions.js';
import { TEST_CONFIG, skipIfNoIntegration } from '../helpers/test-env.js';

describe('docs_deleteContentRange - Integration Tests', () => {
  skipIfNoIntegration();

  let client: Client;
  const testDocId = TEST_CONFIG.oauthDocument;

  beforeAll(async () => {
    const result = await createMCPClient({
      serverPath: TEST_CONFIG.serverPath,
      args: TEST_CONFIG.serverArgs,
      env: TEST_CONFIG.env
    });
    client = result.client;
  });

  afterAll(async () => {
    if (client) {
      await closeMCPClient(client);
    }
  });

  it('should successfully delete content from a document', async () => {
    // First, add some test content that we can delete
    const insertResponse = await callTool(client, 'updateGoogleDoc', {
      documentId: testDocId,
      content: '\n\nTest content for deletion - Integration Test\n'
    });
    assertSuccess(insertResponse);

    // Get the document to find indices
    const getResponse = await callTool(client, 'getGoogleDocContent', {
      documentId: testDocId
    });
    assertSuccess(getResponse);

    // Delete a small range (indices 1-5)
    const deleteResponse = await callTool(client, 'docs_deleteContentRange', {
      documentId: testDocId,
      startIndex: 1,
      endIndex: 5
    });

    assertValidMCPResponse(deleteResponse);
    assertSuccess(deleteResponse);

    expect(deleteResponse.content).toBeDefined();
    expect(deleteResponse.content[0].text).toContain('Successfully deleted');
    expect(deleteResponse.content[0].text).toContain('index 1 to 5');
  }, 60000);

  it('should handle deleting content at end of document', async () => {
    // Get current document length
    const getResponse = await callTool(client, 'getGoogleDocContent', {
      documentId: testDocId
    });
    assertSuccess(getResponse);

    // Extract total length from response
    const lengthMatch = getResponse.content[0].text.match(/Total length: (\d+) characters/);
    expect(lengthMatch).toBeTruthy();

    const totalLength = parseInt(lengthMatch![1]);
    expect(totalLength).toBeGreaterThan(10);

    // Delete last few characters (but not the final newline at index totalLength)
    const startIdx = Math.max(1, totalLength - 5);
    const endIdx = totalLength - 1;

    const deleteResponse = await callTool(client, 'docs_deleteContentRange', {
      documentId: testDocId,
      startIndex: startIdx,
      endIndex: endIdx
    });

    assertValidMCPResponse(deleteResponse);
    assertSuccess(deleteResponse);
    expect(deleteResponse.content[0].text).toContain('Successfully deleted');
  }, 60000);

  it('should return error for invalid document ID', async () => {
    const response = await callTool(client, 'docs_deleteContentRange', {
      documentId: 'invalid-document-id-12345',
      startIndex: 1,
      endIndex: 10
    });

    assertValidMCPResponse(response);
    // Google API will return an error for invalid document
    expect(response.isError || response.content[0].text.includes('error')).toBeTruthy();
  }, 60000);

  it('should reject zero-length range (startIndex === endIndex)', async () => {
    // Google Docs API doesn't allow zero-length ranges
    const response = await callTool(client, 'docs_deleteContentRange', {
      documentId: testDocId,
      startIndex: 5,
      endIndex: 5
    });

    assertValidMCPResponse(response);
    // API should return error: "The range should not be empty"
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('range should not be empty');
  }, 60000);

  it('should validate indices through schema', async () => {
    // Test that schema validation catches invalid indices
    const response = await callTool(client, 'docs_deleteContentRange', {
      documentId: testDocId,
      startIndex: 0, // Invalid: must be at least 1
      endIndex: 10
    });

    assertValidMCPResponse(response);
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Start index must be at least 1');
  }, 60000);
});
