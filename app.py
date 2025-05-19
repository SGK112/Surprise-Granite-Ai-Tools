```python
from flask import Flask, render_template, send_from_directory, request, jsonify
from pymongo import MongoClient
import os
import logging
from werkzeug.utils import secure_filename
from urllib.parse import quote

app = Flask(__name__)

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# MongoDB connection
MONGO_URI = "mongodb://localhost:27017"
DB_NAME = "countertops"
COLLECTION_NAME = "images"
client = MongoClient(MONGO_URI)
db = client[DB_NAME]
collection = db[COLLECTION_NAME]

# Directory for storing images
UPLOAD_FOLDER = 'countertop_images'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg'}

# Base URL for image serving (update to your domain in production)
BASE_URL = 'http://localhost:5000'  # Change to production domain, e.g., 'https://your-domain.com'

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/')
def display_countertops():
    try:
        countertops = list(collection.find({}, {'_id': 0}))
        logger.info(f"Retrieved {len(countertops)} countertops for display")
        return render_template('index.html', countertops=countertops)
    except Exception as e:
        logger.error(f"Error retrieving countertops: {str(e)}")
        return jsonify({'error': 'Failed to load countertops'}), 500

@app.route('/countertop_images/<path:filename>')
def serve_images(filename):
    try:
        return send_from_directory(app.config['UPLOAD_FOLDER'], filename)
    except Exception as e:
        logger.error(f"Error serving image {filename}: {str(e)}")
        return jsonify({'error': 'Image not found'}), 404

@app.route('/api/countertops', methods=['GET'])
def get_countertops():
    try:
        countertops = list(collection.find({}, {'_id': 0}))
        # Append BASE_URL to imageUrl for absolute paths
        for countertop in countertops:
            if 'imageUrl' in countertop and countertop['imageUrl']:
                countertop['imageUrl'] = f"{BASE_URL}/countertop_images/{quote(countertop['imageUrl'])}"
        logger.info(f"Served {len(countertops)} countertops via API")
        return jsonify(countertops)
    except Exception as e:
        logger.error(f"Error serving countertops API: {str(e)}")
        return jsonify({'error': 'Failed to load countertops'}), 500

@app.route('/api/upload-image', methods=['POST'])
def upload_image():
    try:
        if 'file' not in request.files:
            logger.warning("No file uploaded in request")
            return jsonify({'error': 'No file uploaded'}), 400

        file = request.files['file']
        if file.filename == '':
            logger.warning("No file selected")
            return jsonify({'error': 'No file selected'}), 400

        if not allowed_file(file.filename):
            logger.warning(f"Invalid file extension: {file.filename}")
            return jsonify({'error': 'Invalid file type. Use PNG or JPG'}), 400

        # Securely save the file
        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        logger.info(f"Saved image: {filename}")

        # Store in MongoDB
        countertop_data = {
            'colorName': filename.split('.')[0],  # Example: use filename as placeholder
            'vendorName': 'Uploaded',
            'material': 'Unknown',
            'thickness': 'Unknown',
            'costSqFt': 0,
            'availableSqFt': 0,
            'imageUrl': filename,
            'popularity': 0,
            'isNew': true
        }
        collection.insert_one(countertop_data)
        logger.info(f"Stored countertop data for {filename} in MongoDB")

        # Return image URL and mock analysis
        return jsonify({
            'imageUrl': f"{BASE_URL}/countertop_images/{quote(filename)}",
            'analysis': {
                'stoneType': 'Unknown',
                'colorPattern': 'Unknown',
                'isNaturalStone': false,
                'damageType': 'None',
                'severity': 'None',
                'estimatedCost': 'N/A'
            }
        })
    except Exception as e:
        logger.error(f"Error uploading image: {str(e)}")
        return jsonify({'error': 'Failed to upload image'}), 500

# Commented out unused endpoint; can be implemented with a real TTS service
"""
@app.route('/api/speak', methods=['POST'])
def speak():
    try:
        # Example with Google Text-to-Speech (requires google-cloud-texttospeech package)
        # from google.cloud import texttospeech
        # client = texttospeech.TextToSpeechClient()
        # text = request.json.get('text', '')
        # synthesis_input = texttospeech.SynthesisInput(text=text)
        # voice = texttospeech.VoiceSelectionParams(language_code="en-US", ssml_gender=texttospeech.SsmlVoiceGender.NEUTRAL)
        # audio_config = texttospeech.AudioConfig(audio_encoding=texttospeech.AudioEncoding.MP3)
        # response = client.synthesize_speech(input=synthesis_input, voice=voice, audio_config=audio_config)
        # return jsonify({'audio': base64.b64encode(response.audio_content).decode('utf-8')})
        return jsonify({'audio': 'mock_audio_data'})
    except Exception as e:
        logger.error(f"Error in speak endpoint: {str(e)}")
        return jsonify({'error': 'Failed to generate audio'}), 500
"""

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
```
