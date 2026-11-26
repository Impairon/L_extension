function wildcardRegex(pattern) {
  const escaped = pattern.replace(/[.+?^{}$()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  try { return new RegExp("^" + escaped + "$", "i"); } catch { return null; }
}
function elementUrl(img) {
  return img.dataset.loweryPhotoBlocked === "true" ? (img.dataset.loweryOriginalSrc || "") :
    (img.currentSrc || img.src || img.getAttribute("src") || "");
}
function saveAndHide(element, marker) {
  if (element.dataset[marker] === "true") return;
  element.dataset[marker] = "true";
  element.dataset.loweryOriginalStyle = element.getAttribute("style") || "";
  element.dataset.loweryHadStyle = element.hasAttribute("style") ? "1" : "0";
  element.style.setProperty("display", "none", "important");
}
function restoreElement(element, marker) {
  if (element.dataset[marker] !== "true") return;
  if (element.dataset.loweryHadStyle === "1") element.setAttribute("style", element.dataset.loweryOriginalStyle || "");
  else element.removeAttribute("style");
  delete element.dataset[marker];
  delete element.dataset.loweryOriginalStyle;
  delete element.dataset.loweryHadStyle;
}
function restorePhoto(img) {
  if (img.dataset.loweryPhotoBlocked !== "true") return;
  if (img.dataset.loweryHadSrc === "1") img.setAttribute("src", img.dataset.loweryOriginalSrc || "");
  if (img.dataset.loweryHadSrcset === "1") img.setAttribute("srcset", img.dataset.loweryOriginalSrcset || "");
  restoreElement(img, "loweryPhotoBlocked");
  delete img.dataset.loweryHadSrc;
  delete img.dataset.loweryHadSrcset;
  delete img.dataset.loweryOriginalSrc;
  delete img.dataset.loweryOriginalSrcset;
}
function postContainerFor(img) {
  return img.closest('article,[role="article"],[data-testid*="post"],[data-pagelet*="FeedUnit"]');
}
let loweryApplying = false;
async function applyLoweryRules() {
  if (loweryApplying) return;
  loweryApplying = true;
  try {
    const { loweryRules = [], loweryEnabled = true } = await chrome.storage.local.get({ loweryRules: [], loweryEnabled: true });
    const rules = Array.isArray(loweryRules) ? loweryRules : [];
    const photoMatchers = rules.filter(rule => (rule.type || "photo") === "photo").map(rule => wildcardRegex(rule.pattern)).filter(Boolean);
    const postMatchers = rules.filter(rule => rule.type === "post").map(rule => wildcardRegex(rule.pattern)).filter(Boolean);
    const matchedPosts = new Set();
    document.querySelectorAll("img").forEach(img => {
      if (loweryEnabled === false) { restorePhoto(img); return; }
      const url = elementUrl(img);
      const photoMatch = !!url && photoMatchers.some(matcher => matcher.test(url));
      if (photoMatch) {
        if (img.dataset.loweryPhotoBlocked !== "true") {
          img.dataset.loweryHadSrc = img.hasAttribute("src") ? "1" : "0";
          img.dataset.loweryHadSrcset = img.hasAttribute("srcset") ? "1" : "0";
          img.dataset.loweryOriginalSrc = img.getAttribute("src") || "";
          img.dataset.loweryOriginalSrcset = img.getAttribute("srcset") || "";
          saveAndHide(img, "loweryPhotoBlocked");
          img.removeAttribute("src"); img.removeAttribute("srcset");
        }
      } else restorePhoto(img);
      if (url && postMatchers.some(matcher => matcher.test(url))) {
        const post = postContainerFor(img);
        if (post && post !== document.body && post !== document.documentElement) {
          matchedPosts.add(post);
          saveAndHide(post, "loweryPostBlocked");
        }
      }
    });
    document.querySelectorAll('[data-lowery-post-blocked="true"]').forEach(post => {
      if (loweryEnabled === false || !matchedPosts.has(post)) restoreElement(post, "loweryPostBlocked");
    });
  } catch (error) { console.warn("[Lowery] Could not apply rules:", error); }
  finally { loweryApplying = false; }
}
applyLoweryRules();
new MutationObserver(() => applyLoweryRules()).observe(document.documentElement, {
  childList: true, subtree: true, attributes: true, attributeFilter: ["src", "srcset"]
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && (changes.loweryRules || changes.loweryEnabled)) applyLoweryRules();
});
