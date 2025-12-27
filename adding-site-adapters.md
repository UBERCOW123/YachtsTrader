# Adding Support for New Yacht Broker Sites

This document explains how to rapidly add support for yacht brokerage websites that the parser doesn't handle correctly.

## Quick Start (< 48 hours)

### Step 1: Get Debug Info
1. Try the failing URL on the List Your Yacht page
2. Click "Show Debug Info" button after failure
3. Debug info is copied to clipboard and logged to console

### Step 2: Analyze the Site
Open the broker's website in Chrome DevTools and answer:

1. **What is the listing container?**
   - Open DevTools (F12) → Elements tab
   - Find the container that holds all yacht listings
   - Note the class names or IDs (e.g., `.yacht-card`, `#inventory-list article`)

2. **How is each yacht represented?**
   - What element wraps each listing? (e.g., `<article>`, `<div class="boat">`)
   - Is it a grid, list, or card layout?

3. **Where is the data?**
   - Title: What element? (e.g., `h2.title`, `a.boat-name`)
   - Price: What element? What format? (e.g., `.price`, `$1,234,567` or `€1.234.567`)
   - Images: `img` tags or CSS backgrounds? Lazy loaded?
   - Year/Length/Type: In text, separate elements, or data attributes?

4. **Does it use structured data?**
   - Check for `<script type="application/ld+json">` in the HTML
   - Check for `itemtype="schema.org/Product"` attributes

### Step 3: Create the Adapter

Add a new adapter to the `SITE_ADAPTERS` array in `list-yacht.js`:

```javascript
// Add to SITE_ADAPTERS array in list-yacht.js
{
    name: 'example-broker',  // Unique identifier
    
    // Return true if this adapter should handle this site
    detect: (doc, url) => {
        return url.includes('example-broker.com') || 
               doc.querySelector('.their-unique-class') !== null;
    },
    
    // Extract yacht listings from the page
    parse: (doc, url) => {
        const yachts = [];
        
        // Find all listing cards
        const cards = doc.querySelectorAll('.their-listing-class');
        
        cards.forEach((card, i) => {
            const yacht = createEmptyYacht(i);
            yacht.source = 'example-broker';
            
            // Extract title
            const titleEl = card.querySelector('.their-title-class');
            if (titleEl) yacht.title = cleanText(titleEl.textContent);
            
            // Extract price
            const priceEl = card.querySelector('.their-price-class');
            if (priceEl) {
                const parsed = extractPrice(priceEl.textContent);
                yacht.price = parsed.formatted;
                yacht.priceRaw = parsed.raw;
                yacht.confidence.price = 85;
            }
            
            // Extract images
            const imgEl = card.querySelector('img.their-image-class');
            if (imgEl && isValidImage(imgEl)) {
                yacht.images = [resolveUrl(imgEl.src || imgEl.dataset.src, url)];
                yacht.confidence.images = 85;
            }
            
            // Extract specs
            extractSpecs(card, yacht);
            
            // Only add if we got meaningful data
            if (yacht.title || yacht.priceRaw) {
                yachts.push(yacht);
            }
        });
        
        return yachts;
    }
}
```

### Step 4: Test the Adapter

1. Reload the page
2. Try the URL again
3. Verify listings are extracted correctly
4. Check the confidence scores

---

## AI Prompt Template

Use this prompt with Claude/GPT when you have a failing URL to quickly generate an adapter:

```
I need to create a site adapter for a yacht brokerage website that my parser isn't handling correctly.

**URL:** [PASTE FAILING URL]

**Debug Info:**
[PASTE DEBUG INFO FROM CLIPBOARD]

**Sample HTML of one listing card:**
[PASTE HTML FROM DEVTOOLS - right-click a listing → Copy → Copy outerHTML]

Please create a site adapter object that:
1. Detects this specific site by URL or unique page elements
2. Finds all yacht listing cards on the page
3. Extracts: title, price, images, year, length, type, location
4. Uses the helper functions: createEmptyYacht(), cleanText(), extractPrice(), isValidImage(), resolveUrl(), extractSpecs()

The adapter should follow this format:
{
    name: 'site-name',
    detect: (doc, url) => { /* return true if this adapter handles the site */ },
    parse: (doc, url) => { /* return array of yacht objects */ }
}
```

---

## Common Patterns

### Lazy-Loaded Images
```javascript
const imgEl = card.querySelector('img');
const src = imgEl.src || imgEl.dataset.src || imgEl.dataset.lazySrc || imgEl.dataset.original;
```

### Background Images
```javascript
const el = card.querySelector('.image-container');
const style = el.getAttribute('style');
const match = style.match(/url\(['"]?([^'")\s]+)['"]?\)/);
if (match) yacht.images.push(resolveUrl(match[1], url));
```

### European Price Format (€1.234.567,00)
The `extractPrice()` function handles this automatically.

### Data Attributes for Specs
```javascript
const year = card.dataset.year || card.getAttribute('data-year');
const length = card.dataset.length || card.dataset.loa;
```

### Multiple Price Formats
```javascript
// "From $1,200,000" or "Asking $1,200,000"
const priceText = priceEl.textContent.replace(/from|asking|now/gi, '');
const parsed = extractPrice(priceText);
```

---

## Testing Checklist

Before submitting a new adapter:

- [ ] Tested with the specific failing URL
- [ ] Tested with other pages on the same site (pagination, categories)
- [ ] All listings are extracted (compare count with visible listings)
- [ ] Titles are correct and clean (no extra whitespace or HTML)
- [ ] Prices are parsed correctly (right currency, right format)
- [ ] Images load correctly (no 404s, no icons)
- [ ] Year is reasonable (1950-current year)
- [ ] Length is reasonable (15-500 ft)
- [ ] No duplicate listings
- [ ] Confidence scores are reasonable (>60% for good data)

---

## File Structure

```
YachtsTrader/
├── list-yacht.js      # Main parser with SITE_ADAPTERS array
├── list-yacht.html    # UI for listing import
├── list-yacht.css     # Styling
└── docs/
    └── adding-site-adapters.md  # This file
```
