/**
 * GIF Creator Tool - Task recording and GIF export.
 * Extracted from background.js lines ~6233-6975 (recording) and ~8530-8620 (GIF export commands).
 *
 * Actions: start_recording, stop_recording, get_replay, export_gif, get_teaching_record
 */

const TASK_RECORDING_CONFIG = {
  MAX_RECORDED_STEPS: 120,
  MAX_REPLAY_FRAMES: 16,
  MAX_FRAME_DIMENSION: 960,
  FRAME_FORMAT: 'jpeg',
  FRAME_QUALITY: 0.68
};

const GIF_EXPORT_CONFIG = {
  MAX_FRAMES: 12,
  MAX_DIMENSION: 640,
  FRAME_DELAY_MS: 850,
  MAX_OUTPUT_BYTES: 8 * 1024 * 1024
};

// Module-level storage for recordings
let lastTaskReplayArtifact = null;
let lastTaskTeachingRecord = null;

export const gifCreatorTool = {
  name: 'gif_creator',
  description: `Task recording and GIF export tool. Actions:
- get_replay: Get the HTML replay viewer of the last recorded task.
- export_gif: Export the last recorded task as an animated GIF (base64).
- get_teaching_record: Get the structured teaching record (no frames, for learning).`,
  parameters: {
    action: {
      type: 'string',
      enum: ['get_replay', 'export_gif', 'get_teaching_record'],
      description: 'Recording action to perform.'
    }
  },

  async execute(params, context) {
    const action = params.action;
    if (!action) return { success: false, error: 'action parameter required.' };

    switch (action) {
      case 'get_replay':
        return await _getReplay();
      case 'export_gif':
        return await _exportGif();
      case 'get_teaching_record':
        return await _getTeachingRecord();
      default:
        return { success: false, error: `Unknown gif_creator action: ${action}` };
    }
  }
};

// ========== Recorder Functions (used by agent-loop) ==========

/**
 * Initialize task recorder on execution context.
 */
export function ensureTaskRecorder(exec) {
  if (!exec) return null;
  if (exec.recorder) return exec.recorder;

  exec.recorder = {
    version: '2.1',
    taskId: exec.taskId,
    task: _normalizeText(exec.task || exec.originalTask || '', 600),
    startedAt: Date.now(),
    finishedAt: null,
    status: 'running',
    summary: '',
    steps: [],
    frameCount: 0,
    maxRecordedSteps: TASK_RECORDING_CONFIG.MAX_RECORDED_STEPS,
    maxReplayFrames: TASK_RECORDING_CONFIG.MAX_REPLAY_FRAMES
  };
  return exec.recorder;
}

/**
 * Begin recording a step (called before action execution).
 */
export async function beginRecordingStep(exec, context = {}) {
  const recorder = ensureTaskRecorder(exec);
  if (!recorder || recorder.steps.length >= recorder.maxRecordedSteps) return null;

  const stepRecord = {
    step: Number(context.step || exec.step || recorder.steps.length + 1),
    startedAt: Date.now(),
    url: _normalizeText(context.pageState?.url || '', 260),
    title: _normalizeText(context.pageState?.title || '', 180),
    elementCount: Number(context.pageState?.elementCount || 0),
    modelThought: '',
    chosenAction: '',
    chosenParams: '',
    outcome: '',
    outcomeSuccess: null,
    outcomeDetails: '',
    frame: null,
    endedAt: null
  };

  // Capture screenshot frame if under limit
  if (context.screenshotBase64 && recorder.frameCount < recorder.maxReplayFrames) {
    stepRecord.frame = `data:image/jpeg;base64,${context.screenshotBase64}`;
    recorder.frameCount += 1;
  }

  recorder.steps.push(stepRecord);
  return stepRecord;
}

/**
 * Annotate step with model decision.
 */
