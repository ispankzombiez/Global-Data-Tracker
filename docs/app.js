const kpis = document.querySelector("#kpis");
const sourceSelect = document.querySelector("#source-select");
const metricSelect = document.querySelector("#metric-select");
const categorySelect = document.querySelector("#category-select");
const itemSearch = document.querySelector("#item-search");
const itemSelect = document.querySelector("#item-select");
const exportItemCsvButton = document.querySelector("#export-item-csv");
const exportFilteredCsvButton = document.querySelector("#export-filtered-csv");
const topItemsBody = document.querySelector("#top-items");
const latestLabel = document.querySelector("#latest-label");
const deltaLabel = document.querySelector("#delta-label");
const marketLabel = document.querySelector("#market-label");
const gainersBody = document.querySelector("#gainers-body");
const losersBody = document.querySelector("#losers-body");
const themeToggle = document.querySelector("#theme-toggle");
const THEME_STORAGE_KEY = "gdt-theme-v2";

if (window.location.pathname.endsWith("/docs/") || window.location.pathname.endsWith("/docs/index.html")) {
  const target = window.location.pathname
    .replace(/\/docs\/index\.html$/, "/")
    .replace(/\/docs\/$/, "/");
  const suffix = `${window.location.search}${window.location.hash}`;
  window.location.replace(`${target}${suffix}`);
}

let itemChart = null;
let marketChart = null;

const state = {
  source: "active",
  metric: "raw",
  category: "all",
  query: "",
  selectedItem: "",
  theme: document.documentElement.getAttribute("data-theme") || "dark",
  datasets: {}
};

function currentThemeColors() {
  const style = getComputedStyle(document.documentElement);
  return {
    chartText: style.getPropertyValue("--chart-text").trim() || "#d6e2ec",
    chartGrid: style.getPropertyValue("--chart-grid").trim() || "rgba(214, 226, 236, 0.18)",
    accent: style.getPropertyValue("--accent").trim() || "#38b2ac",
    accent2: style.getPropertyValue("--accent-2").trim() || "#f59e0b"
  };
}

function applyTheme(theme) {
  state.theme = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", state.theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, state.theme);
  } catch {
    // Ignore localStorage failures in restricted browser contexts.
  }
  if (themeToggle) {
    themeToggle.textContent = state.theme === "dark" ? "Light Mode" : "Dark Mode";
    themeToggle.setAttribute(
      "aria-label",
      state.theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
    );
  }

  if (state.datasets[state.source]) {
    renderCurrent();
  }
}

function formatNumber(value, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits
  }).format(Number(value) || 0);
}

function formatDelta(value) {
  if (value > 0) {
    return `+${formatNumber(value)}`;
  }
  return formatNumber(value);
}

function createKpi(label, value) {
  const card = document.createElement("article");
  card.className = "kpi";
  card.innerHTML = `<p>${label}</p><strong>${value}</strong>`;
  return card;
}

function csvEscape(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes("\"") || text.includes("\n")) {
    return `"${text.replaceAll("\"", "\"\"")}"`;
  }
  return text;
}

