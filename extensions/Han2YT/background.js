// ============================================================
//  Han2YT — background service worker
//  Dùng chrome.debugger để GÕ CHỮ THẬT vào ô prompt (Slate),
//  Slate chỉ nhận sự kiện thật nên phải đi đường này.
// ============================================================

console.log("[Han2YT] === Background service worker loaded ===");

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((e) => console.warn("[Han2YT] setPanelBehavior:", e));
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let attachedTab = null;

// Nếu người dùng bấm Hủy thanh vàng -> debugger tự tách -> reset trạng thái
chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === attachedTab) {
    console.warn("[Han2YT] debugger bị tách khỏi tab", source.tabId);
    attachedTab = null;
  }
});

function sendCmd(tabId, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params || {}, (res) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res);
    });
  });
}

async function ensureAttached(tabId) {
  if (attachedTab === tabId) return;
  if (attachedTab !== null) {
    try {
      await chrome.debugger.detach({ tabId: attachedTab });
    } catch (_) {}
    attachedTab = null;
  }
  await new Promise((resolve, reject) => {
    chrome.debugger.attach({ tabId }, "1.3", () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
  attachedTab = tabId;
}

async function detach() {
  if (attachedTab !== null) {
    try {
      await chrome.debugger.detach({ tabId: attachedTab });
    } catch (_) {}
    attachedTab = null;
  }
}

// Gõ prompt + Enter bằng input THẬT qua CDP
async function debugTypeAndSubmit(tabId, x, y, prompt) {
  await ensureAttached(tabId);

  // 1) click vào ô để đặt con trỏ (focus thật)
  await sendCmd(tabId, "Input.dispatchMouseEvent", {
    type: "mousePressed", x, y, button: "left", clickCount: 1,
  });
  await sendCmd(tabId, "Input.dispatchMouseEvent", {
    type: "mouseReleased", x, y, button: "left", clickCount: 1,
  });
  await wait(180);

  // 2) chọn hết (Ctrl+A) để xoá nội dung cũ nếu có
  await sendCmd(tabId, "Input.dispatchKeyEvent", {
    type: "keyDown", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65,
  });
  await sendCmd(tabId, "Input.dispatchKeyEvent", {
    type: "keyUp", modifiers: 2, key: "a", code: "KeyA", windowsVirtualKeyCode: 65,
  });
  await wait(60);

  // 3) GÕ CHỮ THẬT — Slate nhận chuẩn 100%
  await sendCmd(tabId, "Input.insertText", { text: prompt });
  await wait(250);

  // 4) Enter để gửi (key thật)
  await sendCmd(tabId, "Input.dispatchKeyEvent", {
    type: "rawKeyDown", key: "Enter", code: "Enter",
    windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
  });
  await sendCmd(tabId, "Input.dispatchKeyEvent", {
    type: "keyUp", key: "Enter", code: "Enter",
    windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13,
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "DEBUG_SUBMIT") {
    debugTypeAndSubmit(msg.tabId, msg.x, msg.y, msg.prompt)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
    return true;
  }

  if (msg.type === "DEBUG_DETACH") {
    detach().then(() => sendResponse({ ok: true }));
    return true;
  }
});

// ============================================================
//  Bridge orchestration: batch generate images via Google Flow
//  for VideoCloudAI storyboard
// ============================================================

function sendToFlowTab(tabId, msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (resp) => {
      if (chrome.runtime.lastError) resolve(null);
      else resolve(resp);
    });
  });
}

const PROVIDER_CONFIG = {
  flow: {
    tabQuery: "https://labs.google/fx/*",
    tabMatch: /\/tools\/flow/,
    contentScript: "content.js",
  },
  chatgpt: {
    tabQuery: "https://chatgpt.com/*",
    tabMatch: /chatgpt\.com/,
    contentScript: "content_chatgpt.js",
  },
  grok: {
    tabQuery: "https://grok.com/*",
    tabMatch: /grok\.com/,
    contentScript: "content_grok.js",
  },
};

async function findFlowTab() {
  const tabs = await chrome.tabs.query({ url: "https://labs.google/fx/*" });
  return tabs.find((t) => /\/tools\/flow/.test(t.url || "")) || null;
}

async function findProviderTab(provider) {
  const cfg = PROVIDER_CONFIG[provider] || PROVIDER_CONFIG.flow;
  const tabs = await chrome.tabs.query({ url: cfg.tabQuery });
  return tabs.find((t) => cfg.tabMatch.test(t.url || "")) || null;
}

