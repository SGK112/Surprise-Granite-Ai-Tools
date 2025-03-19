const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs");

// Define multiple sources for scraping
const SOURCES = [
  {
    name: "MSI Quartz",
    url: "https://www.msisurfaces.com/quartz-countertops/",
    parse: ($) => $(".product-grid-item").map((i, el) => ({
      name: $(el).find(".product-title").text().trim(),
      description: "Quartz countertop from MSI Surfaces",
      imageUrl: $(el).find("img").attr("src")
    })).get()
  },
  {
    name: "MSI Granite",
    url: "https://www.msisurfaces.com/granite-countertops/",
    parse: ($) => $(".product-grid-item").map((i, el) => ({
      name: $(el).find(".product-title").text().trim(),
      description: "Granite countertop from MSI Surfaces",
      imageUrl: $(el).find("img").attr("src")
    })).get()
  },
  {
    name: "Arizona Tile Quartz",
    url: "https://www.arizonatile.com/products/slab/della-terra-quartz/",
    parse: ($) => $(".product-item").map((i, el) => ({
      name: $(el).find(".product-title").text().trim(),
      description: "Quartz countertop from Arizona Tile",
      imageUrl: $(el).find("img").attr("src")
    })).get()
  },
  {
    name: "Daltile Quartz",
    url: "https://www.daltile.com/countertops-product-category/ONE-Quartz-Surfaces",
    parse: ($) => $(".product-grid__item").map((i, el) => ({
      name: $(el).find(".product-tile__title").text().trim(),
      description: "Quartz countertop from Daltile",
      imageUrl: $(el).find("img").attr("src")
    })).get()
  },
  {
    name: "Cosentino Colors",
    url: "https://www.cosentino.com/usa/colors/",
    parse: ($) => $(".product-color").map((i, el) => ({
      name: $(el).find(".product-color__title").text().trim(),
      description: "Countertop material from Cosentino",
      imageUrl: $(el).find("img").attr("src")
    })).get()
  },
  {
    name: "Cambria Quartz",
    url: "https://www.cambriausa.com/quartz-countertops/quartz-colors",
    parse: ($) => $(".product-card").map((i, el) => ({
      name: $(el).find(".product-card__title").text().trim(),
      description: "Quartz countertop from Cambria",
      imageUrl: $(el).find("img").attr("src")
    })).get()
  },
  {
    name: "Arc Surfaces",
    url: "https://arcsurfaces.com/",
    parse: ($) => $(".tile-item").map((i, el) => ({
      name: $(el).find(".tile-title").text().trim(),
      description: "Countertop material from Arc Surfaces",
      imageUrl: $(el).find("img").attr("src")
    })).get()
  },
  {
    name: "Surprise Granite",
    url: "https://www.surprisegranite.com/materials/all-countertops",
    parse: ($) => $(".product-grid-item").map((i, el) => ({
      name: $(el).find(".product-title").text().trim(),
      description: "Countertop from Surprise Granite",
      imageUrl: $(el).find("img").attr("src")
    })).get()
  }
];

async function scrapeColors() {
  let allColors = [];
  
  for (const source of SOURCES) {
    try {
      console.log(`🔍 Scraping from ${source.name}...`);
      const { data } = await axios.get(source.url);
      const $ = cheerio.load(data);
      const colors = source.parse($);
      
      allColors = [...allColors, ...colors];
      console.log(`✅ Scraped ${colors.length} colors from ${source.name}`);
    } catch (error) {
      console.error(`❌ Failed to scrape ${source.name}:`, error.message);
    }
  }

  if (allColors.length > 0) {
    fs.writeFileSync("colors.json", JSON.stringify(allColors, null, 2));
    console.log("✅ Colors saved to colors.json");
  } else {
    console.log("⚠️ No colors scraped.");
  }
}

// Run scraper
scrapeColors();
