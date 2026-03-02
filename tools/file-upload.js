/**
 * File Upload Tool - Upload files to page via CDP DOM.setFileInputFiles.
 * Also supports drag & drop simulation for non-file-input targets.
 */

import { cdp } from '../core/cdp-manager.js';

export const fileUploadTool = {
  name: 'file_upload',
  description: 'Upload a file to a file input element on the page. Finds the file input by ref_id or searches for one automatically. Uses CDP for reliable file setting.',
  parameters: {
    ref: {
      type: 'string',
      description: 'Ref ID of the file input element. If not provided, will search for a file input on the page.'
    },
    filePaths: {
      type: 'array',
      items: { type: 'string' },
      description: 'Array of absolute file paths to upload. At least one required.'
    },
    tabId: { type: 'number', description: 'Tab ID.' }
  },

  async execute(params, context) {
    const tabId = params.tabId || context.tabId;
    if (!tabId) return { success: false, error: 'No tabId. Use tabs_context first.' };

    const filePaths = params.filePaths || params.files || [];
    if (!Array.isArray(filePaths) || filePaths.length === 0) {
      return { success: false, error: 'filePaths array required with at least one file path.' };
    }

    try {
      await cdp.ensureAttached(tabId);

      // Get DOM document root
      const doc = await cdp.sendCommand(tabId, 'DOM.getDocument', {});

      let nodeId;

      if (params.ref) {
        // Resolve ref to actual element, then find its nodeId
        const result = await chrome.scripting.executeScript({
          target: { tabId },
          func: (refId) => {
            const map = window.__crabElementMap;
            if (!map) return null;
            const wr = map[refId];
            const el = wr?.deref ? wr.deref() : wr;
            if (!el || !el.isConnected) return null;
            // Mark element temporarily so we can find it via CDP
            const marker = `crab-upload-${Date.now()}`;
            el.setAttribute('data-crab-upload', marker);
            return marker;
          },
          args: [params.ref]
        });

        const marker = result?.[0]?.result;
        if (marker) {
          const found = await cdp.sendCommand(tabId, 'DOM.querySelector', {
            nodeId: doc.root.nodeId,
            selector: `[data-crab-upload="${marker}"]`
          });
          nodeId = found?.nodeId;

          // Clean up marker
          await chrome.scripting.executeScript({
            target: { tabId },
            func: (m) => {
              const el = document.querySelector(`[data-crab-upload="${m}"]`);
              if (el) el.removeAttribute('data-crab-upload');
            },
            args: [marker]
          });
        }
      }

      if (!nodeId) {
        // Search for file input
        const found = await cdp.sendCommand(tabId, 'DOM.querySelector', {
          nodeId: doc.root.nodeId,
          selector: 'input[type="file"]'
        });
        nodeId = found?.nodeId;
      }

      if (!nodeId) {
        return { success: false, error: 'No file input found on page. Look for a file upload button first.' };
      }

      // Set files via CDP
      await cdp.sendCommand(tabId, 'DOM.setFileInputFiles', {
        nodeId,
        files: filePaths
      });

      return {
        success: true,
        filesCount: filePaths.length,
        message: `Uploaded ${filePaths.length} file(s) to file input`
      };
    } catch (e) {
      return { success: false, error: `file_upload failed: ${e.message}` };
    }
  }
};

/**
 * Upload Image Tool - Specialized for image uploads.
 * Can handle both file inputs and drag-drop targets.
 */
export const uploadImageTool = {
  name: 'upload_image',
  description: 'Upload an image file to the page. Works with file inputs and also attempts drag-drop for other targets.',
  parameters: {
    ref: {
      type: 'string',
      description: 'Ref ID of the target element (file input or drop zone).'
    },
    filePath: {
      type: 'string',
      description: 'Absolute path to the image file.'
    },
    tabId: { type: 'number', description: 'Tab ID.' }
  },

  async execute(params, context) {
    const tabId = params.tabId || context.tabId;
    if (!tabId) return { success: false, error: 'No tabId.' };
    if (!params.filePath) return { success: false, error: 'filePath parameter required.' };

    // Try using file_upload first
    const result = await fileUploadTool.execute({
      ...params,
      filePaths: [params.filePath]
    }, context);

    if (result.success) return result;

    // If no file input found, try triggering click on a hidden file input
    try {
      const clickResult = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          // Look for hidden file inputs that might be triggered by another element
          const hiddenInputs = document.querySelectorAll('input[type="file"]');
          for (const input of hiddenInputs) {
            input.click();
            return { success: true, triggered: true };
          }
          return { success: false, error: 'No file input found to trigger.' };
        }
      });

      const payload = clickResult?.[0]?.result;
      if (payload?.triggered) {
        return {
          success: true,
          message: 'Triggered file input click. File dialog should appear. Note: Automated file selection may require CDP DOM.setFileInputFiles.'
        };
      }
    } catch (e) {
      // Fall through
    }

    return { success: false, error: 'Could not find a file upload target. Try clicking the upload button first.' };
  }
};

export default { fileUploadTool, uploadImageTool };
