import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function analyzeImagesAndGenerateEstimate(project, images) {
  try {
    // Mock estimate if OpenAI key is unavailable
    if (!process.env.OPENAI_API_KEY) {
      console.warn('OPENAI_API_KEY missing, using mock estimate');
      return {
        materialCost: 1000,
        laborCost: 500,
        additionalServices: 250,
        total: 1000 * 3.25 + 26 + 500 + 250,
      };
    }

    const prompt = `
      You are an expert in granite countertop estimation for Surprise Granite.
      Analyze the provided images and project details to generate a detailed estimate.
      Project Type: ${project.type}
      Customer Needs: ${JSON.stringify(project.formData)}
      Image URLs: ${images.map((img) => img.url).join(', ')}
      Apply the following pricing:
      - Material cost: Base cost * 3.25 + $26 for installed pricing
      - Pro setup: $250
      - Additional services: Cost * 1.65, minimum $250
      Provide a JSON object with materialCost, laborCost, additionalServices, and total.
    `;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            ...images.map((img) => ({
              type: 'image_url',
              image_url: { url: img.url },
            })),
          ],
        },
      ],
      max_tokens: 500,
      response_format: { type: 'json_object' },
    });

    const estimateDetails = JSON.parse(response.choices[0].message.content);
    return estimateDetails;
  } catch (error) {
    console.error('OpenAI API error:', error.message);
    throw new Error('Failed to generate estimate');
  }
}
