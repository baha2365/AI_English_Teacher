/**
 * translator.js
 * Duolingo-style word translation popup for the AI English Teacher platform.
 * 
 * Usage:
 *   import { makeClickable, setTranslationLanguage } from './translator.js';
 *
 *   // After writing assistant text to chat:
 *   makeClickable(chatDiv);
 *
 *   // To change target language (default: Russian):
 *   setTranslationLanguage("Kazakh");
 */

const TRANSLATE_API = "http://localhost:8000/translate";

let targetLanguage = "Russian";

/** Change the language words are translated into */
export function setTranslationLanguage(lang) {
    targetLanguage = lang;
}

/* ─── Popup DOM ─────────────────────────────────────────────── */

const popup = document.createElement("div");
popup.id = "translator-popup";
popup.innerHTML = `
  <div class="tp-arrow"></div>
  <div class="tp-body">
    <div class="tp-top">
      <span class="tp-word"></span>
      <span class="tp-pos"></span>
    </div>
    <div class="tp-translation"></div>
    <div class="tp-example"></div>
    <div class="tp-loading">
      <span class="tp-dot"></span><span class="tp-dot"></span><span class="tp-dot"></span>
    </div>
  </div>
`;
document.body.appendChild(popup);

/* ─── Styles ─────────────────────────────────────────────────── */

const style = document.createElement("style");
style.textContent = `
  /* Clickable words */
  .translatable-word {
    cursor: pointer;
    border-bottom: 1.5px dashed rgba(255, 210, 60, 0.55);
    border-radius: 2px;
    transition: background 0.15s, color 0.15s;
    padding: 0 1px;
  }
  .translatable-word:hover {
    background: rgba(255, 210, 60, 0.22);
    color: #ffe566;
    border-bottom-color: #ffe566;
  }
  .translatable-word.active {
    background: rgba(255, 210, 60, 0.35);
    color: #fff176;
    border-bottom-color: #fff176;
  }

  /* Popup container */
  #translator-popup {
    position: fixed;
    z-index: 9999;
    display: none;
    flex-direction: column;
    align-items: center;
    pointer-events: none;
    filter: drop-shadow(0 8px 24px rgba(0,0,0,0.55));
    transform: translateX(-50%) translateY(-100%);
    margin-top: -10px;
  }
  #translator-popup.visible {
    display: flex;
    pointer-events: auto;
    animation: tp-appear 0.18s cubic-bezier(0.34,1.56,0.64,1) both;
  }

  @keyframes tp-appear {
    from { opacity: 0; transform: translateX(-50%) translateY(-100%) scale(0.88); }
    to   { opacity: 1; transform: translateX(-50%) translateY(-100%) scale(1); }
  }

  /* Arrow pointing down */
  .tp-arrow {
    order: 2;
    width: 0;
    height: 0;
    border-left: 9px solid transparent;
    border-right: 9px solid transparent;
    border-top: 9px solid #1a1f2e;
  }

  /* Card body */
  .tp-body {
    order: 1;
    background: #1a1f2e;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 14px;
    padding: 14px 18px 12px;
    min-width: 180px;
    max-width: 280px;
    font-family: 'Segoe UI', sans-serif;
  }

  .tp-top {
    display: flex;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 6px;
  }

  .tp-word {
    font-size: 15px;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: 0.3px;
  }

  .tp-pos {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #00aeff;        /* Duolingo green */
    background: rgba(88,204,2,0.12);
    padding: 2px 6px;
    border-radius: 20px;
  }

  .tp-translation {
    font-size: 20px;
    font-weight: 700;
    color: #ffe566;
    margin-bottom: 6px;
    letter-spacing: 0.2px;
  }

  .tp-example {
    font-size: 11.5px;
    color: rgba(255,255,255,0.55);
    font-style: italic;
    line-height: 1.5;
  }

  /* Loading dots */
  .tp-loading {
    display: none;
    gap: 5px;
    justify-content: center;
    padding: 4px 0;
  }
  .tp-loading.active {
    display: flex;
  }
  .tp-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #00ccff;
    animation: tp-bounce 0.9s infinite ease-in-out;
  }
  .tp-dot:nth-child(2) { animation-delay: 0.15s; }
  .tp-dot:nth-child(3) { animation-delay: 0.30s; }

  @keyframes tp-bounce {
    0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
    40%           { transform: scale(1.0); opacity: 1; }
  }
`;
document.head.appendChild(style);