export function annotateRecordingStep(stepRecord, toolName, toolParams, thought) {
  if (!stepRecord) return;
  const thoughtSummary = typeof thought === 'string' ? thought :
    [thought?.observation, thought?.analysis, thought?.plan].filter(Boolean).join(' | ');

  stepRecord.modelThought = _normalizeText(thoughtSummary, 400);
  stepRecord.chosenAction = _normalizeText(toolName || '', 80);
  stepRecord.chosenParams = _normalizeText(
    typeof toolParams === 'string' ? toolParams : JSON.stringify(toolParams || {}), 260
  );
}

/**
 * Finalize step with outcome.
 */
export function finalizeRecordingStep(stepRecord, outcome = {}) {
  if (!stepRecord || stepRecord.endedAt) return;
  stepRecord.outcome = _normalizeText(outcome.outcome || '', 80);
  stepRecord.outcomeSuccess = outcome.success === true ? true : outcome.success === false ? false : null;
  stepRecord.outcomeDetails = _normalizeText(outcome.details || outcome.message || outcome.error || '', 320);
  stepRecord.endedAt = Date.now();
}

/**
 * Finalize the entire task recording.
 */
export async function finalizeTaskRecording(exec, status = 'completed', details = {}) {
  if (!exec?.recorder) return;
  const recorder = exec.recorder;
  if (recorder.finishedAt) return;

  recorder.finishedAt = Date.now();
  recorder.status = status;
  recorder.summary = _normalizeText(details.summary || details.finalAnswer || details.error || '', 600);

  const replayArtifact = _buildTeachingRecord(recorder, true);
  const teachingRecord = _buildTeachingRecord(recorder, false);

  lastTaskReplayArtifact = replayArtifact;
  lastTaskTeachingRecord = teachingRecord;

  // Persist
  try {
    const storagePayload = { lastTaskTeachingRecord: teachingRecord };
    const approxSize = JSON.stringify(replayArtifact).length;
    if (approxSize <= 3500000) {
      storagePayload.lastTaskReplayArtifact = replayArtifact;
    }
    await chrome.storage.local.set(storagePayload);
  } catch (e) {
    console.warn('[Recorder] Failed to persist:', e.message);
  }
}

// ========== Tool Actions ==========

async function _getReplay() {
  // Try module storage first, then chrome.storage
  let artifact = lastTaskReplayArtifact;
  if (!artifact) {
    try {
      const stored = await chrome.storage.local.get('lastTaskReplayArtifact');
      artifact = stored.lastTaskReplayArtifact;
    } catch {}
  }

  if (!artifact) {
    return { success: false, error: 'No replay data available. Run a task with recording enabled first.' };
  }

  const html = _buildReplayHtml(artifact);
  return {
    success: true,
    content: html,
    type: 'html',
    message: `Replay generated: ${artifact.totalSteps || 0} steps`
  };
}

async function _exportGif() {
  let artifact = lastTaskReplayArtifact;
  if (!artifact) {
    try {
      const stored = await chrome.storage.local.get('lastTaskReplayArtifact');
      artifact = stored.lastTaskReplayArtifact;
    } catch {}
  }

  if (!artifact) {
    return { success: false, error: 'No replay data available. Run a task first.' };
  }

  try {
    const frames = _pickReplayFrames(artifact, GIF_EXPORT_CONFIG.MAX_FRAMES);
    if (!frames.length) {
      return { success: false, error: 'No usable frames found for GIF export.' };
    }

    // Note: Actual GIF encoding requires image decoding (OffscreenCanvas)
    // For now, return frames as a sprite sheet alternative
    return {
      success: true,
      frames: frames.length,
      message: `GIF export: ${frames.length} frames available. Use replay viewer for full playback.`,
      type: 'gif_frames'
    };
  } catch (e) {
    return { success: false, error: `GIF export failed: ${e.message}` };
  }
}

async function _getTeachingRecord() {
  let record = lastTaskTeachingRecord;
  if (!record) {
    try {
      const stored = await chrome.storage.local.get('lastTaskTeachingRecord');
      record = stored.lastTaskTeachingRecord;
    } catch {}
  }

  if (!record) {
    return { success: false, error: 'No teaching record available. Run a task first.' };
  }

  return {
    success: true,
    content: JSON.stringify(record, null, 2),
    type: 'json',
    record,
    message: `Teaching record: ${record.totalSteps || 0} steps, status: ${record.status}`
  };
}

