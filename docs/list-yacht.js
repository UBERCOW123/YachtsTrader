/**
 * Yacht Listing Import System v2.0
 * Robust, extensible parsing with plugin architecture
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    // Minimum confidence to include a listing (0-100)
    MIN_LISTING_CONFIDENCE: 40,

    // Minimum yacht keywords required to validate site
    MIN_YACHT_KEYWORDS: 3,

    // Price range for yacht detection (USD)
    MIN_YACHT_PRICE: 5000,
    MAX_YACHT_PRICE: 100000000,

    // Image size requirements
    MIN_IMAGE_WIDTH: 200,
    MIN_IMAGE_HEIGHT: 150,

    // Maximum listings to display (for testing)
    MAX_LISTINGS_DISPLAY: 10,

    // Enable debug logging
    DEBUG: true
};

// Yacht-related keywords for site validation
const YACHT_KEYWORDS = [
    'yacht', 'yachts', 'boat', 'boats', 'vessel', 'vessels', 'marine',
    'sailing', 'sailboat', 'motor yacht', 'catamaran', 'trimaran',
    'brokerage', 'broker', 'for sale', 'buy', 'sell',
    'length overall', 'loa', 'beam', 'draft', 'hull',
    'engine', 'knots', 'nautical', 'marina', 'cruiser',
    'sportfish', 'trawler', 'express', 'flybridge', 'cockpit',
    'galley', 'cabin', 'berth', 'stateroom', 'helm'
];

// Price pattern definitions
const PRICE_PATTERNS = [
    // USD formats
    { regex: /\$\s*([\d,]+(?:\.\d{2})?)\s*(?:USD|usd)?/, currency: 'USD' },
    { regex: /USD\s*\$?\s*([\d,]+)/i, currency: 'USD' },
    { regex: /([\d,]+)\s*(?:USD|dollars?)/i, currency: 'USD' },
    // EUR formats
    { regex: /€\s*([\d,.\s]+)/, currency: 'EUR' },
    { regex: /EUR\s*€?\s*([\d,.\s]+)/i, currency: 'EUR' },
    { regex: /([\d,.\s]+)\s*(?:EUR|euros?)/i, currency: 'EUR' },
    // GBP formats
    { regex: /£\s*([\d,]+)/, currency: 'GBP' },
    { regex: /GBP\s*£?\s*([\d,]+)/i, currency: 'GBP' },
    // Generic large numbers in yacht context
    { regex: /(?:price|asking)[:\s]*\$?\s*([\d,]+)/i, currency: 'USD' }
];

// ============================================================================
// STATE
// ============================================================================

let parsedYachts = [];
let totalYachtsFound = 0; // Total before limiting
let selectedYachts = new Set();
let currentEditIndex = null;
let lastParseDebug = null;

// ============================================================================
// CORS PROXIES
// ============================================================================

const CORS_PROXIES = [
    'https://api.allorigins.win/raw?url=',
    'https://corsproxy.io/?',
    'https://api.codetabs.com/v1/proxy?quest='
];

async function fetchWithProxy(url) {
    for (const proxy of CORS_PROXIES) {
        try {
            const response = await fetch(proxy + encodeURIComponent(url), {
                headers: { 'Accept': 'text/html' }
            });
            if (response.ok) {
                return await response.text();
            }
        } catch (e) {
            log(`Proxy ${proxy} failed:`, e.message);
        }
    }
    throw new Error('Unable to fetch URL. The website may be blocking automated access.');
}

// ============================================================================
// LOGGING & DEBUG
// ============================================================================

function log(...args) {
    if (CONFIG.DEBUG) {
        console.log('[YachtParser]', ...args);
    }
}

function createDebugReport(url, html, results) {
    return {
        url,
        timestamp: new Date().toISOString(),
        htmlLength: html.length,
        keywordsFound: countYachtKeywords(html),
        structuredDataFound: !!extractStructuredData(html).length,
        listingsAttempted: results.attempted,
        listingsAccepted: results.accepted,
        listingsRejected: results.rejected,
        rejectionReasons: results.rejectionReasons,
        sampleHtml: html.substring(0, 5000)
    };
}

// ============================================================================
// SITE VALIDATION
// ============================================================================

function countYachtKeywords(html) {
    const lowerHtml = html.toLowerCase();
    let count = 0;
    const found = [];

    for (const keyword of YACHT_KEYWORDS) {
        if (lowerHtml.includes(keyword)) {
            count++;
            found.push(keyword);
        }
    }

    log('Keywords found:', count, found.slice(0, 10));
    return { count, found };
}

function validateYachtSite(html) {
    const { count, found } = countYachtKeywords(html);

    if (count < CONFIG.MIN_YACHT_KEYWORDS) {
        return {
            valid: false,
            reason: `This doesn't appear to be a yacht or boat sales website. Found only ${count} yacht-related terms (minimum: ${CONFIG.MIN_YACHT_KEYWORDS}).`,
            keywordsFound: found
        };
    }

    // Check for yacht listing patterns (links to boat pages, inventory markers)
    const lowerHtml = html.toLowerCase();
    const hasInventoryMarkers =
        lowerHtml.includes('/boats/') ||
        lowerHtml.includes('/yachts/') ||
        lowerHtml.includes('/inventory/') ||
        lowerHtml.includes('/listings/') ||
        lowerHtml.includes('for sale') ||
        lowerHtml.includes('brokerage');

    if (!hasInventoryMarkers) {
        return {
            valid: false,
            reason: 'This doesn\'t appear to be a yacht listings page. Please navigate to the inventory or boats for sale page.',
            keywordsFound: found
        };
    }

    return { valid: true, keywordsFound: found };
}

// ============================================================================
// STRUCTURED DATA EXTRACTION (JSON-LD, Schema.org)
// ============================================================================

function extractStructuredData(html) {
    const results = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Extract JSON-LD
    const jsonLdScripts = doc.querySelectorAll('script[type="application/ld+json"]');
    jsonLdScripts.forEach(script => {
        try {
            const data = JSON.parse(script.textContent);
            const items = Array.isArray(data) ? data : [data];

            items.forEach(item => {
                if (item['@type'] === 'Product' ||
                    item['@type'] === 'Vehicle' ||
                    item['@type'] === 'Offer' ||
                    (item['@graph'] && Array.isArray(item['@graph']))) {

                    const products = item['@graph'] || [item];
                    products.forEach(p => {
                        if (p['@type'] === 'Product' || p['@type'] === 'Vehicle') {
                            results.push(parseJsonLdProduct(p));
                        }
                    });
                }
            });
        } catch (e) {
            log('JSON-LD parse error:', e);
        }
    });

    // Extract Schema.org microdata
    const microdataItems = doc.querySelectorAll('[itemtype*="schema.org/Product"], [itemtype*="schema.org/Vehicle"]');
    microdataItems.forEach(item => {
        results.push(parseMicrodataProduct(item));
    });

    log('Structured data found:', results.length, 'items');
    return results;
}

function parseJsonLdProduct(data) {
    const yacht = createEmptyYacht();
    yacht.source = 'json-ld';
    yacht.confidence.overall = 85;

    yacht.title = data.name || '';
    yacht.description = data.description || '';

    if (data.offers) {
        const offer = Array.isArray(data.offers) ? data.offers[0] : data.offers;
        yacht.priceRaw = parseFloat(offer.price) || null;
        yacht.price = yacht.priceRaw ? formatPrice(yacht.priceRaw) : '';
        yacht.confidence.price = 90;
    }

    if (data.image) {
        const images = Array.isArray(data.image) ? data.image : [data.image];
        yacht.images = images.map(img => typeof img === 'string' ? img : img.url).filter(Boolean);
        yacht.confidence.images = 90;
    }

    // Extract year from name/description
    const yearMatch = (yacht.title + ' ' + yacht.description).match(/\b(19[89]\d|20[0-2]\d)\b/);
    if (yearMatch) yacht.year = yearMatch[1];

    return yacht;
}

function parseMicrodataProduct(element) {
    const yacht = createEmptyYacht();
    yacht.source = 'microdata';
    yacht.confidence.overall = 80;

    const getProp = (prop) => {
        const el = element.querySelector(`[itemprop="${prop}"]`);
        return el ? (el.content || el.textContent || '').trim() : '';
    };

    yacht.title = getProp('name');
    yacht.description = getProp('description');
    yacht.price = getProp('price') || getProp('lowPrice');

    const imgEl = element.querySelector('[itemprop="image"]');
    if (imgEl) {
        yacht.images = [imgEl.src || imgEl.content].filter(Boolean);
    }

    return yacht;
}

// ============================================================================
// SITE-SPECIFIC ADAPTERS
// ============================================================================

/**
 * Adapter registry - add new adapters here for custom site support
 * Each adapter should have:
 *   - name: Identifier
 *   - detect(doc, url): Returns true if this adapter handles the site
 *   - parse(doc, url): Returns array of yacht objects
 */
