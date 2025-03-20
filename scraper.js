const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");

// Define multiple sources for scraping
const SOURCES = [
  {
    name: "MSI Quartz",
    url: "https://www.msisurfaces.com/quartz-countertops/",
    parse: ($) => $(".product-grid-item").map((i, el) => ({
      name: $(el).find(".product-title").text().trim(),
      description: "Quartz countertop from MSI Surfaces",
      imageUrl: fixImageUrl($(el).find("img").attr("src"), "https://www.msisurfaces.com")
    })).get()
  },
  {
    name: "MSI Granite",
    url: "https://www.msisurfaces.com/granite-countertops/",
    parse: ($) => $(".product-grid-item").map((i, el) => ({
      name: $(el).find(".product-title").text().trim(),
      description: "Granite countertop from MSI Surfaces",
      imageUrl: fixImageUrl($(el).find("img").attr("src"), "https://www.msisurfaces.com")
    })).get()
  },
  {
    name: "Arizona Tile Quartz",
    url: "https://www.arizonatile.com/products/slab/della-terra-quartz/",
    parse: ($) => $(".product-item").map((i, el) => ({
      name: $(el).find(".product-title").text().trim(),
      description: "Quartz countertop from Arizona Tile",
      imageUrl: fixImageUrl($(el).find("img").attr("src"), "https://www.arizonatile.com")
    })).get()
  },
  {
    name: "Daltile Quartz",
    url: "https://www.daltile.com/countertops-product-category/ONE-Quartz-Surfaces",
    parse: ($) => $(".product-grid__item").map((i, el) => ({
      name: $(el).find(".product-tile__title").text().trim(),
      description: "Quartz countertop from Daltile",
      imageUrl: fixImageUrl($(el).find("img").attr("src"), "https://www.daltile.com")
    })).get()
  },
  {
    name: "Cosentino Colors",
    url: "https://www.cosentino.com/usa/colors/",
    parse: ($) => $(".product-color").map((i, el) => ({
      name: $(el).find(".product-color__title").text().trim(),
      description: "Countertop material from Cosentino",
      imageUrl: fixImageUrl($(el).find("img").attr("src"), "https://www.cosentino.com")
    })).get()
  },
  {
    name: "Cambria Quartz",
    url: "https://www.cambriausa.com/quartz-countertops/quartz-colors",
    parse: ($) => $(".product-card").map((i, el) => ({
      name: $(el).find(".product-card__title").text().trim(),
      description: "Quartz countertop from Cambria",
      imageUrl: fixImageUrl($(el).find("img").attr("src"), "https://www.cambriausa.com")
    })).get()
  },
  {
    name: "Arc Surfaces",
    url: "https://arcsurfaces.com/",
    parse: ($) => $(".tile-item").map((i, el) => ({
      name: $(el).find(".tile-title").text().trim(),
      description: "Countertop material from Arc Surfaces",
      imageUrl: fixImageUrl($(el).find("img").attr("src"), "https://arcsurfaces.com")
    })).get()
  },
  {
    name: "Surprise Granite",
    url: "https://www.surprisegranite.com/materials/all-countertops",
    parse: ($) => $(".product-grid-item").map((i, el) => ({
      name: $(el).find(".product-title").text().trim(),
      description: "Countertop from Surprise Granite",
      imageUrl: fixImageUrl($(el).find("img").attr("src"), "https://www.surprisegranite.com")
    })).get()
  }
];

// Fix relative image URLs to absolute URLs
function fixImageUrl(url, baseUrl) {
  if (url && !url.startsWith('http')) {
    return new URL(url, baseUrl).href; // Resolve relative URL to absolute
  }
  return url;
}

async function scrapeColors() {
  let allColors = [];
  
  for (const source of SOURCES) {
    try {
      console.log(`🔍 Scraping from ${source.name}...`);
      
      const { data } = await axios.get(source.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        },
        timeout: 15000  // Set timeout to 15 seconds
      });

      const $ = cheerio.load(data);
      const colors = source.parse($);
      
      if (colors.length > 0) {
        allColors = [...allColors, ...colors];
        console.log(`✅ Scraped ${colors.length} colors from ${source.name}`);
      } else {
        console.warn(`⚠️ No colors found on ${source.name}. The page structure might have changed.`);
      }

    } catch (error) {
      console.error(`❌ Failed to scrape ${source.name}:`, error.message);
    }
  }

  if (allColors.length > 0) {
    fs.writeFileSync("colors.json", JSON.stringify(allColors, null, 2));
    console.log("✅ Colors saved to colors.json");
  } else {
    console.warn("⚠️ No colors scraped. Check website structures or bot protection.");
  }
}

// Run scraper
scrapeColors();
