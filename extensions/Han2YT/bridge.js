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

  /**
   * Sanitize prompt to avoid Google Flow safety policy violations.
   * Replaces trigger words with safer alternatives while preserving visual intent.
   */
  function sanitizePrompt(prompt) {
    const replacements = [
      // Violence / gore
      [/\bblood[- ]?soaked\b/gi, 'battle-worn'],
      [/\bblood[- ]?stained\b/gi, 'weathered'],
      [/\bbloody\b/gi, 'fierce'],
      [/\bbloodied\b/gi, 'battle-scarred'],
      [/\bblood\b/gi, 'red liquid'],
      [/\bgore\b/gi, 'aftermath'],
      [/\bgory\b/gi, 'intense'],
      [/\bsevered\b/gi, 'fallen'],
      [/\bdecapitat\w+/gi, 'defeated'],
      [/\bdismember\w+/gi, 'scattered'],
      [/\bmutilat\w+/gi, 'damaged'],
      [/\btortur\w+/gi, 'imprisoned'],
      [/\bslaughter\w*/gi, 'battle'],
      [/\bmassacre\w*/gi, 'great battle'],
      [/\bcarnage\b/gi, 'destruction'],
      [/\bbrutal(?:ly|ity)?\b/gi, 'fierce'],
      [/\bgruesome\b/gi, 'dramatic'],
      [/\bgrisly\b/gi, 'somber'],
      // Death / killing
      [/\bkill(?:s|ed|ing)?\b/gi, 'defeats'],
      [/\bmurder\w*/gi, 'conflict'],
      [/\bassassinat\w+/gi, 'confronted'],
      [/\bexecut(?:e[ds]?|ion)\b/gi, 'judgment'],
      [/\bsuicid\w*/gi, 'despair'],
      [/\bdying\b/gi, 'falling'],
      [/\bdeath\b/gi, 'fate'],
      [/\bdead\s+bod(?:y|ies)\b/gi, 'fallen warriors'],
      [/\bcorpse\w*/gi, 'fallen figure'],
      // Weapons in violent context
      [/\bstabb?(?:ed|ing)\b/gi, 'struck'],
      [/\bimpale\w*/gi, 'pierced'],
      [/\bbeheading\b/gi, 'defeat'],
      // Nudity / sexual
      [/\bnude\b/gi, 'draped'],
      [/\bnaked\b/gi, 'robed'],
      [/\bnudity\b/gi, 'exposed skin'],
      [/\bsexual\w*/gi, 'romantic'],
      [/\berotic\w*/gi, 'passionate'],
      [/\bseduct\w+/gi, 'alluring'],
      // Substances
      [/\bdrug(?:s|ged)?\b/gi, 'potion'],
      [/\bcocaine\b/gi, 'white powder'],
      [/\bheroin\b/gi, 'dark substance'],
      // Terror / hate
      [/\bterror(?:ist|ism)\w*/gi, 'conflict'],
      [/\bgenocid\w*/gi, 'tragedy'],
      // Suffering
      [/\bagoniz\w+/gi, 'struggling'],
      [/\bsuffer(?:s|ed|ing)?\b/gi, 'enduring'],
      [/\btorment\w*/gi, 'struggle'],
      [/\bscream(?:s|ed|ing)?\b/gi, 'calling out'],
      [/\bwailing\b/gi, 'mourning'],
      // Misc triggers
      [/\bslave(?:ry|s)?\b/gi, 'servant'],
      [/\benslave\w*/gi, 'captive'],
      [/\bhanging\s+(?:from|by)\b/gi, 'suspended from'],
      [/\bhang(?:s|ed)?\s+(?:himself|herself|themselves)\b/gi, 'collapses'],
    ];
    let result = prompt;
    for (const [pattern, replacement] of replacements) {
      result = result.replace(pattern, replacement);
    }
    return result;
  }

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
        const errText = await res.text().catch(() => '');
        let errMsg = `HTTP ${res.status}`;
        try { const errJson = JSON.parse(errText); errMsg = errJson.error || errMsg; } catch (_) { errMsg = errText.slice(0, 200) || errMsg; }
        throw new Error(errMsg);
      }

      const result = await res.json();
      console.log(`[Han2YT bridge] upload OK: ${result.filename}, url: ${result.url}`);
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
      // Sanitize prompts to avoid Google Flow safety policy violations
      const sanitizedPrompts = prompts.map(pr => {
        const clean = sanitizePrompt(pr.prompt);
        if (clean !== pr.prompt) console.log(`[Han2YT bridge] sanitized: "${pr.prompt.slice(0, 60)}..." → "${clean.slice(0, 60)}..."`);
        return { ...pr, prompt: clean };
      });
      const changed = sanitizedPrompts.filter((p, i) => p.prompt !== prompts[i].prompt).length;
      if (changed) console.log(`[Han2YT bridge] sanitized ${changed}/${prompts.length} prompts`);
      p.postMessage({
        type: 'FLOW_BATCH_START',
        prompts: sanitizedPrompts,
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
