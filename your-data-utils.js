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
<<<<<<< HEAD
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

module.exports = { getMaterialPrices };
=======
const matches = await getMaterialPrices({
  vendor: 'MSI',
  material: 'Quartz',
  color: 'Frost',
  thickness: '3cm'
});

module.exports = { getMaterialPrices };
>>>>>>> 95a0a1145cad68a2e67b726387fb8f7f38e5d8ae
