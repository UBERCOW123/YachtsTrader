/**
 * Yacht Listing Import System
 * Fetches and parses yacht listings from external broker websites
 */

// State
let parsedYachts = [];
let selectedYachts = new Set();
let currentEditIndex = null;

// Required fields for a complete listing
const REQUIRED_FIELDS = ['title', 'price', 'images'];
const RECOMMENDED_FIELDS = ['year', 'length', 'type', 'location', 'description'];

// DOM Elements
const fetchBtn = document.getElementById('fetch-btn');
const brokerUrlInput = document.getElementById('broker-url');
const resultsSection = document.getElementById('results-section');
const yachtCardsContainer = document.getElementById('yacht-cards');
const qualityBanner = document.getElementById('quality-banner');
const selectAllBtn = document.getElementById('select-all-btn');
const importSelectedBtn = document.getElementById('import-selected-btn');
const editModal = document.getElementById('edit-modal');

// CORS Proxy for fetching external URLs (for demo purposes)
// In production, you'd use your own backend
const CORS_PROXIES = [
    'https://api.allorigins.win/raw?url=',
    'https://corsproxy.io/?',
    'https://api.codetabs.com/v1/proxy?quest='
];

/**
 * Fetch content from URL using CORS proxy
 */
async function fetchWithProxy(url) {
    for (const proxy of CORS_PROXIES) {
        try {
            const response = await fetch(proxy + encodeURIComponent(url));
            if (response.ok) {
                return await response.text();
            }
        } catch (e) {
            console.log(`Proxy ${proxy} failed, trying next...`);
        }
    }
    throw new Error('Unable to fetch URL. The website may be blocking automated access.');
}

/**
 * Parse HTML content to extract yacht listings
 */
function parseYachtListings(html, sourceUrl) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const yachts = [];

    // Common selectors for yacht listing pages
    // This is a heuristic approach - in production you might want ML or more sophisticated parsing
    const listingSelectors = [
        'article', '.listing', '.yacht', '.boat', '.vessel', '.product', '.card',
        '[class*="listing"]', '[class*="yacht"]', '[class*="boat"]', '[class*="product"]',
        '.inventory-item', '.search-result', '.item'
    ];

    let listings = [];

    // Try each selector to find listings
    for (const selector of listingSelectors) {
        const found = doc.querySelectorAll(selector);
        if (found.length > 1 && found.length < 100) {
            listings = Array.from(found);
            break;
        }
    }

    // If no structured listings found, try to parse the whole page
    if (listings.length === 0) {
        // Fallback: look for repeated patterns
        listings = findRepeatingPatterns(doc);
    }

    // Parse each listing
    listings.forEach((listing, index) => {
        const yacht = extractYachtData(listing, sourceUrl, index);
        if (yacht.title || yacht.price || yacht.images.length > 0) {
            yachts.push(yacht);
        }
    });

    // If still nothing, create a single listing from the whole page
    if (yachts.length === 0) {
        const singleYacht = extractYachtData(doc.body, sourceUrl, 0);
        if (singleYacht.title || singleYacht.price) {
            yachts.push(singleYacht);
        }
    }

    return yachts;
}

/**
 * Find repeating patterns in the DOM (fallback method)
 */
function findRepeatingPatterns(doc) {
    // Look for divs that contain both images and prices
    const candidates = doc.querySelectorAll('div, section, li');
    const scored = [];

    candidates.forEach(el => {
        let score = 0;
        const text = el.textContent || '';

        // Has price-like content
        if (/\$[\d,]+/.test(text) || /€[\d,]+/.test(text) || /£[\d,]+/.test(text)) score += 3;

        // Has an image
        if (el.querySelector('img')) score += 2;

        // Has link
        if (el.querySelector('a')) score += 1;

        // Has year-like number
        if (/\b(19|20)\d{2}\b/.test(text)) score += 1;

        // Has length-like content
        if (/\d+['']?\s*(ft|feet|m|meters?)/i.test(text)) score += 1;

        // Not too big, not too small
        const size = el.textContent.length;
        if (size > 50 && size < 2000) score += 1;

        if (score >= 3) {
            scored.push({ el, score });
        }
    });

    // Sort by score and take top candidates
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, 20).map(s => s.el);
}