const SITE_ADAPTERS = [
    // WordPress Property/Listing Theme (common pattern used by many brokers)
    // This matches sites using themes like flavor/flavor-flavor-flavor flavor flavor (flavor flavor theme)
    {
        name: 'wp-listing-theme',
        detect: (doc, url) => {
            // Look for common WordPress listing theme patterns
            return doc.querySelector('.listing_wrapper, .property_listing, .listing-unit-img-wrapper, .listing_unit_price_wrapper') !== null;
        },
        parse: (doc, url) => {
            const yachts = [];
            const cards = doc.querySelectorAll('.listing_wrapper, .property_listing');

            cards.forEach((card, i) => {
                const yacht = createEmptyYacht(i);
                yacht.source = 'wp-listing-theme';

                // Title from h4 a or .listing-title
                const titleEl = card.querySelector('h4 a, .listing-title a, .property-title a');
                if (titleEl) {
                    yacht.title = cleanText(titleEl.textContent);
                    yacht.confidence.title = 90;
                    yacht.detailUrl = resolveUrl(titleEl.href, url);
                }

                // Price from .price_wrapper, .listing_unit_price_wrapper, or any element with currency
                const priceEl = card.querySelector('.price_wrapper, .listing_unit_price_wrapper span, .price, [class*="price"]');
                if (priceEl) {
                    const priceText = priceEl.textContent;
                    // Handle "Sold" labels
                    if (/sold/i.test(priceText)) {
                        yacht.price = 'Sold';
                        yacht.priceRaw = 0;
                    } else {
                        const parsed = extractPrice(priceText);
                        if (parsed.raw) {
                            yacht.price = parsed.formatted;
                            yacht.priceRaw = parsed.raw;
                            yacht.confidence.price = 90;
                        }
                    }
                }

                // Image from .listing-unit-img-wrapper or first img
                const imgEl = card.querySelector('.listing-unit-img-wrapper img, .property-img img, img');
                if (imgEl && isValidImage(imgEl)) {
                    yacht.images = [resolveUrl(imgEl.src || imgEl.dataset.src, url)];
                    yacht.confidence.images = 85;
                }

                // Year and specs from .property_location or other metadata
                const metaEl = card.querySelector('.property_location, .listing-meta, .property-meta');
                if (metaEl) {
                    extractSpecs(metaEl, yacht);
                }

                // Also try extracting from card text
                extractSpecs(card, yacht);

                if (yacht.title) {
                    yachts.push(yacht);
                }
            });

            return yachts;
        }
    },

    // Network Yacht Brokers style (uses .outline cards, ltboats classes, background images)
    {
        name: 'nyb-style',
        detect: (doc, url) => {
            return doc.querySelector('.outline, .ltboats-details-title, .ltboats-img, [class*="ltboats"]') !== null ||
                url.includes('networkyachtbrokers');
        },
        parse: (doc, url) => {
            const yachts = [];
            const cards = doc.querySelectorAll('.outline, .boat-card, .yacht-card');

            cards.forEach((card, i) => {
                const yacht = createEmptyYacht(i);
                yacht.source = 'nyb-style';

                // Title - look for ltboats-details-title or any link with boat text
                const titleEl = card.querySelector('.ltboats-details-title, .boat-title, h3 a, h4 a, a[href*="/boats"]');
                if (titleEl) {
                    yacht.title = cleanText(titleEl.textContent);
                    yacht.confidence.title = 90;
                    yacht.detailUrl = resolveUrl(titleEl.href || titleEl.closest('a')?.href, url);
                }

                // Year - explicit class or from text
                const yearEl = card.querySelector('.ltboats-details-year, .boat-year, [class*="year"]');
                if (yearEl) {
                    const yearMatch = yearEl.textContent.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
                    if (yearMatch) yacht.year = yearMatch[1];
                }

                // Price - explicit class
                const priceEl = card.querySelector('.ltboats-details-price, .boat-price, [class*="price"]');
                if (priceEl) {
                    const priceText = priceEl.textContent;
                    if (/sold/i.test(priceText)) {
                        yacht.price = 'Sold';
                        yacht.priceRaw = 0;
                    } else if (/poa|price on application|contact/i.test(priceText)) {
                        yacht.price = 'POA';
                        yacht.priceRaw = 0;
                    } else {
                        const parsed = extractPrice(priceText);
                        if (parsed.raw) {
                            yacht.price = parsed.formatted;
                            yacht.priceRaw = parsed.raw;
                            yacht.confidence.price = 90;
                        }
                    }
                }

                // Location - explicit class (this site has it!)
                const locationEl = card.querySelector('.ltboats-details-location, .boat-location, [class*="location"]');
                if (locationEl) {
                    yacht.location = cleanText(locationEl.textContent);
                    yacht.confidence.specs = (yacht.confidence.specs || 0) + 20;
                }

                // Image - check for background-image first, then img tag
                const bgImgEl = card.querySelector('.ltboats-img, [class*="boat-img"], [style*="background"]');
                if (bgImgEl) {
                    const style = bgImgEl.getAttribute('style') || '';
                    const bgMatch = style.match(/url\(['"]?([^'")\s]+)['"]?\)/);
                    if (bgMatch) {
                        yacht.images = [resolveUrl(bgMatch[1], url)];
                        yacht.confidence.images = 85;
                    }
                }

                // Fallback to img tag
                if (yacht.images.length === 0) {
                    const imgEl = card.querySelector('img');
                    if (imgEl && isValidImage(imgEl)) {
                        yacht.images = [resolveUrl(imgEl.src || imgEl.dataset.src, url)];
                        yacht.confidence.images = 80;
                    }
                }

                // Additional specs from text
                extractSpecs(card, yacht);

                if (yacht.title) {
                    yachts.push(yacht);
                }
            });

            return yachts;
        }
    },

    // YachtWorld-style sites
    {
        name: 'yachtworld-style',
        detect: (doc, url) => {
            return url.includes('yachtworld') ||
                doc.querySelector('.listing-card, .yacht-listing, .boat-listing, .search-result-item') !== null;
        },
        parse: (doc, url) => {
            const yachts = [];
            const cards = doc.querySelectorAll('.listing-card, .yacht-listing, .boat-listing, .search-result-item, [class*="listing-card"], [class*="boat-card"]');

            cards.forEach((card, i) => {
                const yacht = createEmptyYacht(i);
                yacht.source = 'yachtworld-style';

                // Title - look for prominent heading or link
                const titleEl = card.querySelector('h2, h3, .title, .listing-title, [class*="title"], a[class*="name"]');
                if (titleEl) yacht.title = cleanText(titleEl.textContent);

                // Price - look for price element
                const priceEl = card.querySelector('.price, [class*="price"], .amount');
                if (priceEl) {
                    const parsed = extractPrice(priceEl.textContent);
                    yacht.price = parsed.formatted;
                    yacht.priceRaw = parsed.raw;
                    yacht.confidence.price = 85;
                }

                // Image
                const imgEl = card.querySelector('img[src*="yacht"], img[src*="boat"], img.primary, img.main, img:first-of-type');
                if (imgEl && isValidImage(imgEl)) {
                    yacht.images = [resolveUrl(imgEl.src || imgEl.dataset.src, url)];
                    yacht.confidence.images = 80;
                }

                // Specs - look for common spec patterns
                extractSpecs(card, yacht);

                if (yacht.title || yacht.priceRaw) {
                    yachts.push(yacht);
                }
            });

            return yachts;
        }
    },

    // Grid/card layout (common pattern)
    {
        name: 'card-grid',
        detect: (doc, url) => {
            // Look for repeated card-like structures
            const containers = doc.querySelectorAll('.grid, .cards, .listings, .inventory, .results, .outline, [class*="grid"], [class*="cards"], [class*="boats"], [class*="yachts"]');
            return containers.length > 0;
        },
        parse: (doc, url) => {
            const yachts = [];

            // Find container with multiple similar children
            const containers = [
                ...doc.querySelectorAll('.grid, .cards, .listings, .inventory, .results'),
                ...doc.querySelectorAll('[class*="grid"], [class*="cards"], [class*="listing"], [class*="boats-list"], [class*="yacht-list"]')
            ];

            for (const container of containers) {
                const children = container.children;
                if (children.length >= 2 && children.length <= 50) {
                    Array.from(children).forEach((card, i) => {
                        const yacht = extractFromGenericCard(card, url, i);
                        if (yacht && (yacht.title || yacht.priceRaw)) {
                            yacht.source = 'card-grid';
                            yachts.push(yacht);
                        }
                    });

                    if (yachts.length >= 2) break; // Found good container
                }
            }

            return yachts;
        }
    },

    // Detail page (single yacht)
    {
        name: 'detail-page',
        detect: (doc, url) => {
            // Single yacht detail page characteristics
            const hasDetailMarkers = doc.querySelector('.yacht-detail, .boat-detail, .vessel-detail, .product-detail, #yacht, #boat');
            const hasSpecs = doc.querySelector('.specifications, .specs, .details, [class*="spec"]');
            const hasGallery = doc.querySelectorAll('.gallery img, .carousel img, .slider img').length >= 3;

            return hasDetailMarkers || (hasSpecs && hasGallery);
        },
        parse: (doc, url) => {
            const yacht = createEmptyYacht(0);
            yacht.source = 'detail-page';

            // Title from H1
            const h1 = doc.querySelector('h1');
            if (h1) yacht.title = cleanText(h1.textContent);

            // Price - look in various places
            const priceSelectors = ['.price', '[class*="price"]', '.amount', '[class*="amount"]'];
            for (const sel of priceSelectors) {
                const el = doc.querySelector(sel);
                if (el) {
                    const parsed = extractPrice(el.textContent);
                    if (parsed.raw && parsed.raw >= CONFIG.MIN_YACHT_PRICE) {
                        yacht.price = parsed.formatted;
                        yacht.priceRaw = parsed.raw;
                        yacht.confidence.price = 85;
                        break;
                    }
                }
            }

            // Images from gallery
            const galleryImages = doc.querySelectorAll('.gallery img, .carousel img, .slider img, .photos img, [class*="gallery"] img');
            yacht.images = Array.from(galleryImages)
                .filter(isValidImage)
                .map(img => resolveUrl(img.src || img.dataset.src, url))
                .filter(Boolean)
                .slice(0, 20);

            if (yacht.images.length === 0) {
                // Fallback to any large images
                const allImages = doc.querySelectorAll('img');
                yacht.images = Array.from(allImages)
                    .filter(isValidImage)
                    .map(img => resolveUrl(img.src || img.dataset.src, url))
                    .filter(Boolean)
                    .slice(0, 10);
            }

            yacht.confidence.images = yacht.images.length > 0 ? 80 : 0;

            // Specs
            extractSpecs(doc.body, yacht);

            // Description
            const descEl = doc.querySelector('.description, [class*="description"], .details p, article p');
            if (descEl) yacht.description = cleanText(descEl.textContent).slice(0, 2000);

            return yacht.title || yacht.priceRaw ? [yacht] : [];
        }
    }
];

