/**
 * Service to detect user image requests and retrieve medical/anatomical images from 
 * Wikipedia, Wikimedia Commons, and Google/Web image index.
 */

export interface ImageSearchResult {
  url: string;
  title: string;
  source: string;
  description?: string;
}

/**
 * Detects if a user message is specifically asking the bot to send or show an image/picture/diagram.
 * Supports singular and plural (e.g. "heart image", "heart images", "send images of kidney", "/image lungs")
 */
export function detectImageRequest(text: string): { isRequest: boolean; subject?: string } {
  if (!text) return { isRequest: false };
  const raw = text.trim();
  const lower = raw.toLowerCase();

  // 1. Slash commands: /image heart, /images heart, /pic kidney, /photos lungs
  const cmdMatch = raw.match(/^\/(?:image|images|pic|pics|photo|photos|diagram|diagrams)\s+(.+)$/i);
  if (cmdMatch) {
    return { isRequest: true, subject: cleanSubject(cmdMatch[1]) };
  }

  // 2. Phrases like:
  // "send heart image", "show me heart images", "send pictures of heart", "images of heart"
  // "send me google images of the heart", "show images of kidneys", "bring 3 images of liver"
  const verbPattern = /^(?:please\s+)?(?:send|show|give|fetch|get|find|display|bring)?\s*(?:me\s*)?(?:\d+\s+)?(?:a\s*|an\s*|some\s*)?(?:google\s*)?(?:images?|pictures?|photos?|pics?|diagrams?|illustrations?)\s+(?:of|for|about)\s+(.+)$/i;
  const verbMatch = lower.match(verbPattern);
  if (verbMatch && verbMatch[1]) {
    const sub = cleanSubject(verbMatch[1]);
    if (sub.length > 1) {
      return { isRequest: true, subject: sub };
    }
  }

  // 3. User typing "[subject] image" or "[subject] images", e.g. "heart image", "lungs images", "kidney picture"
  const nounPattern = /^(?:please\s+)?(?:send|show|give|fetch|get|find|display|bring)?\s*(?:me\s*)?(?:\d+\s+)?(?:a\s*|an\s*|some\s*)?(?:google\s*)?(.+?)\s+(?:images?|pictures?|photos?|pics?|diagrams?|illustrations?)$/i;
  const nounMatch = lower.match(nounPattern);
  if (nounMatch && nounMatch[1]) {
    const sub = cleanSubject(nounMatch[1]);
    // Avoid false positives like "what does this image mean" or "does this image show..."
    const nonSubjects = /^(this|that|these|those|what|why|how|which|whose|when|where|is|can|could|would|should)$/i;
    if (sub.length > 1 && !nonSubjects.test(sub)) {
      return { isRequest: true, subject: sub };
    }
  }

  return { isRequest: false };
}

function cleanSubject(sub: string): string {
  return sub
    .replace(/^(a|an|the|some|\d+)\s+/i, '')
    .replace(/\s+(please|now|thanks|thank you)$/i, '')
    .trim();
}

/**
 * Searches for high-quality medical, anatomical, or clinical images.
 * Returns 2 to 5 relevant images matching the requested subject.
 */
