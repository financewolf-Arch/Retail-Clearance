// ============================================================
// ClearanceHub — UI Logic
// ============================================================

const RETAILER_META = {
  walmart:  { label: "Walmart",    color: "#0071ce", bg: "#e8f4fd", logo: "🛒" },
  target:   { label: "Target",     color: "#cc0000", bg: "#fde8e8", logo: "🎯" },
  amazon:   { label: "Amazon",     color: "#ff9900", bg: "#fff8e8", logo: "📦" },
  costco:   { label: "Costco",     color: "#005DAA", bg: "#e8f0fb", logo: "🏪" },
  samsclub: { label: "Sam's Club", color: "#004990", bg: "#e8eef8", logo: "🏬" },
  bestbuy:  { label: "Best Buy",   color: "#0046be", bg: "#e8edfb", logo: "💙" },
};

let activeCategory = "all";
let activeRetailer  = "all";
let searchQuery     = "";
let sortMode        = "savings-desc";

// Live deals array populated asynchronously
let liveDEALS = [];

// ─────────────────────────────────────────────────────────────
// LIVE RSS FETCHING
// Pulls from DealNews category feeds + Slickdeals clearance
// Cached 2 hours in localStorage so repeat visits are instant
// ─────────────────────────────────────────────────────────────

const LIVE_CACHE_KEY = "ch_live_v3";
const CACHE_TTL_MS   = 2 * 60 * 60 * 1000; // 2 hours

const RSS_SOURCES = [
  { url: "https://www.dealnews.com/c196/Electronics/?rss=1",        category: "tech"    },
  { url: "https://www.dealnews.com/c219/Clothing/?rss=1",           category: "fashion" },
  { url: "https://www.dealnews.com/c93/Home-and-Garden/?rss=1",     category: "home"    },
  { url: "https://www.dealnews.com/c144/Sports-and-Fitness/?rss=1", category: "sports"  },
  { url: "https://www.dealnews.com/c137/Toys-and-Games/?rss=1",     category: "toys"    },
  { url: "https://www.dealnews.com/c199/Health-and-Beauty/?rss=1",  category: "beauty"  },
  { url: "https://www.dealnews.com/c222/Food-and-Gourmet/?rss=1",   category: "food"    },
  {
    url: "https://slickdeals.net/newsearch.php?mode=frontpage&searcharea=deals&searchin=first&rss=1&q=clearance",
    category: null,
  },
];

// Two free CORS proxies as fallback
const PROXIES = [
  raw => `https://api.allorigins.win/get?url=${encodeURIComponent(raw)}`,
  raw => `https://corsproxy.io/?${encodeURIComponent(raw)}`,
];

async function proxyFetch(rawUrl) {
  for (const buildUrl of PROXIES) {
    try {
      const res = await fetch(buildUrl(rawUrl), { signal: AbortSignal.timeout(9000) });
      if (!res.ok) continue;
      const text = await res.text();
      try {
        // allorigins wraps in JSON; corsproxy returns raw XML
        return JSON.parse(text).contents || text;
      } catch {
        return text;
      }
    } catch { /* try next proxy */ }
  }
  return null;
}

function parseXMLItems(xmlStr) {
  try {
    const doc = new DOMParser().parseFromString(xmlStr, "text/xml");
    if (doc.querySelector("parsererror")) return [];
    return [...doc.querySelectorAll("item")].map(el => {
      // <link> in RSS 2.0 is sometimes a bare text node next to the tag
      let link = el.querySelector("link")?.textContent?.trim() || "";
      if (!link.startsWith("http")) {
        // walk siblings for text node that looks like a URL
        const linkTag = el.getElementsByTagName("link")[0];
        if (linkTag) {
          let node = linkTag.nextSibling;
          while (node) {
            const v = node.nodeValue?.trim();
            if (v?.startsWith("http")) { link = v; break; }
            node = node.nextSibling;
          }
        }
      }
      if (!link.startsWith("http")) {
        // fall back to guid
        const guid = el.querySelector("guid")?.textContent?.trim();
        if (guid?.startsWith("http")) link = guid;
      }
      return {
        title: el.querySelector("title")?.textContent?.trim()       || "",
        link,
        desc:  el.querySelector("description")?.textContent?.trim() || "",
        pub:   el.querySelector("pubDate")?.textContent?.trim()     || "",
      };
    });
  } catch { return []; }
}

