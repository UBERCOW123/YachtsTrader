# YachtsTrader Parser - Session Handoff Document

**Last Updated:** 2025-12-27T14:34:00Z  
**Status:** In active development - URL parsing system

---

## Project Overview

YachtsTrader is a yacht listing aggregator website (like AutoTrader for boats). The core feature being developed is a **URL parser** that allows yacht brokers to paste their website URL and have their listings automatically imported.

**Goal:** Work "out of the box" for 70% of yacht broker sites, with ability to add custom adapters for edge cases within 48 hours.

---

## Current Architecture

### Files Location
All working code is in `docs/` folder:
- `docs/index.html` - Main homepage
- `docs/list-yacht.html` - Listing import page (URL parser UI)
- `docs/list-yacht.css` - Styles for import page
- `docs/list-yacht.js` - **Core parsing logic** (~1700 lines)
- `docs/styles.css` - Base styles
- `docs/script.js` - Homepage JS

### Parser Architecture (list-yacht.js)

```
User enters URL
    ↓
fetchWithProxy() - Uses CORS proxies to fetch HTML
    ↓
parseYachtListings() orchestrates:
    1. validateYachtSite() - Check for yacht keywords
    2. extractStructuredData() - Try JSON-LD/Schema.org first
    3. SITE_ADAPTERS[] - Try known site patterns
    4. genericHeuristicParse() - Fallback
    ↓
If no results, discoverInventoryLinks() - Find /boats/, /inventory/ pages
    ↓
discoverPaginationLinks() - Find page 2, 3, next links
    ↓
Follow discovered links, parse each, combine results
    ↓
deduplicateYachts() + confidence filtering
    ↓
renderYachtCards() - Display with edit capability
```

### Site Adapters (Plugin System)

Located in `SITE_ADAPTERS` array. Each adapter has:
- `name` - Identifier
- `detect(doc, url)` - Returns true if this adapter handles the site
- `parse(doc, url)` - Returns array of yacht objects

Current adapters:
1. **wp-listing-theme** - WordPress property themes (`.listing_wrapper`, `.property_listing`)
2. **nyb-style** - Network Yacht Brokers (`.outline`, `.ltboats-*`)
3. **yachtworld-style** - YachtWorld patterns
4. **card-grid** - Generic grid/card layouts
5. **detail-page** - Single yacht detail pages

---

## What's Working

✅ **Red Ensign (red-ensign.com)** - Working well with wp-listing-theme adapter
- Prices extracted (£27,950 format)
- Titles, images working
- Pagination discovery working

✅ **Discovery System**
- Finds inventory pages from homepage
- Follows pagination (page 2, 3)
- Deduplicates results

✅ **Display Limiting**
- CONFIG.MAX_LISTINGS_DISPLAY = 10 (for testing)
- Shows "10 of 25 Yachts Found" with message about hidden listings

✅ **Confidence Scoring**
- Title: 35 points, Images: 25, Price: 15, Year: 10, etc.
- MIN_LISTING_CONFIDENCE = 40 to filter junk

---

## Current Problems / TODO

### 1. Network Yacht Brokers (networkyachtbrokers.com) - Partially Fixed
- Added nyb-style adapter but needs testing
- Uses background images (not img tags) - added extraction
- Homepage needs to discover `/results/` page - added pattern
- **Test this!** Adapter was just added, not verified working

### 2. Location Extraction Weak
- Many sites have location but we're not extracting
- Red Ensign has location in `.property_location` - partially working
- NYB has `.ltboats-details-location` - added to adapter
- Generic extraction patterns in `extractSpecs()` need improvement

