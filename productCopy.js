// Presentation copy and helpers for product views
const productShowcaseCopy = {
    apples: {
        tagline: 'Lunchbox hero',
        description: 'Naturally sweet Honeycrisp apples picked at peak ripeness for a juicy crunch in every bite.',
        tastingNotes: 'Bright, crisp and gently floral.',
        highlights: ['Rich in Vitamin C', 'Hand-graded for quality'],
        accentColor: 'success'
    },
    bananas: {
        tagline: 'Energy booster',
        description: 'Sun-ripened Cavendish bananas perfect for smoothies, baking or a pre-workout snack.',
        tastingNotes: 'Creamy texture with mellow sweetness.',
        highlights: ['High in potassium', 'Low food miles'],
        accentColor: 'warning'
    },
    broccoli: {
        tagline: 'Weekly greens',
        description: 'Tender florets from local hydroponic farms that roast beautifully or disappear into stir-fries.',
        tastingNotes: 'Earthy with peppery bite.',
        highlights: ['Packed with fibre', 'Great for meal prep'],
        accentColor: 'success'
    },
    bread: {
        tagline: 'Baked daily',
        description: 'Golden sourdough loaves with a crackly crust and soft, chewy centre.',
        tastingNotes: 'Subtle tang with nutty aroma.',
        highlights: ['Naturally leavened', 'No preservatives'],
        accentColor: 'secondary'
    },
    milk: {
        tagline: 'Breakfast essential',
        description: 'Farm-fresh milk that is gently pasteurised to keep things creamy and wholesome.',
        tastingNotes: 'Silky mouthfeel, subtly sweet.',
        highlights: ['Source-certified dairies', 'Great for barista-style foam'],
        accentColor: 'primary'
    },
    tomatoes: {
        tagline: 'Salad ready',
        description: 'Vine tomatoes bursting with flavour that brighten salads, sandwiches and pastas.',
        tastingNotes: 'Sweet with balanced acidity.',
        highlights: ['Naturally ripened', 'Perfect for roasting'],
        accentColor: 'danger'
    },
    oranges: {
        tagline: 'Citrus sunshine',
        description: 'Zesty, juicy oranges ideal for fresh juice or brightening up breakfast.',
        tastingNotes: 'Refreshing acidity with natural sweetness.',
        highlights: ['Vitamin C boost', 'Perfect for juicing'],
        accentColor: 'warning'
    },
    durian: {
        tagline: 'King of fruits',
        description: 'Creamy, aromatic durian for bold dessert experiments and durian fans alike.',
        tastingNotes: 'Custardy texture with deep, complex aroma.',
        highlights: ['Premium grade', 'Chilled delivery'],
        accentColor: 'secondary'
    },
    blueberries: {
        tagline: 'Berry burst',
        description: 'Plump blueberries that sweeten smoothies, pancakes and yoghurts.',
        tastingNotes: 'Sweet with a lively tart finish.',
        highlights: ['Great for cereals', 'Easy grab-and-go snack'],
        accentColor: 'primary'
    }
};

const heroCopy = {
    heading: 'Farm-fresh goodness delivered daily',
    subheading: 'Discover produce with transparent ratings, curated descriptions and easy checkout.',
    perks: [
        'Curated from trusted farms every sunrise',
        'Shopper reviews keep quality honest',
        'Same-day collection available before 6 PM'
    ]
};

const decorateProduct = (productRow = {}) => {
    const key = (productRow.productName || '').toLowerCase();
    const copy = productShowcaseCopy[key] || {};
    const priceNumber = Number(productRow.price || 0);
    const ratingValue = Number(productRow.averageRating || 0);
    const qty = Number(productRow.quantity);
    const status = productRow.status
        || (qty <= 0 ? 'sold_out' : qty < 10 ? 'low_stock' : 'in_stock');
    const isSoldOut = status === 'sold_out' || qty <= 0;
    const isLowStock = status === 'low_stock' && qty > 0;

    return {
        ...productRow,
        status,
        isSoldOut,
        isLowStock,
        category: productRow.category || 'General',
        showcaseTag: copy.tagline || 'Fresh pick',
        accentColor: copy.accentColor || 'success',
        shortDescription: productRow.description || copy.description || 'Freshly picked produce from trusted growers.',
        tastingNotes: copy.tastingNotes || '',
        highlights: copy.highlights || ['Quality checked', 'Ready for checkout'],
        priceLabel: priceNumber ? priceNumber.toFixed(2) : '0.00',
        ratingValue,
        averageRating: ratingValue ? ratingValue.toFixed(1) : '0.0',
        reviewCount: productRow.reviewCount || 0
    };
};

module.exports = {
    productShowcaseCopy,
    heroCopy,
    decorateProduct
};
