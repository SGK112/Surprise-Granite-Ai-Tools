from flask import Flask, request, jsonify
import os
import openai
from flask_cors import CORS
import requests, csv
from io import StringIO

app = Flask(__name__)

# Enable CORS for specific domains
CORS(app, resources={r"/*": {"origins": ["https://www.surprisegranite.com", "https://www.remodely.ai"]}})

# Load OpenAI API Key from environment variables
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise ValueError("Missing OpenAI API Key. Please set it in environment variables.")

# Set the API key for the OpenAI library
openai.api_key = OPENAI_API_KEY

def get_pricing_data():
    """
    Fetch pricing data from the Google Sheets CSV.
    Expected CSV columns include "Material" and "Cost/SqFt".
    For example:
       Material: granite and quartz, Cost/SqFt: 45
       Material: quartzite and marble, Cost/SqFt: 65
       Material: dekton and porcelain, Cost/SqFt: 85
    """
    url = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRWyYuTQxC8_fKNBg9_aJiB7NMFztw6mgdhN35lo8sRL45MvncRg4D217lopZxuw39j5aJTN6TP4Elh/pub?output=csv"
    response = requests.get(url)
    if response.status_code != 200:
        raise Exception("Could not fetch pricing data")
    csv_text = response.text
    csv_file = StringIO(csv_text)
    reader = csv.DictReader(csv_file)
    pricing = {}
    for row in reader:
        material = row["Material"].strip().lower()
        price = float(row["Cost/SqFt"])
        pricing[material] = price
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
        lower_input = user_input.lower()
        # If pricing-related keywords are detected, append pricing data to the system prompt.
        if any(keyword in lower_input for keyword in ["price", "cost", "estimate"]):
            try:
                pricing_data = get_pricing_data()
                pricing_summary = ", ".join([f"{mat.title()}: ${price}" for mat, price in pricing_data.items()])
                system_message = (
                    "You are a helpful remodeling assistant. "
                    "When answering pricing questions, refer to the following pricing data: " + pricing_summary + "."
                )
            except Exception as ex:
                system_message = "You are a helpful remodeling assistant."
                print("Error fetching pricing data:", ex)
        else:
            system_message = "You are a helpful remodeling assistant."
            
        response = openai.ChatCompletion.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_input}
            ]
        )
        return jsonify({"response": response.choices[0].message.content})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/estimate", methods=["POST", "OPTIONS"])
def estimate():
    if request.method == "OPTIONS":
        return jsonify({}), 200

    data = request.json
    if not data or not data.get("totalSqFt"):
        return jsonify({"error": "Missing project data"}), 400
    try:
        total_sq_ft = float(data.get("totalSqFt", 0))
        vendor = data.get("vendor", "default vendor")
        color = data.get("color", "default color")
        demo = data.get("demo", "no").lower()
        customer_name = data.get("customerName", "N/A")
        
        # New fields:
        material_type = data.get("materialType", "granite and quartz").strip().lower()
        sink_qty = float(data.get("sinkQty", 0))
        cooktop_qty = float(data.get("cooktopQty", 0))
        sink_type = data.get("sinkType", "standard").lower()
        cooktop_type = data.get("cooktopType", "standard").lower()
        backsplash = data.get("backsplash", "no").lower()
        edge_detail = data.get("edgeDetail", "standard").lower()

        pricing_data = get_pricing_data()
        price_per_sqft = pricing_data.get(material_type, 50)
        
        material_cost = total_sq_ft * price_per_sqft
        if demo == "yes":
            material_cost *= 1.10

        if edge_detail == "premium":
            edge_multiplier = 1.05
        elif edge_detail == "custom":
            edge_multiplier = 1.10
        else:
            edge_multiplier = 1.0
        material_cost *= edge_multiplier

        sink_cost = sink_qty * (150 if sink_type == "premium" else 100)
        cooktop_cost = cooktop_qty * (160 if cooktop_type == "premium" else 120)
        backsplash_cost = total_sq_ft * 20 if backsplash == "yes" else 0

        preliminary_total = material_cost + sink_cost + cooktop_cost + backsplash_cost

        slab_size = 100  
        slab_count = int((total_sq_ft + slab_size - 1) // slab_size)

        prompt = (
            f"Customer: {customer_name}\n"
            f"Project Area: {total_sq_ft} sq ft\n"
            f"Vendor: {vendor}\n"
            f"Color: {color}\n"
            f"Material Type: {material_type}\n"
            f"Price per Sq Ft for {material_type}: ${price_per_sqft:.2f}\n"
            f"Demo Required: {demo}\n"
            f"Edge Detail: {edge_detail}\n"
            f"Material Cost (after adjustments): ${material_cost:.2f}\n"
            f"Sink Cuts (Qty): {sink_qty} ({sink_type})\n"
            f"Sink Cost: ${sink_cost:.2f}\n"
            f"Cooktop Cuts (Qty): {cooktop_qty} ({cooktop_type})\n"
            f"Cooktop Cost: ${cooktop_cost:.2f}\n"
            f"Backsplash: {backsplash}\n"
            f"Backsplash Cost: ${backsplash_cost:.2f}\n"
            f"Preliminary Total: ${preliminary_total:.2f}\n"
            f"Slab Count: {slab_count}\n\n"
            "Generate a detailed, professional estimate that includes a breakdown of costs, "
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