/**
 * Extract yacht data from a DOM element
 */
function extractYachtData(element, sourceUrl, index) {
    const yacht = {
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
        sourceUrl: sourceUrl,
        issues: []
    };

    const text = element.textContent || '';
    const html = element.innerHTML || '';

    // Extract Title
    const headings = element.querySelectorAll('h1, h2, h3, h4, .title, [class*="title"], [class*="name"]');
    for (const h of headings) {
        const t = h.textContent.trim();
        if (t.length > 5 && t.length < 200) {
            yacht.title = t;
            break;
        }
    }

    // Fallback title from links
    if (!yacht.title) {
        const links = element.querySelectorAll('a');
        for (const link of links) {
            const t = link.textContent.trim();
            if (t.length > 10 && t.length < 150 && !t.includes('http')) {
                yacht.title = t;
                break;
            }
        }
    }

    // Extract Price
    const pricePatterns = [
        /\$\s*([\d,]+(?:\.\d{2})?)/,
        /€\s*([\d,]+(?:\.\d{2})?)/,
        /£\s*([\d,]+(?:\.\d{2})?)/,
        /USD\s*([\d,]+)/i,
        /EUR\s*([\d,]+)/i,
        /([\d,]+)\s*(?:USD|EUR|GBP)/i
    ];

    for (const pattern of pricePatterns) {
        const match = text.match(pattern);
        if (match) {
            yacht.priceRaw = parseInt(match[1].replace(/,/g, ''));
            yacht.price = formatPrice(yacht.priceRaw);
            break;
        }
    }

    // Check for "Price on Request" or similar
    if (!yacht.price && /price\s*on\s*request|POA|call\s*for\s*price/i.test(text)) {
        yacht.price = 'Price on Request';
    }

    // Extract Year
    const yearMatch = text.match(/\b(19[89]\d|20[0-2]\d)\b/);
    if (yearMatch) {
        yacht.year = yearMatch[1];
    }

    // Extract Length
    const lengthPatterns = [
        /(\d+(?:\.\d+)?)\s*['']?\s*(ft|feet|foot)/i,
        /(\d+(?:\.\d+)?)\s*(m|meters?|metres?)\b/i,
        /length[:\s]+(\d+(?:\.\d+)?)\s*(ft|m)?/i,
        /LOA[:\s]+(\d+(?:\.\d+)?)/i
    ];

    for (const pattern of lengthPatterns) {
        const match = text.match(pattern);
        if (match) {
            yacht.length = match[1];
            if (match[2] && match[2].toLowerCase().startsWith('m')) {
                yacht.lengthUnit = 'm';
            }
            break;
        }
    }

    // Extract Type
    const typeKeywords = {
        'motor yacht': 'motor',
        'motor': 'motor',
        'sailing': 'sail',
        'sailboat': 'sail',
        'sail': 'sail',
        'catamaran': 'catamaran',
        'trimaran': 'catamaran',
        'superyacht': 'superyacht',
        'mega yacht': 'superyacht',
        'megayacht': 'superyacht',
        'cruiser': 'motor',
        'sportfish': 'motor',
        'trawler': 'motor',
        'express': 'motor'
    };

    const lowerText = text.toLowerCase();
    for (const [keyword, type] of Object.entries(typeKeywords)) {
        if (lowerText.includes(keyword)) {
            yacht.type = type;
            break;
        }
    }

    // Extract Location
    const locationPatterns = [
        /(?:located?\s*(?:in|at)?|location)[:\s]+([A-Za-z\s,]+?)(?:\.|$|\n)/i,
        /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z]{2})\b/, // City, ST format
        /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z][a-z]+)/ // City, Country format
    ];

    for (const pattern of locationPatterns) {
        const match = text.match(pattern);
        if (match && match[1].length < 50) {
            yacht.location = match[1].trim();
            break;
        }
    }

    // Extract Images
    const images = element.querySelectorAll('img');
    images.forEach(img => {
        let src = img.src || img.dataset.src || img.dataset.lazySrc;
        if (src && !src.includes('placeholder') && !src.includes('logo') && !src.includes('icon')) {
            // Convert relative URLs to absolute
            if (src.startsWith('/')) {
                const urlObj = new URL(sourceUrl);
                src = urlObj.origin + src;
            } else if (!src.startsWith('http')) {
                const urlObj = new URL(sourceUrl);
                src = urlObj.origin + '/' + src;
            }

            // Filter out tiny images (likely icons)
            const width = img.naturalWidth || img.width || 100;
            const height = img.naturalHeight || img.height || 100;
            if (width >= 100 && height >= 100) {
                yacht.images.push(src);
            }
        }
    });

    // Also check for background images
    const bgElements = element.querySelectorAll('[style*="background"]');
    bgElements.forEach(el => {
        const style = el.getAttribute('style');
        const match = style.match(/url\(['"]?([^'")\s]+)['"]?\)/);
        if (match) {
            yacht.images.push(match[1]);
        }
    });

    // Extract Description
    const descElements = element.querySelectorAll('p, .description, [class*="desc"]');
    for (const desc of descElements) {
        const t = desc.textContent.trim();
        if (t.length > 50 && t.length < 2000) {
            yacht.description = t;
            break;
        }
    }

    // Determine issues
    yacht.issues = validateYacht(yacht);

    return yacht;
}

