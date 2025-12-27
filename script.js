// Sample yacht listings data
const yachtListings = [
    {
        id: 1,
        title: "2023 Sunseeker Manhattan 68",
        price: 2850000,
        year: 2023,
        length: 68,
        type: "motor",
        location: "Miami, FL",
        image: "https://images.unsplash.com/photo-1567899378494-47b22a2ae96a?w=600&h=400&fit=crop",
        badge: "featured"
    },
    {
        id: 2,
        title: "2022 Beneteau Oceanis 51.1",
        price: 485000,
        year: 2022,
        length: 51,
        type: "sail",
        location: "San Diego, CA",
        image: "https://images.unsplash.com/photo-1540946485063-a40da27545f8?w=600&h=400&fit=crop",
        badge: "new"
    },
    {
        id: 3,
        title: "2021 Azimut S6",
        price: 1950000,
        year: 2021,
        length: 60,
        type: "motor",
        location: "Fort Lauderdale, FL",
        image: "https://images.unsplash.com/photo-1605281317010-fe5ffe798166?w=600&h=400&fit=crop",
        badge: null
    },
    {
        id: 4,
        title: "2020 Lagoon 46",
        price: 695000,
        year: 2020,
        length: 46,
        type: "catamaran",
        location: "Annapolis, MD",
        image: "https://images.unsplash.com/photo-1500917293891-ef795e70e1f6?w=600&h=400&fit=crop",
        badge: null
    },
    {
        id: 5,
        title: "2019 Princess V78",
        price: 3200000,
        year: 2019,
        length: 78,
        type: "motor",
        location: "Monaco",
        image: "https://images.unsplash.com/photo-1569263979104-865ab7cd8d13?w=600&h=400&fit=crop",
        badge: "featured"
    },
    {
        id: 6,
        title: "2023 Jeanneau Sun Odyssey 490",
        price: 425000,
        year: 2023,
        length: 49,
        type: "sail",
        location: "Newport, RI",
        image: "https://images.unsplash.com/photo-1544551763-46a013bb70d5?w=600&h=400&fit=crop",
        badge: "new"
    },
    {
        id: 7,
        title: "2018 Ferretti 850",
        price: 4500000,
        year: 2018,
        length: 85,
        type: "superyacht",
        location: "Cannes, France",
        image: "https://images.unsplash.com/photo-1559494007-9f5847c49d94?w=600&h=400&fit=crop",
        badge: null
    },
    {
        id: 8,
        title: "2022 Fountaine Pajot Elba 45",
        price: 750000,
        year: 2022,
        length: 45,
        type: "catamaran",
        location: "St. Thomas, USVI",
        image: "https://images.unsplash.com/photo-1586456298178-9e9f3a8a6a5b?w=600&h=400&fit=crop",
        badge: null
    }
];

// Format price with commas and dollar sign
function formatPrice(price) {
    return '$' + price.toLocaleString('en-US');
}

// Create listing card HTML
function createListingCard(listing) {
    const badgeHTML = listing.badge 
        ? `<span class="listing-badge badge-${listing.badge}">${listing.badge}</span>` 
        : '';
    
    return `
        <a href="#" class="listing-card" data-id="${listing.id}">
            <img src="${listing.image}" alt="${listing.title}" class="listing-image" 
                 onerror="this.src='https://via.placeholder.com/600x400/e5e7eb/9ca3af?text=No+Image'">
            <div class="listing-content">
                ${badgeHTML}
                <div class="listing-price">${formatPrice(listing.price)}</div>
                <h3 class="listing-title">${listing.title}</h3>
                <div class="listing-specs">
                    <span class="listing-spec">📅 ${listing.year}</span>
                    <span class="listing-spec">📏 ${listing.length}ft</span>
                </div>
                <div class="listing-location">📍 ${listing.location}</div>
            </div>
        </a>
    `;
}

// Render all listings
function renderListings(listings) {
    const grid = document.getElementById('listings-grid');
    grid.innerHTML = listings.map(createListingCard).join('');
}

// Filter listings based on search criteria
function filterListings() {
    const type = document.getElementById('type').value;
    const minPrice = parseInt(document.getElementById('min-price').value) || 0;
    const maxPrice = parseInt(document.getElementById('max-price').value) || Infinity;
    const length = document.getElementById('length').value;

    let filtered = yachtListings.filter(listing => {
        // Type filter
        if (type && listing.type !== type) return false;
        
        // Price filter
        if (listing.price < minPrice || listing.price > maxPrice) return false;
        
        // Length filter
        if (length) {
            const len = parseInt(length);
            if (len === 30 && listing.length > 30) return false;
            if (len === 50 && (listing.length <= 30 || listing.length > 50)) return false;
            if (len === 80 && (listing.length <= 50 || listing.length > 80)) return false;
            if (len === 100 && (listing.length <= 80 || listing.length > 100)) return false;
            if (len === 101 && listing.length <= 100) return false;
        }
        
        return true;
    });

    renderListings(filtered);
}

// Sort listings
function sortListings(sortBy) {
    let sorted = [...yachtListings];
    
    switch(sortBy) {
        case 'price-low':
            sorted.sort((a, b) => a.price - b.price);
            break;
        case 'price-high':
            sorted.sort((a, b) => b.price - a.price);
            break;
        case 'newest':
            sorted.sort((a, b) => b.year - a.year);
            break;
        case 'length':
            sorted.sort((a, b) => b.length - a.length);
            break;
        default:
            // Featured first
            sorted.sort((a, b) => (b.badge === 'featured' ? 1 : 0) - (a.badge === 'featured' ? 1 : 0));
    }
    
    renderListings(sorted);
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Render initial listings
    renderListings(yachtListings);

    // Search button click
    document.getElementById('search-btn').addEventListener('click', filterListings);

    // Sort change
    document.getElementById('sort').addEventListener('change', (e) => {
        sortListings(e.target.value);
    });

    // Load more button (just an alert for demo)
    document.getElementById('load-more-btn').addEventListener('click', () => {
        alert('In a real application, this would load more listings from the server.');
    });
});