/* ─── Popup logic ────────────────────────────────────────────── */

const elWord        = popup.querySelector(".tp-word");
const elPos         = popup.querySelector(".tp-pos");
const elTranslation = popup.querySelector(".tp-translation");
const elExample     = popup.querySelector(".tp-example");
const elLoading     = popup.querySelector(".tp-loading");

let currentWordEl = null;

function showLoading(wordEl) {
    positionPopup(wordEl);
    elWord.textContent        = wordEl.textContent;
    elPos.textContent         = "";
    elTranslation.textContent = "";
    elExample.textContent     = "";
    elLoading.classList.add("active");
    popup.classList.add("visible");
}

function showResult(data) {
    elLoading.classList.remove("active");
    elPos.textContent         = data.part_of_speech || "";
    elTranslation.textContent = data.translation    || "—";
    elExample.textContent     = data.example        ? `"${data.example}"` : "";
}

function showError() {
    elLoading.classList.remove("active");
    elTranslation.textContent = "Translation failed";
    elExample.textContent     = "";
}

function hidePopup() {
    popup.classList.remove("visible");
    if (currentWordEl) {
        currentWordEl.classList.remove("active");
        currentWordEl = null;
    }
}

function positionPopup(wordEl) {
    const rect   = wordEl.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2 + window.scrollX;
    const topY    = rect.top  + window.scrollY - 6;   // 6px gap above word

    popup.style.left = `${centerX}px`;
    popup.style.top  = `${topY}px`;
}

/* ─── Translation cache ──────────────────────────────────────── */

const cache = new Map();   // "word|language" → data

async function fetchTranslation(word) {
    const key = `${word.toLowerCase()}|${targetLanguage}`;
    if (cache.has(key)) return cache.get(key);

    const res  = await fetch(TRANSLATE_API, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ word, target_language: targetLanguage }),
    });
    const data = await res.json();
    cache.set(key, data);
    return data;
}

/* ─── Word click handler ─────────────────────────────────────── */

async function handleWordClick(e) {
    const wordEl = e.currentTarget;

    // Toggle off if same word clicked again
    if (currentWordEl === wordEl) {
        hidePopup();
        return;
    }

    if (currentWordEl) currentWordEl.classList.remove("active");
    currentWordEl = wordEl;
    wordEl.classList.add("active");

    const word = wordEl.textContent.replace(/[^a-zA-Z'-]/g, "").trim();
    if (!word) return;

    showLoading(wordEl);

    try {
        const data = await fetchTranslation(word);
        showResult(data);
    } catch (err) {
        console.error("[Translator]", err);
        showError();
    }
}

/* ─── Public API ─────────────────────────────────────────────── */

/**
 * Wraps every word in `container` with a clickable <span>.
 * Call this each time new assistant text is rendered.
 * @param {HTMLElement} container  - the chat div or message element
 */
export function makeClickable(container) {
    // Walk only text nodes inside <p> tags to avoid re-wrapping
    const paragraphs = container.querySelectorAll("p");
    (paragraphs.length ? [...paragraphs] : [container]).forEach(wrapWords);
}

function wrapWords(el) {
    // Collect raw text nodes (skip already-wrapped spans)
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            if (node.parentElement && node.parentElement.classList.contains("translatable-word")) {
                return NodeFilter.FILTER_REJECT;
            }
            return node.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        }
    });

    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);

    textNodes.forEach((textNode) => {
        const frag = document.createDocumentFragment();
        const parts = textNode.textContent.split(/(\b[a-zA-Z''-]+\b)/g);

        parts.forEach((part) => {
            if (/^[a-zA-Z''-]+$/.test(part) && part.length > 1) {
                const span = document.createElement("span");
                span.className = "translatable-word";
                span.textContent = part;
                span.addEventListener("click", handleWordClick);
                frag.appendChild(span);
            } else {
                frag.appendChild(document.createTextNode(part));
            }
        });

        textNode.parentNode.replaceChild(frag, textNode);
    });
}

/* ─── Close popup on outside click ──────────────────────────── */

document.addEventListener("click", (e) => {
    if (!popup.contains(e.target) && !e.target.classList.contains("translatable-word")) {
        hidePopup();
    }
});

/* ─── Reposition on scroll/resize ───────────────────────────── */

window.addEventListener("resize", () => {
    if (currentWordEl) positionPopup(currentWordEl);
});