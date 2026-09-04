#!/usr/bin/env node
// collectors/market.mjs — price data for FACT-CHECKING market-commentary tweets.
// Dependency-free, Node >= 22 (uses global fetch). Read-only, no keys, no login.
//
// The wall harvests macro/TA "signal" accounts (and any post implying a tradeable
// view) whose claims are narrative + levels. Before that becomes a thesis card
// (see CLAUDE.md "Market-thesis synthesis"), its factual claims ("BTC topped
// $126K", "NVDA reclaimed $200") get checked against real price history HERE — so
// a thesis carries verified ✓/✗ rows, not repeated marketing.
//
// ONE universal source: Yahoo Finance's public chart API — covers every asset
// class the engine might touch, so the thesis engine is asset-class-agnostic.
//
// Usage:
//   node collectors/market.mjs price   <symbol>                 → latest spot
//   node collectors/market.mjs history <symbol> [days]          → daily OHLC JSON (default 400)
//   node collectors/market.mjs check   <symbol> <lvl[,lvl,…]> [days]
//                                                          → for each level, first date
//                                                            its daily range touched it,
//                                                            plus spot + range hi/lo
//
// Symbols (friendly forms are normalised to Yahoo; or pass a Yahoo symbol as-is):
//   crypto     BTC · ETH · SOL            (→ BTC-USD …)
//   equity/ETF NVDA · SPY · LLY · CRWV     (as-is)
//   index      ^GSPC · ^IXIC · ^DJI  or  SPX/NASDAQ/DOW/VIX aliases
//   commodity  CL=F · GC=F  or  OIL/GOLD/SILVER/NATGAS aliases
//   FX         EURUSD · GBPUSD · USDJPY  (→ …=X)   ·  DXY
//
// Output is JSON on stdout (pipe to jq/python3); diagnostics go to stderr.

const CRYPTO = new Set(["BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "AVAX", "LINK", "LTC", "BCH", "DOT", "MATIC"]);
const ALIAS = {
  SPX: "^GSPC", SP500: "^GSPC", NASDAQ: "^IXIC", NDX: "^NDX", DOW: "^DJI", DJIA: "^DJI",
  RUSSELL: "^RUT", VIX: "^VIX", FTSE: "^FTSE", NIKKEI: "^N225",
  OIL: "CL=F", WTI: "CL=F", BRENT: "BZ=F", GOLD: "GC=F", SILVER: "SI=F", NATGAS: "NG=F", COPPER: "HG=F",
  DXY: "DX-Y.NYB", US10Y: "^TNX", UST10Y: "^TNX",
};
const FX = /^(?:[A-Z]{3})(?:USD|EUR|GBP|JPY|CHF|CAD|AUD|NZD)$/;

// Map a friendly symbol to a Yahoo Finance symbol.
function yahooSymbol(raw) {
  const s = raw.trim();
  const U = s.toUpperCase();
  if (ALIAS[U]) return ALIAS[U];
  if (s.startsWith("^") || s.includes("=") || s.includes(".") || s.includes("-")) return s; // already a Yahoo symbol
  if (CRYPTO.has(U)) return `${U}-USD`;
  if (FX.test(U)) return `${U}=X`;
  return U; // equity / ETF ticker
}

const rangeFor = days => days <= 30 ? "1mo" : days <= 90 ? "3mo" : days <= 180 ? "6mo"
  : days <= 365 ? "1y" : days <= 730 ? "2y" : days <= 1825 ? "5y" : "max";
const fmtDate = ms => new Date(ms).toISOString().slice(0, 10);

async function yahooDaily(rawSym, days) {
  const sym = yahooSymbol(rawSym);
  const qs = `range=${rangeFor(days)}&interval=1d`;
  const path = `/v8/finance/chart/${encodeURIComponent(sym)}?${qs}`;
  let lastErr;
  for (const host of ["query1.finance.yahoo.com", "query2.finance.yahoo.com"]) {
    try {
      const res = await fetch(`https://${host}${path}`, { headers: { "User-Agent": "Mozilla/5.0 social-wall-market-fetch" } });
      if (!res.ok) { lastErr = new Error(`Yahoo HTTP ${res.status} for ${sym}`); continue; }
      const j = await res.json();
      const r = j?.chart?.result?.[0];
      if (!r) { lastErr = new Error(`Yahoo: no data for ${sym} (unknown symbol?)`); continue; }
      const ts = r.timestamp || [];
      const q = r.indicators?.quote?.[0] || {};
      const rows = ts.map((t, i) => ({
        d: fmtDate(t * 1000), o: q.open?.[i], h: q.high?.[i], l: q.low?.[i], c: q.close?.[i],
      })).filter(x => Number.isFinite(x.h) && Number.isFinite(x.l) && Number.isFinite(x.c));
      if (!rows.length) { lastErr = new Error(`Yahoo: empty series for ${sym}`); continue; }
      return { rows: rows.slice(-days), meta: r.meta || {}, symbol: sym };
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error(`Yahoo: fetch failed for ${sym}`);
}

function summarize(rows) {
  let hi = rows[0], lo = rows[0];
  for (const r of rows) { if (r.h > hi.h) hi = r; if (r.l < lo.l) lo = r; }
  const last = rows[rows.length - 1];
  return {
    asOf: last.d, spot: last.c,
    rangeHigh: { price: hi.h, date: hi.d },
    rangeLow:  { price: lo.l, date: lo.d },
    days: rows.length, from: rows[0].d, to: last.d,
  };
}

// First date the daily range [l,h] contained `level` (i.e. price actually traded there).
function firstTouch(rows, level) {
  for (const r of rows) if (r.l <= level && level <= r.h) return r.d;
  return null;
}

async function main() {
  const [cmd, sym, arg3, arg4] = process.argv.slice(2);
  if (!cmd || !sym) {
    console.error("usage: collectors/market.mjs price|history|check <symbol> [days | levels days]");
    process.exit(2);
  }
  try {
    if (cmd === "price") {
      const { rows, symbol } = await yahooDaily(sym, 10);
      const s = summarize(rows);
      console.log(JSON.stringify({ symbol, asOf: s.asOf, spot: s.spot }, null, 2));
    } else if (cmd === "history") {
      const { rows, symbol } = await yahooDaily(sym, arg3 ? +arg3 : 400);
      console.log(JSON.stringify({ symbol, summary: summarize(rows), days: rows }, null, 2));
    } else if (cmd === "check") {
      if (!arg3) { console.error("check needs levels, e.g. check BTC 126000,59000"); process.exit(2); }
      const { rows, symbol } = await yahooDaily(sym, arg4 ? +arg4 : 800);
      const s = summarize(rows);
      const levels = arg3.split(",").map(x => +x.replace(/[^0-9.]/g, "")).filter(Number.isFinite);
      const checks = levels.map(level => {
        const touched = firstTouch(rows, level);
        return { level, everTouched: !!touched, firstTouched: touched };
      });
      console.log(JSON.stringify({ symbol, summary: s, checks }, null, 2));
    } else {
      console.error(`unknown command "${cmd}"`); process.exit(2);
    }
  } catch (e) {
    console.error("market-fetch error:", e.message);
    process.exit(1);
  }
}

main();