async function ensureContentScript(tabId, provider) {
  const cfg = PROVIDER_CONFIG[provider] || PROVIDER_CONFIG.flow;
  let resp = await sendToFlowTab(tabId, { type: "PING" });
  if (resp) {
    console.log("[Han2YT] Content script already active on tab", tabId);
    return true;
  }
  console.log("[Han2YT] Content script not responding, injecting", cfg.contentScript);
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: [cfg.contentScript],
    });
    await wait(600);
    resp = await sendToFlowTab(tabId, { type: "PING" });
    if (resp) {
      console.log("[Han2YT] Content script injected OK");
      return true;
    }
    console.warn("[Han2YT] First PING after injection failed, retrying...");
    await wait(1000);
    resp = await sendToFlowTab(tabId, { type: "PING" });
    return !!resp;
  } catch (e) {
    console.warn("[Han2YT] Cannot inject content script:", e);
    return false;
  }
}

let batchStopped = false;
let batchProvider = "flow";

chrome.runtime.onConnect.addListener((port) => {
  console.log("[Han2YT] Port connected:", port.name);
  if (port.name !== "flow-bridge") return;

  port.onMessage.addListener(async (msg) => {
    if (msg.type === "FLOW_BATCH_STOP") {
      batchStopped = true;
      const tab = await findProviderTab(batchProvider);
      if (tab) await sendToFlowTab(tab.id, { type: "STOP" });
      return;
    }

    if (msg.type !== "FLOW_BATCH_START") return;

    batchStopped = false;
    const { prompts, delayMin, delayMax, mediaType, provider } = msg;
    const providerKey = (provider === "google-flow" ? "flow" : provider) || "flow";
    batchProvider = providerKey;
    const provCfg = PROVIDER_CONFIG[providerKey] || PROVIDER_CONFIG.flow;
    const isVideo = mediaType === "video";
    const mediaLabel = isVideo ? "video" : "image";
    let doneCount = 0;

    console.log("[Han2YT] === BATCH START ===", prompts.length, "prompts, mediaType:", mediaType, "provider:", providerKey);

    // 1) Find provider tab
    const tab = await findProviderTab(providerKey);
    console.log("[Han2YT] Provider tab:", tab ? `id=${tab.id} url=${tab.url}` : "NOT FOUND");
    if (!tab) {
      const labels = { flow: "Google Flow (labs.google/fx/tools/flow)", chatgpt: "ChatGPT (chatgpt.com)", grok: "Grok (grok.com)" };
      port.postMessage({ type: "FLOW_BATCH_ERROR", error: `No ${labels[providerKey] || providerKey} tab found. Open it first.` });
      return;
    }

    // 2) Ensure content script is loaded
    console.log("[Han2YT] Ensuring content script...");
    const csReady = await ensureContentScript(tab.id, providerKey);
    console.log("[Han2YT] Content script ready:", csReady);
    if (!csReady) {
      port.postMessage({ type: "FLOW_BATCH_ERROR", error: `Cannot connect to ${providerKey} page. Reload the tab and try again.` });
      return;
    }

    // 3) Focus the Flow tab
    try {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    } catch (_) {}
    await wait(1500); // wait for Flow UI to render after focus

    const MAX_RETRIES = 3;
    const POLICY_REST_MIN = 10; // seconds
    const POLICY_REST_MAX = 20; // seconds

    // 4) Process each prompt
    for (let i = 0; i < prompts.length; i++) {
      if (batchStopped) {
        port.postMessage({ type: "FLOW_BATCH_DONE", total: prompts.length, done: doneCount });
        await detach();
        return;
      }

      const { timestamp, prompt } = prompts[i];
      let success = false;

      for (let attempt = 0; attempt < MAX_RETRIES && !success; attempt++) {
        if (batchStopped) break;

        const attemptLabel = attempt > 0 ? ` (retry ${attempt}/${MAX_RETRIES - 1})` : "";
        port.postMessage({
          type: "FLOW_PROGRESS",
          index: i,
          total: prompts.length,
          status: "generating",
          detail: `(${i + 1}/${prompts.length})${attemptLabel} Typing prompt...`,
        });

        try {
          // a) Get prompt box coordinates + snapshot baseline
          const box = await sendToFlowTab(tab.id, { type: "GET_BOX", mediaType: isVideo ? "video" : "image" });
          console.log("[Han2YT] GET_BOX result:", JSON.stringify(box));
          if (!box || !box.ok) throw new Error(box?.error || "Cannot find prompt input on Flow page");

          // b) Type prompt + Enter via debugger
          console.log("[Han2YT] Typing prompt at", box.x, box.y, ":", prompt.slice(0, 40));
          await debugTypeAndSubmit(tab.id, box.x, box.y, prompt);
          console.log("[Han2YT] Typed + submitted prompt OK");
          await wait(500);

          port.postMessage({
            type: "FLOW_PROGRESS",
            index: i,
            total: prompts.length,
            status: "waiting",
            detail: `(${i + 1}/${prompts.length})${attemptLabel} Waiting for ${mediaLabel}...`,
          });

          // c) Wait for new image/video
          const imgResp = await sendToFlowTab(tab.id, { type: isVideo ? "WAIT_VIDEO" : "WAIT_IMAGE" });
          if (batchStopped) break;

          // c2) Handle policy violation — rest and retry
          if (imgResp && imgResp.policyViolation) {
            const restSec = POLICY_REST_MIN + Math.random() * (POLICY_REST_MAX - POLICY_REST_MIN);
            const msg = imgResp.message || "Policy violation";
            console.warn(`[Han2YT] Policy violation on prompt ${i + 1}: ${msg}. Resting ${Math.round(restSec)}s...`);
            port.postMessage({
              type: "FLOW_PROGRESS",
              index: i,
              total: prompts.length,
              status: "policy_rest",
              detail: `(${i + 1}/${prompts.length}) Policy violation — resting ${Math.round(restSec)}s before retry...`,
            });
            await wait(restSec * 1000);
            continue; // retry this prompt
          }

          if (!imgResp || !imgResp.ok || !imgResp.src) {
            throw new Error(imgResp?.timeout ? "Timed out waiting for image" : "Failed to get image");
          }

          // d) Convert image to data URL
          port.postMessage({
            type: "FLOW_PROGRESS",
            index: i,
            total: prompts.length,
            status: "downloading",
            detail: `(${i + 1}/${prompts.length}) Downloading ${mediaLabel}...`,
          });

          let dataUrl;
          const imgSrc = imgResp.src;
          console.log(`[Han2YT] ${mediaLabel} src: ${imgSrc ? imgSrc.slice(0, 50) : "(empty)"}...`);

          if (!imgSrc) {
            throw new Error(`${mediaLabel} src is empty`);
          }

          if (/^data:/.test(imgSrc)) {
            dataUrl = imgSrc;
          } else {
            // Strategy 1: Try direct fetch from background (most reliable, no CORS issues for extension)
            if (/^https?:/.test(imgSrc)) {
              try {
                console.log(`[Han2YT] Fetching ${mediaLabel} directly from background...`);
                const resp = await fetch(imgSrc);
                if (resp.ok) {
                  const blob = await resp.blob();
                  dataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                  });
                }
              } catch (fetchErr) {
                console.warn(`[Han2YT] Direct fetch failed:`, fetchErr.message);
              }
            }

            // Strategy 2: Ask content script to convert
            if (!dataUrl) {
              const toDataType = isVideo ? "TODATAURL_VIDEO" : "TODATAURL";
              let dataResp = await sendToFlowTab(tab.id, { type: toDataType, src: imgSrc });

              if (!dataResp || (!dataResp.dataUrl && !dataResp.error)) {
                console.warn(`[Han2YT] ${toDataType} returned empty, retrying in 2s...`);
                await wait(2000);
                dataResp = await sendToFlowTab(tab.id, { type: toDataType, src: imgSrc });
              }

              if (dataResp && dataResp.dataUrl) {
                dataUrl = dataResp.dataUrl;
              } else {
                const errMsg = dataResp?.error || "unknown";
                console.error(`[Han2YT] ${toDataType} also failed:`, errMsg);
                throw new Error(`Failed to download ${mediaLabel}: ` + errMsg);
              }
            }
          }

          // e) Send image/video back to bridge for upload
          port.postMessage({
            type: "FLOW_IMAGE_READY",
            index: i,
            timestamp,
            prompt,
            dataUrl,
            mediaType: isVideo ? "video" : "image",
          });

          doneCount++;
          success = true;
          port.postMessage({
            type: "FLOW_PROGRESS",
            index: i,
            total: prompts.length,
            status: "done",
            detail: `(${i + 1}/${prompts.length}) Done!`,
          });

        } catch (err) {
          console.warn(`[Han2YT] Prompt ${i + 1} attempt ${attempt + 1} failed:`, err);
          if (attempt === MAX_RETRIES - 1) {
            // Final attempt failed
            port.postMessage({
              type: "FLOW_PROMPT_ERROR",
              index: i,
              total: prompts.length,
              timestamp,
              error: String(err.message || err),
            });
          } else {
            // Rest before retry on error too
            const restSec = POLICY_REST_MIN + Math.random() * (POLICY_REST_MAX - POLICY_REST_MIN);
            port.postMessage({
              type: "FLOW_PROGRESS",
              index: i,
              total: prompts.length,
              status: "error_rest",
              detail: `(${i + 1}/${prompts.length}) Error: ${err.message}. Resting ${Math.round(restSec)}s before retry...`,
            });
            await wait(restSec * 1000);
          }
        }
      }

      // f) Random delay before next prompt (skip after last)
      if (i < prompts.length - 1 && !batchStopped) {
        const delay = (delayMin + Math.random() * (delayMax - delayMin)) * 1000;
        port.postMessage({
          type: "FLOW_PROGRESS",
          index: i,
          total: prompts.length,
          status: "delay",
          detail: `Resting ${Math.round(delay / 1000)}s before next prompt...`,
        });
        await wait(delay);
      }
    }

    // 5) Done — detach debugger
    await detach();
    port.postMessage({ type: "FLOW_BATCH_DONE", total: prompts.length, done: doneCount });
  });
});
