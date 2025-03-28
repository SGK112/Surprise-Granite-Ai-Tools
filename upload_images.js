const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const sharp = require("sharp");
const axios = require("axios");
const FormData = require("form-data");

const RENDER_URL = "https://surprise-granite-connections-dev.onrender.com/api/upload-countertop";

async function convertAndUploadImages() {
    const imagesDir = path.join(__dirname, "countertop_images");
    const files = await fsPromises.readdir(imagesDir);

    for (const file of files) {
        if (file.endsWith(".avif")) {
            const avifPath = path.join(imagesDir, file);
            const jpegPath = path.join(imagesDir, `${file.replace(".avif", "")}.jpg`);

            try {
                await sharp(avifPath)
                    .jpeg({ quality: 80 })
                    .toFile(jpegPath);
                console.log(`Converted ${file} to JPEG`);

                const form = new FormData();
                const fileBuffer = await fsPromises.readFile(jpegPath);
                form.append("image", fileBuffer, { filename: path.basename(jpegPath), contentType: "image/jpeg" });
                const response = await axios.post(RENDER_URL, form, {
                    headers: form.getHeaders()
                });
                console.log(`Uploaded ${file}: ${response.data.message}, ID: ${response.data.imageId}`);

                await fsPromises.unlink(jpegPath);
            } catch (error) {
                console.error(`Error processing ${file}:`, error.message);
            }
        }
    }
    console.log("All images processed!");
}

convertAndUploadImages();