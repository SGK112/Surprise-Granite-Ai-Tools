import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const analyzeImagesAndGenerateEstimate = async (project, images) => {
  try {
    const imageData = images.map((image) => ({
      path: path.resolve(image.path),
      originalname: image.originalname,
    }));

    // Prepare prompt for OpenAI
    const prompt = `
      You are an expert contractor analyzing a ${project.type} remodeling project.
      Based on the provided images and customer needs: ${JSON.stringify(project.formData)},
      generate a detailed estimate including:
      - Itemized costs (materials, labor, etc.)
      - Total estimated cost
      - Estimated timeline
      - Any assumptions or recommendations
      Return the response in a structured JSON format.
    `;

    // Convert images to base64 for OpenAI API
    const imageInputs = imageData.map((img) => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: fs.readFileSync(img.path).toString('base64'),
      },
    }));

    // Call OpenAI API
    const response = await openai.chat.completions.create({
      model: 'gpt-4-vision-preview',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...imageInputs,
          ],
        },
      ],
    });

    const estimateDetails = response.choices[0].message.content;

    // Clean up uploaded images
    imageData.forEach((img) => fs.unlinkSync(img.path));

    return estimateDetails;
  } catch (error) {
    throw new Error(`OpenAI API error: ${error.message}`);
  }
};
