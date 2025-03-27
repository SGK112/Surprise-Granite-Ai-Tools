const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");

// MongoDB connection details
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
        const images_dir = path.join(__dirname, "countertop_images");
        const files = fs.readdirSync(images_dir).filter(file => file.endsWith("_scene.avif"));

        // Generate metadata for each image
        const countertops = files.map(file => {
            const base_name = file.replace("_scene.avif", "");
            const product_name = base_name
                .split("_")
                .map(word => word.charAt(0).toUpperCase() + word.slice(1))
                .join(" ");

            // Infer material based on name (simplified logic, can be improved)
            let material = "granite"; // Default
            if (base_name.toLowerCase().includes("calacatta") || base_name.toLowerCase().includes("carrara")) {
                material = "marble";
            } else if (base_name.toLowerCase().includes("quartz")) {
                material = "quartz";
            }

            // Infer veining based on name (simplified logic)
            let veining = "moderate veining/speckles"; // Default
            if (base_name.toLowerCase().includes("no_veining")) {
                veining = "no veining";
            } else if (base_name.toLowerCase().includes("dramatic")) {
                veining = "dramatic veining";
            }

            // Infer colors based on name (simplified logic, can be improved with image analysis)
            let primary_color = "200,200,200"; // Default gray
            let secondary_color = "100,100,100"; // Default darker gray
            if (base_name.toLowerCase().includes("white")) {
                primary_color = "240,240,240";
                secondary_color = "180,180,180";
            } else if (base_name.toLowerCase().includes("black")) {
                primary_color = "0,0,0";
                secondary_color = "50,50,50";
            } else if (base_name.toLowerCase().includes("brown") || base_name.toLowerCase().includes("beige")) {
                primary_color = "245,222,179"; // Beige
                secondary_color = "139,69,19"; // Brown
            }

            return {
                product_name: product_name,
                material: material,
                brand: "Surprise Granite",
                veining: veining,
                primary_color: primary_color,
                secondary_color: secondary_color,
                scene_image_path: `/countertop_images/${file}`
            };
        });

        // Insert into MongoDB
        await collection.insertMany(countertops);
        console.log(`Inserted ${countertops.length} countertops into ${collection_name}`);
    } catch (err) {
        console.error("Error populating countertops:", err.message, err.stack);
        throw err; // Re-throw the error to be caught in server.js
    } finally {
        if (client) await client.close();
        console.log("MongoDB connection closed");
    }
}

// Export the function so it can be imported in server.js
module.exports = { populatecountertops };
