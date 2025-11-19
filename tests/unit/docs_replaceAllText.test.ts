import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createMCPClient, closeMCPClient, callTool } from '../helpers/mcp-client.js';
import { assertValidMCPResponse, assertSuccess } from '../helpers/assertions.js';
import { TEST_CONFIG, skipIfNoIntegration } from '../helpers/test-env.js';

describe('docs_replaceAllText - Integration Tests', () => {
  skipIfNoIntegration();

  let client: Client;
  const testDocId = TEST_CONFIG.oauthDocument;

  beforeAll(async () => {
    const result = await createMCPClient({
      serverPath: TEST_CONFIG.serverPath,
      serverArgs: TEST_CONFIG.serverArgs,
      env: TEST_CONFIG.env
    });
    client = result.client;
  });

  afterAll(async () => {
    if (client) {
      await closeMCPClient(client);
    }
  });

  it('should successfully replace text in a document (case-insensitive)', async () => {
    // First, add test content
    const insertResponse = await callTool(client, 'updateGoogleDoc', {
      documentId: testDocId,
      content: '\n\nTest REPLACE content for integration test\n'
    });
    assertSuccess(insertResponse);

    // Replace "replace" (case-insensitive)
    const replaceResponse = await callTool(client, 'docs_replaceAllText', {
      documentId: testDocId,
      containsText: 'replace',
      replaceText: 'REPLACED',
      matchCase: false
    });

    assertValidMCPResponse(replaceResponse);
    assertSuccess(replaceResponse);

    expect(replaceResponse.content).toBeDefined();
    expect(replaceResponse.content[0].text).toContain('Successfully replaced');
    expect(replaceResponse.content[0].text).toMatch(/\d+ occurrence/);
  }, 60000);

  it('should replace text with case-sensitive matching', async () => {
    // Add mixed-case content
    await callTool(client, 'updateGoogleDoc', {
      documentId: testDocId,
      content: '\n\nTest CASE case CaSe for case sensitivity\n'
    });

    // Replace only lowercase "case" with matchCase=true
    const replaceResponse = await callTool(client, 'docs_replaceAllText', {
      documentId: testDocId,
      containsText: 'case',
      replaceText: 'REPLACED',
      matchCase: true
    });

    assertValidMCPResponse(replaceResponse);
    assertSuccess(replaceResponse);

    // Should only replace lowercase instances
    expect(replaceResponse.content[0].text).toContain('occurrence');
  }, 60000);

  it('should replace text with empty string (deletion)', async () => {
    // Add content with marker
    await callTool(client, 'updateGoogleDoc', {
      documentId: testDocId,
      content: '\n\nRemove [DELETE_ME] this marker\n'
    });

    // Replace marker with empty string
    const replaceResponse = await callTool(client, 'docs_replaceAllText', {
      documentId: testDocId,
      containsText: '[DELETE_ME] ',
      replaceText: ''
    });

    assertValidMCPResponse(replaceResponse);
    assertSuccess(replaceResponse);
    expect(replaceResponse.content[0].text).toMatch(/\d+ occurrence/);
  }, 60000);

  it('should return 0 occurrences when text not found', async () => {
    const replaceResponse = await callTool(client, 'docs_replaceAllText', {
      documentId: testDocId,
      containsText: 'ThisTextDoesNotExistInTheDocument12345',
      replaceText: 'something'
    });

    assertValidMCPResponse(replaceResponse);
    assertSuccess(replaceResponse);
    expect(replaceResponse.content[0].text).toContain('0 occurrence');
  }, 60000);

  it('should return error for invalid document ID', async () => {
    const response = await callTool(client, 'docs_replaceAllText', {
      documentId: 'invalid-document-id-12345',
      containsText: 'test',
      replaceText: 'replaced'
    });

    assertValidMCPResponse(response);
    expect(response.isError || response.content[0].text.includes('error')).toBeTruthy();
  }, 60000);

  it('should validate empty containsText through schema', async () => {
    const response = await callTool(client, 'docs_replaceAllText', {
      documentId: testDocId,
      containsText: '',
      replaceText: 'test'
    });

    assertValidMCPResponse(response);
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain('Search text is required');
  }, 60000);
});
