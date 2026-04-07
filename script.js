// ============================================================
// ClearanceHub — UI Logic
// ============================================================

const RETAILER_META = {
  walmart:  { label: "Walmart",   color: "#0071ce", bg: "#e8f4fd", logo: "🛒" },
  target:   { label: "Target",    color: "#cc0000", bg: "#fde8e8", logo: "🎯" },
  amazon:   { label: "Amazon",    color: "#ff9900", bg: "#fff8e8", logo: "📦" },
  costco:   { label: "Costco",    color: "#005DAA", bg: "#e8f0fb", logo: "🏪" },
  samsclub: { label: "Sam's Club",color: "#004990", bg: "#e8eef8", logo: "🏬" },
  bestbuy:  { label: "Best Buy",  color: "#0046be", bg: "#e8edfb", logo: "💙" },
};

let activeCategory = "all";
let activeRetailer  = "all";
let searchQuery     = "";
let sortMode        = "savings-desc";

// ── Render ────────────────────────────────────────────────

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
  const meta   = RETAILER_META[deal.retailer] || { label: deal.retailer, color: "#555", bg: "#f0f0f0", logo: "🏷️" };
  const pctOff = pct(deal.normalPrice, deal.clearancePrice);
  const saved  = savings(deal.normalPrice, deal.clearancePrice);
  const stockLabel = deal.inStock ? '<span class="stock in-stock">✔ In Stock</span>' : '<span class="stock out-stock">✖ Low/Out of Stock</span>';
  const badgeHtml  = deal.badge ? `<span class="item-badge">${deal.badge}</span>` : "";

  return `
  <article class="deal-card" data-id="${deal.id}">
    <div class="card-top" style="background:${meta.bg}">
      ${badgeHtml}
      <span class="pct-pill">-${pctOff}%</span>
      <img
        src="${deal.fallbackImage}"
        alt="${deal.name}"
        class="deal-img"
        loading="lazy"
        onerror="this.src='${deal.fallbackImage}'"
      />
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
      ${stockLabel}
      <a
        href="${deal.link}"
        target="_blank"
        rel="noopener noreferrer"
        class="buy-btn"
        style="background:${meta.color}"
        aria-label="Buy ${deal.name} at ${meta.label}"
      >
        Shop at ${meta.label} ↗
      </a>
    </div>
  </article>`;
}

function getFiltered() {
  let list = DEALS.slice();

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
  const grid = document.getElementById("dealsGrid");
  const noRes = document.getElementById("noResults");
  const count = document.getElementById("dealsCount");
  const filtered = getFiltered();

  count.textContent = `${filtered.length} deal${filtered.length !== 1 ? "s" : ""} found`;

  if (filtered.length === 0) {
    grid.innerHTML = "";
    noRes.classList.remove("hidden");
  } else {
    noRes.classList.add("hidden");
    grid.innerHTML = filtered.map(buildCard).join("");
  }
}

// ── Event Wiring ─────────────────────────────────────────

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

// ── Init ─────────────────────────────────────────────────
render();
