from flask import Flask, send_from_directory, request, jsonify
from pymongo import MongoClient
import os
import csv
import requests
from urllib.parse import quote, urlparse
from werkzeug.utils import secure_filename
from PIL import Image
import json
import openai
from dotenv import load_dotenv
import os

app = Flask(__name__)
load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = "countertops"
COLLECTION_NAME = "images"
client = MongoClient(MONGO_URI)
db = client[DB_NAME]
collection = db[COLLECTION_NAME]

UPLOAD_FOLDER = 'countertop_images'
STATIC_FOLDER = 'dist'
IMAGES_FOLDER = 'images'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(STATIC_FOLDER, exist_ok=True)
os.makedirs(IMAGES_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg'}

BASE_URL = os.getenv("BASE_URL", "http://localhost:5000")
PUBLISHED_CSV_MATERIALS = os.getenv("PUBLISHED_CSV_MATERIALS", "")
openai.api_key = os.getenv("OPENAI_API_KEY")

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def optimize_images():
    for filename in os.listdir(app.config['UPLOAD_FOLDER']):
        if allowed_file(filename):
            file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
            img = Image.open(file_path)
            img.thumbnail((320, 128))
            img.save(file_path, quality=80)

def process_csv_and_images():
    if not PUBLISHED_CSV_MATERIALS:
        return
    collection.delete_many({})
    if PUBLISHED_CSV_MATERIALS.startswith(('http://', 'https://')):
        response = requests.get(PUBLISHED_CSV_MATERIALS)
        response.raise_for_status()
        csv_content = response.text.splitlines()
        csv_reader = csv.DictReader(csv_content)
    else:
        with open(PUBLISHED_CSV_MATERIALS, 'r') as csv_file:
            csv_reader = csv.DictReader(csv_file)
    for row in csv_reader:
        countertop_data = {
            'colorName': row.get('colorName', 'Unknown'),
            'vendorName': row.get('vendorName', 'Unknown'),
            'material': row.get('material', 'Unknown'),
            'thickness': row.get('thickness', 'Unknown'),
            'costSqFt': float(row.get('costSqFt', 0)),
            'availableSqFt': float(row.get('availableSqFt', 0)),
            'imageUrl': row.get('imageUrl', ''),
            'popularity': float(row.get('popularity', 0)),
            'isNew': row.get('isNew', 'false').lower() == 'true'
        }
        image_url = row.get('imageUrl', '')
        if image_url:
            if image_url.startswith(('http://', 'https://')):
                image_response = requests.get(image_url, stream=True)
                image_response.raise_for_status()
                filename = secure_filename(os.path.basename(urlparse(image_url).path))
                if allowed_file(filename):
                    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                    with open(file_path, 'wb') as f:
                        for chunk in image_response.iter_content(1024):
                            f.write(chunk)
                    countertop_data['imageUrl'] = filename
                else:
                    countertop_data['imageUrl'] = 'fallback.jpg'
            else:
                if allowed_file(image_url) and os.path.exists(os.path.join(app.config['UPLOAD_FOLDER'], image_url)):
                    countertop_data['imageUrl'] = image_url
                else:
                    countertop_data['imageUrl'] = 'fallback.jpg'
        collection.insert_one(countertop_data)
    optimize_images()

if PUBLISHED_CSV_MATERIALS:
    process_csv_and_images()

@app.route('/')
def serve_index():
    return send_from_directory('.', 'index.html')

@app.route('/countertop_images/<path:filename>')
def serve_images(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@app.route('/dist/<path:filename>')
def serve_static(filename):
    return send_from_directory(STATIC_FOLDER, filename)

@app.route('/js/app.js')
def serve_app_js():
    return send_from_directory('.', 'app.js')

@app.route('/sw.js')
def serve_sw():
    return send_from_directory('public', 'sw.js')

@app.route('/manifest.json')
def serve_manifest():
    return send_from_directory('.', 'manifest.json')

@app.route('/images/<path:filename>')
def serve_fallback(filename):
    return send_from_directory(IMAGES_FOLDER, filename)

@app.route('/api/countertops', methods=['GET'])
def get_countertops():
    countertops = list(collection.find({}, {'_id': 0}))
    for countertop in countertops:
        if 'imageUrl' in countertop and countertop['imageUrl']:
            countertop['imageUrl'] = f"{BASE_URL}/countertop_images/{quote(countertop['imageUrl'])}"
    return jsonify(countertops)

@app.route('/api/upload-image', methods=['POST'])
def upload_image():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    if not allowed_file(file.filename):
        return jsonify({'error': 'Invalid file type. Use PNG or JPG'}), 400
    filename = secure_filename(file.filename)
    file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(file_path)
    countertop_data = {
        'colorName': filename.split('.')[0],
        'vendorName': 'Uploaded',
        'material': 'Unknown',
        'thickness': 'Unknown',
        'costSqFt': 0,
        'availableSqFt': 0,
        'imageUrl': filename,
        'popularity': 0,
        'isNew': True
    }
    collection.insert_one(countertop_data)
    return jsonify({
        'imageUrl': f"{BASE_URL}/countertop_images/{quote(filename)}",
        'analysis': {
            'stoneType': 'Unknown',
            'damageType': 'None',
            'severity': 'None',
            'estimatedCost': 'N/A'
        }
    })

@app.route('/sg-chatbot-widget.html')
def serve_chatbot_widget():
    return send_from_directory('public', 'sg-chatbot-widget.html')

@app.route('/public/<path:filename>')
def serve_public(filename):
    return send_from_directory('public', filename)

@app.route('/api/materials')
def api_materials():
    # Return mock data for now
    return jsonify([
        {"name": "Calacatta Quartz", "material": "Quartz", "installedPrice": 75.0},
        {"name": "Black Granite", "material": "Granite", "installedPrice": 65.0}
    ])

@app.route('/api/shopify-products')
def api_shopify_products():
    # Return mock data for now
    return jsonify([
        {"title": "Granite Cleaner", "variants": [{"price": "12.99"}], "handle": "granite-cleaner"}
    ])

def load_materials():
    try:
        with open('materials.json', 'r') as f:
            return json.load(f)
    except Exception:
        return []

def estimate_countertop(message, materials):
    import re
    sqft_match = re.search(r'(\d+(\.\d+)?)\s*(sq\.?\s*ft|square feet)', message, re.I)
    sqft = float(sqft_match.group(1)) if sqft_match else None

    for mat in materials:
        if 'Color Name' not in mat or 'Material' not in mat or 'Cost/SqFt' not in mat:
            continue
        color_name = mat['Color Name']
        material = mat['Material']
        try:
            raw_cost = float(mat['Cost/SqFt'])
            finished_price = round(raw_cost * 3.25 + 35, 2)
        except Exception:
            finished_price = 0.0

        if color_name.lower() in message.lower() or material.lower() in message.lower():
            if sqft:
                # Waste factor logic
                if sqft < 20:
                    waste_factor = 0.5
                elif sqft < 40:
                    waste_factor = 0.35
                else:
                    waste_factor = 0.2
                total_sqft = round(sqft * (1 + waste_factor), 2)
                total = round(finished_price * total_sqft, 2)
                return (
                    f"{color_name} ({material}): <b>${finished_price}/sq.ft installed</b>.<br>"
                    f"Estimated with a {int(waste_factor*100)}% waste factor: <b>{total_sqft} sq.ft</b>.<br>"
                    f"For your project, your estimate is <b>${total}</b>.<br>"
                    f"<i>Tip: Always order extra material for seams, pattern matching, and repairs. "
                    f"Discuss edge profiles, backsplash, and sink cutouts with your fabricator. "
                    f"For tile, order 10% extra for cuts and breakage. For stone, check slab sizes and layout before ordering.</i>"
                )
            else:
                return (
                    f"{color_name} ({material}): <b>${finished_price}/sq.ft installed</b>.<br>"
                    f"Please provide square footage for a full estimate.<br>"
                    f"<i>Tip: Always order extra material for seams, pattern matching, and repairs. "
                    f"Discuss edge profiles, backsplash, and sink cutouts with your fabricator. "
                    f"For tile, order 10% extra for cuts and breakage. For stone, check slab sizes and layout before ordering.</i>"
                )
    return None

def get_shopify_products(query):
    # TODO: Replace with real Shopify API call
    return [{"title": "Sample Product", "variants": [{"price": "99.99"}], "handle": "sample-product"}]

@app.route('/api/chat', methods=['POST'])
def api_chat():
    data = request.json
    user_message = data.get('message', '').lower()
    quote_state = data.get('quoteState', {}) or {}

    # Detect main menu options
    if "countertop quote" in user_message:
        return jsonify({
            "message": "Great! What material or color are you interested in for your countertop? (e.g., Taj Mahal, Sparkling White, Granite, Quartz, etc.)",
            "options": ["Repair Quote", "Design Tips", "Shop Now", "Live Agent"],
            "quoteState": {"intent": "countertop_quote"}
        })
    if "repair quote" in user_message:
        return jsonify({
            "message": "What type of repair do you need? Please describe the issue and the material (e.g., chip in granite, crack in quartz, etc.).",
            "options": ["Countertop Quote", "Design Tips", "Shop Now", "Live Agent"],
            "quoteState": {"intent": "repair_quote"}
        })
    if "design tips" in user_message:
        return jsonify({
            "message": "For a magical kitchen, choose Quartz with a waterfall edge. Need more enchanting ideas? Tell me your style or ask about colors, edges, or layouts!",
            "options": ["Countertop Quote", "Repair Quote", "Shop Now", "Live Agent"],
            "quoteState": {"intent": "design_tips"}
        })
    if "shop now" in user_message:
        return jsonify({
            "message": "You can browse our products at <a href='https://store.surprisegranite.com' target='_blank'>our online store</a>. What are you looking for today?",
            "options": ["Countertop Quote", "Repair Quote", "Design Tips", "Live Agent"],
            "quoteState": {"intent": "shop_now"}
        })
    if "live agent" in user_message:
        return jsonify({
            "message": "A live agent will be with you soon! Or call us at <a href='tel:623-555-1234'>623-555-1234</a>.",
            "options": ["Countertop Quote", "Repair Quote", "Design Tips", "Shop Now"],
            "quoteState": {"intent": "live_agent"}
        })

    materials = fetch_materials_from_csv()
    material_found = None
    sqft = None

    import re
    # Try to extract square footage
    sqft_match = re.search(r'(\d+(\.\d+)?)\s*(sq\.?\s*ft|square feet)?', user_message, re.I)
    if sqft_match:
        sqft = float(sqft_match.group(1))
        quote_state['sqft'] = sqft

    # Try to match a material in this message
    for mat in materials:
        if 'Color Name' not in mat or 'Material' not in mat or 'Cost/SqFt' not in mat:
            continue
        color_name = mat['Color Name']
        material = mat['Material']
        if color_name.lower() in user_message.lower() or material.lower() in user_message.lower():
            material_found = mat
            quote_state['material'] = color_name
            break

    # If user only sent a number, use last material from quoteState
    if not material_found and 'material' in quote_state and sqft:
        for mat in materials:
            if mat['Color Name'].lower() == quote_state['material'].lower():
                material_found = mat
                break

    # If both material and sqft are present, give a full estimate
    if material_found and ('sqft' in quote_state and quote_state['sqft']):
        raw_cost = float(material_found['Cost/SqFt'])
        finished_price = round(raw_cost * 3.25 + 35, 2)
        sqft = quote_state['sqft']
        # Waste factor logic
        if sqft < 20:
            waste_factor = 0.5
        elif sqft < 40:
            waste_factor = 0.35
        else:
            waste_factor = 0.2
        total_sqft = round(sqft * (1 + waste_factor), 2)
        total = round(finished_price * total_sqft, 2)
        return jsonify({
            "message": (
                f"{material_found['Color Name']} ({material_found['Material']}): <b>${finished_price}/sq.ft installed</b>.<br>"
                f"Estimated with a {int(waste_factor*100)}% waste factor: <b>{total_sqft} sq.ft</b>.<br>"
                f"For your project, your estimate is <b>${total}</b>.<br>"
                f"<i>Tip: Always order extra material for seams, pattern matching, and repairs. "
                f"Discuss edge profiles, backsplash, and sink cutouts with your fabricator. "
                f"For tile, order 10% extra for cuts and breakage. For stone, check slab sizes and layout before ordering.</i>"
            ),
            "quoteState": quote_state
        })

    # If only material is found, ask for sqft
    if material_found:
        return jsonify({
            "message": (
                f"{material_found['Color Name']} ({material_found['Material']}): <b>Estimated pricing available.</b><br>"
                f"Please provide your project's square footage for a full estimate."
            ),
            "quoteState": quote_state
        })

    # If only sqft is found, ask for material
    if 'sqft' in quote_state and quote_state['sqft']:
        return jsonify({
            "message": (
                f"Great! You have {quote_state['sqft']} sq.ft. "
                f"Which material or color are you interested in? (e.g., Taj Mahal, Granite, Quartz, etc.)"
            ),
            "quoteState": quote_state
        })

    # Fallback to OpenAI
    llms_context = (
        load_llms_context() +
        "\n" + company_info_text +
        "\nYou are the Surprise Granite Wizard AI assistant. You ONLY answer questions about countertops, remodeling, our products, and our services. " +
        "If a user asks something off-topic, politely redirect them to our services. " +
        "Always use HTML hyperlinks for any links. " +
        "If you don't know the answer, offer to connect the user with a live agent or provide company contact info."
    )
    messages = [
        {"role": "system", "content": llms_context},
        {"role": "user", "content": user_message}
    ]
    response = openai.chat.completions.create(
        model="gpt-3.5-turbo",
        messages=messages
    )
    ai_reply = response.choices[0].message.content
    return jsonify({"message": ai_reply, "quoteState": quote_state})

@app.route('/api/close-chat', methods=['POST'])
def api_close_chat():
    return jsonify({"status": "closed"})

@app.route('/api/lead', methods=['POST'])
def api_lead():
    data = request.json
    collection.insert_one({
        "type": "lead",
        "lead": data
    })
    return jsonify({"status": "received"})

def fetch_materials_from_google():
    sheet_id = os.getenv("GOOGLE_SHEET_ID")
    api_key = os.getenv("GOOGLE_API_KEY")
    range_name = "Sheet1!A1:Z100"  # Adjust to your sheet/range

    url = f"https://sheets.googleapis.com/v4/spreadsheets/{sheet_id}/values/{range_name}?key={api_key}"
    response = requests.get(url)
    data = response.json()

    # Convert rows to list of dicts
    rows = data.get("values", [])
    if not rows or len(rows) < 2:
        return []
    headers = rows[0]
    materials = [dict(zip(headers, row)) for row in rows[1:]]
    # Optionally convert price fields to float
    for mat in materials:
        if "installedPrice" in mat:
            try:
                mat["installedPrice"] = float(mat["installedPrice"])
            except Exception:
                mat["installedPrice"] = 0.0
    return materials

def fetch_materials_from_csv():
    url = os.getenv("GOOGLE_SHEET_CSV_URL")
    response = requests.get(url)
    response.raise_for_status()
    decoded = response.content.decode('utf-8')
    reader = csv.DictReader(decoded.splitlines())
    materials = []
    for row in reader:
        # Convert price to float if present
        if "installedPrice" in row:
            try:
                row["installedPrice"] = float(row["installedPrice"])
            except Exception:
                row["installedPrice"] = 0.0
        materials.append(row)
    return materials

materials = fetch_materials_from_csv()

def load_llms_context():
    try:
        with open('llms.txt', 'r', encoding='utf-8') as f:
            return f.read()
    except Exception:
        return ""

def load_company_info():
    try:
        with open('companyInfo.json', 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {}

company_info = load_company_info()
company_info_text = (
    f"Company Name: {company_info.get('name', 'Surprise Granite')}\n"
    f"Phone: {company_info.get('phone', '623-555-1234')}\n"
    f"Email: {company_info.get('email', 'info@surprisegranite.com')}\n"
    f"Address: {company_info.get('address', '11560 N Dysart Rd, Surprise, AZ 85379')}\n"
    f"Website: <a href='{company_info.get('website', 'https://surprisegranite.com')}'>surprisegranite.com</a>\n"
    f"Store: <a href='{company_info.get('store', 'https://store.surprisegranite.com')}'>our online store</a>\n"
)

llms_context = (
    load_llms_context() +
    "\n" + company_info_text +
    "\nYou are the Surprise Granite Wizard AI assistant. You ONLY answer questions about countertops, remodeling, our products, and our services. " +
    "If a user asks something off-topic, politely redirect them to our services. " +
    "Always use HTML hyperlinks for any links. " +
    "If you don't know the answer, offer to connect the user with a live agent or provide company contact info."
)

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)