async function loadJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${url}`);
  }
  return response.json();
}

let processedDataBase = null;

function processedDataBaseCandidates() {
  const candidates = [];
  const add = (value) => {
    const normalized = String(value || "").replace(/\/+$/, "");
    if (normalized && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  // Relative candidates support local docs serving and repo-root entrypoint modes.
  add("./data/processed");
  add("../data/processed");

  // Absolute candidate supports GitHub project pages where app is hosted under /<repo>/.
  const pathParts = window.location.pathname.split("/").filter(Boolean);
  if (window.location.hostname.endsWith("github.io") && pathParts.length > 0) {
    add(`/${pathParts[0]}/data/processed`);
  }

  // Final fallback for custom-domain/root-hosted pages.
  add("/data/processed");

  return candidates;
}

async function loadProcessedJson(fileName) {
  if (processedDataBase) {
    return loadJson(`${processedDataBase}/${fileName}`);
  }

  const attempts = [];
  for (const base of processedDataBaseCandidates()) {
    const url = `${base}/${fileName}`;
    try {
      const payload = await loadJson(url);
      processedDataBase = base;
      return payload;
    } catch (error) {
      attempts.push(url);
    }
  }

  console.error("Processed data path resolution failed", { fileName, attempts });
  throw new Error("No processed datasets available. Run data pipeline first.");
}

function categoryForItem(itemName) {
  const normalized = itemName.toLowerCase();

  if (normalized.includes("coin") || normalized.includes("flor") || normalized.includes("gem")) {
    return "currency";
  }

  if (
    normalized.includes("cake") ||
    normalized.includes("pie") ||
    normalized.includes("soup") ||
    normalized.includes("jam") ||
    normalized.includes("roast") ||
    normalized.includes("salad") ||
    normalized.includes("pizza")
  ) {
    return "food";
  }

  if (
    normalized.includes("hat") ||
    normalized.includes("shirt") ||
    normalized.includes("pants") ||
    normalized.includes("boots") ||
    normalized.includes("mask") ||
    normalized.includes("helm")
  ) {
    return "wearable";
  }

  if (
    normalized.includes("wood") ||
    normalized.includes("iron") ||
    normalized.includes("stone") ||
    normalized.includes("gold") ||
    normalized.includes("egg") ||
    normalized.includes("wool") ||
    normalized.includes("honey") ||
    normalized.includes("oil")
  ) {
    return "resource";
  }

  if (
    normalized.includes("seed") ||
    normalized.includes("wheat") ||
    normalized.includes("corn") ||
    normalized.includes("carrot") ||
    normalized.includes("potato") ||
    normalized.includes("beet") ||
    normalized.includes("sunflower") ||
    normalized.includes("pumpkin")
  ) {
    return "crop";
  }

  return "other";
}

function getPreviousDate(history, latestDate) {
  const dates = history.dates || [];
  if (dates.length < 2) {
    return null;
  }

  const idx = dates.indexOf(latestDate);
  if (idx <= 0) {
    return dates[dates.length - 2] ?? null;
  }
  return dates[idx - 1];
}

function getItemValue(history, itemName, date) {
  if (!date) {
    return 0;
  }
  return history.seriesByItem?.[itemName]?.[date] ?? 0;
}

function computeDeltas(history, latest) {
  const prevDate = getPreviousDate(history, latest.date);
  const deltas = {};
  const names = Object.keys(latest.items || {});

  for (const itemName of names) {
    const current = latest.items[itemName] ?? 0;
    const previous = getItemValue(history, itemName, prevDate);
    deltas[itemName] = current - previous;
  }

  return { deltas, prevDate };
}

function filteredItemNames(latest) {
  const entries = Object.entries(latest.items || {}).sort((a, b) => b[1] - a[1]);
  return entries
    .map(([name]) => name)
    .filter((name) => {
      if (state.category !== "all" && categoryForItem(name) !== state.category) {
        return false;
      }
      if (state.query && !name.toLowerCase().includes(state.query.toLowerCase())) {
        return false;
      }
      return true;
    });
}

function renderSourceOptions(availableSources) {
  sourceSelect.innerHTML = "";

  for (const source of availableSources) {
    const option = document.createElement("option");
    option.value = source;
    option.textContent = source;
    sourceSelect.appendChild(option);
  }

  if (!availableSources.includes(state.source)) {
    state.source = availableSources[0] || "active";
  }

  sourceSelect.value = state.source;
}

function renderKpis(history, latest, deltas) {
  const positive = Object.values(deltas).filter((value) => value > 0).length;
  const negative = Object.values(deltas).filter((value) => value < 0).length;

  kpis.innerHTML = "";
  kpis.append(
    createKpi("Latest Date", latest.date || "N/A"),
    createKpi("Tracked Farms", formatNumber(latest.farmCount || 0)),
    createKpi("Item Types", formatNumber(history.itemTypes || 0)),
    createKpi("Daily Snapshots", formatNumber(history.dates?.length || 0)),
    createKpi("Items Gained", formatNumber(positive)),
    createKpi("Items Dropped", formatNumber(negative))
  );
}

function renderTopItems(latest, history, deltas) {
  const prevDate = getPreviousDate(history, latest.date);
  latestLabel.textContent = latest.date
    ? `Snapshot date: ${latest.date}${prevDate ? ` (vs ${prevDate})` : ""}`
    : "No latest snapshot found";

  const farmCount = latest.farmCount || 1;
  const names = filteredItemNames(latest);

  topItemsBody.innerHTML = "";

  for (const name of names.slice(0, 150)) {
    const amount = latest.items[name] ?? 0;
    const perFarm = amount / farmCount;
    const delta = deltas[name] ?? 0;
    const deltaClass = delta > 0 ? "delta-up" : delta < 0 ? "delta-down" : "delta-flat";

    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${name}</td>
      <td>${formatNumber(amount)}</td>
      <td>${formatNumber(perFarm, 3)}</td>
      <td class="${deltaClass}">${formatDelta(delta)}</td>
    `;
    topItemsBody.appendChild(row);
  }
}

