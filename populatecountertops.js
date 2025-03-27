require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

// MongoDB connection
const mongo_uri = process.env.MONGODB_URI || "mongodb://localhost:27017";
const db_name = "countertops";
const collection_name = "countertops.images";

async function populatecountertops() {
    let client;
    try {
        // Connect to MongoDB
        client = new MongoClient(mongo_uri, {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            connectTimeoutMS: 10000,
        });
        await client.connect();
        console.log("Connected to MongoDB");
        const db = client.db(db_name);
        const collection = db.collection(collection_name);

        // Clear existing documents (optional, comment out if you want to keep existing data)
        await collection.deleteMany({});
        console.log("Cleared existing documents in countertops.images");

        // Read all .avif files in countertop_images/
        const imagesDir = path.join(__dirname, "countertop_images");
        const files = fs.readdirSync(imagesDir).filter(file => file.endsWith("_scene.avif"));

        // Generate metadata for each image
        const countertops = files.map(file => {
            const baseName = file.replace("_scene.avif", "");
            const productName = baseName
                .split("_")
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(" ");

            // Infer material based on name (simplified logic, can be improved)
            let material = "granite"; // Default
            if (baseName.toLowerCase().includes("calacatta") || baseName.toLowerCase().includes("carrara")) {
                material = "marble";
            } else if (baseName.toLowerCase().includes("quartz")) {
                material = "quartz";
            }

            // Infer veining based on name (simplified logic)
            let veining = "moderate veining/speckles"; // Default
            if (baseName.toLowerCase().includes("no_veining")) {
                veining = "no veining";
            } else if (baseName.toLowerCase().includes("dramatic")) {
                veining = "dramatic veining";
            }

            // Infer colors based on name (simplified logic, can be improved with image analysis)
            let primaryColor = "200,200,200"; // Default gray
            let secondaryColor = "100,100,100"; // Default darker gray
            if (baseName.toLowerCase().includes("white")) {
                primaryColor = "240,240,240";
                secondaryColor = "180,180,180";
            } else if (baseName.toLowerCase().includes("black")) {
                primaryColor = "0,0,0";
                secondaryColor = "50,50,50";
            } else if (baseName.toLowerCase().includes("brown") || baseName.toLowerCase().includes("beige")) {
                primaryColor = "245,222,179"; // Beige
                secondaryColor = "139,69,19"; // Brown
            }

            return {
                product_name: productName,
                material: material,
                brand: "Surprise Granite",
                veining: veining,
                primary_color: primaryColor,
                secondary_color: secondaryColor,
                scene_image_path: `/countertop_images/${file}`
            };
        });

        // Insert into MongoDB
        await collection.insertMany(countertops);
        console.log(`Inserted ${countertops.length} countertops into ${collection_name}`);
    } catch (err) {
        console.error("Error populating countertops:", err.message, err.stack);
    } finally {
        if (client) await client.close();
        console.log("MongoDB connection closed");
    }
}

populatecountertops();
