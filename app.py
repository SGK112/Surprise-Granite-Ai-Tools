from flask import Flask, render_template, send_from_directory
from pymongo import MongoClient
import os

app = Flask(__name__)

# MongoDB connection
MONGO_URI = "mongodb://localhost:27017"
DB_NAME = "countertops"
COLLECTION_NAME = "images"

@app.route('/')
def display_countertops():
    client = MongoClient(MONGO_URI)
    db = client[DB_NAME]
    collection = db[COLLECTION_NAME]
    countertops = list(collection.find())
    client.close()
    return render_template('index.html', countertops=countertops)

@app.route('/countertop_images/<path:filename>')
def serve_images(filename):
    return send_from_directory('countertop_images', filename)

if __name__ == '__main__':
    app.run(debug=True)
