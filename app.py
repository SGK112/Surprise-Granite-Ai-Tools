from flask import Flask, request, jsonify
import os
import openai
from flask_cors import CORS
import requests, csv, math
from io import StringIO
import argparse

app = Flask(__name__)

# Approved domains exactly as they appear in the browser
approved_origins = [
    "https://www.surprisegranite.com",
    "https://www.remodely.ai"
]

# Enable CORS for all routes for the approved origins
CORS(app, resources={r"/*": {"origins": approved_origins}})

# Load OpenAI API Key from environment variables
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise ValueError("Missing OpenAI API Key. Please set it in environment variables.")
openai.api_key = OPENAI_API_KEY

# --- Helper functions ---
def safe_str(val, default=""):
    return str(val) if val is not None else default

def safe_float(val, default=0.0):
    try:
        return float(val)
    except (TypeError, ValueError):
        return default

# --- Static Pricing Data for Materials (fallback) ---
STATIC_PRICING_CSV = """Color Name,Vendor Name,Thickness,Material,size,Total/SqFt,Cost/SqFt,Price Group,Tier
Frost-N,Arizona Tile,3cm,Quartz,"126 x 63",55.13,10.24,2,Low Tier
Gemstone Beige-N,Arizona Tile,1.5cm,Quartz,"126 x 63",55.13,6.05,1,Low Tier
Oceana-N,Arizona Tile,2cm,Quartz,"126 x 63",55.13,7.90,1,Low Tier
Steel-N,Arizona Tile,3cm,Quartz,"126 x 63",55.13,10.24,2,Low Tier
White Sand-N,Arizona Tile,2cm,Quartz,"138 x 79",75.71,7.90,1,Low Tier
"""

def get_static_pricing_data():
    """Parses the static pricing CSV and returns a dictionary keyed by color (lowercase)."""
    pricing = {}
    csv_file = StringIO(STATIC_PRICING_CSV)
    reader = csv.DictReader(csv_file)
    for row in reader:
        color = row["Color Name"].strip().lower()
        cost_sqft = safe_float(row.get("Cost/SqFt"), 50.0)
        total_sqft = safe_float(row.get("Total/SqFt"), 100.0)
        pricing[color] = {"cost": cost_sqft, "total_sqft": total_sqft}
    return pricing

def get_pricing_data():
    """
    Fetch pricing data from the published Google Sheets CSV.
    Only pull the necessary columns: "Color Name", "Cost/SqFt", "Total/SqFt".
    If fetching fails, fall back to static pricing data.
    """
    url = (
        "https://docs.google.com/spreadsheets/d/e/"
        "2PACX-1vRWyYuTQxC8_fKNBg9_aJiB7NMFztw6mgdhN35lo8sRL45MvncRg4D217lopZxuw39j5aJTN6TP4Elh"
        "/pub?output=csv"
    )
    try:
        response = requests.get(url, timeout=10)
        if response.status_code != 200:
            raise Exception("Could not fetch pricing data")
        csv_text = response.text
        csv_file = StringIO(csv_text)
        reader = csv.DictReader(csv_file)
        pricing = {}
        for row in reader:
            color = row["Color Name"].strip().lower()
            cost_sqft = safe_float(row.get("Cost/SqFt"), 50.0)
            total_sqft = safe_float(row.get("Total/SqFt"), 100.0)
            pricing[color] = {"cost": cost_sqft, "total_sqft": total_sqft}
        return pricing
    except Exception as e:
        print("Falling back to static pricing data due to error:", e)
        return get_static_pricing_data()

# --- Static Service Pricing Data ---
STATIC_SERVICE_PRICING_CSV = """Code,Service,U/M,Price,Description
CT-001,Quartz Countertop Fabrication,SQFT,$45.00,Standard quartz countertop cuts with edge finishing for durability and elegance.
CT-002,Granite Countertop Fabrication,SQFT,$55.00,Includes edge finishing, polishing, and sealing for natural stone.
CT-003,Marble Countertop Fabrication,SQFT,$65.00,Precision fabrication for delicate, high-maintenance marble countertops.
CT-004,Porcelain/Dekton Countertop Fabrication,SQFT,$85.00,Requires advanced handling and techniques for seamless, modern finishes.
CT-005,Custom Island Fabrication,Per Job,$1,000.00+,For large or uniquely shaped countertop pieces tailored to specific designs.
CT-006,Countertop Installation,Per SQFT,$37.50+,Professional placement, securing, and seam polishing for a flawless finish.
CT-007,Undermount Sink Cutout,EA.,$574.00,Includes precision cutting and polishing for a seamless sink integration.
CT-008,Farmhouse Sink Cutout,EA.,$674.00,Custom cutouts for large, apron-front farmhouse sinks.
CT-009,Cooktop Cutout,EA.,$150.00,Precision cutting for stovetops or custom appliance integration.
CT-010,Countertop Sealing,Per SQFT,$12.00+,Protects natural stone countertops from stains and damage, extending lifespan.
"""