// ============================================================================
// GENERIC EXTRACTION HELPERS
// ============================================================================

function createEmptyYacht(index = 0) {
    return {
        id: `yacht-${Date.now()}-${index}`,
        title: '',
        price: '',
        priceRaw: null,
        year: '',
        length: '',
        lengthUnit: 'ft',
        type: '',
        make: '',
        model: '',
        location: '',
        description: '',
        images: [],
        sourceUrl: '',
        source: 'generic',
        confidence: {
            overall: 50,
            title: 0,
            price: 0,
            images: 0,
            specs: 0
        },
        issues: []
    };
}

function extractFromGenericCard(card, baseUrl, index) {
    const text = card.textContent || '';
    const yacht = createEmptyYacht(index);

    // Skip if too little or too much content
    if (text.length < 20 || text.length > 5000) return null;

    // Try to get price (but don't require it)
    const priceData = extractPrice(text);
    if (priceData.raw && priceData.raw >= CONFIG.MIN_YACHT_PRICE && priceData.raw <= CONFIG.MAX_YACHT_PRICE) {
        yacht.price = priceData.formatted;
        yacht.priceRaw = priceData.raw;
        yacht.confidence.price = 70;
    }

    // Title - first meaningful heading or link
    const headings = card.querySelectorAll('h1, h2, h3, h4, h5, a[href*="boat"], a[href*="yacht"]');
    for (const h of headings) {
        const t = cleanText(h.textContent);
        if (t.length >= 5 && t.length <= 150 && !t.match(/^[\$€£]/)) {
            yacht.title = t;
            yacht.confidence.title = 65;
            yacht.detailUrl = h.href || h.closest('a')?.href;
            break;
        }
    }

    // Images - try img tags first
    const images = card.querySelectorAll('img');
    yacht.images = Array.from(images)
        .filter(isValidImage)
        .map(img => resolveUrl(img.src || img.dataset.src || img.dataset.lazySrc, baseUrl))
        .filter(Boolean);

    // Fallback to background images
    if (yacht.images.length === 0) {
        const bgElements = card.querySelectorAll('[style*="background"]');
        bgElements.forEach(el => {
            const style = el.getAttribute('style') || '';
            const bgMatch = style.match(/url\(['"]?([^'")\s]+)['"]?\)/);
            if (bgMatch && yacht.images.length < 3) {
                const imgUrl = resolveUrl(bgMatch[1], baseUrl);
                if (imgUrl && !imgUrl.includes('placeholder')) {
                    yacht.images.push(imgUrl);
                }
            }
        });
    }

    yacht.confidence.images = yacht.images.length > 0 ? 70 : 0;

    // Location - check for explicit location elements first
    const locationEl = card.querySelector('[class*="location"], [class*="port"], [class*="city"]');
    if (locationEl) {
        yacht.location = cleanText(locationEl.textContent);
        yacht.confidence.specs = (yacht.confidence.specs || 0) + 20;
    }

    // Additional specs from text
    extractSpecs(card, yacht);

    // Only need title to be valid (price is nice to have)
    if (!yacht.title) return null;

    return yacht;
}