function extractPrices(title, desc) {
  const full    = title + " " + desc;
  const priceRx = /\$[\d,]+(?:\.\d{1,2})?/g;
  const wasRx   = /(?:was|reg\.?|regular|orig\.?|originally|from|list|msrp)\s+\$?([\d,]+(?:\.\d{1,2})?)/i;
  const pctRx   = /(\d+)%\s*off/i;

  const prices = [...full.matchAll(priceRx)]
    .map(m => parseFloat(m[0].replace(/[$,]/g, "")))
    .filter(p => p >= 0.5 && p < 15000);

  if (!prices.length) return null;

  const clearance = prices[0];
  let normal      = null;

  const wasM = full.match(wasRx);
  if (wasM) normal = parseFloat(wasM[1].replace(/,/g, ""));

  if (!normal) normal = prices.find(p => p > clearance) || null;

  if (!normal) {
    const pctM = full.match(pctRx);
    if (pctM) {
      const pct = parseInt(pctM[1]);
      if (pct > 5 && pct < 95) normal = parseFloat((clearance / (1 - pct / 100)).toFixed(2));
    }
  }

  if (!normal || normal <= clearance || (normal / clearance) > 20) return null;
  return { clearancePrice: clearance, normalPrice: parseFloat(normal.toFixed(2)) };
}

function detectRetailer(text) {
  const t = text.toLowerCase();
  if (t.includes("walmart"))             return "walmart";
  if (t.includes("target"))             return "target";
  if (t.includes("costco"))             return "costco";
  if (/sam.s\s*club|samsclub/.test(t))  return "samsclub";
  if (/best\s*buy|bestbuy/.test(t))     return "bestbuy";
  return "amazon";
}

function detectCategory(text, defaultCat) {
  if (defaultCat) return defaultCat;
  const t = text.toLowerCase();
  if (/\btv\b|laptop|tablet|headphone|earbud|speaker|camera|gaming|ipad|macbook|airpod|pixel|galaxy\s+[sa]\d|router|printer|monitor|drone|smartwatch|chromebook/.test(t)) return "tech";
  if (/shoe|sneaker|boot|sandal|shirt|blouse|pants|jeans|jacket|coat|dress|hoodie|sweater|legging|activewear|handbag|purse|apparel/.test(t)) return "fashion";
  if (/vacuum|air fryer|instant pot|blender|kitchen|cookware|pots|pans|furniture|mattress|pillow|bedding|sofa|couch|grill|coffee maker|ice maker/.test(t)) return "home";
  if (/\btoy\b|lego|doll|board game|puzzle|playset|action figure|barbie|hot wheels|nerf/.test(t)) return "toys";
  if (/makeup|skincare|serum|moisturizer|hair dryer|hair care|beauty|shampoo|conditioner|perfume|lotion|toothbrush/.test(t)) return "beauty";
  if (/\bfood\b|coffee|snack|protein|supplement|vitamin|organic|grocery|chocolate|beverage|candy/.test(t)) return "food";
  if (/golf|dumbbell|fitness|exercise|yoga|cycling|hiking|camping|treadmill|kayak|tent|bike/.test(t)) return "sports";
  return "supplies";
}

function cleanTitle(title) {
  return title
    .replace(/\s+for\s+\$[\d,]+(?:\.\d{1,2})?.*$/i, "")
    .replace(/\s*\$[\d,]+(?:\.\d{1,2})?\s*(?:\(.*?\))?\s*$/i, "")
    .replace(/,\s*was\s+\$[\d,]+.*$/i, "")
    .replace(/\s*[-–]\s*\d+%\s*off.*$/i, "")
    .trim();
}