### 3. Pagination Not Fully Working
- Only follows 2 additional pages (hardcoded limit)
- Some sites use AJAX pagination (can't follow without JS execution)
- Should detect total pages and offer to scan more

### 4. Price Extraction Edge Cases
- "POA", "Price on Application", "Contact for Price" - added support
- "Sold" labels - added support
- European format (€1.234.567) - partially handled
- Missing some currency patterns

### 5. Search Stopping Early
User reported different results from homepage vs inventory URL.
- Need to ensure discovery finds ALL inventory links
- May need to try multiple discovered links, not just first 3

### 6. Background Images
- Added support in nyb-style adapter and extractFromGenericCard
- Pattern: `style="background: url(...)"`
- Not all sites use this, but NYB does

### 7. CORS Proxy Limitations
- Using public proxies (allorigins.win, corsproxy.io)
- These can fail, rate limit, or be blocked
- Production needs dedicated backend proxy

---

## Key Configuration (in list-yacht.js)

```javascript
const CONFIG = {
    MIN_LISTING_CONFIDENCE: 40,  // Lower = more permissive
    MIN_YACHT_KEYWORDS: 3,       // Site validation
    MIN_YACHT_PRICE: 5000,       // Filter noise
    MAX_YACHT_PRICE: 100000000,
    MIN_IMAGE_WIDTH: 200,
    MIN_IMAGE_HEIGHT: 150,
    MAX_LISTINGS_DISPLAY: 10,    // Testing limit
    DEBUG: true                  // Console logging
};
```

---

## Adding New Site Support

1. **Analyze the site** using browser DevTools
   - Find yacht card container class
   - Find title, price, image, location elements
   - Check if they use background images

2. **Add adapter** to `SITE_ADAPTERS` array in list-yacht.js:
```javascript
{
    name: 'site-name',
    detect: (doc, url) => {
        return url.includes('domain.com') || doc.querySelector('.their-class');
    },
    parse: (doc, url) => {
        // Extract yachts, return array
    }
}
```

3. **Test** with the URL

See `adding-site-adapters.md` for full guide + AI prompt template.

---

## Debug Workflow

1. Enter failing URL → "Scan Website"
2. If fails, click "Show Debug Info" 
3. Console shows: URL, validation result, rejection reasons
4. Alert tells user to email support with URL

Debug data structure:
```javascript
lastParseDebug = {
    url: "...",
    validation: { valid: true/false, keywordsFound: [...] },
    yachts: [...],
    debug: { attempted: N, accepted: N, rejected: N, rejectionReasons: [...] }
}
```

---

## Ideas for Future Improvement

### Short Term
- [ ] Test networkyachtbrokers.com after recent changes
- [ ] Improve location extraction patterns
- [ ] Add more inventory URL patterns to discovery
- [ ] Increase pagination limit or make configurable

### Medium Term
- [ ] Headless browser for JS-rendered sites (Puppeteer/Playwright)
- [ ] Backend proxy service (bypass CORS)
- [ ] User feedback loop - "This didn't work" button
- [ ] Cache parsed results

### Long Term
- [ ] Machine learning for card detection
- [ ] Auto-generate adapters from sample HTML
- [ ] Broker API integrations (YachtWorld API, etc.)

---

## Test URLs

| Site | URL | Status |
|------|-----|--------|
| Red Ensign | https://www.red-ensign.com/motor-yacht-brokerage_sort_low_high/ | ✅ Working |
| Network Yacht Brokers | https://www.networkyachtbrokers.com/ | ⚠️ Needs testing |
| Network Yacht Brokers (direct) | https://www.networkyachtbrokers.com/results/ | ⚠️ Needs testing |

---

## Files to Review

1. **`docs/list-yacht.js`** - Core parsing logic, adapters, discovery
2. **`docs/list-yacht.html`** - UI markup
3. **`adding-site-adapters.md`** - Developer guide for custom adapters

---

## Next Steps for AI Agent

1. **Test** https://www.networkyachtbrokers.com/results/ - verify nyb-style adapter works
2. **Check** location extraction on Red Ensign
3. **Improve** generic extractSpecs() for better location parsing
4. **Add** more test sites to verify parser robustness
5. **Consider** increasing MAX_LISTINGS_DISPLAY or making it configurable