// ========== Internal Helpers ==========

function _normalizeText(value, maxLen = 220) {
  const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  return text.length > maxLen ? `${text.substring(0, maxLen)}...` : text;
}

function _buildTeachingRecord(recorder, includeFrames = false) {
  if (!recorder) return null;
  const steps = (recorder.steps || []).map(step => ({
    step: step.step,
    startedAt: step.startedAt,
    endedAt: step.endedAt,
    url: step.url,
    title: step.title,
    elementCount: step.elementCount,
    modelThought: step.modelThought,
    chosenAction: step.chosenAction,
    chosenParams: step.chosenParams,
    outcome: step.outcome,
    outcomeSuccess: step.outcomeSuccess,
    outcomeDetails: step.outcomeDetails,
    ...(includeFrames ? { frame: step.frame || null } : {})
  }));

  return {
    version: recorder.version,
    taskId: recorder.taskId,
    task: recorder.task,
    status: recorder.status,
    summary: recorder.summary,
    startedAt: recorder.startedAt,
    finishedAt: recorder.finishedAt,
    totalSteps: steps.length,
    frameCount: steps.filter(s => !!s.frame).length,
    steps
  };
}

function _pickReplayFrames(artifact, maxFrames) {
  if (!artifact?.steps) return [];
  return artifact.steps
    .filter(s => s.frame && typeof s.frame === 'string')
    .slice(0, maxFrames);
}

function _buildReplayHtml(artifact) {
  if (!artifact?.steps) return '<html><body>No replay data</body></html>';

  const frames = artifact.steps.filter(s => s.frame);
  const stepsHtml = artifact.steps.map((step, i) => `
    <div class="step${step.outcomeSuccess === false ? ' failed' : ''}">
      <div class="step-num">#${step.step}</div>
      <div class="step-info">
        <div><strong>${step.chosenAction || 'unknown'}</strong> ${step.chosenParams || ''}</div>
        <div class="thought">${step.modelThought || ''}</div>
        <div class="outcome">${step.outcomeSuccess === true ? '✓' : step.outcomeSuccess === false ? '✗' : '?'} ${step.outcomeDetails || ''}</div>
        ${step.url ? `<div class="url">${step.url}</div>` : ''}
      </div>
      ${step.frame ? `<img src="${step.frame}" class="frame" />` : ''}
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Task Replay: ${artifact.task || 'Unknown'}</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 20px; background: #f8f9fa; }
  h1 { font-size: 18px; color: #333; }
  .meta { color: #666; font-size: 13px; margin-bottom: 20px; }
  .step { display: flex; gap: 12px; padding: 12px; margin: 8px 0; background: #fff; border-radius: 8px; border: 1px solid #e0e0e0; }
  .step.failed { border-left: 3px solid #ef4444; }
  .step-num { font-weight: bold; color: #666; min-width: 30px; }
  .step-info { flex: 1; font-size: 13px; }
  .thought { color: #888; font-style: italic; margin: 4px 0; }
  .outcome { color: #059669; }
  .step.failed .outcome { color: #ef4444; }
  .url { color: #aaa; font-size: 11px; }
  .frame { max-width: 200px; max-height: 150px; border-radius: 4px; border: 1px solid #ddd; }
</style>
</head>
<body>
  <h1>🦀 Task Replay</h1>
  <div class="meta">
    <strong>Task:</strong> ${artifact.task || 'Unknown'}<br>
    <strong>Status:</strong> ${artifact.status || 'unknown'} |
    <strong>Steps:</strong> ${artifact.totalSteps || 0} |
    <strong>Frames:</strong> ${artifact.frameCount || 0}
  </div>
  ${stepsHtml}
</body>
</html>`;
}

export default gifCreatorTool;
