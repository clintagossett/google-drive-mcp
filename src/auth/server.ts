import express from 'express';
import { OAuth2Client } from 'google-auth-library';
import { TokenManager } from './tokenManager.js';
import http from 'http';
import open from 'open';
import { loadCredentials } from './client.js';
import { google } from 'googleapis';

// OAuth scopes for Google Drive, Docs, Sheets, and Slides
const SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/presentations'
];

export class AuthServer {
  private baseOAuth2Client: OAuth2Client; // Used by TokenManager for validation/refresh
  private flowOAuth2Client: OAuth2Client | null = null; // Used specifically for the auth code flow
  private app: express.Express;
  private server: http.Server | null = null;
  private tokenManager: TokenManager;
  private portRange: { start: number; end: number };
  public authCompletedSuccessfully = false; // Flag for standalone script

  constructor(oauth2Client: OAuth2Client) {
    this.baseOAuth2Client = oauth2Client;
    this.tokenManager = new TokenManager(oauth2Client);
    this.app = express();
    this.portRange = { start: 3000, end: 3004 };
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.app.get('/', (req, res) => {
      // Generate the URL using the active flow client if available, else base
      const clientForUrl = this.flowOAuth2Client || this.baseOAuth2Client;
      const authUrl = clientForUrl.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
      });
      res.send(`<h1>Google Drive Authentication</h1><a href="${authUrl}">Authenticate with Google</a>`);
    });

    this.app.get('/oauth2callback', async (req, res) => {
      const code = req.query.code as string;
      if (!code) {
        res.status(400).send('Authorization code missing');
        return;
      }
      // IMPORTANT: Use the flowOAuth2Client to exchange the code
      if (!this.flowOAuth2Client) {
        res.status(500).send('Authentication flow not properly initiated.');
        return;
      }
      try {
        const { tokens } = await this.flowOAuth2Client.getToken(code);
        // Save tokens using the TokenManager (which uses the base client)
        await this.tokenManager.saveTokens(tokens);
        this.authCompletedSuccessfully = true;

        // Get the path where tokens were saved
        const tokenPath = this.tokenManager.getTokenPath();

        // Fetch user info and scopes
        let userEmail = 'Unknown';
        let userName = 'Unknown User';
        const grantedScopes = tokens.scope ? tokens.scope.split(' ') : SCOPES;

        try {
          // Set credentials on the flow client to make API calls
          this.flowOAuth2Client.setCredentials(tokens);
          const drive = google.drive({ version: 'v3', auth: this.flowOAuth2Client });
          const aboutResponse = await drive.about.get({ fields: 'user' });
          userEmail = aboutResponse.data.user?.emailAddress || userEmail;
          userName = aboutResponse.data.user?.displayName || userName;
        } catch (apiError) {
          // If we can't fetch user info, just skip it
          console.error('Could not fetch user info:', apiError);
        }

        // Scope descriptions
        const scopeDescriptions: Record<string, string> = {
          'https://www.googleapis.com/auth/drive': 'Full access to Google Drive',
          'https://www.googleapis.com/auth/drive.file': 'Access to files created by this app',
          'https://www.googleapis.com/auth/drive.readonly': 'Read-only access to Google Drive',
          'https://www.googleapis.com/auth/documents': 'Access to Google Docs',
          'https://www.googleapis.com/auth/spreadsheets': 'Access to Google Sheets',
          'https://www.googleapis.com/auth/presentations': 'Access to Google Slides'
        };

        // Generate scope list HTML
        const scopeListHtml = grantedScopes.map(scope => {
          const description = scopeDescriptions[scope] || 'Unknown scope';
          return `<li><strong>${scope.split('/').pop()}</strong> - ${description}</li>`;
        }).join('');

        // Send a more informative HTML response including the path
        res.send(`
          <!DOCTYPE html>
          <html lang="en">
          <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Authentication Successful</title>
              <style>
                  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); margin: 0; padding: 20px; }
                  .container { max-width: 600px; width: 100%; padding: 2em; background-color: #fff; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); }
                  h1 { color: #4CAF50; margin-top: 0; font-size: 2em; }
                  h2 { color: #555; font-size: 1.3em; margin-top: 1.5em; margin-bottom: 0.5em; border-bottom: 2px solid #f0f0f0; padding-bottom: 0.3em; }
                  p { color: #333; margin-bottom: 0.5em; line-height: 1.6; }
                  .user-info { background-color: #f8f9fa; padding: 1em; border-radius: 8px; margin: 1em 0; }
                  .user-email { font-weight: bold; color: #667eea; font-size: 1.1em; }
                  .user-name { color: #555; margin-top: 0.3em; }
                  code { background-color: #eee; padding: 0.3em 0.5em; border-radius: 4px; font-size: 0.85em; word-break: break-all; display: inline-block; max-width: 100%; }
                  ul { list-style: none; padding: 0; margin: 1em 0; }
                  li { padding: 0.5em; margin: 0.3em 0; background-color: #f8f9fa; border-radius: 6px; border-left: 3px solid #4CAF50; }
                  .close-msg { margin-top: 2em; padding: 1em; background-color: #e8f5e9; border-radius: 6px; color: #2e7d32; }
                  .checkmark { font-size: 3em; color: #4CAF50; margin-bottom: 0.3em; }
              </style>
          </head>
          <body>
              <div class="container">
                  <div style="text-align: center;">
                      <div class="checkmark">✓</div>
                      <h1>Authentication Successful!</h1>
                  </div>

                  <h2>Authenticated User</h2>
                  <div class="user-info">
                      <div class="user-email">${userEmail}</div>
                      <div class="user-name">${userName}</div>
                  </div>

                  <h2>Granted Permissions</h2>
                  <ul>
                      ${scopeListHtml}
                  </ul>

                  <h2>Token Storage</h2>
                  <p>Your authentication tokens have been saved to:</p>
                  <p><code>${tokenPath}</code></p>

                  <div class="close-msg">
                      <strong>You're all set!</strong> You can now close this browser window and start using the Google Drive MCP server.
                  </div>
              </div>
          </body>
          </html>
        `);
      } catch (error: unknown) {
        this.authCompletedSuccessfully = false;
        const message = error instanceof Error ? error.message : 'Unknown error';
        // Send an HTML error response
        res.status(500).send(`
          <!DOCTYPE html>
          <html lang="en">
          <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Authentication Failed</title>
              <style>
                  body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background-color: #f4f4f4; margin: 0; }
                  .container { text-align: center; padding: 2em; background-color: #fff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
                  h1 { color: #F44336; }
                  p { color: #333; }
              </style>
          </head>
          <body>
              <div class="container">
                  <h1>Authentication Failed</h1>
                  <p>An error occurred during authentication:</p>
                  <p><code>${message}</code></p>
                  <p>Please try again or check the server logs.</p>
              </div>
          </body>
          </html>
        `);
      }
    });
  }

  async start(openBrowser = true): Promise<boolean> {
    if (await this.tokenManager.validateTokens()) {
      this.authCompletedSuccessfully = true;
      return true;
    }
    
    // Try to start the server and get the port
    const port = await this.startServerOnAvailablePort();
    if (port === null) {
      this.authCompletedSuccessfully = false;
      return false;
    }

    // Successfully started server on `port`. Now create the flow-specific OAuth client.
    try {
      const { client_id, client_secret } = await loadCredentials();
      this.flowOAuth2Client = new OAuth2Client(
        client_id,
        client_secret || undefined,
        `http://localhost:${port}/oauth2callback`
      );
    } catch (error) {
        // Could not load credentials, cannot proceed with auth flow
        console.error('Failed to load credentials for auth flow:', error);
        this.authCompletedSuccessfully = false;
        await this.stop(); // Stop the server we just started
        return false;
    }

    if (openBrowser) {
      // Generate Auth URL using the newly created flow client
      const authorizeUrl = this.flowOAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
      });
      
      console.error('\n🔐 AUTHENTICATION REQUIRED');
      console.error('══════════════════════════════════════════');
      console.error('\nOpening your browser to authenticate...');
      console.error(`If the browser doesn't open, visit:\n${authorizeUrl}\n`);
      
      await open(authorizeUrl);
    }

    return true; // Auth flow initiated
  }

  private async startServerOnAvailablePort(): Promise<number | null> {
    for (let port = this.portRange.start; port <= this.portRange.end; port++) {
      try {
        await new Promise<void>((resolve, reject) => {
          // Create a temporary server instance to test the port
          const testServer = this.app.listen(port, () => {
            this.server = testServer; // Assign to class property *only* if successful
            console.error(`Authentication server listening on http://localhost:${port}`);
            resolve();
          });
          testServer.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
              // Port is in use, close the test server and reject
              testServer.close(() => reject(err)); 
            } else {
              // Other error, reject
              reject(err);
            }
          });
        });
        return port; // Port successfully bound
      } catch (error: unknown) {
        // Check if it's EADDRINUSE, otherwise rethrow or handle
        if (!(error instanceof Error && 'code' in error && (error as any).code === 'EADDRINUSE')) {
            // An unexpected error occurred during server start
            console.error('Failed to start auth server:', error);
            return null;
        }
        // EADDRINUSE occurred, loop continues
      }
    }
    console.error('No available ports for authentication server (tried ports', this.portRange.start, '-', this.portRange.end, ')');
    return null; // No port found
  }

  public getRunningPort(): number | null {
    if (this.server) {
      const address = this.server.address();
      if (typeof address === 'object' && address !== null) {
        return address.port;
      }
    }
    return null;
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.server) {
        this.server.close((err) => {
          if (err) {
            reject(err);
          } else {
            this.server = null;
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}