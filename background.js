const BLINK_API = "https://core.blink.new/api";
const BLINK_KEY = "blnk_pk_vfRDduQdwnIgNQHiNu4e9h-32fbkJyj-";

const DEFAULT_RULES = [
  { pattern: "*://*.googleusercontent.com/*=s*-c", type: "image", custom: false },
  { pattern: "*://*.gravatar.com/avatar/*", type: "image", custom: false },
  { pattern: "*://avatars.githubusercontent.com/*", type: "image", custom: false },
  { pattern: "*://cdn.discordapp.com/avatars/*", type: "image", custom: false },
  { pattern: "*://*.fbcdn.net/*", type: "image", custom: false }
];

const IMAGE_EXTENSIONS = new Set([
  "avif", "bmp", "gif", "ico", "jpeg", "jpg", "png", "svg", "webp", "jfif", "heic"
]);
const SPECIFIC_IMAGE_ROUTE = /^(?:avatars?|profile[-_]?photos?|profile[-_]?displayphotos?|displayphotos?|profile[-_]?images?|photos?|pictures?|thumbnails?|thumbs?)(?:[-_.]|$)/i;
const GENERIC_IMAGE_ROUTE = /^(?:images?|media|uploads?|attachments?)(?:[-_.]|$)/i;
const VOLATILE = /^(?:\d{3,}|v\d{3,}|[a-f0-9]{16,}|[a-f0-9]{8}-[a-f0-9-]{20,}|[a-z0-9_-]{18,})$/i;
const GENERIC_FILE = /^(?:img|image|photo|picture|avatar|profile|thumb|thumbnail)[-_]?(?:\d+|[a-f0-9]{6,})?$/i;

function escapeGlobLiteral(value) {
  return value.replace(/[.+?^{}$()|[\]\\]/g, "\\$&");
}

function globToRegex(pattern) {
  return "^" + pattern.split("*").map(escapeGlobLiteral).join(".*") + "$";
}

function isVolatileSegment(segment) {
  const clean = segment.split(";")[0];
  return VOLATILE.test(clean) || /^[0-9a-f]{8,}$/i.test(clean) || (/^(?=.*[a-z])(?=.*\d)[a-z0-9]{6,32}$/i.test(clean));
}

function safeDecode(segment) {
  try { return decodeURIComponent(segment); } catch { return segment; }
}

function makeSmartPattern(rawUrl) {
  const url = new URL(rawUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only normal HTTP(S) image URLs can become rules");
  }

  const host = url.hostname.toLowerCase();
  const rawSegments = url.pathname.split("/").filter(Boolean);
  const segments = rawSegments.map(safeDecode);
  if (!segments.length) return "*://" + host + "/*";

  const last = segments[segments.length - 1];
  const extensionMatch = last.match(/\.([a-z0-9]{2,5})$/i);
  const extension = extensionMatch?.[1]?.toLowerCase() || "";
  const isImageFile = IMAGE_EXTENSIONS.has(extension);

  // Find the strongest semantic image route, not just any occurrence of "media".
  let routeIndex = segments.findIndex(segment => SPECIFIC_IMAGE_ROUTE.test(segment));
  if (routeIndex < 0) routeIndex = segments.findIndex(segment => GENERIC_IMAGE_ROUTE.test(segment));
  if (routeIndex < 0) {
    // Some CDNs put transformation directives before the actual asset path.
    routeIndex = segments.findIndex(segment => /^(?:image|img|photo|avatar)[-_]/i.test(segment));
  }

  let stablePrefix = segments.slice(0, routeIndex >= 0 ? routeIndex : segments.length - (isImageFile ? 1 : 0));
  while (stablePrefix.length && isVolatileSegment(stablePrefix[stablePrefix.length - 1])) {
    stablePrefix.pop();
  }

  // Keep meaningful route names, but wildcard volatile IDs and generated filenames.
  let pathParts;
  if (routeIndex === segments.length - 1 && isImageFile) {
    const stem = last.slice(0, -(extension.length + 1));
    const semanticStem = stem.match(/^(avatar|profile|photo|image|img|thumb|thumbnail)[-_]/i)?.[0];
    pathParts = segments.slice(0, -1);
    pathParts.push((semanticStem || "*") + "*." + extension);
  } else if (routeIndex >= 0) {
    pathParts = segments.slice(0, routeIndex + 1).map((part, index) => {
      if (index < routeIndex && (isVolatileSegment(part) || /^\d+$/.test(part) && part.length < 4)) return "*";
      return part;
    });
    // Retain useful folders after the media route (e.g. uploads/posts),
    // but stop at the first likely ID or generated filename.
    for (const part of segments.slice(routeIndex + 1)) {
      if (isVolatileSegment(part) || /^\d+$/.test(part)) break;
      if (/\.[a-z0-9]{2,5}$/i.test(part) && IMAGE_EXTENSIONS.has(part.split(".").pop().toLowerCase())) break;
      pathParts.push(part);
    }
    pathParts.push("*");
  } else if (isImageFile) {
    pathParts = segments.slice(0, -1).map(part => isVolatileSegment(part) ? "*" : part);
    const stem = last.slice(0, -(extension.length + 1));
    const semanticStem = stem.match(/^(avatar|profile|photo|image|img|thumb|thumbnail)[-_]/i)?.[0];
    pathParts.push((semanticStem || "*") + "." + extension);
  } else {
    // Without a recognizable image route or extension, stay conservative:
    // generalize only obvious IDs and keep every stable path component.
    pathParts = segments.map(part => isVolatileSegment(part) ? "*" : part);
    if (!pathParts.some(part => part === "*")) pathParts[pathParts.length - 1] = "*";
  }

  // Avoid patterns that collapse to the whole host or a root-wide wildcard.
  const path = pathParts.filter(Boolean).join("/");
  return "*://" + host + "/" + (path || "*");
}