/**
 * Format price number to string
 */
function formatPrice(num) {
    if (!num || isNaN(num)) return '';
    return '$' + num.toLocaleString('en-US');
}

/**
 * Validate yacht data and return list of issues
 */
function validateYacht(yacht) {
    const issues = [];

    if (!yacht.title) issues.push({ field: 'title', severity: 'error', message: 'Missing title' });
    if (!yacht.price) issues.push({ field: 'price', severity: 'error', message: 'Missing price' });
    if (yacht.images.length === 0) issues.push({ field: 'images', severity: 'error', message: 'No images found' });

    if (!yacht.year) issues.push({ field: 'year', severity: 'warning', message: 'Missing year' });
    if (!yacht.length) issues.push({ field: 'length', severity: 'warning', message: 'Missing length' });
    if (!yacht.type) issues.push({ field: 'type', severity: 'warning', message: 'Missing type' });
    if (!yacht.location) issues.push({ field: 'location', severity: 'warning', message: 'Missing location' });
    if (!yacht.description) issues.push({ field: 'description', severity: 'warning', message: 'Missing description' });

    return issues;
}

/**
 * Render yacht cards
 */
function renderYachtCards() {
    if (parsedYachts.length === 0) {
        yachtCardsContainer.innerHTML = `
            <div class="no-results">
                <p>No yacht listings could be extracted from this page.</p>
                <p>Try a different URL or enter your listings manually.</p>
            </div>
        `;
        return;
    }

    yachtCardsContainer.innerHTML = parsedYachts.map((yacht, index) => {
        const hasErrors = yacht.issues.some(i => i.severity === 'error');
        const isSelected = selectedYachts.has(yacht.id);

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
                               onerror="this.parentElement.innerHTML='<div class=\\'no-image\\'><span>🖼️</span><p>Image failed to load</p></div>'">
                           ${yacht.images.length > 1 ? `<span class="image-count">+${yacht.images.length - 1} photos</span>` : ''}`
                : `<div class="no-image"><span>📷</span><p>No images</p></div>`
            }
                </div>
                
                <div class="yacht-details">
                    <h3 class="yacht-title">${yacht.title || '<span style="color: #dc3545">Title Required</span>'}</h3>
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
                    <button class="btn btn-outline btn-small" onclick="editYacht(${index})">
                        ✏️ Edit
                    </button>
                    <button class="btn btn-outline btn-small" onclick="removeYacht(${index})">
                        🗑️ Remove
                    </button>
                </div>
            </div>
        `;
    }).join('');

    updateCounts();
}