function renderItemOptions(latest) {
  const names = filteredItemNames(latest);
  const hadPrevious = names.includes(state.selectedItem);

  itemSelect.innerHTML = "";

  for (const name of names) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    itemSelect.appendChild(option);
  }

  if (!hadPrevious) {
    state.selectedItem = names[0] || "";
  }

  itemSelect.value = state.selectedItem;
}

function renderMovers(history, latest, deltas) {
  const prevDate = getPreviousDate(history, latest.date);
  deltaLabel.textContent = prevDate
    ? `${latest.date} compared with ${prevDate}`
    : "Need at least two snapshots to compute movers";

  const entries = Object.entries(deltas);
  const gainers = entries
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);
  const losers = entries
    .filter(([, value]) => value < 0)
    .sort((a, b) => a[1] - b[1])
    .slice(0, 20);

  gainersBody.innerHTML = "";
  losersBody.innerHTML = "";

  for (const [name, value] of gainers) {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${name}</td><td class="delta-up">${formatDelta(value)}</td>`;
    gainersBody.appendChild(row);
  }

  for (const [name, value] of losers) {
    const row = document.createElement("tr");
    row.innerHTML = `<td>${name}</td><td class="delta-down">${formatDelta(value)}</td>`;
    losersBody.appendChild(row);
  }
}

function renderMarketChart(history) {
  const labels = history.dates || [];
  const totals = labels.map((date) => {
    let sum = 0;
    const farmCount = history.farmCountByDate?.[date] || 1;

    for (const series of Object.values(history.seriesByItem || {})) {
      const value = series?.[date] || 0;
      sum += state.metric === "perFarm" ? value / farmCount : value;
    }

    return sum;
  });

  if (marketChart) {
    marketChart.destroy();
  }

  const context = document.querySelector("#market-chart").getContext("2d");
  const usePerFarm = state.metric === "perFarm";
  const metricLabel = usePerFarm ? "per active farm" : "global total";
  const digits = usePerFarm ? 3 : 0;
  const colors = currentThemeColors();

  marketChart = new Chart(context, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: `All tracked items (${metricLabel})`,
          data: totals,
          borderWidth: 1,
          backgroundColor: `${colors.accent2}99`,
          borderColor: colors.accent2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: {
            color: colors.chartText
          },
          grid: {
            color: colors.chartGrid
          }
        },
        y: {
          ticks: {
            color: colors.chartText,
            callback(value) {
              return formatNumber(value, digits);
            }
          },
          grid: {
            color: colors.chartGrid
          }
        }
      },
      plugins: {
        legend: {
          labels: {
            color: colors.chartText
          }
        },
        tooltip: {
          callbacks: {
            label(context) {
              return `${context.dataset.label}: ${formatNumber(context.parsed.y, digits)}`;
            }
          }
        }
      }
    }
  });

  if (labels.length > 0) {
    const first = totals[0] || 0;
    const last = totals.at(-1) || 0;
    const delta = last - first;
    const sign = delta > 0 ? "+" : "";
    marketLabel.textContent = `${metricLabel} change since first snapshot: ${sign}${formatNumber(delta, digits)}`;
  } else {
    marketLabel.textContent = "";
  }
}

function renderChart(history, latest, itemName) {
  const labels = history.dates || [];
  const series = history.seriesByItem?.[itemName] || {};
  const usePerFarm = state.metric === "perFarm";
  const data = labels.map((date) => {
    const rawValue = series[date] || 0;
    if (!usePerFarm) {
      return rawValue;
    }
    const farms = history.farmCountByDate?.[date] || 1;
    return rawValue / farms;
  });

  if (itemChart) {
    itemChart.destroy();
  }

  const context = document.querySelector("#item-chart").getContext("2d");
  const labelSuffix = usePerFarm ? " per active farm" : " total amount";
  const digitCount = usePerFarm ? 3 : 0;
  const colors = currentThemeColors();

  itemChart = new Chart(context, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `${itemName}${labelSuffix}`,
          data,
          borderColor: colors.accent,
          backgroundColor: `${colors.accent}33`,
          fill: true,
          pointRadius: 2,
          borderWidth: 2,
          tension: 0.24
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          ticks: {
            color: colors.chartText
          },
          grid: {
            color: colors.chartGrid
          }
        },
        y: {
          ticks: {
            color: colors.chartText,
            callback(value) {
              return formatNumber(value, digitCount);
            }
          },
          grid: {
            color: colors.chartGrid
          }
        }
      },
      plugins: {
        legend: {
          labels: {
            color: colors.chartText
          }
        },
        tooltip: {
          callbacks: {
            label(context) {
              return `${context.dataset.label}: ${formatNumber(context.parsed.y, digitCount)}`;
            }
          }
        }
      }
    }
  });
}

function renderError(error) {
  kpis.innerHTML = "";
  const card = createKpi("Error", error.message || "Unable to load data");
  kpis.appendChild(card);
}

function downloadSelectedItemCsv() {
  const current = state.datasets[state.source];
  if (!current || !state.selectedItem) {
    return;
  }

  const { history } = current;
  const itemName = state.selectedItem;
  const dates = history.dates || [];
  const series = history.seriesByItem?.[itemName] || {};
  const rows = [
    ["date", "source", "item", "raw_total", "active_farm_count", "per_active_farm"]
  ];

  for (const date of dates) {
    const raw = series[date] || 0;
    const farms = history.farmCountByDate?.[date] || 1;
    const perFarm = raw / farms;
    rows.push([date, state.source, itemName, raw, farms, perFarm]);
  }

  const csvText = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const safeName = itemName.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  const fileName = `${state.source}-${safeName || "item"}.csv`;

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadFilteredItemsCsv() {
  const current = state.datasets[state.source];
  if (!current) {
    return;
  }

  const { history, latest } = current;
  const names = filteredItemNames(latest);
  if (names.length === 0) {
    return;
  }

  const rows = [
    ["date", "source", "item", "raw_total", "active_farm_count", "per_active_farm", "category"]
  ];

  for (const date of history.dates || []) {
    const farms = history.farmCountByDate?.[date] || 1;

    for (const itemName of names) {
      const raw = history.seriesByItem?.[itemName]?.[date] || 0;
      rows.push([
        date,
        state.source,
        itemName,
        raw,
        farms,
        raw / farms,
        categoryForItem(itemName)
      ]);
    }
  }

  const csvText = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const queryPart = state.query
    ? state.query.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase()
    : "all";
  const fileName = `${state.source}-${state.category}-${queryPart}-filtered-items.csv`;

  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function loadDataset(source) {
  if (!state.datasets[source]) {
    const [history, latest] = await Promise.all([
      loadProcessedJson(`history-${source}.json`),
      loadProcessedJson(`latest-${source}.json`)
    ]);
    state.datasets[source] = { history, latest };
  }

  return state.datasets[source];
}

function renderCurrent() {
  const current = state.datasets[state.source];
  if (!current) {
    return;
  }

  const { history, latest } = current;
  const { deltas } = computeDeltas(history, latest);

  renderKpis(history, latest, deltas);
  renderItemOptions(latest);
  renderTopItems(latest, history, deltas);
  renderMovers(history, latest, deltas);
  renderMarketChart(history);

  if (state.selectedItem) {
    renderChart(history, latest, state.selectedItem);
  }
}

async function init() {
  try {
    let availableSources = ["active"];

    try {
      const catalog = await loadProcessedJson("catalog.json");
      availableSources = Object.keys(catalog.sources || {}).sort();
      if (availableSources.length === 0) {
        availableSources = ["active"];
      }
    } catch {
      availableSources = ["active"];
    }

    renderSourceOptions(availableSources);

    for (const source of availableSources) {
      try {
        await loadDataset(source);
      } catch {
        // Ignore missing source files so one broken source does not block others.
      }
    }

    if (!state.datasets[state.source]) {
      const fallback = Object.keys(state.datasets)[0];
      if (!fallback) {
        throw new Error("No processed datasets available. Run data pipeline first.");
      }
      state.source = fallback;
      sourceSelect.value = state.source;
    }

    renderCurrent();

    sourceSelect.addEventListener("change", () => {
      state.source = sourceSelect.value;
      renderCurrent();
    });

    metricSelect.addEventListener("change", () => {
      state.metric = metricSelect.value;
      renderCurrent();
    });

    categorySelect.addEventListener("change", () => {
      state.category = categorySelect.value;
      renderCurrent();
    });

    itemSearch.addEventListener("input", () => {
      state.query = itemSearch.value;
      renderCurrent();
    });

    itemSelect.addEventListener("change", () => {
      state.selectedItem = itemSelect.value;
      renderCurrent();
    });

    exportItemCsvButton.addEventListener("click", () => {
      downloadSelectedItemCsv();
    });

    exportFilteredCsvButton.addEventListener("click", () => {
      downloadFilteredItemsCsv();
    });

  } catch (error) {
    renderError(error);
    console.error(error);
  }
}

applyTheme(state.theme);

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    applyTheme(state.theme === "dark" ? "light" : "dark");
  });
}

init();