function buildLiveDeals(rawItems) {
  const seen   = new Set();
  const result = [];
  for (const item of rawItems) {
    const { title, link, desc, pub, defaultCategory } = item;
    if (!title || !link || seen.has(link)) continue;
    seen.add(link);

    const prices = extractPrices(title, desc);
    if (!prices) continue;

    const fullText = title + " " + desc;
    const retailer = detectRetailer(fullText);
    const category = detectCategory(title, defaultCategory);
    const meta     = RETAILER_META[retailer] || { color: "#555555", bg: "#f0f0f0", logo: "🏷️" };
    const name     = cleanTitle(title) || title.slice(0, 80);
    const hexColor = meta.color.replace("#", "");

    result.push({
      id:             "live_" + result.length,
      name,
      category,
      retailer,
      normalPrice:    prices.normalPrice,
      clearancePrice: prices.clearancePrice,
      fallbackImage:  `https://placehold.co/300x200/${hexColor}/ffffff?text=${encodeURIComponent(name.slice(0, 22))}`,
      link,
      inStock:        true,
      badge:          "Live",
      isLive:         true,
      pubDate:        pub,
    });
    if (result.length >= 80) break;
  }
  return result;
}

let _liveStatusState = "idle";

function setLiveStatus(state, date) {
  _liveStatusState = state;
  const el = document.getElementById("liveStatus");
  if (!el) return;
  const fmt = d => d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) +
                   " · " + d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const map = {
    idle:    "",
    loading: `<span class="ldot spin"></span> Fetching live deals from DealNews &amp; Slickdeals…`,
    live:    `<span class="ldot green"></span> Live deals loaded — ${fmt(date)} &nbsp;<button class="refresh-btn" onclick="refreshLive()">↺ Refresh</button>`,
    cached:  `<span class="ldot blue"></span> Cached — last fetched ${fmt(date)} &nbsp;<button class="refresh-btn" onclick="refreshLive()">↺ Refresh now</button>`,
    error:   `<span class="ldot red"></span> Live fetch unavailable — showing curated deals &nbsp;<button class="refresh-btn" onclick="refreshLive()">↺ Retry</button>`,
  };
  el.innerHTML  = map[state] || "";
  el.className  = "live-status-bar ls-" + state;
}

async function loadLiveDeals() {
  setLiveStatus("loading");

  // Serve from cache if fresh enough
  try {
    const cached = JSON.parse(localStorage.getItem(LIVE_CACHE_KEY) || "null");
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS && cached.data?.length > 0) {
      liveDEALS = cached.data;
      setLiveStatus("cached", new Date(cached.ts));
      render();
      return;
    }
  } catch { /* ignore corrupt cache */ }

  // Fetch all RSS feeds in parallel
  const rawItems = [];
  await Promise.allSettled(
    RSS_SOURCES.map(async src => {
      const xml = await proxyFetch(src.url);
      if (!xml) return;
      parseXMLItems(xml).forEach(it =>
        rawItems.push({ ...it, defaultCategory: src.category })
      );
    })
  );

  if (rawItems.length > 0) {
    liveDEALS = buildLiveDeals(rawItems);
    try {
      localStorage.setItem(LIVE_CACHE_KEY, JSON.stringify({ data: liveDEALS, ts: Date.now() }));
    } catch { /* storage full — skip cache */ }
    setLiveStatus("live", new Date());
  } else {
    setLiveStatus("error");
  }

  render();
}

function refreshLive() {
  try { localStorage.removeItem(LIVE_CACHE_KEY); } catch {}
  liveDEALS = [];
  loadLiveDeals();
}

// ─────────────────────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────────────────────

function pct(normal, clearance) {
  return Math.round(((normal - clearance) / normal) * 100);
}

function savings(normal, clearance) {
  return (normal - clearance).toFixed(2);
}

