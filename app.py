from flask import Flask, request, jsonify
import os
import openai
from flask_cors import CORS

app = Flask(__name__)

# Enable CORS for specific domains
CORS(app, resources={r"/*": {"origins": ["https://www.surprisegranite.com", "https://www.remodely.ai"]}})

# Load OpenAI API Key from environment variables
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise ValueError("Missing OpenAI API Key. Please set it in environment variables.")

# Set the API key for the OpenAI library (do not use openai.Client)
openai.api_key = OPENAI_API_KEY

@app.route("/")
def home():
    return "<h1>Surprise Granite AI Chatbot</h1><p>Your AI assistant is ready.</p>"

@app.route("/chat", methods=["POST"])
def chat():
    data = request.json
    user_input = data.get("message", "")
    if not user_input:
        return jsonify({"error": "Missing user input"}), 400
    try:
        response = openai.ChatCompletion.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are a helpful remodeling assistant."},
                {"role": "user", "content": user_input}
            ]
        )
        return jsonify({"response": response.choices[0].message.content})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# New Estimator Endpoint
@app.route("/api/estimate", methods=["POST", "OPTIONS"])
def estimate():
    data = request.json
    if not data or not data.get("totalSqFt"):
        return jsonify({"error": "Missing project data"}), 400
    try:
        # Extract and process input data
        total_sq_ft = float(data.get("totalSqFt", 0))
        vendor = data.get("vendor", "default vendor")
        color = data.get("color", "default color")
        demo = data.get("demo", "no")
        sink_cutout = float(data.get("sinkCutout", 0))
        cooktop_cutout = float(data.get("cooktopCutout", 0))
        edge_detail = data.get("edgeDetail", "standard")

        # Preliminary cost calculations (customize as needed)
        material_cost = total_sq_ft * 50  # Example: $50 per sqft
        if demo.lower() == "yes":
            material_cost *= 1.10  # 10% extra if demo is required
        sink_cost = sink_cutout * 50       # Example: $50 per sqft for sink cutout
        cooktop_cost = cooktop_cutout * 75   # Example: $75 per sqft for cooktop cutout
        
        if edge_detail.lower() == "premium":
            multiplier = 1.05
        elif edge_detail.lower() == "custom":
            multiplier = 1.10
        else:
            multiplier = 1.0
        material_cost *= multiplier
        
        preliminary_total = material_cost + sink_cost + cooktop_cost
        
        # Calculate the number of slabs needed (assuming a fixed slab size)
        slab_size = 100  # Example slab size in sqft
        slab_count = int((total_sq_ft + slab_size - 1) // slab_size)

        # Build a prompt for GPT-4 to generate a narrative estimate
        prompt = (
            f"Customer: {data.get('customerName', 'N/A')}\n"
            f"Project Area: {total_sq_ft} sq ft\n"
            f"Vendor: {vendor}\n"
            f"Color: {color}\n"
            f"Demo Required: {demo}\n"
            f"Sink Cutout: {sink_cutout} sq ft\n"
            f"Cooktop Cutout: {cooktop_cutout} sq ft\n"
            f"Edge Detail: {edge_detail}\n"
            f"Material Cost: ${material_cost:.2f}\n"
            f"Sink Cost: ${sink_cost:.2f}\n"
            f"Cooktop Cost: ${cooktop_cost:.2f}\n"
            f"Preliminary Total: ${preliminary_total:.2f}\n"
            f"Slab Count: {slab_count}\n\n"
            "Generate a detailed, professional estimate that includes a breakdown of costs, "
            "notes on installation, and a personalized message for the customer."
        )

        ai_response = openai.ChatCompletion.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are an expert estimator in remodeling and construction."},
                {"role": "user", "content": prompt}
            ]
        )
        narrative = ai_response.choices[0].message.content

        return jsonify({
            "preliminary": {
                "material_cost": material_cost,
                "sink_cost": sink_cost,
                "cooktop_cost": cooktop_cost,
                "preliminary_total": preliminary_total,
                "slab_count": slab_count
            },
            "estimate": narrative
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
