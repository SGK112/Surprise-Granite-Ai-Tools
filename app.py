from flask import Flask, request, jsonify
import os
import openai
from flask_cors import CORS
import requests, csv
from io import StringIO
import math

app = Flask(__name__)

# List your approved domains (exactly as they appear in the browser)
approved_origins = [
    "https://www.surprisegranite.com",
    "https://www.remodely.ai"
]

# Enable CORS for all routes with the approved origins
CORS(app, resources={r"/*": {"origins": approved_origins}})

# Load OpenAI API Key from environment variables
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise ValueError("Missing OpenAI API Key. Please set it in environment variables.")

openai.api_key = OPENAI_API_KEY

def get_pricing_data():
    """
    Fetch pricing data from the Google Sheets CSV.
    Expected CSV columns:
      Color Name, Vendor Name, Thickness, Material, size, Total/SqFt, Cost/SqFt, Price Group, Tier
    We use the lowercased "Color Name" as the key and store:
      - "cost": Cost per square foot (as a float)
      - "total_sqft": The total square footage available per color option (as a float)
    """
    url = ("https://docs.google.com/spreadsheets/d/e/"
           "2PACX-1vRWyYuTQxC8_fKNBg9_aJiB7NMFztw6mgdhN35lo8sRL45MvncRg4D217lopZxuw39j5aJTN6TP4Elh"
           "/pub?output=csv")
    response = requests.get(url)
    if response.status_code != 200:
        raise Exception("Could not fetch pricing data")
    csv_text = response.text
    csv_file = StringIO(csv_text)
    reader = csv.DictReader(csv_file)
    pricing = {}
    for row in reader:
        color = row["Color Name"].strip().lower()
        try:
            cost_sqft = float(row["Cost/SqFt"])
        except Exception:
            cost_sqft = 50.0
        try:
            color_total_sqft = float(row["Total/SqFt"])
        except Exception:
            color_total_sqft = 100.0
        pricing[color] = {"cost": cost_sqft, "total_sqft": color_total_sqft}
    return pricing

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

@app.route("/api/estimate", methods=["POST", "OPTIONS"])
def estimate():
    # Respond to preflight OPTIONS requests
    if request.method == "OPTIONS":
        return jsonify({}), 200

    data = request.json
    if not data or not data.get("totalSqFt"):
        return jsonify({"error": "Missing project data"}), 400

    try:
        # Extract input data
        total_sq_ft = float(data.get("totalSqFt"))
        vendor = data.get("vendor", "default vendor")
        color = data.get("color", "").strip().lower()
        demo = data.get("demo", "no")
        sink_qty = float(data.get("sinkQty", 0))
        cooktop_qty = float(data.get("cooktopQty", 0))
        sink_type = data.get("sinkType", "standard")
        cooktop_type = data.get("cooktopType", "standard")
        backsplash = data.get("backsplash", "no")
        edge_detail = data.get("edgeDetail", "standard")

        # Get pricing data from CSV
        pricing_data = get_pricing_data()
        pricing_info = pricing_data.get(color, {"cost": 50, "total_sqft": 100})
        price_per_sqft = pricing_info["cost"]
        color_total_sqft = pricing_info["total_sqft"]

        # Calculate material cost and adjustments
        material_cost = total_sq_ft * price_per_sqft
        if demo.lower() == "yes":
            material_cost *= 1.10  # add 10% for demo
        sink_cost = sink_qty * (150 if sink_type.lower() == "premium" else 100)
        cooktop_cost = cooktop_qty * (160 if cooktop_type.lower() == "premium" else 120)
        backsplash_cost = total_sq_ft * 20 if backsplash.lower() == "yes" else 0

        if edge_detail.lower() == "premium":
            multiplier = 1.05
        elif edge_detail.lower() == "custom":
            multiplier = 1.10
        else:
            multiplier = 1.0
        material_cost *= multiplier

        preliminary_total = material_cost + sink_cost + cooktop_cost + backsplash_cost

        # Calculate slab count (accounting for 20% waste)
        effective_sq_ft = total_sq_ft * 1.20
        slab_count = math.ceil(effective_sq_ft / color_total_sqft)

        # Build prompt for GPT‑4 narrative estimate
        prompt = (
            f"Customer: {data.get('customerName', 'N/A')}\n"
            f"Job Name: {data.get('jobName', 'N/A')}\n"
            f"Job Type: {data.get('jobType', 'fabricate and install')}\n"
            f"Project Area: {total_sq_ft} sq ft (with 20% waste: {effective_sq_ft:.2f} sq ft)\n"
            f"Vendor: {vendor}\n"
            f"Color: {color.title()}\n"
            f"Demo Required: {demo}\n"
            f"Sink Count: {sink_qty} ({sink_type})\n"
            f"Cooktop Count: {cooktop_qty} ({cooktop_type})\n"
            f"Backsplash: {backsplash}\n"
            f"Edge Detail: {edge_detail}\n"
            f"Price per Sq Ft for {color.title()}: ${price_per_sqft:.2f}\n"
            f"Material Cost: ${material_cost:.2f}\n"
            f"Sink Cost: ${sink_cost:.2f}\n"
            f"Cooktop Cost: ${cooktop_cost:.2f}\n"
            f"Backsplash Cost: ${backsplash_cost:.2f}\n"
            f"Preliminary Total: ${preliminary_total:.2f}\n"
            f"Slab Count: {slab_count}\n\n"
            "Generate a detailed, professional estimate that includes a breakdown of material and labor costs, "
            "installation notes, and a personalized message for the customer."
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
                "backsplash_cost": backsplash_cost,
                "preliminary_total": preliminary_total,
                "slab_count": slab_count
            },
            "estimate": narrative
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