function extractSpecs(element, yacht) {
    const text = element.textContent || '';

    // Year
    const yearMatch = text.match(/\b(19[5-9]\d|20[0-2]\d)\b/);
    if (yearMatch) {
        const year = parseInt(yearMatch[1]);
        if (year >= 1950 && year <= new Date().getFullYear() + 1) {
            yacht.year = yearMatch[1];
            yacht.confidence.specs = (yacht.confidence.specs || 0) + 20;
        }
    }

    // Length
    const lengthPatterns = [
        /(?:length|loa)[:\s]*(\d+(?:\.\d+)?)\s*(?:ft|feet|')/i,
        /(\d+(?:\.\d+)?)\s*(?:ft|feet|')\s*(?:length|loa)?/i,
        /(?:length|loa)[:\s]*(\d+(?:\.\d+)?)\s*(?:m|meters?|metres?)/i,
        /(\d+(?:\.\d+)?)\s*(?:m|meters?|metres?)\s*(?:length|loa)?/i
    ];

    for (const pattern of lengthPatterns) {
        const match = text.match(pattern);
        if (match) {
            const len = parseFloat(match[1]);
            if (len >= 15 && len <= 500) { // Reasonable yacht length range
                yacht.length = match[1];
                yacht.lengthUnit = pattern.toString().includes('meter') ? 'm' : 'ft';
                yacht.confidence.specs = (yacht.confidence.specs || 0) + 20;
                break;
            }
        }
    }

    // Type
    const typeKeywords = {
        'motor yacht': 'motor', 'motoryacht': 'motor', 'power boat': 'motor',
        'sailing yacht': 'sail', 'sailboat': 'sail', 'sloop': 'sail', 'ketch': 'sail',
        'catamaran': 'catamaran', 'multihull': 'catamaran',
        'superyacht': 'superyacht', 'megayacht': 'superyacht', 'mega yacht': 'superyacht',
        'sportfish': 'motor', 'sport fish': 'motor', 'express cruiser': 'motor',
        'trawler': 'motor', 'flybridge': 'motor', 'sedan': 'motor'
    };

    const lowerText = text.toLowerCase();
    for (const [keyword, type] of Object.entries(typeKeywords)) {
        if (lowerText.includes(keyword)) {
            yacht.type = type;
            yacht.confidence.specs = (yacht.confidence.specs || 0) + 15;
            break;
        }
    }

    // Location
    const locationPatterns = [
        /(?:location|located|port)[:\s]+([A-Za-z][A-Za-z\s,]+?)(?:\.|$|\n|<)/i,
        /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z]{2})\b/, // City, ST
        /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/ // City, Country
    ];

    for (const pattern of locationPatterns) {
        const match = text.match(pattern);
        if (match && match[1].length >= 3 && match[1].length <= 50) {
            yacht.location = cleanText(match[1]);
            yacht.confidence.specs = (yacht.confidence.specs || 0) + 15;
            break;
        }
    }
}

function extractPrice(text) {
    for (const pattern of PRICE_PATTERNS) {
        const match = text.match(pattern.regex);
        if (match) {
            // Clean the number - remove spaces, handle European format
            let numStr = match[1].replace(/\s/g, '').replace(/,/g, '');

            // Handle European decimal format (1.234.567,00)
            if (numStr.includes('.') && numStr.indexOf('.') < numStr.length - 3) {
                numStr = numStr.replace(/\./g, '');
            }

            const raw = parseFloat(numStr);
            if (!isNaN(raw) && raw >= 1000) {
                return {
                    raw,
                    formatted: formatPrice(raw, pattern.currency),
                    currency: pattern.currency
                };
            }
        }
    }

    return { raw: null, formatted: '', currency: null };
}

function formatPrice(num, currency = 'USD') {
    if (!num || isNaN(num)) return '';

    const symbols = { USD: '$', EUR: '€', GBP: '£' };
    const symbol = symbols[currency] || '$';

    return symbol + num.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function isValidImage(img) {
    if (!img) return false;

    const src = (img.src || img.dataset.src || '').toLowerCase();

    // Exclude common non-listing images
    const excludePatterns = [
        'logo', 'icon', 'placeholder', 'loading', 'spinner', 'avatar',
        'banner', 'header', 'footer', 'social', 'facebook', 'twitter',
        'linkedin', 'instagram', 'pinterest', 'youtube', 'button',
        '1x1', 'pixel', 'tracking', 'beacon', 'spacer'
    ];

    for (const pattern of excludePatterns) {
        if (src.includes(pattern)) return false;
    }

    // Check dimensions if available
    const width = img.naturalWidth || img.width || parseInt(img.getAttribute('width')) || 300;
    const height = img.naturalHeight || img.height || parseInt(img.getAttribute('height')) || 200;

    return width >= CONFIG.MIN_IMAGE_WIDTH && height >= CONFIG.MIN_IMAGE_HEIGHT;
}

function resolveUrl(url, baseUrl) {
    if (!url) return null;
    if (url.startsWith('data:')) return null; // Skip data URLs
    if (url.startsWith('http')) return url;

    try {
        const base = new URL(baseUrl);
        if (url.startsWith('//')) {
            return base.protocol + url;
        } else if (url.startsWith('/')) {
            return base.origin + url;
        } else {
            return new URL(url, baseUrl).href;
        }
    } catch {
        return null;
    }
}

function cleanText(text) {
    return (text || '')
        .replace(/\s+/g, ' ')
        .replace(/[\n\r\t]/g, ' ')
        .trim();
}

// ============================================================================
// MAIN PARSING ORCHESTRATOR
// ============================================================================

function parseYachtListings(html, sourceUrl) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const debug = {
        attempted: 0,
        accepted: 0,
        rejected: 0,
        rejectionReasons: []
    };

    // Step 1: Validate this is a yacht site
    const validation = validateYachtSite(html);
    if (!validation.valid) {
        lastParseDebug = { url: sourceUrl, validation, yachts: [], debug };
        return { yachts: [], error: validation.reason };
    }

    let yachts = [];

    // Step 2: Try structured data first (highest quality)
    const structuredYachts = extractStructuredData(html);
    if (structuredYachts.length > 0) {
        log('Using structured data:', structuredYachts.length, 'items');
        yachts = structuredYachts;
    }

    // Step 3: Try site-specific adapters
    if (yachts.length === 0) {
        for (const adapter of SITE_ADAPTERS) {
            if (adapter.detect(doc, sourceUrl)) {
                log('Using adapter:', adapter.name);
                yachts = adapter.parse(doc, sourceUrl);
                if (yachts.length > 0) break;
            }
        }
    }

    // Step 4: Fallback to generic heuristic parsing
    if (yachts.length === 0) {
        log('Using generic fallback parser');
        yachts = genericHeuristicParse(doc, sourceUrl);
    }

    // Step 5: Validate and filter results
    debug.attempted = yachts.length;

    yachts = yachts.filter(yacht => {
        // Calculate overall confidence
        yacht.confidence.overall = calculateConfidence(yacht);

        // Validate each yacht
        yacht.issues = validateYacht(yacht);
        yacht.sourceUrl = sourceUrl;

        // Filter out low-confidence listings
        if (yacht.confidence.overall < CONFIG.MIN_LISTING_CONFIDENCE) {
            debug.rejected++;
            debug.rejectionReasons.push(`Low confidence (${yacht.confidence.overall}): ${yacht.title || 'No title'}`);
            return false;
        }

        // Must have at least title or price
        if (!yacht.title && !yacht.priceRaw) {
            debug.rejected++;
            debug.rejectionReasons.push('No title or price');
            return false;
        }

        debug.accepted++;
        return true;
    });

    // Deduplicate
    yachts = deduplicateYachts(yachts);

    lastParseDebug = { url: sourceUrl, validation, yachts, debug };
    log('Parse complete:', debug);

    return { yachts, error: null };
}

