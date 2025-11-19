/**
 * Google Slides API Integration Tests
 *
 * Tests Slides API operations against real presentations in Shared Drive.
 *
 * Run with: npm run test:integration:slides
 */

import {
  initializeTestContext,
  validateSharedDriveAccess,
  generateTestFileName,
  trackCreatedFile,
  cleanupTestFiles,
  cleanupOrphanedTestFiles,
  TestContext
} from './setup';

describe('Slides API Integration Tests', () => {
  let context: TestContext;
  let testPresentationId: string;
  let testSlideId: string;

  beforeAll(async () => {
    console.log('\n🚀 Initializing Slides API integration tests...\n');
    context = await initializeTestContext();
    await validateSharedDriveAccess(context);
    await cleanupOrphanedTestFiles(context);

    // Create a test presentation
    const fileName = generateTestFileName('slides_test', 'gslides');
    const response = await context.slides.presentations.create({
      requestBody: {
        title: fileName
      }
    });

    testPresentationId = response.data.presentationId;
    testSlideId = response.data.slides[0].objectId;

    // Move to Shared Drive
    await context.drive.files.update({
      fileId: testPresentationId,
      addParents: context.config.sharedDrive.testFolderId,
      fields: 'id,parents',
      supportsAllDrives: true
    });

    trackCreatedFile(context, testPresentationId);
  }, 30000);

  afterAll(async () => {
    console.log('\n🧹 Cleaning up test files...\n');
    await cleanupTestFiles(context);
  }, 30000);

  describe('Presentation Metadata', () => {
    test('should get presentation properties', async () => {
      const response = await context.slides.presentations.get({
        presentationId: testPresentationId
      });

      const presentation = response.data;

      expect(presentation.presentationId).toBe(testPresentationId);
      expect(presentation.title).toBeDefined();
      expect(presentation.slides).toBeDefined();
      expect(presentation.slides.length).toBeGreaterThan(0);
    });

    test('should verify presentation is in Shared Drive', async () => {
      const response = await context.drive.files.get({
        fileId: testPresentationId,
        fields: 'id,name,driveId,parents',
        supportsAllDrives: true
      });

      const file = response.data;

      expect(file.driveId).toBeDefined();
      expect(file.parents).toContain(context.config.sharedDrive.testFolderId);
    });
  });

  describe('Slide Management', () => {
    test('should create a new slide', async () => {
      const response = await context.slides.presentations.batchUpdate({
        presentationId: testPresentationId,
        requestBody: {
          requests: [
            {
              createSlide: {
                insertionIndex: 1
              }
            }
          ]
        }
      });

      expect(response.data.replies).toBeDefined();
      expect(response.data.replies[0].createSlide).toBeDefined();
      expect(response.data.replies[0].createSlide.objectId).toBeDefined();
    });

    test('should get all slides', async () => {
      const response = await context.slides.presentations.get({
        presentationId: testPresentationId
      });

      const slides = response.data.slides;

      expect(slides.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Content Operations', () => {
    test('should insert text box', async () => {
      const response = await context.slides.presentations.batchUpdate({
        presentationId: testPresentationId,
        requestBody: {
          requests: [
            {
              createShape: {
                objectId: 'TestTextBox_' + Date.now(),
                shapeType: 'TEXT_BOX',
                elementProperties: {
                  pageObjectId: testSlideId,
                  size: {
                    height: { magnitude: 100, unit: 'PT' },
                    width: { magnitude: 300, unit: 'PT' }
                  },
                  transform: {
                    scaleX: 1,
                    scaleY: 1,
                    translateX: 100,
                    translateY: 100,
                    unit: 'PT'
                  }
                }
              }
            }
          ]
        }
      });

      expect(response.data.replies).toBeDefined();
      expect(response.data.replies[0].createShape).toBeDefined();
    });

    test('should insert shape', async () => {
      const response = await context.slides.presentations.batchUpdate({
        presentationId: testPresentationId,
        requestBody: {
          requests: [
            {
              createShape: {
                objectId: 'TestShape_' + Date.now(),
                shapeType: 'RECTANGLE',
                elementProperties: {
                  pageObjectId: testSlideId,
                  size: {
                    height: { magnitude: 150, unit: 'PT' },
                    width: { magnitude: 150, unit: 'PT' }
                  },
                  transform: {
                    scaleX: 1,
                    scaleY: 1,
                    translateX: 400,
                    translateY: 100,
                    unit: 'PT'
                  }
                }
              }
            }
          ]
        }
      });

      expect(response.data.replies).toBeDefined();
      expect(response.data.replies[0].createShape).toBeDefined();
    });
  });

  describe('Formatting', () => {
    test('should update page background', async () => {
      const response = await context.slides.presentations.batchUpdate({
        presentationId: testPresentationId,
        requestBody: {
          requests: [
            {
              updatePageProperties: {
                objectId: testSlideId,
                pageProperties: {
                  pageBackgroundFill: {
                    solidFill: {
                      color: {
                        rgbColor: {
                          red: 0.95,
                          green: 0.95,
                          blue: 1.0
                        }
                      }
                    }
                  }
                },
                fields: 'pageBackgroundFill.solidFill.color'
              }
            }
          ]
        }
      });

      expect(response.data.replies).toBeDefined();
    });
  });

  describe('Slide Deletion', () => {
    test('should delete a slide', async () => {
      // Get the second slide ID
      const presentation = await context.slides.presentations.get({
        presentationId: testPresentationId
      });
      const slideToDelete = presentation.data.slides[1].objectId;

      const response = await context.slides.presentations.batchUpdate({
        presentationId: testPresentationId,
        requestBody: {
          requests: [
            {
              deleteObject: {
                objectId: slideToDelete
              }
            }
          ]
        }
      });

      expect(response.data.replies).toBeDefined();

      // Verify slide is deleted
      const updatedPresentation = await context.slides.presentations.get({
        presentationId: testPresentationId
      });
      expect(updatedPresentation.data.slides.length).toBe(presentation.data.slides.length - 1);
    });
  });
});