/**
 * Update counts in the UI
 */
function updateCounts() {
    document.getElementById('yacht-count').textContent = parsedYachts.length;
    document.getElementById('selected-count').textContent = selectedYachts.size;

    const issueCount = parsedYachts.filter(y => y.issues.some(i => i.severity === 'error')).length;
    document.getElementById('issue-count').textContent = issueCount;

    if (issueCount === 0) {
        qualityBanner.classList.add('success');
        qualityBanner.innerHTML = `
            <div class="quality-icon">✅</div>
            <div class="quality-text">
                <strong>All listings have complete data</strong>
                <p>Ready to import to Yachts Trader</p>
            </div>
        `;
    } else {
        qualityBanner.classList.remove('success');
        qualityBanner.innerHTML = `
            <div class="quality-icon">⚠️</div>
            <div class="quality-text">
                <strong>${issueCount} listing${issueCount !== 1 ? 's' : ''} ${issueCount !== 1 ? 'have' : 'has'} missing required data</strong>
                <p>Fields marked in red require attention before publishing</p>
            </div>
        `;
    }
}

/**
 * Toggle yacht selection
 */
function toggleYachtSelection(id) {
    if (selectedYachts.has(id)) {
        selectedYachts.delete(id);
    } else {
        selectedYachts.add(id);
    }
    renderYachtCards();
}

/**
 * Select/deselect all yachts
 */
function toggleSelectAll() {
    if (selectedYachts.size === parsedYachts.length) {
        selectedYachts.clear();
    } else {
        parsedYachts.forEach(y => selectedYachts.add(y.id));
    }
    renderYachtCards();
}

/**
 * Remove a yacht from the list
 */
function removeYacht(index) {
    const yacht = parsedYachts[index];
    selectedYachts.delete(yacht.id);
    parsedYachts.splice(index, 1);
    renderYachtCards();
}

/**
 * Open edit modal for a yacht
 */
function editYacht(index) {
    currentEditIndex = index;
    const yacht = parsedYachts[index];

    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `
        <div class="form-group">
            <label for="edit-title">Title <span class="required">*</span></label>
            <input type="text" id="edit-title" value="${escapeHtml(yacht.title)}" 
                   class="${!yacht.title ? 'error' : ''}" placeholder="e.g., 2023 Sunseeker Manhattan 68">
            ${!yacht.title ? '<p class="form-error">Title is required</p>' : ''}
        </div>
        
        <div class="form-row">
            <div class="form-group">
                <label for="edit-price">Price <span class="required">*</span></label>
                <input type="text" id="edit-price" value="${yacht.price}" 
                       class="${!yacht.price ? 'error' : ''}" placeholder="e.g., $2,500,000">
                ${!yacht.price ? '<p class="form-error">Price is required</p>' : ''}
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
                    <option value="ft" ${yacht.lengthUnit === 'ft' ? 'selected' : ''}>Feet (ft)</option>
                    <option value="m" ${yacht.lengthUnit === 'm' ? 'selected' : ''}>Meters (m)</option>
                </select>
            </div>
        </div>
        
        <div class="form-row">
            <div class="form-group">
                <label for="edit-type">Type</label>
                <select id="edit-type">
                    <option value="" ${!yacht.type ? 'selected' : ''}>Select type...</option>
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
            <textarea id="edit-description" placeholder="Enter yacht description...">${escapeHtml(yacht.description)}</textarea>
        </div>
        
        <div class="form-group">
            <label>Images (${yacht.images.length} found)</label>
            ${yacht.images.length > 0
            ? `<div class="image-gallery">
                    ${yacht.images.slice(0, 8).map((img, i) => `
                        <img src="${img}" class="gallery-image ${i === 0 ? 'primary' : ''}" 
                             alt="Yacht image ${i + 1}"
                             onerror="this.style.display='none'">
                    `).join('')}
                   </div>
                   <p class="form-hint">Click an image to set as primary</p>`
            : '<p class="form-hint">No images found. You can add images after importing.</p>'
        }
        </div>
    `;

    editModal.style.display = 'flex';
}