function genericHeuristicParse(doc, sourceUrl) {
    const yachts = [];

    // Find elements that look like listing containers
    const candidateSelectors = [
        'article', '.item', '.card', '.product', '.result',
        '[class*="listing"]', '[class*="yacht"]', '[class*="boat"]',
        '[class*="product"]', '[class*="result"]', '[class*="item"]'
    ];

    let candidates = [];
    for (const selector of candidateSelectors) {
        const found = doc.querySelectorAll(selector);
        if (found.length >= 2 && found.length <= 100) {
            candidates = Array.from(found);
            break;
        }
    }

    // If no candidates, try finding repeated structures
    if (candidates.length === 0) {
        candidates = findRepeatedStructures(doc);
    }

    candidates.forEach((el, i) => {
        const yacht = extractFromGenericCard(el, sourceUrl, i);
        if (yacht) yachts.push(yacht);
    });

    return yachts;
}

function findRepeatedStructures(doc) {
    const candidates = [];
    const seen = new Map();

    // Look for elements with similar class structures
    const allElements = doc.querySelectorAll('div, article, section, li');

    allElements.forEach(el => {
        const classes = el.className;
        if (classes && classes.length > 5) {
            const key = classes.split(' ').sort().join('|');
            if (!seen.has(key)) {
                seen.set(key, []);
            }
            seen.get(key).push(el);
        }
    });

    // Find groups with multiple items
    for (const [key, elements] of seen.entries()) {
        if (elements.length >= 2 && elements.length <= 50) {
            // Check if they contain price patterns
            let priceCount = 0;
            elements.forEach(el => {
                if (/\$[\d,]+|\€[\d,]+|£[\d,]+/.test(el.textContent)) {
                    priceCount++;
                }
            });

            if (priceCount >= elements.length * 0.5) {
                candidates.push(...elements);
                break;
            }
        }
    }

    return candidates;
}

function calculateConfidence(yacht) {
    let score = 0;
    let maxScore = 0;

    // Title is most important (required)
    if (yacht.title) { score += 35; } maxScore += 35;

    // Images are very important
    if (yacht.images.length > 0) { score += 25; } maxScore += 25;

    // Price is nice to have but some sites don't show on listing pages
    if (yacht.priceRaw && yacht.priceRaw > 0) { score += 15; } maxScore += 15;

    // Recommended fields
    if (yacht.year) { score += 10; } maxScore += 10;
    if (yacht.length) { score += 5; } maxScore += 5;
    if (yacht.type) { score += 5; } maxScore += 5;
    if (yacht.location) { score += 5; } maxScore += 5;

    // Bonus for structured data sources or known adapters
    if (yacht.source === 'json-ld' || yacht.source === 'microdata' || yacht.source === 'red-ensign') {
        score += 10;
    }

    return Math.round((score / maxScore) * 100);
}

function validateYacht(yacht) {
    const issues = [];

    if (!yacht.title) issues.push({ field: 'title', severity: 'error', message: 'Missing title' });

    // Price is only an error if completely missing; "See Details" / "POA" etc are warnings
    if (!yacht.price) {
        issues.push({ field: 'price', severity: 'error', message: 'Missing price' });
    } else if (yacht.price === 'See Details' || yacht.price === 'POA' || yacht.priceRaw === 0) {
        issues.push({ field: 'price', severity: 'warning', message: 'Price not shown' });
    }

    if (yacht.images.length === 0) issues.push({ field: 'images', severity: 'warning', message: 'No images' });

    if (!yacht.year) issues.push({ field: 'year', severity: 'warning', message: 'Missing year' });
    if (!yacht.length) issues.push({ field: 'length', severity: 'warning', message: 'Missing length' });
    if (!yacht.type) issues.push({ field: 'type', severity: 'warning', message: 'Missing type' });
    if (!yacht.location) issues.push({ field: 'location', severity: 'warning', message: 'Missing location' });

    return issues;
}

function deduplicateYachts(yachts) {
    const seenUrls = new Set();
    const seenTitles = new Set();

    return yachts.filter(yacht => {
        // Best: dedupe by detail URL (most reliable)
        if (yacht.detailUrl) {
            if (seenUrls.has(yacht.detailUrl)) return false;
            seenUrls.add(yacht.detailUrl);
            return true;
        }

        // Fallback: dedupe by title + price
        const key = `${(yacht.title || '').toLowerCase().trim()}|${yacht.priceRaw || 0}`;
        if (seenTitles.has(key)) return false;
        seenTitles.add(key);
        return true;
    });
}

// ============================================================================
// UI RENDERING
// ============================================================================

