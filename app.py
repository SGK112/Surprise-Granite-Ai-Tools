```python
from flask import Flask, render_template, send_from_directory, request, jsonify
from pymongo import MongoClient
import os
import logging
import csv
import requests
from urllib.parse import quote, urlparse
from werkzeug.utils import secure_filename

app = Flask(__name__)

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# MongoDB connection
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")  # Use Render env variable
DB_NAME = "countertops"
COLLECTION_NAME = "images"
client = MongoClient(MONGO_URI)
db = client[DB_NAME]
collection = db[COLLECTION_NAME]

# Directories
UPLOAD_FOLDER = 'countertop_images'
STATIC_FOLDER = 'dist'
IMAGES_FOLDER = 'images'
if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)
if not os.path.exists(STATIC_FOLDER):
    os.makedirs(STATIC_FOLDER)
if not os.path.exists(IMAGES_FOLDER):
    os.makedirs(IMAGES_FOLDER)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg'}

# Base URL for production
BASE_URL = os.getenv("BASE_URL", "http://localhost:5000")  # Use Render env variable

# CSV processing
PUBLISHED_CSV_MATERIALS = os.getenv("PUBLISHED_CSV_MATERIALS", "")  # e.g., "/app/materials.csv" or URL

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def process_csv_and_images():
    if not PUBLISHED_CSV_MATERIALS:
        logger.warning("PUBLISHED_CSV_MATERIALS not set")
        return

    try:
        # Clear existing collection (optional, comment out to append)
        collection.delete_many({})

        # Read CSV
        if PUBLISHED_CSV_MATERIALS.startswith(('http://', 'https://')):
            response = requests.get(PUBLISHED_CSV_MATERIALS)
            response.raise_for_status()
            csv_content = response.text.splitlines()
            csv_reader = csv.DictReader(csv_content)
        else:
            with open(PUBLISHED_CSV_MATERIALS, 'r') as csv_file:
                csv_reader = csv.DictReader(csv_file)

        for row in csv_reader:
            # Prepare countertop data
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

            # Handle image
            image_url = row.get('imageUrl', '')
            if image_url:
                if image_url.startswith(('http://', 'https://')):
                    # Download image from URL
                    try:
                        image_response = requests.get(image_url, stream=True)
                        image_response.raise_for_status()
                        filename = secure_filename(os.path.basename(urlparse(image_url).path))
                        if allowed_file(filename):
                            file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                            with open(file_path, 'wb') as f:
                                for chunk in image_response.iter_content(1024):
                                    f.write(chunk)
                            countertop_data['imageUrl'] = filename
                            logger.info(f"Downloaded image: {filename}")
                        else:
                            logger.warning(f"Invalid image extension: {filename}")
                            countertop_data['imageUrl'] = 'fallback.jpg'
                    except Exception as e:
                        logger.error(f"Failed to download image {image_url}: {str(e)}")
                        countertop_data['imageUrl'] = 'fallback.jpg'
                else:
                    # Assume local filename in countertop_images
                    if allowed_file(image_url) and os.path.exists(os.path.join(app.config['UPLOAD_FOLDER'], image_url)):
                        countertop_data['imageUrl'] = image_url
                    else:
                        logger.warning(f"Image not found: {image_url}")
                        countertop_data['imageUrl'] = 'fallback.jpg'

            # Insert into MongoDB
            collection.insert_one(countertop_data)
            logger.info(f"Inserted countertop: {countertop_data['colorName']}")

    except Exception as e:
        logger.error(f"Error processing CSV: {str(e)}")

# Run CSV processing on startup
if PUBLISHED_CSV_MATERIALS:
    process_csv_and_images()

@app.route('/')
def serve_index():
    try:
        return send_from_directory('.', 'index.html')
    except Exception as e:
        logger.error(f"Error serving index.html: {str(e)}")
        return jsonify({'error': 'Failed to load page'}), 500

@app.route('/countertop_images/<path:filename>')
def serve_images(filename):
    try:
        return send_from_directory(app.config['UPLOAD_FOLDER'], filename)
    except Exception as e:
        logger.error(f"Error serving image {filename}: {str(e)}")
        return jsonify({'error': 'Image not found'}), 404

@app.route('/dist/<path:filename>')
def serve_static(filename):
    try:
        return send_from_directory(STATIC_FOLDER, filename)
    except Exception as e:
        logger.error(f"Error serving static file {filename}: {str(e)}")
        return jsonify({'error': 'File not found'}), 404

@app.route('/js/app.js')
def serve_app_js():
    try:
        return send_from_directory('.', 'app.js')
    except Exception as e:
        logger.error(f"Error serving app.js: {str(e)}")
        return jsonify({'error': 'Script not found'}), 404

@app.route('/sw.js')
def serve_sw():
    try:
        return send_from_directory('.', 'sw.js')
    except Exception as e:
        logger.error(f"Error serving sw.js: {str(e)}")
        return jsonify({'error': 'Service worker not found'}), 404

@app.route('/manifest.json')
def serve_manifest():
    try:
        return send_from_directory('.', 'manifest.json')
    except Exception as e:
        logger.error(f"Error serving manifest.json: {str(e)}")
        return jsonify({'error': 'Manifest not found'}), 404

@app.route('/images/<path:filename>')
def serve_fallback(filename):
    try:
        return send_from_directory(IMAGES_FOLDER, filename)
    except Exception as e:
        logger.error(f"Error serving image {filename}: {str(e)}")
        return jsonify({'error': 'Image not found'}), 404

@app.route('/api/countertops', methods=['GET'])
def get_countertops():
    try:
        countertops = list(collection.find({}, {'_id': 0}))
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

        filename = secure_filename(file.filename)
        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(file_path)
        logger.info(f"Saved image: {filename}")

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
        logger.info(f"Stored countertop data for {filename} in MongoDB")

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

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
```

