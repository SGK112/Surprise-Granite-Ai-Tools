from flask import Flask, request, jsonify
import os
import openai
from flask_cors import CORS
import requests, csv
from io import StringIO

# Initialize the Flask app
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
    Expected CSV columns: Material, Price
    Example rows:
       Material,Price
       granite and quartz,45
       quartzite and marble,65
       dekton and porcelain,85
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
        price = float(row["Price"])
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
        # Check if the input contains pricing-related keywords
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

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)