function renderYachtCards() {
    const container = document.getElementById('yacht-cards');

    if (parsedYachts.length === 0) {
        container.innerHTML = `
            <div class="no-results" style="text-align: center; padding: 40px; color: var(--gray-500);">
                <p style="font-size: 18px; margin-bottom: 12px;">No yacht listings could be extracted.</p>
                <p>Try a different URL or enter your listings manually.</p>
                ${CONFIG.DEBUG ? `<button class="btn btn-outline" style="margin-top: 20px;" onclick="showDebugInfo()">Show Debug Info</button>` : ''}
            </div>
        `;
        return;
    }

    container.innerHTML = parsedYachts.map((yacht, index) => {
        const hasErrors = yacht.issues.some(i => i.severity === 'error');
        const isSelected = selectedYachts.has(yacht.id);
        const confidence = yacht.confidence.overall;

        return `
            <div class="yacht-card ${isSelected ? 'selected' : ''} ${hasErrors ? 'has-issues' : ''}" data-id="${yacht.id}">
                <div class="yacht-checkbox">
                    <input type="checkbox" ${isSelected ? 'checked' : ''} 
                           onchange="toggleYachtSelection('${yacht.id}')" 
                           aria-label="Select ${yacht.title || 'yacht'}">
                </div>
                
                <div class="yacht-image-wrapper">
                    ${yacht.images.length > 0
                ? `<img src="${yacht.images[0]}" alt="${yacht.title}" class="yacht-image" 
                               onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'no-image\\'><span>🖼️</span><p>Image failed</p></div>'">
                           ${yacht.images.length > 1 ? `<span class="image-count">+${yacht.images.length - 1}</span>` : ''}`
                : `<div class="no-image"><span>📷</span><p>No images</p></div>`
            }
                </div>
                
                <div class="yacht-details">
                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                        <h3 class="yacht-title">${yacht.title || '<span style="color: #dc3545">Title Required</span>'}</h3>
                        <span class="confidence-badge" style="
                            font-size: 11px;
                            padding: 2px 8px;
                            border-radius: 10px;
                            background: ${confidence >= 70 ? '#d4edda' : confidence >= 50 ? '#fff3cd' : '#f8d7da'};
                            color: ${confidence >= 70 ? '#155724' : confidence >= 50 ? '#856404' : '#721c24'};
                        ">${confidence}% match</span>
                    </div>
                    <div class="yacht-price">${yacht.price || '<span style="color: #dc3545">Price Required</span>'}</div>
                    
                    <div class="yacht-specs">
                        ${yacht.year ? `<span class="spec-item"><span class="label">Year:</span> <span class="value">${yacht.year}</span></span>` : ''}
                        ${yacht.length ? `<span class="spec-item"><span class="label">Length:</span> <span class="value">${yacht.length}${yacht.lengthUnit}</span></span>` : ''}
                        ${yacht.type ? `<span class="spec-item"><span class="label">Type:</span> <span class="value">${capitalizeFirst(yacht.type)}</span></span>` : ''}
                        ${yacht.location ? `<span class="spec-item"><span class="label">Location:</span> <span class="value">${yacht.location}</span></span>` : ''}
                    </div>
                    
                    <div class="field-status">
                        ${yacht.issues.map(issue => `
                            <span class="field-tag ${issue.severity === 'error' ? 'missing' : 'warning'}">
                                ${issue.severity === 'error' ? '❌' : '⚠️'} ${issue.message}
                            </span>
                        `).join('')}
                        ${yacht.issues.length === 0 ? '<span class="field-tag complete">✓ Complete</span>' : ''}
                    </div>
                </div>
                
                <div class="yacht-actions">
                    <button class="btn btn-outline btn-small" onclick="editYacht(${index})">✏️ Edit</button>
                    <button class="btn btn-outline btn-small" onclick="removeYacht(${index})">🗑️ Remove</button>
                </div>
            </div>
        `;
    }).join('');

    updateCounts();
}

function updateCounts() {
    // Show displayed count and total if different
    const notShown = totalYachtsFound - parsedYachts.length;
    const countText = notShown > 0
        ? `${parsedYachts.length} of ${totalYachtsFound}`
        : `${parsedYachts.length}`;
    document.getElementById('yacht-count').textContent = countText;
    document.getElementById('selected-count').textContent = selectedYachts.size;

    const errorCount = parsedYachts.filter(y => y.issues.some(i => i.severity === 'error')).length;
    document.getElementById('issue-count').textContent = errorCount;

    const banner = document.getElementById('quality-banner');

    // Show "more not shown" message if applicable
    if (notShown > 0) {
        banner.classList.remove('success');
        banner.innerHTML = `
            <div class="quality-icon">📋</div>
            <div class="quality-text">
                <strong>Showing ${parsedYachts.length} of ${totalYachtsFound} listings found</strong>
                <p>${notShown} additional listing${notShown !== 1 ? 's' : ''} not shown (testing limit)</p>
            </div>
        `;
    } else if (errorCount === 0) {
        banner.classList.add('success');
        banner.innerHTML = `
            <div class="quality-icon">✅</div>
            <div class="quality-text">
                <strong>All listings have complete data</strong>
                <p>Ready to import to Yachts Trader</p>
            </div>
        `;
    } else {
        banner.classList.remove('success');
        banner.innerHTML = `
            <div class="quality-icon">⚠️</div>
            <div class="quality-text">
                <strong>${errorCount} listing${errorCount !== 1 ? 's have' : ' has'} missing required data</strong>
                <p>Click Edit to fill in missing fields</p>
            </div>
        `;
    }
}

function showDebugInfo() {
    if (!lastParseDebug) {
        console.log('[YachtParser] No debug info available');
        return;
    }

    // Log to console for dev team
    console.log('=== YACHT PARSER DEBUG ===');
    console.log('URL:', lastParseDebug.url);
    console.log('Full Debug Data:', JSON.stringify(lastParseDebug, null, 2));

    // Simple user message
    alert(`We couldn't fully parse this website.\n\nTo request support for this broker, please email:\nsupport@yachtstrader.com\n\nInclude this URL:\n${lastParseDebug.url || document.getElementById('broker-url').value}\n\n(Debug info has been logged to the browser console)`);
}

// ============================================================================
// UI EVENT HANDLERS
// ============================================================================

function toggleYachtSelection(id) {
    if (selectedYachts.has(id)) {
        selectedYachts.delete(id);
    } else {
        selectedYachts.add(id);
    }
    renderYachtCards();
}

function toggleSelectAll() {
    if (selectedYachts.size === parsedYachts.length) {
        selectedYachts.clear();
    } else {
        parsedYachts.forEach(y => selectedYachts.add(y.id));
    }
    renderYachtCards();
}

function removeYacht(index) {
    const yacht = parsedYachts[index];
    selectedYachts.delete(yacht.id);
    parsedYachts.splice(index, 1);
    renderYachtCards();
}

