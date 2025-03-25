from flask import Flask, render_template, send_from_directory, request, jsonify
from pymongo import MongoClient
import os

app = Flask(__name__)

# MongoDB connection
MONGO_URI = "mongodb://localhost:27017"
DB_NAME = "countertops"
COLLECTION_NAME = "images"
client = MongoClient(MONGO_URI)
db = client[DB_NAME]
collection = db[COLLECTION_NAME]

@app.route('/')
def display_countertops():
    countertops = list(collection.find())
    return render_template('index.html', countertops=countertops)

@app.route('/countertop_images/<path:filename>')
def serve_images(filename):
    return send_from_directory('countertop_images', filename)

@app.route('/api/countertops', methods=['GET'])
def get_countertops():
    countertops = list(collection.find({}, {'_id': 0}))
    return jsonify(countertops)

@app.route('/api/upload-image', methods=['POST'])
def upload_image():
    if 'file' not in request.files:
        return jsonify({'error': 'No file uploaded'}), 400

    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400

    # Mock analysis response (since we don't have a real image analysis API)
    mock_result = {
        'response': {
            'stoneType': 'Unknown',
            'colorPattern': 'Unknown',
            'isNaturalStone': False,
            'damageType': 'Crack',
            'severity': 'Moderate',
            'estimatedCost': '$500-$800'
        }
    }
    return jsonify(mock_result)

@app.route('/api/speak', methods=['POST'])
def speak():
    # Mock audio response (since we don't have a real text-to-speech API)
    # In a real implementation, you'd use a service like Google Text-to-Speech
    return jsonify({'audio': 'mock_audio_data'})

if __name__ == '__main__':
    app.run(debug=True)