export async function searchMedicalImages(
  subject: string,
  minCount: number = 2,
  maxCount: number = 5
): Promise<ImageSearchResult[]> {
  const clean = cleanSubject(subject);
  if (!clean) return [];

  const results: ImageSearchResult[] = [];
  const seenUrls = new Set<string>();

  function addResult(url: string, title: string, source: string, description?: string) {
    if (!url) return;
    const norm = normalizeWikimediaUrl(url);
    const key = norm.split('?')[0].toLowerCase();
    if (seenUrls.has(key)) return;
    seenUrls.add(key);
    results.push({
      url: norm,
      title: title || clean,
      source,
      description,
    });
  }

  // Check if a Wikimedia title is a meta-icon or UI element rather than an anatomical/medical image
  function isExcludedTitle(title: string): boolean {
    const lower = title.toLowerCase();
    const bannedTokens = [
      'icon', 'logo', 'flag', 'symbol', 'edit-', 'question', 'shackle',
      'portal', 'speaker', 'ambox', 'crystal', 'sound', 'audio', 'stub',
      'wikimedia', 'wikiproject', 'disambig', 'badge', 'button', 'star',
      'folder', 'check', 'arrow', 'cross', 'ballot', 'blank'
    ];
    return bannedTokens.some(token => lower.includes(token));
  }

  // 1. Query Wikipedia article images generator (fetches authentic diagrams/photos used on that subject's main article)
  try {
    const articleUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(clean)}&generator=images&gimlimit=30&prop=imageinfo&iiprop=url|mime&iiurlwidth=1200&format=json`;
    const res = await fetch(articleUrl, {
      headers: { 'User-Agent': 'MedchatBot/1.0 (medical.education@medchat.org)' },
    });
    if (res.ok) {
      const data = await res.json();
      const pages = Object.values(data?.query?.pages || {}) as any[];
      for (const p of pages) {
        const rawTitle: string = p.title || '';
        if (isExcludedTitle(rawTitle)) continue;

        const info = p.imageinfo?.[0];
        const imgUrl = info?.thumburl || info?.url;
        if (imgUrl) {
          const cleanTitle = rawTitle
            .replace(/^File:/i, '')
            .replace(/\.(jpg|png|svg|jpeg|gif)$/i, '')
            .replace(/_/g, ' ');
          addResult(imgUrl, cleanTitle, 'Wikipedia / Wikimedia Commons');
        }
        if (results.length >= maxCount) break;
      }
    }
  } catch (e) {
    // Continue to next strategy
  }

  // 2. Query Wikipedia search generator (finds related anatomy pages, e.g. "Human heart", "Heart wall", "Coronary circulation")
  if (results.length < maxCount) {
    try {
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(clean + ' anatomy')}&gsrlimit=10&prop=pageimages|description&piprop=thumbnail|original&pithumbsize=1200&format=json`;
      const res = await fetch(searchUrl, {
        headers: { 'User-Agent': 'MedchatBot/1.0 (medical.education@medchat.org)' },
      });
      if (res.ok) {
        const data = await res.json();
        const pages = Object.values(data?.query?.pages || {}) as any[];
        for (const p of pages) {
          if (p.title && isExcludedTitle(p.title)) continue;
          const src = p.thumbnail?.source || p.original?.source;
          if (src) {
            addResult(src, p.title || clean, 'Wikipedia Anatomy', p.description);
          }
          if (results.length >= maxCount) break;
        }
      }
    } catch (e) {
      // Continue to next strategy
    }
  }

  // 3. Query Wikimedia Commons directly for diagrams and histological/clinical photos
  if (results.length < maxCount) {
    try {
      const commonsUrl = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(clean + ' diagram medical')}&gsrnamespace=6&gsrlimit=12&prop=imageinfo&iiprop=url|mime&iiurlwidth=1200&format=json`;
      const res = await fetch(commonsUrl, {
        headers: { 'User-Agent': 'MedchatBot/1.0 (medical.education@medchat.org)' },
      });
      if (res.ok) {
        const data = await res.json();
        const pages = Object.values(data?.query?.pages || {}) as any[];
        for (const p of pages) {
          const rawTitle = p.title || '';
          if (isExcludedTitle(rawTitle)) continue;

          const info = p.imageinfo?.[0];
          const url = info?.thumburl || info?.url;
          if (url) {
            const cleanTitle = rawTitle
              .replace(/^File:/i, '')
              .replace(/\.(jpg|png|svg|jpeg)$/i, '')
              .replace(/_/g, ' ');
            addResult(url, cleanTitle, 'Wikimedia Commons');
          }
          if (results.length >= maxCount) break;
        }
      }
    } catch (e) {
      // Continue to next strategy
    }
  }

  // 4. Web index fallback via DuckDuckGo images to ensure we always have 2-5 images
  if (results.length < minCount) {
    try {
      const tokenRes = await fetch(
        `https://duckduckgo.com/?q=${encodeURIComponent(clean + ' medical anatomy diagram')}&iax=images&ia=images`
      );
      if (tokenRes.ok) {
        const tokenHtml = await tokenRes.text();
        const vqdMatch = tokenHtml.match(/vqd=([\'\"])?([0-9-]+)\1/);
        if (vqdMatch && vqdMatch[2]) {
          const vqd = vqdMatch[2];
          const imgApiUrl = `https://duckduckgo.com/i.js?l=us-en&o=json&q=${encodeURIComponent(clean + ' medical anatomy diagram')}&vqd=${vqd}&f=,,,;&p=1`;
          const imgRes = await fetch(imgApiUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
          });
          if (imgRes.ok) {
            const imgData = await imgRes.json();
            const list = imgData?.results || [];
            for (const item of list) {
              if (item?.image) {
                addResult(item.image, item.title || clean, 'Medical Image Index');
              }
              if (results.length >= maxCount) break;
            }
          }
        }
      }
    } catch (e) {
      // Handled below
    }
  }

  // Return between minCount and maxCount (capped at 5, at least minCount if available)
  return results.slice(0, maxCount);
}

/**
 * Backward compatibility wrapper returning the primary image or null.
 */
export async function searchMedicalImage(subject: string): Promise<ImageSearchResult | null> {
  const list = await searchMedicalImages(subject, 1, 1);
  return list[0] || null;
}

/**
 * If the image is SVG, convert to high-resolution PNG thumbnail URL supported by Telegram sendPhoto and sendMediaGroup.
 */
function normalizeWikimediaUrl(url: string): string {
  if (!url) return url;
  if (url.endsWith('.svg') || url.includes('.svg?')) {
    const baseClean = url.split('?')[0];
    const fileName = baseClean.split('/').pop();
    if (baseClean.includes('/wikipedia/commons/')) {
      return baseClean.replace('/wikipedia/commons/', '/wikipedia/commons/thumb/') + `/1280px-${fileName}.png`;
    }
  }
  return url;
}