**Changes**:
- Added `requests` and `csv` imports for CSV processing and image downloads.
- Added `PUBLISHED_CSV_MATERIALS` environment variable parsing.
- Implemented `process_csv_and_images` to:
  - Read CSV from a URL or local file.
  - Clear MongoDB collection (optional).
  - Insert countertop data into MongoDB.
  - Download images from URLs to `countertop_images` or validate local filenames.
- Runs `process_csv_and_images` on startup if `PUBLISHED_CSV_MATERIALS` is set.
- Added environment variables for `MONGO_URI` and `BASE_URL`.

#### 3. Update `requirements.txt`
Add dependencies for CSV and image processing:

<xaiArtifact artifact_id="8fbeeebd-684e-4a3b-8536-200d96398a18" artifact_version_id="10dd2ff5-f420-41d5-9677-97c64cd30074" title="requirements.txt" contentType="text/plain">
```
Flask==2.3.2
pymongo==4.6.3
gunicorn==22.0.0
requests==2.31.0
```

#### 4. Configure Render Environment Variables
In Render’s dashboard:
- Go to your service → Environment → Environment Variables.
- Add:
  - `PUBLISHED_CSV_MATERIALS`: URL (e.g., `https://example.com/materials.csv`) or local path (e.g., `/app/materials.csv`).
  - `MONGO_URI`: MongoDB connection string (e.g., `mongodb+srv://user:password@cluster.mongodb.net`).
  - `BASE_URL`: Your deployed URL (e.g., `https://your-app-name.onrender.com`).
- Example:
  ```
  PUBLISHED_CSV_MATERIALS=https://example.com/materials.csv
  MONGO_URI=mongodb+srv://user:password@cluster.mongodb.net
  BASE_URL=https://your-app-name.onrender.com
  ```

#### 5. Include `materials.csv` (Optional)
If `PUBLISHED_CSV_MATERIALS` points to a local file (e.g., `/app/materials.csv`), include `materials.csv` in the repo:

<xaiArtifact artifact_id="8fbeeebd-684e-4a3b-8536-200d96398a18" artifact_version_id="8e737320-48f4-4ecd-8e07-43e2c69a44ff" title="materials.csv" contentType="text/csv">
```csv
colorName,vendorName,material,thickness,costSqFt,availableSqFt,imageUrl,popularity,isNew
Calacatta Quartz,Caesarstone,Quartz,3cm,50,100,https://example.com/images/calacatta-quartz.jpg,0.8,false
Black Granite,Local Supplier,Granite,2cm,40,80,black-granite.jpg,0.7,true
```

**Note**: If using URLs, ensure they are publicly accessible. If using local filenames, place images in `countertop_images` before deployment.

