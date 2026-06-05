# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GAS-IMS is a Gas Inventory Management System (가스 재고 관리 시스템) for PSG-포항충전소, a Korean industrial gas production facility. It tracks gas inventory, production batches, cartridge charging, raw material levels, and monthly loss-rate analysis (손실률). The entire application is a **monolithic single-page application** — all UI, business logic, and styles live in one file: `index.html` (~11,000 lines).

## No Build System

There is no package manager, bundler, or test framework. This is a static HTML file deployed directly to GitHub Pages.

- **Development:** Edit `index.html` directly in any editor
- **Deployment:** Open `uploader.html` in a browser → paste a GitHub PAT → drag-drop `index.html` → click upload. This pushes via GitHub REST API to the `main` branch, which GitHub Pages auto-deploys.
- **No lint, no tests, no CI.**

## Architecture

### Single-File SPA Structure

`index.html` is organized in this order (all inline):
1. `<style>` — full dark-theme CSS with CSS custom properties
2. Firebase SDK `<script>` tag (CDN)
3. One large `<script>` block containing all application JavaScript

`uploader.html` is a standalone deployment utility — it is not part of the application.

### Data Persistence (3-Layer Fallback)

All reads/writes go through `fsLoad(key, default)` / `fsSave(key, val)`:

1. **Firebase SDK** — primary real-time path; uses Firestore listeners for live multi-client sync
2. **Firebase REST API** — fallback for environments where the SDK is blocked; polled every 10 seconds
3. **Browser `localStorage`** — offline/cache layer; always written alongside Firebase

The `window.onFsUpdate` callback is the single re-render entrypoint triggered by Firestore listeners. When data changes arrive (from another client or the same), this function rerenders the active page.

### Firestore Schema

All data lives in a single Firestore collection (`gasims`). Each document key corresponds to one data domain:

| Constant | Firestore Key | Description |
|---|---|---|
| `STORE_KEY_INV` | `gasims_inventory_v2` | Current stock levels |
| `STORE_KEY_LOG` | `gasims_log_v2` | Transaction log |
| `STORE_KEY_RAW` | `gasims_raw_v1` | Raw material tanks (He, N2, Ar, H2, O2, CO2) |
| `STORE_KEY_CART` | `gasims_cartridges_v1` | Cartridge inventory |
| `STORE_KEY_CART_LOG` | `gasims_cartlog_v1` | Cartridge transaction log |
| `STORE_KEY_CLIENTS` | `gasims_clients_v1` | Customer records |
| `STORE_KEY_EXPIRE` | `gasims_expire_v1` | Expiration date settings |
| `STORE_KEY_ANALYSIS` | `gasims_analysis_v1` | Quality analysis / test certificates |
| `STORE_KEY_INCOMING` | `gasims_incoming_v1` | Incoming empty bottle records |
| `STORE_KEY_ORDERS` | `gasims_orders_v1` | Purchase orders |
| `STORE_KEY_USERS` | `gasims_users_v1` | User accounts (custom auth) |
| `STORE_KEY_CLOSING` | `gasims_monthly_closing_v1` | Monthly closing / loss-rate data |
| `STORE_KEY_DAYCLOSE` | `gasims_daily_closing_v1` | Daily closing records |

The `_v1` / `_v2` suffix is a manual schema version. If you add a new data field to an existing key, no migration is needed (Firestore stores JSON objects). If you break backwards compatibility, bump the suffix and add a migration in the load path.

### Page Navigation

The app has 11 pages controlled by `nav-btn` tab clicks. Each page is a `<div id="page-*">` hidden/shown via CSS class toggling. The active page is re-rendered on tab switch:

| Page ID | Function |
|---|---|
| `page-dash` | Dashboard — summary tiles and raw material status |
| `page-base` | Baseline inventory setup |
| `page-prod` | Daily production input |
| `page-cart` | Cartridge charging |
| `page-incoming` | Incoming empty bottle records |
| `page-order` | Purchase order management |
| `page-txn` | Outbound shipments / inventory adjustments |
| `page-analysis` | Quality analysis and test certificates |
| `page-closing` | Daily/monthly closing and loss-rate calculation |
| `page-hist` | Transaction history log |
| `page-admin` | Admin panel (user mgmt, logs) |

### Authentication

There is no OAuth. The app uses a custom username/password system:
- Accounts stored in Firestore under `gasims_users_v1`
- Roles: Admin, Manager, Staff — access controlled via `applyRolePermissions()`
- Admin password separately hashed in localStorage as `gasims_adminpw`
- Current session stored under `STORE_KEY_SESSION`
- First-launch requires admin signup (only enabled when no users exist)

### Key Function Conventions

- `render*()` — Re-renders a page section from current in-memory state (e.g., `renderDash()`, `renderCart()`)
- `open*()`/`close*()` — Toggle modal dialogs
- `fsLoad(key, default)` / `fsSave(key, val)` — All data access goes through these
- `today()` — Returns current date as `YYYY-MM-DD` string
- `calcSystemUsedKg()` — Core business logic: computes system-side gas usage for monthly loss-rate reconciliation

### Gas Domain Constants

```js
const HE_KG_TO_M3 = 0.126;     // Helium: kg → m³ conversion factor
const CYL_VOL_L = [47, ...];   // Standard cylinder volumes in liters
const WARN_DAYS = 30;           // Days before expiry to show warning
const ALL_GAS_LIST = [...];     // Gas codes: He, N2, Ar, H2, O2, CO2, ...
```

### CSS Theme

Dark GitHub-inspired theme via CSS custom properties in `:root`:

```css
--bg: #0d1117        /* page background */
--accent: #39d353    /* success / positive numbers */
--accent2: #1f6feb   /* primary actions */
--danger: #f85149    /* errors / critical */
--warn: #d29922      /* warnings */
--text: #e6edf3      /* body text */
--mono: 'JetBrains Mono'  /* numeric data */
--sans: 'Nanum Gothic'    /* Korean UI text */
```

## Key Conventions

- **Language:** All UI labels, variable names for domain concepts, and comments are in Korean. Gas codes use chemical symbols (`He`, `N2`, `Ar`, `H2`, `O2`, `CO2`).
- **Storage key naming:** `gasims_<domain>_v<N>` — never abbreviate the prefix.
- **Version bumping:** Only bump `_vN` when the data shape is incompatible with existing stored data.
- **Error handling:** User-facing errors use `alert()`. No error boundary or toast system.
- **Date format:** Always `YYYY-MM-DD` (ISO 8601), never locale-formatted strings in data.
- **Modals:** Each modal is a `.modal` div. Open/close via dedicated `open*Modal()` / `close*Modal()` function pairs — never toggle visibility directly from event handlers.
- **CSV export:** All pages that expose history data should also expose a CSV export function named `export*Csv()`.
