// ============================================================
// ClearanceHub — Daily Deal Fetcher (GitHub Actions / Node.js)
// Pulls from DealNews category RSS feeds + Slickdeals clearance,
// parses prices and retailer info, then writes a fresh data.js.
// ============================================================

"use strict";

const Parser = require("rss-parser");
const fs     = require("fs");
const path   = require("path");

const parser = new Parser({
  timeout: 12000,
  headers: { "User-Agent": "ClearanceHub-Bot/1.0 (+https://github.com/financewolf-arch/retail-clearance)" },
});

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

// ── Parsing helpers ──────────────────────────────────────────

function extractPrices(title, content) {
  const full    = (title + " " + content).replace(/<[^>]*>/g, " ");
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
      const p = parseInt(pctM[1]);
      if (p > 5 && p < 95) normal = parseFloat((clearance / (1 - p / 100)).toFixed(2));
    }
  }

  if (!normal || normal <= clearance || normal / clearance > 20) return null;
  return { clearancePrice: clearance, normalPrice: parseFloat(normal.toFixed(2)) };
}

function detectRetailer(text) {
  const t = text.toLowerCase();
  if (t.includes("walmart"))            return "walmart";
  if (t.includes("target"))            return "target";
  if (t.includes("costco"))            return "costco";
  if (/sam.s\s*club|samsclub/.test(t)) return "samsclub";
  if (/best\s*buy|bestbuy/.test(t))    return "bestbuy";
  return "amazon";
}

function detectCategory(text, defaultCat) {
  if (defaultCat) return defaultCat;
  const t = text.toLowerCase();
  if (/\btv\b|laptop|tablet|headphone|earbud|speaker|camera|gaming|ipad|macbook|airpod|pixel|router|printer|monitor|drone|smartwatch|chromebook/.test(t)) return "tech";
  if (/shoe|sneaker|boot|shirt|blouse|pants|jeans|jacket|coat|dress|hoodie|sweater|legging|handbag|purse|apparel/.test(t)) return "fashion";
  if (/vacuum|air fryer|instant pot|blender|kitchen|cookware|pots|pans|furniture|mattress|pillow|bedding|grill|coffee maker|ice maker/.test(t)) return "home";
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
    .replace(/\s*@\s*\w.*$/i, "")
    .trim();
}

const RETAILER_COLOR = {
  walmart:  "0071ce",
  target:   "cc0000",
  amazon:   "ff9900",
  costco:   "005DAA",
  samsclub: "004990",
  bestbuy:  "0046be",
};

// ── Main fetch + parse ───────────────────────────────────────

async function fetchAllDeals() {
  const rawItems = [];

  const results = await Promise.allSettled(
    RSS_SOURCES.map(async src => {
      try {
        const feed = await parser.parseURL(src.url);
        feed.items.forEach(item => {
          rawItems.push({
            title:   item.title         || "",
            link:    item.link          || item.guid || "",
            content: item.contentSnippet || item.content || "",
            defaultCategory: src.category,
          });
        });
        console.log(`✓ ${src.url} — ${feed.items.length} items`);
      } catch (err) {
        console.warn(`✗ Failed: ${src.url} — ${err.message}`);
      }
    })
  );

  console.log(`\nFetched ${rawItems.length} raw items from ${results.length} feeds.`);

  const seen   = new Set();
  const deals  = [];

  for (const item of rawItems) {
    const { title, link, content, defaultCategory } = item;
    if (!title || !link || seen.has(link)) continue;
    seen.add(link);

    const prices = extractPrices(title, content);
    if (!prices) continue;

    const fullText = title + " " + content;
    const retailer = detectRetailer(fullText);
    const category = detectCategory(title, defaultCategory);
    const name     = cleanTitle(title) || title.slice(0, 80);
    const hexColor = RETAILER_COLOR[retailer] || "555555";

    deals.push({
      id:             deals.length + 1,
      name:           name.replace(/'/g, "\\'"),
      category,
      retailer,
      normalPrice:    prices.normalPrice,
      clearancePrice: prices.clearancePrice,
      fallbackImage:  `https://placehold.co/300x200/${hexColor}/ffffff?text=${encodeURIComponent(name.slice(0, 22))}`,
      link,
      inStock:        true,
      badge:          "Clearance",
    });

    if (deals.length >= 60) break;
  }

  console.log(`Parsed ${deals.length} valid deals.\n`);
  return deals;
}

// ── Write data.js ────────────────────────────────────────────

function toJS(deals) {
  const dateStr = new Date().toISOString().slice(0, 10);
  const items   = deals.map(d => `  {
    id:             ${d.id},
    name:           ${JSON.stringify(d.name)},
    category:       ${JSON.stringify(d.category)},
    retailer:       ${JSON.stringify(d.retailer)},
    normalPrice:    ${d.normalPrice},
    clearancePrice: ${d.clearancePrice},
    fallbackImage:  ${JSON.stringify(d.fallbackImage)},
    link:           ${JSON.stringify(d.link)},
    inStock:        ${d.inStock},
    badge:          ${JSON.stringify(d.badge)},
  }`).join(",\n");

  return `// ============================================================
// ClearanceHub — Auto-Generated Deal Data
// Last updated: ${dateStr} by GitHub Actions
// Sources: DealNews category RSS · Slickdeals clearance search
// ============================================================

const DEALS = [
${items}
];
`;
}

// ── Entry point ──────────────────────────────────────────────

(async () => {
  console.log("ClearanceHub — fetching live deals...\n");
  const deals  = await fetchAllDeals();
  const outPath = path.join(__dirname, "..", "data.js");

  if (deals.length === 0) {
    console.error("No deals parsed — keeping existing data.js untouched.");
    process.exit(0); // don't overwrite with empty data
  }

  fs.writeFileSync(outPath, toJS(deals), "utf8");
  console.log(`Wrote ${deals.length} deals to data.js`);
})();