def get_service_pricing_data():
    """Parses the static service pricing CSV and returns a list of dictionaries."""
    csv_file = StringIO(STATIC_SERVICE_PRICING_CSV)
    reader = csv.DictReader(csv_file)
    return [row for row in reader]

# Force JSON parsing from requests to avoid 415 errors
def get_request_data():
    return request.get_json(force=True)

@app.route("/", methods=["GET"])
def home():
    return "<h1>Surprise Granite AI Chatbot</h1><p>Your AI assistant is ready.</p>"

@app.route("/chat", methods=["POST"])
def chat():
    data = get_request_data()
    user_input = safe_str(data.get("message")).strip()
    if not user_input:
        return jsonify({"error": "Missing user input"}), 400

    company_context = (
        "You are a helpful remodeling assistant for Surprise Granite. "
        "Our company is dedicated to high-quality granite products and exceptional customer service. "
        "Below are our Terms and Conditions (updated 01/11/2025) and other company details:\n\n"
        # (Insert your full Terms text here if needed)
        "Answer all customer inquiries based on Surprise Granite’s policies, product details, and quality standards. "
        "Always maintain a professional tone and provide accurate, detailed, and helpful information."
    )

    try:
        response = openai.ChatCompletion.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": company_context},
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

    data = get_request_data()
    if not data or not data.get("totalSqFt"):
        return jsonify({"error": "Missing project data"}), 400

    try:
        total_sq_ft = safe_float(data.get("totalSqFt"))
        vendor = safe_str(data.get("vendor"), "default vendor").strip()
        color = safe_str(data.get("color"), "").strip().lower()
        demo = safe_str(data.get("demo"), "no").strip().lower()
        sink_qty = safe_float(data.get("sinkQty"), 0)
        cooktop_qty = safe_float(data.get("cooktopQty"), 0)
        sink_type = safe_str(data.get("sinkType"), "standard").strip().lower()
        cooktop_type = safe_str(data.get("cooktopType"), "standard").strip().lower()
        backsplash = safe_str(data.get("backsplash"), "no").strip().lower()
        tile_option = safe_float(data.get("tileOption"), 0)
        edge_detail = safe_str(data.get("edgeDetail"), "standard").strip().lower()
        job_name = safe_str(data.get("jobName"), "N/A").strip()
        job_type = safe_str(data.get("jobType"), "fabricate and install").strip().lower()
        customer_name = safe_str(data.get("customerName"), "Valued Customer").strip()

        pricing_data = get_pricing_data()
        pricing_info = pricing_data.get(color, {"cost": 50, "total_sqft": 100})
        price_per_sqft = pricing_info["cost"]
        color_total_sqft = pricing_info["total_sqft"]

        material_cost = total_sq_ft * price_per_sqft
        if demo == "yes":
            material_cost *= 1.10
        sink_cost = sink_qty * (150 if sink_type == "premium" else 100)
        cooktop_cost = cooktop_qty * (160 if cooktop_type == "premium" else 120)
        backsplash_cost = total_sq_ft * (tile_option if tile_option > 0 else 20) if backsplash == "yes" else 0

        if edge_detail == "premium":
            multiplier = 1.05
        elif edge_detail == "custom":
            multiplier = 1.10
        else:
            multiplier = 1.0
        material_cost *= multiplier

        preliminary_total = material_cost + sink_cost + cooktop_cost + backsplash_cost
        effective_sq_ft = total_sq_ft * 1.20
        slab_count = math.ceil(effective_sq_ft / color_total_sqft)

        markup = 1.35 if job_type == "slab only" else 1.30
        base_labor_rate = 45
        labor_cost = total_sq_ft * base_labor_rate * markup

        total_project_cost = preliminary_total + labor_cost
        final_cost_per_sq_ft = f"{(total_project_cost / total_sq_ft):.2f}" if total_sq_ft else "0.00"

        prompt = (
            f"Surprise Granite Detailed Estimate\n\n"
            f"Customer: Mr./Ms. {customer_name}\n"
            f"Job Name: {job_name}\n"
            f"Job Type: {job_type}\n"
            f"Project Area: {total_sq_ft} sq ft (with 20% waste: {effective_sq_ft:.2f} sq ft)\n"
            f"Vendor: {vendor}\n"
            f"Material (Color): {color.title()}\n"
            f"Price per Sq Ft for {color.title()}: ${price_per_sqft:.2f}\n"
            f"Material Cost: ${material_cost:.2f}\n"
            f"Sink Count: {sink_qty} ({sink_type}), Cost: ${sink_cost:.2f}\n"
            f"Cooktop Count: {cooktop_qty} ({cooktop_type}), Cost: ${cooktop_cost:.2f}\n"
            f"Backsplash Cost: ${backsplash_cost:.2f}\n"
            f"Number of Slabs Needed: {slab_count} (Each slab: {color_total_sqft} sq ft)\n"
            f"Preliminary Total (Materials): ${preliminary_total:.2f}\n"
            f"Labor Cost (at base rate ${base_labor_rate} per sq ft with markup {int((markup-1)*100)}%): ${labor_cost:.2f}\n"
            f"Total Project Cost: ${total_project_cost:.2f}\n"
            f"Final Cost Per Sq Ft: ${final_cost_per_sq_ft}\n\n"
            "Using the above pricing details from Surprise Granite, generate a comprehensive, professional, "
            "and detailed written estimate that includes a breakdown of material and labor costs, installation notes, "
            "and a personalized closing message addressing the customer by name. "
            "Ensure that the estimate is specific to Surprise Granite pricing and does not include generic information."
        )

        response = openai.ChatCompletion.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are an expert estimator at Surprise Granite. Provide a highly detailed and professional estimate strictly based on Surprise Granite pricing details."},
                {"role": "user", "content": prompt}
            ]
        )
        narrative = response.choices[0].message.content

        return jsonify({
            "preliminary": {
                "material_cost": material_cost,
                "sink_cost": sink_cost,
                "cooktop_cost": cooktop_cost,
                "backsplash_cost": backsplash_cost,
                "labor_cost": labor_cost,
                "preliminary_total": preliminary_total,
                "slab_count": slab_count
            },
            "estimate": narrative
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/millwork-estimate", methods=["POST", "OPTIONS"])
def millwork_estimate():
    if request.method == "OPTIONS":
        return jsonify({}), 200

    data = get_request_data()
    required_fields = ["roomLength", "roomWidth", "cabinetStyle", "woodType"]
    for field in required_fields:
        if data.get(field) is None:
            return jsonify({"error": f"Missing {field}"}), 400

    try:
        room_length = safe_float(data.get("roomLength"))
        room_width = safe_float(data.get("roomWidth"))
        cabinet_style = safe_str(data.get("cabinetStyle")).strip().lower()
        wood_type = safe_str(data.get("woodType")).strip().lower()

        area = room_length * room_width
        base_cost = 50.0
        style_multiplier = 1.2 if cabinet_style == "modern" else (1.1 if cabinet_style == "traditional" else 1.0)
        wood_multiplier = 1.3 if wood_type == "oak" else (1.2 if wood_type == "maple" else 1.0)

        estimated_cost = area * base_cost * style_multiplier * wood_multiplier

        prompt = (
            f"Millwork Estimate Details:\n"
            f"Room dimensions: {room_length} ft x {room_width} ft (Area: {area} sq ft)\n"
            f"Cabinet Style: {cabinet_style.title()}\n"
            f"Wood Type: {wood_type.title()}\n"
            f"Base cost per sq ft: ${base_cost:.2f}\n"
            f"Style Multiplier: {style_multiplier}\n"
            f"Wood Multiplier: {wood_multiplier}\n"
            f"Calculated Estimated Cost: ${estimated_cost:.2f}\n\n"
            "Please provide a comprehensive, professional, and friendly written estimate for millwork services based on the above details."
        )

        response = openai.ChatCompletion.create(
            model="gpt-4",
            messages=[
                {"role": "system", "content": "You are a professional millwork estimator."},
                {"role": "user", "content": prompt}
            ]
        )
        narrative = response.choices[0].message.content

        return jsonify({
            "area": area,
            "estimatedCost": estimated_cost,
            "narrative": narrative
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/service-pricing", methods=["GET"])
def service_pricing():
    try:
        services = get_service_pricing_data()
        return jsonify({"services": services})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the Surprise Granite Flask app")
    parser.add_argument("--port", type=int, default=5002, help="Port number to run the app")
    args = parser.parse_args()
    # Use PORT environment variable if available (for deployments like Render)
    port = int(os.environ.get("PORT", args.port))
    app.run(host="0.0.0.0", port=port, debug=True)
