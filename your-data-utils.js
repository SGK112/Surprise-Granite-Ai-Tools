const { parse } = require('csv-parse/sync');
const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');

// Helper: Fuzzy match
function fuzzyMatch(str, pattern) {
  if (!str || !pattern) return false;
  return str.toLowerCase().includes(pattern.toLowerCase());
}

// Load materials from CSV or JSON
async function loadMaterials() {
  // Try CSV first
  try {
    const csvUrl = process.env.GOOGLE_SHEET_CSV_URL;
    const response = await axios.get(csvUrl, { timeout: 10000 });
    const data = parse(response.data, { columns: true, skip_empty_lines: true, trim: true });
    return data;
  } catch (err) {
    // Fallback to local JSON
    try {
      const jsonData = await fs.readFile(path.join(__dirname, 'public', 'materials.json'), 'utf8');
      return JSON.parse(jsonData);
    } catch (jsonErr) {
      return [];
    }
  }
}

/**
 * Search materials by vendor, material type, color name, thickness.
 * @param {Object} query - { vendor, material, color, thickness }
 * @returns {Promise<Array>} - Array of matching materials with price info
 */
async function getMaterialPrices(query) {
  const { vendor, material, color, thickness } = query;
  const materials = await loadMaterials();

  // Filter by all provided fields (case-insensitive, partial match)
  return materials.filter(item =>
    (!vendor    || fuzzyMatch(item.Vendor || item.vendor || '', vendor)) &&
    (!material  || fuzzyMatch(item.Material || '', material)) &&
    (!color     || fuzzyMatch(item['Color Name'] || item.name || '', color)) &&
    (!thickness || fuzzyMatch(item.Thickness || '', thickness))
  ).map(item => ({
    name: item['Color Name'] || item.name || '',
    vendor: item.Vendor || item.vendor || '',
    material: item.Material || '',
    thickness: item.Thickness || '',
    price: item['Cost/SqFt'] || item.costPerSquare || '',
    installedPrice: item.installedPrice || '', // If you pre-calculate it
    imageUrl: item.image_url || item['Image URL'] || ''
  }));
}

// Example usage in an endpoint or chat logic:
async function testGetMaterialPrices() {
  const matches = await getMaterialPrices({
    vendor: 'MSI',
    material: 'Quartz',
    color: 'Frost',
    thickness: '3cm'
  });
  console.log(matches);
}

// Uncomment the next line to test directly:
// testGetMaterialPrices();

/**
 * Get products from Shopify store with optional search
 * @param {string} query - Search query for products 
 * @returns {Promise<Array>} - Array of Shopify products
 */
async function getShopifyProducts(query = '') {
  try {
    // Get configuration from environment variables
    const shopifyShop = process.env.SHOPIFY_SHOP;
    const shopifyToken = process.env.SHOPIFY_ACCESS_TOKEN;
    
    if (!shopifyShop || !shopifyToken) {
      console.error('Missing Shopify configuration');
      return [];
    }
    
    // Create the GraphQL query to search products
    const graphqlQuery = `
    {
      products(first: 10, query: "${query}") {
        edges {
          node {
            id
            title
            handle
            description
            featuredImage {
              url
            }
            variants(first: 1) {
              edges {
                node {
                  price
                  compareAtPrice
                  sku
                }
              }
            }
          }
        }
      }
    }`;
    
    // Make request to Shopify GraphQL API
    const response = await axios({
      url: `https://${shopifyShop}/api/2024-07/graphql.json`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Shopify-Access-Token': shopifyToken
      },
      data: { query: graphqlQuery }
    });
    
    // Process the response
    if (response.data && response.data.data && response.data.data.products) {
      return response.data.data.products.edges.map(edge => {
        const product = edge.node;
        const variant = product.variants.edges[0]?.node;
        
        return {
          id: product.id,
          title: product.title,
          handle: product.handle,
          description: product.description,
          image: product.featuredImage?.url || '',
          price: variant?.price || '0.00',
          compareAtPrice: variant?.compareAtPrice || null,
          sku: variant?.sku || ''
        };
      });
    }
    
    return [];
  } catch (error) {
    console.error('Error fetching Shopify products:', error.message);
    return [];
  }
}

module.exports = { getMaterialPrices, getShopifyProducts };