function fmt(n) {
  return "$" + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function buildCard(deal) {
  const meta    = RETAILER_META[deal.retailer] || { label: deal.retailer, color: "#555", bg: "#f0f0f0", logo: "🏷️" };
  const pctOff  = pct(deal.normalPrice, deal.clearancePrice);
  const saved   = savings(deal.normalPrice, deal.clearancePrice);
  const stock   = deal.inStock
    ? '<span class="stock in-stock">✔ In Stock</span>'
    : '<span class="stock out-stock">✖ Low/Out of Stock</span>';

  const badgeClass = deal.isLive ? "item-badge badge-live" : "item-badge";
  const badgeHtml  = deal.badge ? `<span class="${badgeClass}">${deal.isLive ? "🔴 " : ""}${deal.badge}</span>` : "";
  const liveSource = deal.isLive
    ? `<span class="live-source">via DealNews / Slickdeals</span>`
    : "";

  return `
  <article class="deal-card${deal.isLive ? " card-live" : ""}" data-id="${deal.id}">
    <div class="card-top" style="background:${meta.bg}">
      ${badgeHtml}
      <span class="pct-pill">-${pctOff}%</span>
      <img src="${deal.fallbackImage}" alt="${deal.name}" class="deal-img" loading="lazy"
           onerror="this.src='${deal.fallbackImage}'" />
    </div>
    <div class="card-body">
      <div class="retailer-tag" style="color:${meta.color};border-color:${meta.color}20;background:${meta.bg}">
        ${meta.logo} ${meta.label}
      </div>
      <h3 class="deal-name">${deal.name}</h3>
      <div class="price-row">
        <span class="price-normal">${fmt(deal.normalPrice)}</span>
        <span class="price-arrow">→</span>
        <span class="price-clear">${fmt(deal.clearancePrice)}</span>
      </div>
      <div class="savings-line">You save <strong>${fmt(saved)}</strong> (${pctOff}% off)</div>
      ${stock}
      ${liveSource}
      <a href="${deal.link}" target="_blank" rel="noopener noreferrer"
         class="buy-btn" style="background:${meta.color}"
         aria-label="View deal for ${deal.name}">
        ${deal.isLive ? "View Deal ↗" : `Shop at ${meta.label} ↗`}
      </a>
    </div>
  </article>`;
}

function getFiltered() {
  // Live deals first, then curated static deals
  let list = [...liveDEALS, ...DEALS];

  if (activeCategory !== "all") list = list.filter(d => d.category === activeCategory);
  if (activeRetailer  !== "all") list = list.filter(d => d.retailer  === activeRetailer);
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(d => d.name.toLowerCase().includes(q));
  }

  switch (sortMode) {
    case "savings-desc": list.sort((a, b) => (b.normalPrice - b.clearancePrice) - (a.normalPrice - a.clearancePrice)); break;
    case "price-asc":    list.sort((a, b) => a.clearancePrice - b.clearancePrice); break;
    case "price-desc":   list.sort((a, b) => b.clearancePrice - a.clearancePrice); break;
    case "pct-desc":     list.sort((a, b) => pct(b.normalPrice, b.clearancePrice) - pct(a.normalPrice, a.clearancePrice)); break;
  }

  return list;
}

function render() {
  const grid     = document.getElementById("dealsGrid");
  const noRes    = document.getElementById("noResults");
  const countEl  = document.getElementById("dealsCount");
  const filtered = getFiltered();

  const liveN    = filtered.filter(d => d.isLive).length;
  const curatedN = filtered.length - liveN;

  let countStr = `${filtered.length} deal${filtered.length !== 1 ? "s" : ""} found`;
  if (liveN > 0 && curatedN > 0) countStr += ` (${liveN} live · ${curatedN} curated)`;
  else if (liveN > 0)            countStr += ` (${liveN} live)`;
  countEl.textContent = countStr;

  if (filtered.length === 0) {
    grid.innerHTML = "";
    noRes.classList.remove("hidden");
  } else {
    noRes.classList.add("hidden");
    grid.innerHTML = filtered.map(buildCard).join("");
  }
}

// ─────────────────────────────────────────────────────────────
// EVENT WIRING
// ─────────────────────────────────────────────────────────────

document.querySelectorAll(".filter-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeCategory = btn.dataset.category;
    render();
  });
});

document.querySelectorAll(".retailer-chip").forEach(chip => {
  chip.addEventListener("click", () => {
    document.querySelectorAll(".retailer-chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    activeRetailer = chip.dataset.retailer;
    render();
  });
});

document.getElementById("searchInput").addEventListener("input", e => {
  searchQuery = e.target.value.trim();
  render();
});

document.getElementById("sortSelect").addEventListener("change", e => {
  sortMode = e.target.value;
  render();
});

// ─────────────────────────────────────────────────────────────
// INIT — render curated data immediately, then fetch live deals
// ─────────────────────────────────────────────────────────────
render();
loadLiveDeals();