async function applyRules(rules = DEFAULT_RULES, enabled = true) {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  const removeRuleIds = existing.filter(rule => rule.id >= 1000 && rule.id < 6000).map(rule => rule.id);
  const imageRules = rules
    .filter(rule => rule && typeof rule.pattern === "string" && rule.pattern.trim())
    .slice(0, 1000);
  const addRules = enabled ? imageRules.map((rule, index) => ({
    id: 1000 + index,
    priority: 1,
    action: { type: "block" },
    condition: {
      regexFilter: globToRegex(rule.pattern.trim()),
      resourceTypes: ["image"],
      isUrlFilterCaseSensitive: false
    }
  })) : [];
  await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
}

async function syncStoredRules() {
  const data = await chrome.storage.local.get({ loweryRules: DEFAULT_RULES, loweryEnabled: true });
  // Drop old video rules instead of silently converting them into photo rules.
  const rules = (Array.isArray(data.loweryRules) ? data.loweryRules : DEFAULT_RULES)
    .filter(rule => rule && rule.type !== "video")
    .map(rule => ({ ...rule, type: "image" }));
  if (rules.length !== (data.loweryRules || []).length) {
    await chrome.storage.local.set({ loweryRules: rules });
  }
  await applyRules(rules, data.loweryEnabled !== false);
}

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "lowery-add-image-pattern",
      title: "Block matching photos with Lowery",
      contexts: ["image"]
    });
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
  if (info.menuItemId !== "lowery-add-image-pattern" || !info.srcUrl) return;
  try {
    const pattern = makeSmartPattern(info.srcUrl);
    const { loweryRules = DEFAULT_RULES } = await chrome.storage.local.get({ loweryRules: DEFAULT_RULES });
    const normalized = (Array.isArray(loweryRules) ? loweryRules : DEFAULT_RULES)
      .filter(rule => rule && rule.type !== "video")
      .map(rule => ({ ...rule, type: "image" }));
    if (!normalized.some(rule => rule.pattern === pattern)) {
      await chrome.storage.local.set({
        loweryRules: [...normalized, { pattern, type: "image", custom: true }]
      });
    }
  } catch (error) {
    console.warn("[Lowery] Could not add smart photo URL rule:", error);
  }
});

function blinkRequestPath(path) {
  return BLINK_API + "/" + String(path).replace(/^https?:\/\/[^/]+\/api\//, "").replace(/^\/?(api\/)?/, "");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "LOWERY_SET_ENABLED") {
    (async () => {
      await chrome.storage.local.set({ loweryEnabled: message.enabled !== false });
      await syncStoredRules();
      sendResponse({ ok: true });
    })().catch(error => {
      console.warn("[Lowery] Could not change blocking state:", error);
      sendResponse({ ok: false, error: String(error) });
    });
    return true;
  }
  if (message?.type !== "BLINK_API") return;
  const { path, method = "GET", body } = message;
  fetch(blinkRequestPath(path), {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-blink-publishable-key": BLINK_KEY,
      ...(method === "POST" || method === "PATCH" ? { Prefer: "return=representation" } : {})
    },
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