function editYacht(index) {
    currentEditIndex = index;
    const yacht = parsedYachts[index];

    document.getElementById('modal-body').innerHTML = `
        <div class="form-group">
            <label for="edit-title">Title <span class="required">*</span></label>
            <input type="text" id="edit-title" value="${escapeHtml(yacht.title)}" 
                   class="${!yacht.title ? 'error' : ''}" placeholder="e.g., 2023 Sunseeker Manhattan 68">
        </div>
        
        <div class="form-row">
            <div class="form-group">
                <label for="edit-price">Price <span class="required">*</span></label>
                <input type="text" id="edit-price" value="${yacht.price}" 
                       class="${!yacht.price ? 'error' : ''}" placeholder="e.g., $2,500,000">
            </div>
            <div class="form-group">
                <label for="edit-year">Year</label>
                <input type="text" id="edit-year" value="${yacht.year}" placeholder="e.g., 2023">
            </div>
        </div>
        
        <div class="form-row">
            <div class="form-group">
                <label for="edit-length">Length</label>
                <input type="text" id="edit-length" value="${yacht.length}" placeholder="e.g., 68">
            </div>
            <div class="form-group">
                <label for="edit-length-unit">Unit</label>
                <select id="edit-length-unit">
                    <option value="ft" ${yacht.lengthUnit === 'ft' ? 'selected' : ''}>Feet</option>
                    <option value="m" ${yacht.lengthUnit === 'm' ? 'selected' : ''}>Meters</option>
                </select>
            </div>
        </div>
        
        <div class="form-row">
            <div class="form-group">
                <label for="edit-type">Type</label>
                <select id="edit-type">
                    <option value="">Select type...</option>
                    <option value="motor" ${yacht.type === 'motor' ? 'selected' : ''}>Motor Yacht</option>
                    <option value="sail" ${yacht.type === 'sail' ? 'selected' : ''}>Sailing Yacht</option>
                    <option value="catamaran" ${yacht.type === 'catamaran' ? 'selected' : ''}>Catamaran</option>
                    <option value="superyacht" ${yacht.type === 'superyacht' ? 'selected' : ''}>Superyacht</option>
                </select>
            </div>
            <div class="form-group">
                <label for="edit-location">Location</label>
                <input type="text" id="edit-location" value="${escapeHtml(yacht.location)}" placeholder="e.g., Miami, FL">
            </div>
        </div>
        
        <div class="form-group">
            <label for="edit-description">Description</label>
            <textarea id="edit-description" placeholder="Enter description...">${escapeHtml(yacht.description)}</textarea>
        </div>
        
        <div class="form-group">
            <label>Images (${yacht.images.length} found)</label>
            ${yacht.images.length > 0
            ? `<div class="image-gallery">${yacht.images.slice(0, 8).map((img, i) => `
                    <img src="${img}" class="gallery-image ${i === 0 ? 'primary' : ''}" 
                         onerror="this.style.display='none'" alt="Image ${i + 1}">
                `).join('')}</div>`
            : '<p class="form-hint">No images found.</p>'
        }
        </div>
    `;

    document.getElementById('edit-modal').style.display = 'flex';
}

function saveYachtEdit() {
    if (currentEditIndex === null) return;

    const yacht = parsedYachts[currentEditIndex];

    yacht.title = document.getElementById('edit-title').value.trim();
    yacht.price = document.getElementById('edit-price').value.trim();
    yacht.year = document.getElementById('edit-year').value.trim();
    yacht.length = document.getElementById('edit-length').value.trim();
    yacht.lengthUnit = document.getElementById('edit-length-unit').value;
    yacht.type = document.getElementById('edit-type').value;
    yacht.location = document.getElementById('edit-location').value.trim();
    yacht.description = document.getElementById('edit-description').value.trim();

    // Parse price if updated
    if (yacht.price && !yacht.priceRaw) {
        const parsed = extractPrice(yacht.price);
        yacht.priceRaw = parsed.raw;
        yacht.price = parsed.formatted || yacht.price;
    }

    yacht.issues = validateYacht(yacht);
    yacht.confidence.overall = calculateConfidence(yacht);

    closeModal();
    renderYachtCards();
}

function closeModal() {
    document.getElementById('edit-modal').style.display = 'none';
    currentEditIndex = null;
}

function importSelectedYachts() {
    if (selectedYachts.size === 0) {
        alert('Please select at least one yacht to import.');
        return;
    }

    const yachtsToImport = parsedYachts.filter(y => selectedYachts.has(y.id));
    const hasErrors = yachtsToImport.some(y => y.issues.some(i => i.severity === 'error'));

    if (hasErrors && !confirm('Some selected yachts have missing required data. They will be saved as drafts. Continue?')) {
        return;
    }

    console.log('Importing yachts:', yachtsToImport);
    alert(`Successfully imported ${yachtsToImport.length} yacht(s)!`);
}

async function handleFetch() {
    const url = document.getElementById('broker-url').value.trim();

    if (!url) {
        alert('Please enter a URL');
        return;
    }

    try {
        new URL(url);
    } catch {
        alert('Please enter a valid URL');
        return;
    }

    const btn = document.getElementById('fetch-btn');
    const btnText = btn.querySelector('.btn-text');
    const btnLoading = btn.querySelector('.btn-loading');

    btnText.style.display = 'none';
    btnLoading.style.display = 'flex';
    btn.disabled = true;

    // Update loading text
    const updateStatus = (msg) => {
        btnLoading.innerHTML = `<span class="spinner"></span>${msg}`;
    };

    try {
        updateStatus('Fetching page...');
        const html = await fetchWithProxy(url);

        updateStatus('Scanning for listings...');
        let result = parseYachtListings(html, url);
        let allYachts = result.yachts || [];
        let pagesScanned = [url];

        // ALWAYS discover inventory links - homepage may only show featured boats
        // This is CRITICAL for any website - complete inventory is often on a separate page
        updateStatus('Discovering inventory pages...');
        const inventoryLinks = discoverInventoryLinks(html, url);
        log('Discovered inventory links:', inventoryLinks);

        // Follow ALL discovered inventory pages (up to 5)
        const inventoryToScan = inventoryLinks.slice(0, 5);
        for (let i = 0; i < inventoryToScan.length; i++) {
            const invUrl = inventoryToScan[i];
            if (pagesScanned.includes(invUrl)) continue;

            updateStatus(`Scanning inventory ${i + 1}/${inventoryToScan.length}...`);

            try {
                const invHtml = await fetchWithProxy(invUrl);
                const invResult = parseYachtListings(invHtml, invUrl);

                if (invResult.yachts && invResult.yachts.length > 0) {
                    allYachts.push(...invResult.yachts);
                    pagesScanned.push(invUrl);
                    log(`Found ${invResult.yachts.length} yachts on ${invUrl}`);

                    // Also check pagination on this inventory page
                    const invPagination = discoverPaginationLinks(invHtml, invUrl);
                    for (let j = 0; j < Math.min(3, invPagination.length); j++) {
                        const pageUrl = invPagination[j];
                        if (pagesScanned.includes(pageUrl)) continue;

                        updateStatus(`Scanning page ${j + 2} of inventory...`);
                        try {
                            const pageHtml = await fetchWithProxy(pageUrl);
                            const pageResult = parseYachtListings(pageHtml, pageUrl);
                            if (pageResult.yachts && pageResult.yachts.length > 0) {
                                allYachts.push(...pageResult.yachts);
                                pagesScanned.push(pageUrl);
                                log(`Found ${pageResult.yachts.length} yachts on ${pageUrl}`);
                            }
                        } catch (e) {
                            log(`Failed to fetch page ${pageUrl}:`, e.message);
                        }
                    }
                }
            } catch (e) {
                log(`Failed to fetch ${invUrl}:`, e.message);
            }
        }

        // Also check pagination on the original URL if it had boats
        if (result.yachts && result.yachts.length > 0) {
            updateStatus('Checking for more pages...');
            const paginationLinks = discoverPaginationLinks(html, url);
            log('Pagination links found:', paginationLinks);

            for (let i = 0; i < Math.min(3, paginationLinks.length); i++) {
                const pageUrl = paginationLinks[i];
                if (pagesScanned.includes(pageUrl)) continue;

                updateStatus(`Scanning page ${i + 2}...`);

                try {
                    const pageHtml = await fetchWithProxy(pageUrl);
                    const pageResult = parseYachtListings(pageHtml, pageUrl);

                    if (pageResult.yachts && pageResult.yachts.length > 0) {
                        allYachts.push(...pageResult.yachts);
                        pagesScanned.push(pageUrl);
                        log(`Found ${pageResult.yachts.length} yachts on ${pageUrl}`);
                    }
                } catch (e) {
                    log(`Failed to fetch pagination ${pageUrl}:`, e.message);
                }
            }
        }

        // Deduplicate across all pages
        allYachts = deduplicateYachts(allYachts);

        if (allYachts.length === 0) {
            // Show helpful message
            const inventoryLinks = discoverInventoryLinks(html, url);
            if (inventoryLinks.length > 0) {
                alert(`No yacht listings could be extracted.\n\nWe found these potential inventory pages:\n${inventoryLinks.slice(0, 5).join('\n')}\n\nTry entering one of these URLs directly.`);
            } else {
                alert(`No yacht listings found on this page.\n\nTips:\n• Try navigating to the "Boats for Sale" or "Inventory" page\n• Some websites block automated access`);
            }
            return;
        }

        // Store total count and limit displayed results
        totalYachtsFound = allYachts.length;
        parsedYachts = allYachts.slice(0, CONFIG.MAX_LISTINGS_DISPLAY);

        selectedYachts.clear();
        parsedYachts.forEach(y => selectedYachts.add(y.id));

        document.getElementById('results-section').style.display = 'block';
        document.getElementById('source-url').textContent = `Source: ${pagesScanned.join(', ')}`;
        renderYachtCards();
        document.getElementById('results-section').scrollIntoView({ behavior: 'smooth' });

    } catch (error) {
        console.error('Fetch error:', error);
        alert(`Failed to fetch the website:\n\n${error.message}`);
    } finally {
        btnText.style.display = 'inline';
        btnLoading.style.display = 'none';
        btn.disabled = false;
    }
}