#### 6. Reuse Existing Files
Use the previously provided files for the frontend and PWA:
- `index.html`, `app.js`, `sw.js`, `manifest.json` (from prior responses).
- `input.css`, `tailwind.config.js`, `package.json` for Tailwind CSS.
- Generate `dist/output.css`:
  ```bash
  npm run build:css
  ```

#### 7. Populate `countertop_images` and `images`
- **countertop_images/**:
  - If CSV uses local filenames, add images (e.g., `calacatta-quartz.jpg`, `black-granite.jpg`).
  - If CSV uses URLs, `app.py` will download them on startup.
  - Add a fallback:
    ```bash
    curl -o countertop_images/fallback.jpg https://placehold.co/150x150
    ```
- **images/**:
  - Add `fallback.jpg`, `icon-192.png`, `icon-512.png` (convert SVG logo using convertio.co).

### Addressing Previous Errors
- **Regex Error (`Uncaught SyntaxError: Invalid regular expression: missing /`)**: Ensured regex patterns in `app.js` (e.g., `/^\d{5}$/`) are correct.
- **Shopyflow Conflicts**: Hosting on Flask avoids Webflow/Shopyflow injections. If using Webflow, disable Shopyflow in Project Settings → Integrations.
- **Null Error (`Cannot set properties of null`)**: Added `<div id="region-display">` and null checks in `app.js`.
- **Placeholder Errors (`via.placeholder.com`)**: Replaced with local `/images/fallback.jpg`.
- **Service Worker 404**: `sw.js` is served by Flask, fixing the 404.
- **Wized 404**: Removed Wized script (not needed).

### Deployment on Render
1. **Prepare Repository**:
   - Ensure all files are in the repo (see structure above).
   - Commit and push:
     ```bash
     git add .
     git commit -m "Add CSV processing and fix errors"
     git push origin main
     ```

2. **Deploy**:
   - Connect your GitHub repo to Render.
   - Create a new Web Service, select Python environment.
   - Configure environment variables in Render’s dashboard.
   - Deploy; Render will install dependencies from `requirements.txt` and run `Procfile`:
     ```bash
     echo "web: gunicorn app:app" > Procfile
     ```

3. **Verify CSV Processing**:
   - Check logs in Render’s dashboard for CSV processing messages (e.g., “Inserted countertop: Calacatta Quartz”).
   - Verify MongoDB has records:
     ```python
     from pymongo import MongoClient
     client = MongoClient('your-mongo-uri')
     db = client['countertops']
     print(list(db['images'].find({}, {'_id': 0})))
     ```
   - Confirm images in `countertop_images` (Render’s filesystem is ephemeral, so images are downloaded on startup).

### Testing
1. **Local Testing**:
   - Set environment variables:
     ```bash
     export PUBLISHED_CSV_MATERIALS=/path/to/materials.csv
     export MONGO_URI=mongodb://localhost:27017
     export BASE_URL=http://localhost:5000
     ```
   - Run:
     ```bash
     python app.py
     ```
   - Open `http://localhost:5000`.

2. **Render Testing**:
   - Access `https://your-app-name.onrender.com`.
   - Verify:
     - Pricing (e.g., `$237.50/sq ft` for Calacatta Quartz 3cm, West Coast).
     - Images load from `/countertop_images/`.
     - No console errors (F12 → Console).
     - PWA features (home screen installation, offline support).
   - Test on iPhone (app-like behavior) and PC (wide-screen layout).

### Additional Notes
- **CSV Hosting**: If `PUBLISHED_CSV_MATERIALS` is a URL, host the CSV on a reliable service (e.g., Google Drive, Dropbox, or your own server). Ensure it’s UTF-8 encoded to avoid parsing errors.[](https://help.shopify.com/en/manual/products/import-export/using-csv)
- **Image Sources**: If CSV URLs are unavailable, source images from vendors (e.g., Caesarstone) or stock libraries (Unsplash, Pexels).
- **MongoDB**: Use MongoDB Atlas for a hosted database in production.
- **Webflow**: If hosting on Webflow, upload `index.html`, `dist/output.css`, `/images/*`, and `manifest.json` to the Asset Manager, but serve `app.js` and `sw.js` from Flask.

If you encounter issues, please provide:
- The console log from Chrome DevTools.
- The Render URL and `/api/countertops` response.
- The CSV file or its URL for verification.
I’ll ensure the app leverages the CSV for images and pricing, fixing all errors![](https://render.com/docs/configure-environment-variables)
