// ... (imports, setup, and unchanged functions like loadLaborData, connectToMongoDB remain the same)

async function estimateProject(fileData, customerNeeds) {
    try {
        await ensureMongoDBConnection();
        const imagesCollection = db?.collection("countertop_images") || { find: () => ({ sort: () => ({ limit: () => ({ allowDiskUse: () => ({ toArray: async () => [] }) }) }) }) };
        const pastEstimates = await imagesCollection
            .find({ "metadata.estimate.material_type": { $exists: true } })
            .sort({ "metadata.uploadDate": -1 })
            .limit(3)
            .allowDiskUse(true)
            .toArray();
        console.log("Fetched past estimates:", pastEstimates.length);

        const pastData = pastEstimates.map(img => {
            const estimate = img.metadata?.estimate || {};
            return {
                material_type: typeof estimate.material_type === "string" ? estimate.material_type : "Unknown",
                project_scope: typeof estimate.project_scope === "string" ? estimate.project_scope : "Replacement",
                condition: estimate.condition || { damage_type: "No visible damage", severity: "None" },
                additional_features: Array.isArray(estimate.additional_features) ? estimate.additional_features : [],
                solutions: typeof estimate.solutions === "string" ? estimate.solutions : "Professional evaluation required",
                cost: enhanceCostEstimate(estimate)?.totalCost || "Contact for estimate",
                likes: img.metadata.likes || 0,
                dislikes: img.metadata.dislikes || 0,
            };
        });

        const prompt = `You are CARI, an expert AI general contractor at Surprise Granite, specializing in remodeling estimates as of March 2025. Analyze this ${fileData.type === "image" ? "image" : "document text"} and customer needs ("${customerNeeds}") with:

        **Pricing Data**:
        - Labor: ${JSON.stringify(laborData.slice(0, 10))} (limited sample)
        - Materials: ${JSON.stringify(materialsData.slice(0, 10))} (limited sample)

        **Historical Estimates (sample)**: ${JSON.stringify(pastData)}

        Estimate:
        - Project scope (e.g., "countertop installation", "repair")
        - Material type (e.g., "Quartz", "Tile")
        - Color and pattern
        - Dimensions (extract from needs or assume: 25 sq ft countertops, 10 sq ft showers, 5 units cabinets, 100 sq ft flooring)
        - Additional features (array, e.g., ["sink cutout"])
        - Condition (for repairs, { damage_type, severity })
        - Solutions (detailed, modern techniques)
        - Reasoning (explain estimate)

        Respond in JSON with: project_scope, material_type, color_and_pattern, dimensions, additional_features, condition, solutions, reasoning.`;

        const messages = [
            { role: "system", content: prompt },
            { role: "user", content: fileData.type === "image" ? [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${fileData.content}` } }] : fileData.content }
        ];
        const response = await withRetry(() => openai.chat.completions.create({
            model: "gpt-4o",
            messages,
            max_tokens: 2000,
            temperature: 0.5,
            response_format: { type: "json_object" },
        }));

        let result;
        try {
            result = JSON.parse(response.choices[0].message.content || '{}');
        } catch (parseErr) {
            logError("Failed to parse OpenAI response", parseErr);
            result = {};
        }

        const estimate = {
            project_scope: typeof result.project_scope === "string" ? result.project_scope : "Replacement",
            material_type: typeof result.material_type === "string" ? result.material_type : "Unknown",
            color_and_pattern: typeof result.color_and_pattern === "string" ? result.color_and_pattern : "Not identified",
            dimensions: typeof result.dimensions === "string" ? result.dimensions : (customerNeeds.includes("shower") ? "10 sq ft (assumed)" : "25 sq ft (assumed)"),
            additional_features: Array.isArray(result.additional_features) ? result.additional_features : [],
            condition: result.condition && typeof result.condition === "object" ? result.condition : { damage_type: "No visible damage", severity: "None" },
            solutions: typeof result.solutions === "string" ? result.solutions : "Contact for professional evaluation.",
            reasoning: typeof result.reasoning === "string" ? result.reasoning : "Based on default assumptions."
        };
        console.log("Generated estimate:", JSON.stringify(estimate, null, 2));
        return estimate;
    } catch (err) {
        logError("Estimate generation failed", err);
        const assumedDimensions = customerNeeds.includes("shower") ? "10 sq ft (assumed)" : "25 sq ft (assumed)";
        const fallbackEstimate = {
            project_scope: "Replacement",
            material_type: "Unknown",
            color_and_pattern: "Not identified",
            dimensions: assumedDimensions,
            additional_features: [],
            condition: { damage_type: "No visible damage", severity: "None" },
            solutions: "Contact for professional evaluation.",
            reasoning: `Estimate failed: ${err.message}. Assumed default dimensions based on context.`
        };
        console.log("Fallback estimate:", JSON.stringify(fallbackEstimate, null, 2));
        return fallbackEstimate;
    }
}

function enhanceCostEstimate(estimate) {
    if (!estimate || typeof estimate !== "object" || !laborData.length || !materialsData.length) {
        logError("Invalid inputs in enhanceCostEstimate", { laborData, materialsData, estimate });
        return null;
    }

    const materialType = typeof estimate.material_type === "string" ? estimate.material_type : "Unknown";
    const projectScope = typeof estimate.project_scope === "string" ? estimate.project_scope : "replacement";
    console.log("Enhancing cost estimate for:", { materialType, projectScope });

    const dimensions = typeof estimate.dimensions === "string" ? estimate.dimensions : "25 sq ft";
    const sqFtMatch = dimensions.match(/(\d+)-?(\d+)?\s*sq\s*ft/i);
    const unitMatch = dimensions.match(/(\d+)\s*units?/i);
    const sqFt = sqFtMatch ? (sqFtMatch[2] ? (parseInt(sqFtMatch[1], 10) + parseInt(sqFtMatch[2], 10)) / 2 : parseInt(sqFtMatch[1], 10)) : 25;
    const units = unitMatch ? parseInt(unitMatch[1], 10) : 0;
    console.log(`Calculated sq ft: ${sqFt}, units: ${units}`);

    const material = materialsData.find(m => (m.type || "").toLowerCase() === materialType.toLowerCase()) || { cost_per_sqft: 50, cost_per_unit: 0, confidence: 1 };
    const materialCost = ((material.cost_per_sqft || 0) * sqFt + (material.cost_per_unit || 0) * units) * 1.3;

    let laborCost = 0;
    if (projectScope.toLowerCase().includes("repair") && estimate.condition?.damage_type && estimate.condition.damage_type !== "No visible damage") {
        const damageType = typeof estimate.condition.damage_type === "string" ? estimate.condition.damage_type : "";
        const laborEntry = laborData.find(entry => (entry.type || "").toLowerCase() === damageType.toLowerCase()) || { rate_per_sqft: 15, hours: 1, confidence: 1 };
        const severityMultiplier = { None: 0, Low: 1, Moderate: 2, Severe: 3 }[estimate.condition.severity || "None"] || 1;
        laborCost = (laborEntry.rate_per_sqft || 0) * sqFt * laborEntry.hours * severityMultiplier * (laborEntry.confidence || 1);
    } else {
        const laborEntry = laborData.find(entry => projectScope.toLowerCase().includes((entry.type || "").toLowerCase())) || { rate_per_sqft: 15, rate_per_unit: 0, hours: 1, confidence: 1 };
        laborCost = ((laborEntry.rate_per_sqft || 0) * sqFt + (laborEntry.rate_per_unit || 0) * units) * laborEntry.hours * (laborEntry.confidence || 1);
    }

    const featuresCost = (estimate.additional_features || []).reduce((sum, feature) => {
        const featureStr = typeof feature === "string" ? feature : "";
        const laborEntry = laborData.find(entry => featureStr.toLowerCase().includes((entry.type || "").toLowerCase())) || { rate_per_sqft: 0, confidence: 1 };
        return sum + (laborEntry.rate_per_sqft * sqFt * (laborEntry.confidence || 1) || 0);
    }, 0);

    const totalCost = materialCost + laborCost + featuresCost;
    const costEstimate = {
        materialCost: `$${materialCost.toFixed(2)}`,
        laborCost: { total: `$${laborCost.toFixed(2)}` },
        additionalFeaturesCost: `$${featuresCost.toFixed(2)}`,
        totalCost: `$${totalCost.toFixed(2)}`
    };
    console.log("Cost estimate generated:", JSON.stringify(costEstimate, null, 2));
    return costEstimate;
}

app.post("/api/contractor-estimate", upload.single("file"), async (req, res, next) => {
    try {
        await ensureMongoDBConnection();
        if (!req.file) throwError("No file uploaded", 400);

        const fileData = await extractFileContent(req.file);
        const customerNeeds = (req.body.customer_needs || "").trim();
        const fileHash = createHash("sha256").update(fileData.content).digest("hex");
        const cacheKey = `estimate_${fileHash}_${customerNeeds.slice(0, 50).replace(/[^a-zA-Z0-9]/g, '')}`;

        let estimate = cache.get(cacheKey);
        if (!estimate) {
            estimate = await estimateProject(fileData, customerNeeds);
            cache.set(cacheKey, estimate);
        }

        const imagesCollection = db?.collection("countertop_images");
        if (imagesCollection) {
            const fileDoc = {
                fileHash,
                fileData: new Binary(req.file.buffer),
                metadata: {
                    originalName: req.file.originalname,
                    mimeType: req.file.mimetype,
                    size: req.file.size,
                    uploadDate: new Date(),
                    estimate,
                    likes: 0,
                    dislikes: 0,
                },
            };
            const insertResult = await imagesCollection.insertOne(fileDoc);
            estimate.imageId = insertResult.insertedId;
        } else {
            console.warn("MongoDB not available; skipping image storage.");
            estimate.imageId = null;
        }

        const costEstimate = enhanceCostEstimate(estimate) || {
            materialCost: "Contact for estimate",
            laborCost: { total: "Contact for estimate" },
            additionalFeaturesCost: "$0",
            totalCost: "Contact for estimate"
        };

        const audioBuffer = await generateTTS(estimate, customerNeeds);

        const responseData = {
            imageId: estimate.imageId?.toString() || null,
            message: "Estimate generated successfully",
            projectScope: estimate.project_scope,
            materialType: estimate.material_type,
            colorAndPattern: estimate.color_and_pattern,
            dimensions: estimate.dimensions,
            additionalFeatures: estimate.additional_features.join(", ") || "None",
            condition: estimate.condition,
            costEstimate,
            reasoning: estimate.reasoning,
            solutions: estimate.solutions,
            contact: `Contact Surprise Granite at ${SURPRISE_GRANITE_PHONE} for a full evaluation.`,
            audioBase64: audioBuffer.toString("base64"),
            shareUrl: estimate.imageId ? `${req.protocol}://${req.get("host")}/api/get-countertop/${estimate.imageId}` : null,
            likes: 0,
            dislikes: 0,
        };
        res.status(201).json(responseData);
    } catch (err) {
        if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
            return res.status(400).json({ error: "File size exceeds 10MB limit" });
        }
        logError("Error in /api/contractor-estimate", err);
        next(err);
    }
});

// ... (rest of the file: generateTTS, chunkText, error middleware, startup/shutdown remain unchanged)
