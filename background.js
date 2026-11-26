const BLINK_API = "https://core.blink.new/api";
const BLINK_KEY = "blnk_pk_vfRDduQdwnIgNQHiNu4e9h-32fbkJyj-";
const DEFAULT_RULES = [
  { pattern: "*://*.googleusercontent.com/*=s*-c", type: "photo", custom: false },
  { pattern: "*://*.gravatar.com/avatar/*", type: "photo", custom: false },
  { pattern: "*://avatars.githubusercontent.com/*", type: "photo", custom: false },
  { pattern: "*://cdn.discordapp.com/avatars/*", type: "photo", custom: false },
  { pattern: "*://*.fbcdn.net/*", type: "photo", custom: false }
];
function wildcardRegex(pattern) {
  return "^" + pattern.replace(/[.+?^{}$()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$";
}
async function applyRules(rules = DEFAULT_RULES, enabled = true) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.filter(rule => rule.id >= 1000 && rule.id < 6000).map(rule => rule.id);
  const photoRules = rules.filter(rule => (rule.type || "photo") === "photo");
  const addRules = enabled ? photoRules.slice(0, 1000).map((rule, index) => ({
    id: 1000 + index, priority: 1, action: { type: "block" },
    condition: { regexFilter: wildcardRegex(rule.pattern), resourceTypes: ["image"] }
  })) : [];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}
async function syncStoredRules() {
  const data = await chrome.storage.local.get({ loweryRules: DEFAULT_RULES, loweryEnabled: true });
  await applyRules(Array.isArray(data.loweryRules) ? data.loweryRules : DEFAULT_RULES, data.loweryEnabled !== false);
}
function makeSmartPattern(rawUrl) {
  const url = new URL(rawUrl);
  const segments = url.pathname.split("/").filter(Boolean);
  const semanticIndex = segments.findIndex(segment => /profile|avatar|photo|picture/i.test(segment));
  if (semanticIndex >= 0) {
    const stablePart = (segments[semanticIndex].match(/^(profile|avatar|photo|picture)/i) || [segments[semanticIndex]])[0];
    const prefix = segments.slice(0, Math.max(0, semanticIndex - 1));
    return "*://" + url.hostname + "/" + (prefix.length ? prefix.join("/") + "/" : "") + "*/" + stablePart + "*";
  }
  const mediaIndex = segments.findIndex(segment => /image|media|upload/i.test(segment));
  if (mediaIndex >= 0) {
    const prefix = segments.slice(0, mediaIndex);
    const stablePart = (segments[mediaIndex].match(/^(image|media|upload)/i) || [segments[mediaIndex]])[0];
    return "*://" + url.hostname + "/" + (prefix.length ? prefix.join("/") + "/" : "") + "*" + stablePart + "*";
  }
  const slash = url.pathname.lastIndexOf("/");
  return "*://" + url.hostname + url.pathname.slice(0, slash + 1) + "*";
}
chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "lowery-add-photo-pattern", title: "Block matching photos with Lowery", contexts: ["image"] });
    chrome.contextMenus.create({ id: "lowery-add-post-pattern", title: "Block posts containing this image with Lowery", contexts: ["image"] });
  });
  await syncStoredRules().catch(error => console.warn("[Lowery] Could not initialize rules:", error));
});
chrome.runtime.onStartup.addListener(() => {
  syncStoredRules().catch(error => console.warn("[Lowery] Could not restore rules:", error));
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.loweryRules || changes.loweryEnabled)) {
    syncStoredRules().catch(error => console.warn("[Lowery] Could not update blocking rules:", error));
  }
});
chrome.contextMenus.onClicked.addListener(async info => {
  const type = info.menuItemId === "lowery-add-post-pattern" ? "post" : info.menuItemId === "lowery-add-photo-pattern" ? "photo" : null;
  if (!type || !info.srcUrl) return;
  try {
    const pattern = makeSmartPattern(info.srcUrl);
    const { loweryRules = DEFAULT_RULES } = await chrome.storage.local.get({ loweryRules: DEFAULT_RULES });
    if (!loweryRules.some(rule => rule.pattern === pattern && (rule.type || "photo") === type)) {
      await chrome.storage.local.set({ loweryRules: [...loweryRules, { pattern, type, custom: true }] });
    }
  } catch (error) { console.warn("[Lowery] Could not add smart rule:", error); }
});
function blinkRequestPath(path) {
  return BLINK_API + "/" + String(path).replace(/^https?:\/\/[^/]+\/api\//, "").replace(/^\/?(api\/)?/, "");
}
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "BLINK_API") return;
  const { path, method = "GET", body } = message;
  fetch(blinkRequestPath(path), {
    method,
    headers: { "Content-Type": "application/json", "x-blink-publishable-key": BLINK_KEY,
      ...(method === "POST" || method === "PATCH" ? { Prefer: "return=representation" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  }).then(async response => {
    const responseText = await response.text();
    let data = responseText;
    try { data = JSON.parse(responseText); } catch {}
    sendResponse({ ok: response.ok, status: response.status, data });
  }).catch(error => {
    console.error("[background] BLINK_API request failed:", error);
    sendResponse({ ok: false, status: 0, data: String(error) });
  });
  return true;
});