/**
 * Discover links to inventory/boat listing pages from a given page
 */
function discoverInventoryLinks(html, baseUrl) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const inventoryPatterns = [
        /\/boats?\/?$/i,
        /\/yachts?\/?$/i,
        /\/inventory\/?$/i,
        /\/listings?\/?$/i,
        /\/for-?sale\/?$/i,
        /\/brokerage\/?$/i,
        /\/used-?(boats?|yachts?)/i,
        /\/new-?(boats?|yachts?)/i,
        /\/motor-?yacht/i,
        /\/sail(ing)?-?yacht/i,
        /\/search/i,
        /\/browse/i,
        /\/fleet/i,
        /\/vessels?/i,
        /\/results\/?$/i,  // Network Yacht Brokers pattern
        /\/boats[_-]for[_-]sale/i
    ];

    const inventoryKeywords = [
        'boats for sale', 'yachts for sale', 'inventory', 'our boats',
        'our yachts', 'browse', 'search boats', 'search yachts',
        'view all', 'see all', 'all boats', 'all yachts', 'fleet',
        'brokerage', 'for sale', 'listings', 'motor yachts', 'sailing yachts',
        'search', 'find a boat', 'find a yacht', 'results'
    ];

    const links = doc.querySelectorAll('a[href]');
    const found = new Map(); // url -> score

    const base = new URL(baseUrl);

    links.forEach(link => {
        let href = link.href || link.getAttribute('href');
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;

        // Resolve relative URLs
        try {
            href = new URL(href, baseUrl).href;
        } catch {
            return;
        }

        // Must be same domain
        try {
            const linkUrl = new URL(href);
            if (linkUrl.hostname !== base.hostname) return;
        } catch {
            return;
        }

        // Skip non-html resources
        if (/\.(jpg|png|gif|pdf|doc|css|js)$/i.test(href)) return;

        // Skip the current page
        if (href === baseUrl || href === baseUrl + '/') return;

        let score = 0;
        const linkText = (link.textContent || '').toLowerCase().trim();
        const hrefLower = href.toLowerCase();

        // Check URL patterns
        for (const pattern of inventoryPatterns) {
            if (pattern.test(hrefLower)) {
                score += 10;
                break;
            }
        }

        // Check link text
        for (const keyword of inventoryKeywords) {
            if (linkText.includes(keyword)) {
                score += 5;
                break;
            }
        }

        // Bonus for nav links (more likely to be main inventory)
        if (link.closest('nav, header, .nav, .menu, .navigation')) {
            score += 3;
        }

        // Bonus for prominent links
        if (link.closest('h1, h2, h3, .hero, .banner, .cta')) {
            score += 2;
        }

        if (score > 0) {
            const existing = found.get(href) || 0;
            found.set(href, Math.max(existing, score));
        }
    });

    // Sort by score and return top results
    return Array.from(found.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([url]) => url)
        .slice(0, 10);
}

/**
 * Discover pagination links (page 2, page 3, next, etc.)
 */
function discoverPaginationLinks(html, baseUrl) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const paginationUrls = [];
    const base = new URL(baseUrl);

    // Look for pagination containers
    const paginationContainers = doc.querySelectorAll(
        '.pagination, .paging, .page-numbers, .wp-pagenavi, nav[aria-label*="pagination"], [class*="pagination"]'
    );

    // If we find a pagination container, get links from it
    if (paginationContainers.length > 0) {
        paginationContainers.forEach(container => {
            const links = container.querySelectorAll('a[href]');
            links.forEach(link => {
                const text = link.textContent.trim();
                const href = link.href || link.getAttribute('href');

                // Skip "previous" and current page
                if (/prev|previous|«|‹/i.test(text)) return;
                if (link.classList.contains('current') || link.classList.contains('active')) return;

                // Accept "next", numbered pages (2, 3, etc.), or ">", "»"
                if (/^[2-9]$|^next$|^›$|^»$/i.test(text) || /\/page\/\d+/i.test(href)) {
                    try {
                        const fullUrl = new URL(href, baseUrl).href;
                        if (fullUrl.includes(base.hostname) && !paginationUrls.includes(fullUrl)) {
                            paginationUrls.push(fullUrl);
                        }
                    } catch { }
                }
            });
        });
    }

    // Fallback: look for common pagination URL patterns
    if (paginationUrls.length === 0) {
        const allLinks = doc.querySelectorAll('a[href]');
        allLinks.forEach(link => {
            const href = link.href || link.getAttribute('href');
            if (!href) return;

            // Match /page/2, ?page=2, &p=2 patterns
            if (/[?&/]page[=/]?\d+/i.test(href) || /\/\d+\/?$/.test(href)) {
                try {
                    const fullUrl = new URL(href, baseUrl).href;
                    if (fullUrl.includes(base.hostname) &&
                        fullUrl !== baseUrl &&
                        !paginationUrls.includes(fullUrl)) {
                        paginationUrls.push(fullUrl);
                    }
                } catch { }
            }
        });
    }

    log('Pagination URLs found:', paginationUrls);
    return paginationUrls;
}

function capitalizeFirst(str) {
    return str ? str.charAt(0).toUpperCase() + str.slice(1) : '';
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('fetch-btn').addEventListener('click', handleFetch);
    document.getElementById('broker-url').addEventListener('keypress', e => {
        if (e.key === 'Enter') handleFetch();
    });
    document.getElementById('select-all-btn').addEventListener('click', toggleSelectAll);
    document.getElementById('import-selected-btn').addEventListener('click', importSelectedYachts);
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', saveYachtEdit);
    document.getElementById('edit-modal').addEventListener('click', e => {
        if (e.target.id === 'edit-modal') closeModal();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape') closeModal();
    });
});

// Global functions for onclick handlers
window.toggleYachtSelection = toggleYachtSelection;
window.editYacht = editYacht;
window.removeYacht = removeYacht;
window.showDebugInfo = showDebugInfo;
