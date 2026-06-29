// ============================================================
//  Han2YT — bridge.js
//  Content script injected into VideoCloudAI (localhost:5174).
//  Bridges the web app with the Chrome extension to generate
//  images/videos via Google Flow and upload results back to the backend.
//
//  Communication:
//    Page -> bridge.js:  CustomEvent 'Han2YT_flow_start' / 'Han2YT_flow_stop' / 'Han2YT_flow_ping'
//    bridge.js -> Page:  CustomEvent 'Han2YT_flow_progress' / 'Han2YT_flow_image' / 'Han2YT_flow_done' / 'Han2YT_flow_error' / 'Han2YT_flow_pong'
//    bridge.js <-> background.js:  chrome.runtime.Port ('flow-bridge')
// ============================================================

// Remove old listeners on re-injection (extension reload)
if (window.__HAN2YT_BRIDGE_CLEANUP__) {
  window.__HAN2YT_BRIDGE_CLEANUP__();
}

(function () {
  let port = null;
  let running = false;
  let pendingUploads = 0;
  let deferredDone = null;

  function emit(eventName, detail) {
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  }

  function isExtensionValid() {
    try {
      return !!(chrome && chrome.runtime && chrome.runtime.id);
    } catch (_) {
      return false;
    }
  }

  function connectPort() {
    if (port) {
      try { port.disconnect(); } catch (_) {}
      port = null;
    }
    if (!isExtensionValid()) {
      // Try to auto-reload the page once
      if (!window.__HAN2YT_RELOAD_ATTEMPTED__) {
        window.__HAN2YT_RELOAD_ATTEMPTED__ = true;
        console.warn('[Han2YT bridge] Extension context invalid, auto-reloading page...');
        window.location.reload();
        throw new Error('Reloading page...');
      }
      throw new Error('Extension was reloaded. Please refresh this page (Ctrl+Shift+R) and try again.');
    }
    port = chrome.runtime.connect({ name: 'flow-bridge' });
    port.onDisconnect.addListener(() => {
      port = null;
      if (running) {
        running = false;
        emit('Han2YT_flow_error', { error: 'Extension disconnected' });
      }
    });
    port.onMessage.addListener(handleBgMessage);
    return port;
  }

  function handleBgMessage(msg) {
    if (!msg || !msg.type) return;

    if (msg.type === 'FLOW_PROGRESS') {
      emit('Han2YT_flow_progress', {
        index: msg.index,
        total: msg.total,
        status: msg.status,
        detail: msg.detail,
      });
    }

    if (msg.type === 'FLOW_IMAGE_READY') {
      uploadMedia(msg.dataUrl, msg.index, msg.timestamp, msg.prompt, msg.mediaType);
    }

    if (msg.type === 'FLOW_PROMPT_ERROR') {
      emit('Han2YT_flow_progress', {
        index: msg.index,
        total: msg.total,
        status: 'error',
        detail: msg.error,
      });
      emit('Han2YT_flow_image', {
        index: msg.index,
        timestamp: msg.timestamp,
        status: 'error',
        error: msg.error,
      });
    }

    if (msg.type === 'FLOW_BATCH_DONE') {
      if (pendingUploads > 0) {
        deferredDone = { total: msg.total, done: msg.done };
      } else {
        running = false;
        emit('Han2YT_flow_done', { total: msg.total, done: msg.done });
      }
    }

    if (msg.type === 'FLOW_BATCH_ERROR') {
      running = false;
      emit('Han2YT_flow_error', { error: msg.error });
    }
  }

  function flushDeferredDone() {
    if (deferredDone && pendingUploads <= 0) {
      running = false;
      emit('Han2YT_flow_done', deferredDone);
      deferredDone = null;
    }
  }

  async function uploadMedia(dataUrl, index, timestamp, prompt, mediaType) {
    pendingUploads++;
    try {
      const isVideo = mediaType === 'video';
      const safeName = (prompt || (isVideo ? 'video' : 'image')).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '-').slice(0, 40);
      const ext = isVideo ? 'mp4' : 'png';
      const filename = `flow_${String(index + 1).padStart(3, '0')}_${safeName}_${Date.now()}.${ext}`;

      const sizeKB = Math.round((dataUrl?.length || 0) / 1024);
      console.log(`[Han2YT bridge] uploading ${mediaType || 'image'}: ${filename}, dataUrl prefix: ${dataUrl?.slice(0, 50)}, size: ${sizeKB}KB`);

      // Convert data URL to Blob and upload via FormData (handles any size)
      const byteStr = atob(dataUrl.split(',')[1]);
      const mimeMatch = dataUrl.match(/^data:([^;]+);/);
      const mime = mimeMatch ? mimeMatch[1] : (isVideo ? 'video/mp4' : 'image/png');
      const ab = new ArrayBuffer(byteStr.length);
      const ia = new Uint8Array(ab);
      for (let j = 0; j < byteStr.length; j++) ia[j] = byteStr.charCodeAt(j);
      const blob = new Blob([ab], { type: mime });
      const fd = new FormData();
      fd.append('file', blob, filename);

      const res = await fetch('/api/image/upload-single', {
        method: 'POST',
        body: fd,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Upload failed' }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const result = await res.json();
      emit('Han2YT_flow_image', {
        index,
        timestamp,
        filename: result.filename,
        url: result.url,
        status: 'done',
      });
    } catch (err) {
      console.error('[Han2YT bridge] upload error:', err);
      emit('Han2YT_flow_image', {
        index,
        timestamp,
        status: 'error',
        error: String(err.message || err),
      });
    } finally {
      pendingUploads--;
      flushDeferredDone();
    }
  }

  // Event handlers
  function onStart(e) {
    if (running) {
      console.warn('[Han2YT bridge] Previous batch still running — resetting.');
      running = false;
      if (port) {
        try { port.postMessage({ type: 'FLOW_BATCH_STOP' }); } catch (_) {}
      }
    }

    const { prompts, delayMin, delayMax, mediaType, provider } = e.detail || {};
    if (!prompts || !prompts.length) {
      emit('Han2YT_flow_error', { error: 'No prompts provided' });
      return;
    }

    running = true;
    pendingUploads = 0;
    deferredDone = null;
    try {
      const p = connectPort();
      p.postMessage({
        type: 'FLOW_BATCH_START',
        prompts,
        delayMin: delayMin ?? 5,
        delayMax: delayMax ?? 15,
        mediaType: mediaType || 'image',
        provider: (provider === 'google-flow' ? 'flow' : provider) || 'flow',
      });
    } catch (err) {
      running = false;
      emit('Han2YT_flow_error', { error: 'Cannot connect to extension: ' + String(err.message || err) });
    }
  }

  function onStop() {
    running = false;
    if (port) {
      try { port.postMessage({ type: 'FLOW_BATCH_STOP' }); } catch (_) {}
    }
  }

  function onPing() {
    emit('Han2YT_flow_pong', { ok: isExtensionValid() });
  }

  window.addEventListener('Han2YT_flow_start', onStart);
  window.addEventListener('Han2YT_flow_stop', onStop);
  window.addEventListener('Han2YT_flow_ping', onPing);

  // Expose cleanup so next injection can remove old listeners
  window.__HAN2YT_BRIDGE_CLEANUP__ = function () {
    window.removeEventListener('Han2YT_flow_start', onStart);
    window.removeEventListener('Han2YT_flow_stop', onStop);
    window.removeEventListener('Han2YT_flow_ping', onPing);
    if (port) {
      try { port.disconnect(); } catch (_) {}
      port = null;
    }
    running = false;
  };

  console.log('[Han2YT] bridge.js loaded (v2) on VideoCloudAI page.');
})();