/**
 * Save edited yacht data
 */
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

    // Revalidate
    yacht.issues = validateYacht(yacht);

    closeModal();
    renderYachtCards();
}

/**
 * Close modal
 */
function closeModal() {
    editModal.style.display = 'none';
    currentEditIndex = null;
}

/**
 * Import selected yachts
 */
function importSelectedYachts() {
    if (selectedYachts.size === 0) {
        alert('Please select at least one yacht to import.');
        return;
    }

    const yachtsToImport = parsedYachts.filter(y => selectedYachts.has(y.id));
    const hasIssues = yachtsToImport.some(y => y.issues.some(i => i.severity === 'error'));

    if (hasIssues) {
        const confirm = window.confirm(
            'Some selected yachts have missing required data. They will be saved as drafts. Continue?'
        );
        if (!confirm) return;
    }

    // In a real app, this would send to a backend
    console.log('Importing yachts:', yachtsToImport);
    alert(`Successfully imported ${yachtsToImport.length} yacht(s)!\n\nIn a production system, these would be saved to your account.`);
}

/**
 * Handle fetch button click
 */
async function handleFetch() {
    const url = brokerUrlInput.value.trim();

    if (!url) {
        alert('Please enter a URL');
        return;
    }

    // Validate URL format
    try {
        new URL(url);
    } catch {
        alert('Please enter a valid URL (e.g., https://example.com/yachts)');
        return;
    }

    // Show loading state
    const btnText = fetchBtn.querySelector('.btn-text');
    const btnLoading = fetchBtn.querySelector('.btn-loading');
    btnText.style.display = 'none';
    btnLoading.style.display = 'flex';
    fetchBtn.disabled = true;

    try {
        const html = await fetchWithProxy(url);
        parsedYachts = parseYachtListings(html, url);
        selectedYachts.clear();

        // Select all by default
        parsedYachts.forEach(y => selectedYachts.add(y.id));

        // Show results
        resultsSection.style.display = 'block';
        document.getElementById('source-url').textContent = `Source: ${url}`;
        renderYachtCards();

        // Scroll to results
        resultsSection.scrollIntoView({ behavior: 'smooth' });

    } catch (error) {
        console.error('Fetch error:', error);
        alert(`Failed to fetch the website:\n\n${error.message}\n\nThis could be due to:\n• The website blocking automated access\n• CORS restrictions\n• Network issues\n\nTry a different URL or enter your listings manually.`);
    } finally {
        btnText.style.display = 'inline';
        btnLoading.style.display = 'none';
        fetchBtn.disabled = false;
    }
}

/**
 * Utility: Capitalize first letter
 */
function capitalizeFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Utility: Escape HTML
 */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Fetch button
    fetchBtn.addEventListener('click', handleFetch);

    // Enter key in URL input
    brokerUrlInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleFetch();
    });

    // Select all button
    selectAllBtn.addEventListener('click', toggleSelectAll);

    // Import button
    importSelectedBtn.addEventListener('click', importSelectedYachts);

    // Modal close
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-cancel').addEventListener('click', closeModal);
    document.getElementById('modal-save').addEventListener('click', saveYachtEdit);

    // Close modal on overlay click
    editModal.addEventListener('click', (e) => {
        if (e.target === editModal) closeModal();
    });

    // ESC to close modal
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && editModal.style.display === 'flex') {
            closeModal();
        }
    });
});

// Make functions available globally for onclick handlers
window.toggleYachtSelection = toggleYachtSelection;
window.editYacht = editYacht;
window.removeYacht = removeYacht;
