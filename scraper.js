const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

// Output file
const OUTPUT_FILE = path.join(__dirname, "colors.staging.json");

// List of vendor sources to scrape
const SOURCES = [
  {
    name: "MSI Quartz",
    url: "https://www.msisurfaces.com/quartz-countertops/",
    parse: ($) =>
      $(".product-grid-item")
        .map((_, el) => ({
          name: $(el).find(".product-title").text().trim(),
          description: "Quartz countertop from MSI Surfaces",
          imageUrl: fixUrl($(el).find("img").attr("src"), "https://www.msisurfaces.com")
        }))
        .get(),
  },
  {
    name: "MSI Granite",
    url: "https://www.msisurfaces.com/granite-countertops/",
    parse: ($) =>
      $(".product-grid-item")
        .map((_, el) => ({
          name: $(el).find(".product-title").text().trim(),
          description: "Granite countertop from MSI Surfaces",
          imageUrl: fixUrl($(el).find("img").attr("src"), "https://www.msisurfaces.com")
        }))
        .get(),
  },
  {
    name: "Arizona Tile Quartz",
    url: "https://www.arizonatile.com/products/slab/della-terra-quartz/",
    parse: ($) =>
      $(".product-item")
        .map((_, el) => ({
          name: $(el).find(".product-title").text().trim(),
          description: "Quartz countertop from Arizona Tile",
          imageUrl: fixUrl($(el).find("img").attr("src"), "https://www.arizonatile.com")
        }))
        .get(),
  },
  {
    name: "Cambria Quartz",
    url: "https://www.cambriausa.com/quartz-countertops/quartz-colors",
    parse: ($) =>
      $(".product-card")
        .map((_, el) => ({
          name: $(el).find(".product-card__title").text().trim(),
          description: "Quartz countertop from Cambria",
          imageUrl: fixUrl($(el).find("img").attr("src"), "https://www.cambriausa.com")
        }))
        .get()
  },
  {
    name: "Daltile Quartz",
    url: "https://www.daltile.com/countertops-product-category/ONE-Quartz-Surfaces",
    parse: ($) =>
      $(".product-grid__item")
        .map((_, el) => ({
          name: $(el).find(".product-tile__title").text().trim(),
          description: "Quartz countertop from Daltile",
          imageUrl: fixUrl($(el).find("img").attr("src"), "https://www.daltile.com")
        }))
        .get()
  },
  {
    name: "Cosentino Colors",
    url: "https://www.cosentino.com/usa/colors/",
    parse: ($) =>
      $(".product-color")
        .map((_, el) => ({
          name: $(el).find(".product-color__title").text().trim(),
          description: "Countertop material from Cosentino (Silestone or Dekton)",
          imageUrl: fixUrl($(el).find("img").attr("src"), "https://www.cosentino.com")
        }))
        .get()
  }
];

// Ensure all image URLs are absolute
function fixUrl(url, base) {
  if (!url) return null;
  return url.startsWith("http") ? url : new URL(url, base).href;
}

async function scrapeAll() {
  const allColors = [];

  for (const source of SOURCES) {
    try {
      console.log(`🔍 Scraping ${source.name}...`);
      const { data } = await axios.get(source.url, {
        headers: { "User-Agent": "Mozilla/5.0" },
        timeout: 15000,
      });

      const $ = cheerio.load(data);
      const items = source.parse($);

      if (Array.isArray(items) && items.length > 0) {
        allColors.push(...items);
        console.log(`✅ ${items.length} colors scraped from ${source.name}`);
      } else {
        console.warn(`⚠️ No items found on ${source.name}`);
      }
    } catch (err) {
      console.error(`❌ Failed to scrape ${source.name}:`, err.message);
    }
  }

  if (allColors.length > 0) {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allColors, null, 2));
    console.log(`📁 Saved ${allColors.length} colors to ${OUTPUT_FILE}`);
  } else {
    console.warn("⚠️ No colors were scraped. Existing data remains unchanged.");
  }
}

scrapeAll();
