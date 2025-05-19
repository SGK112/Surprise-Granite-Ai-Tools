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
MONGO_URI = "mongodb://localhost:27017" # Update to hosted MongoDB URI in production
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
BASE_URL = 'https://your-app-name.herokuapp.com' # Replace with your deployed URL

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

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
- Added routes for `index.html`, `app.js`, `sw.js`, `manifest.json`, `dist/output.css`, and `/images/fallback.jpg`.
- Created `STATIC_FOLDER` (`dist`) and `IMAGES_FOLDER` (`images`) for CSS and static images.
- Updated `BASE_URL` placeholder for production deployment.

#### 2. `index.html`
- **Purpose**: The main HTML file rendering the app’s UI, linking to CSS, JavaScript, and the manifest.
- **Content**: Includes React-based UI, Tailwind styles (via compiled `output.css`), and PWA metadata.

<xaiArtifact artifact_id="8fbeeebd-684e-4a3b-8536-200d96398a18" artifact_version_id="93fa9463-634d-4fce-bd80-22dc1c91176e" title="index.html" contentType="text/html">
```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <meta name="description" content="Compare and quote granite, quartz, and other countertops with Surprise Granite's interactive calculator.">
    <meta name="keywords" content="countertops, granite, quartz, quote, comparison, Surprise Granite">
    <meta name="author" content="Surprise Granite">
    <meta name="robots" content="index, follow">
    <meta property="og:title" content="Surprise Granite Countertop Comparison Quote">
    <meta property="og:description" content="Compare and quote granite, quartz, and other countertops with Surprise Granite's interactive calculator.">
    <meta property="og:image" content="/images/icon-192.png">
    <meta property="og:url" content="https://www.surprisegranite.com/compare-quote">
    <meta name="twitter:card" content="summary_large_image">
    <meta name="theme-color" content="#f5f5f5">
    <title>Surprise Granite Countertop Comparison Quote</title>
    <link rel="canonical" href="https://www.surprisegranite.com/compare-quote">
    <link rel="icon" href="/images/icon-192.png" type="image/png">
    <link rel="manifest" href="/manifest.json">
    <link rel="stylesheet" href="/dist/output.css">
    <script src="https://cdn.jsdelivr.net/npm/react@18.2.0/umd/react.production.min.js" defer></script>
    <script src="https://cdn.jsdelivr.net/npm/react-dom@18.2.0/umd/react-dom.production.min.js" defer></script>
    <script src="https://cdn.jsdelivr.net/npm/fuse.js@7.0.0/dist/fuse.min.js" defer></script>
    <script src="https://unpkg.com/jspdf@latest/dist/jspdf.umd.min.js" defer></script>
    <style>
        :root {
            --bg-primary: #f5f5f5;
            --bg-secondary: #ffffff;
            --text-primary: #1f2937;
            --text-secondary: #4b5563;
            --border-color: #e5e7eb;
            --accent-color: #2563eb;
            --error-color: #b91c1c;
            --success-color: #10b981;
            --shadow-color: rgba(0, 0, 0, 0.1);
        }
        [data-theme="dark"] {
            --bg-primary: #1f2937;
            --bg-secondary: #374151;
            --text-primary: #d1d5db;
            --text-secondary: #9ca3af;
            --border-color: #4b5563;
            --accent-color: #3b82f6;
            --error-color: #ef4444;
            --success-color: #34d399;
            --shadow-color: rgba(0, 0, 0, 0.3);
        }
        html, body {
            margin: 0;
            padding: 0;
            width: 100%;
            height: 100%;
            overflow-x: hidden;
            background-color: var(--bg-primary);
            color: var(--text-primary);
            transition: background-color 0.3s, color 0.3s;
            font-family: 'Inter', system-ui, sans-serif;
            box-sizing: border-box;
        }
        *, *:before, *:after {
            box-sizing: inherit;
        }
        .app-container {
            min-height: 100vh;
            width: 100%;
            max-width: 100vw;
            display: flex;
            flex-direction: column;
            padding-bottom: 5rem;
        }
        .material-badge {
            padding: 0.25rem 0.5rem;
            border-radius: 0.75rem;
            color: white;
            font-size: 0.75rem;
            font-weight: 500;
        }
        .color-swatch {
            width: 16px;
            height: 16px;
            border-radius: 4px;
            border: 1px solid var(--border-color);
            display: inline-block;
        }
        .bottom-nav {
            position: fixed;
            bottom: 0;
            left: 0;
            right: 0;
            background: var(--bg-secondary);
            border-top: 1px solid var(--border-color);
            z-index: 50;
            display: flex;
            justify-content: space-around;
            padding: 0.75rem 0;
            transition: background-color 0.3s;
            width: 100%;
            max-width: 100vw;
        }
        .card {
            background: var(--bg-secondary);
            border-radius: 12px;
            box-shadow: 0 2px 8px var(--shadow-color);
            transition: transform 0.2s, background-color 0.3s;
            padding: 1rem;
            width: 100%;
            max-width: 320px;
            margin: 0 auto;
        }
        .card:hover {
            transform: translateY(-2px);
        }
        .card img {
            width: 100%;
            height: 128px;
            object-fit: cover;
            border-radius: 8px;
            margin-bottom: 1rem;
        }
        .toast {
            position: fixed;
            bottom: 6rem;
            left: 50%;
            transform: translateX(-50%);
            background: var(--success-color);
            color: white;
            padding: 0.5rem 1rem;
            border-radius: 8px;
            z-index: 100;
            display: none;
            max-width: 90%;
            font-size: 0.9rem;
            transition: opacity 0.3s;
        }
        .toast.error {
            background: var(--error-color);
        }
        .animate-slide-up {
            animation: slideUp 0.3s ease-out;
        }
        @keyframes slideUp {
            from { transform: translateY(20px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
        }
        .animate-slide-in {
            animation: slideIn 0.3s ease-out;
        }
        @keyframes slideIn {
            from { transform: translateX(-20px); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }
        .error-message {
            background: #fee2e2;
            color: var(--error-color);
            padding: 0.75rem;
            border-radius: 8px;
            text-align: center;
            margin: 1rem auto;
            max-width: 90%;
            font-size: 0.9rem;
            transition: background-color 0.3s, color 0.3s;
        }
        [data-theme="dark"] .error-message {
            background: #7f1d1d;
        }
        .container {
            width: 100%;
            max-width: 1400px;
            padding: 1rem;
            flex: 1;
            margin: 0 auto;
        }
        .card-grid {
            display: flex;
            flex-direction: column;
            gap: 1rem;
            align-items: center;
        }
        .filter-panel {
            display: none;
            transition: opacity 0.3s, transform 0.3s;
        }
        .filter-panel.active {
            display: block;
            animation: slideIn 0.3s ease-out;
        }
        input, select, textarea, button {
            background: var(--bg-secondary);
            border: 1px solid var(--border-color);
            color: var(--text-primary);
            border-radius: 8px;
            padding: 0.5rem;
            font-size: 0.9rem;
            transition: background-color 0.3s, border-color 0.3s, color 0.3s;
            touch-action: manipulation;
            width: 100%;
        }
        input:focus, select:focus, textarea:focus {
            outline: none;
            border-color: var(--accent-color);
        }
        button {
            min-height: 44px;
            cursor: pointer;
        }
        button:disabled {
            background: #6b7280;
            cursor: not-allowed;
        }
        @media (min-width: 640px) {
            body { padding-bottom: 0; }
            .bottom-nav { display: none; }
            .container { padding: 2rem; }
            .card-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
                gap: 1.5rem;
            }
            .filter-panel { display: block; }
            .app-container { padding-bottom: 0; }
        }
        @media (min-width: 768px) {
            h1 { font-size: 2rem; }
            h2 { font-size: 1.5rem; }
            p, input, select, button, textarea { font-size: 1rem; }
        }
        @media (min-width: 1280px) {
            .container { max-width: 1600px; }
            .card-grid { gap: 2rem; }
        }
        .top-nav {
            display: none;
        }
        @media (min-width: 640px) {
            .top-nav {
                display: flex;
                justify-content: center;
                gap: 2rem;
                padding: 1rem 0;
                background: var(--bg-secondary);
                border-bottom: 1px solid var(--border-color);
                margin-bottom: 1rem;
                transition: background-color 0.3s, border-color 0.3s;
                max-width: 1400px;
                margin-left: auto;
                margin-right: auto;
            }
        }
        .theme-toggle {
            position: absolute;
            top: 1rem;
            right: 1rem;
            width: 32px;
            height: 32px;
            padding: 0.25rem;
            border-radius: 4px;
            background: var(--bg-secondary);
            transition: background-color 0.3s;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10;
        }
        .theme-toggle svg {
            width: 20px;
            height: 20px;
            color: var(--text-primary);
        }
        @media (min-width: 640px) {
            .theme-toggle {
                right: 2rem;
            }
        }
        @media (max-width: 639px) {
            input, select, textarea {
                font-size: 16px;
            }
        }
    </style>
</head>
<body>
    <div id="root"></div>
    <div id="error" class="error-message hidden"></div>
    <div id="region-display" class="text-sm text-center" style="color: var(--text-secondary)"></div>
    <script src="/js/app.js"></script>
</body>
</html>
```

**Notes**:
- Uses compiled Tailwind CSS (`/dist/output.css`) to fix the CDN warning.
- Links to `app.js`, `sw.js`, and `manifest.json` served by Flask.
- Includes `<div id="region-display">` to fix the null `textContent` error.
- Uses local logo (`/images/icon-192.png`) for reliability.

#### 3. `app.js`
- **Purpose**: Contains the React-based JavaScript logic for the app, including UI rendering, state management, and API calls to `/api/countertops`.
- **Content**: Implements the `App` component, `fetchPriceList`, and error handling, with fixes for regex and null errors.

<xaiArtifact artifact_id="8fbeeebd-684e-4a3b-8536-200d96398a18" artifact_version_id="4a88a842-6d98-425e-b5da-d3a522126596" title="app.js" contentType="application/javascript">
```javascript
// Reset viewport scale and scroll on load
window.addEventListener('load', () => {
    document.body.style.zoom = '1';
    window.scrollTo(0, 0);
    history.scrollRestoration = 'manual';
});

// Utility Functions
const getColorSwatch = colorName => {
    const name = (colorName || '').toLowerCase();
    if (name.includes('white')) return '#F5F5F5';
    if (name.includes('black')) return '#1F2937';
    if (name.includes('blue')) return '#3B82F6';
    if (name.includes('gray')) return '#6B7280';
    return '#D1D5DB';
};

const getMaterialBadgeColor = material => {
    const m = (material || '').toLowerCase();
    if (m.includes('granite')) return 'bg-green-600';
    if (m.includes('quartz')) return 'bg-blue-600';
    if (m.includes('quartzite')) return 'bg-purple-600';
    if (m.includes('dekton')) return 'bg-gray-600';
    if (m.includes('porcelain')) return 'bg-red-600';
    return 'bg-gray-500';
};

const getWasteFactor = sqFt => {
    if (sqFt < 25) return 1.30;
    if (sqFt <= 50) return 1.20;
    return 1.15;
};

// React Component
function App() {
    const [priceData, setPriceData] = React.useState([]);
    const [quote, setQuote] = React.useState(JSON.parse(localStorage.getItem('quote')) || []);
    const [searchQuery, setSearchQuery] = React.useState(localStorage.getItem('searchQuery') || '');
    const [currentTab, setCurrentTab] = React.useState(localStorage.getItem('currentTab') || 'search');
    const [zipCode, setZipCode] = React.useState(localStorage.getItem('zipCode') || '');
    const [regionMultiplier, setRegionMultiplier] = React.useState(1.0);
    const [regionName, setRegionName] = React.useState('National Average');
    const [filters, setFilters] = React.useState(JSON.parse(localStorage.getItem('filters')) || { material: '', color: '', vendor: '' });
    const [showFilters, setShowFilters] = React.useState(false);
    const [toast, setToast] = React.useState({ message: '', show: false, isError: false });
    const [error, setError] = React.useState('');
    const [theme, setTheme] = React.useState(localStorage.getItem('theme') || 'light');

    React.useEffect(() => {
        fetchPriceList();
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
        localStorage.setItem('currentTab', currentTab);
        localStorage.setItem('searchQuery', searchQuery);
        localStorage.setItem('filters', JSON.stringify(filters));
        window.scrollTo(0, 0);
    }, [zipCode, theme, currentTab, searchQuery, filters]);

    const showToast = (message, isError = false) => {
        setToast({ message, show: true, isError });
        setTimeout(() => setToast({ message: '', show: false, isError: false }), 3000);
    };

    const showError = (message) => {
        setError(message);
        const errorDiv = document.getElementById('error');
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.classList.remove('hidden');
        } else {
            console.warn('Error div not found');
        }
    };

    const toggleTheme = () => {
        setTheme(theme === 'light' ? 'dark' : 'light');
    };

    const fetchPriceList = async () => {
        try {
            const response = await fetch('https://your-app-name.herokuapp.com/api/countertops', {
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(5000)
            });
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            const rawData = await response.json();
            const processedData = rawData.flatMap((item, index) => 
                ['2cm', '3cm'].map(thickness => ({
                    id: `${item.colorName}-${item.vendorName}-${thickness}-${index}`,
                    colorName: item.colorName || 'Unknown',
                    vendorName: item.vendorName || 'Unknown',
                    thickness,
                    material: item.material || 'Unknown',
                    installedPricePerSqFt: (parseFloat(item.costSqFt || 0) * 3.25 + 35) * (thickness === '2cm' ? 0.9 : 1) * regionMultiplier,
                    availableSqFt: parseFloat(item.availableSqFt || 0),
                    imageUrl: item.imageUrl || '/images/fallback.jpg',
                    popularity: item.popularity || Math.random(),
                    isNew: item.isNew || Math.random() > 0.8
                }))
            );
            setPriceData(processedData);
        } catch (err) {
            console.error('Fetch error:', err.message);
            setPriceData([{
                id: 'mock-granite-2cm-0',
                colorName: 'Mock Granite',
                vendorName: 'Mock Vendor',
                thickness: '2cm',
                material: 'Granite',
                installedPricePerSqFt: 50 * regionMultiplier,
                availableSqFt: 100,
                imageUrl: '/images/fallback.jpg',
                popularity: 0.8,
                isNew: false
            }]);
            showError('Failed to load countertop data. Using mock data.');
        }
    };

    const addToQuote = (item) => {
        if (quote.some(q => q.id === item.id)) return;
        const newQuote = [...quote, { ...item, sqFt: 25 }];
        setQuote(newQuote);
        localStorage.setItem('quote', JSON.stringify(newQuote));
        showToast(`${item.colorName} added to cart`);
    };

    const removeFromQuote = (index) => {
        const newQuote = quote.filter((_, i) => i !== index);
        setQuote(newQuote);
        localStorage.setItem('quote', JSON.stringify(newQuote));
        showToast('Item removed from cart');
    };

    const updateSqFt = (index, value) => {
        const parsedValue = parseFloat(value);
        if (isNaN(parsedValue) || parsedValue <= 0) {
            showToast('Please enter a valid square footage', true);
            return;
        }
        const newQuote = [...quote];
        newQuote[index].sqFt = parsedValue;
        setQuote(newQuote);
        localStorage.setItem('quote', JSON.stringify(newQuote));
    };

    const handleZipSubmit = () => {
        if (!/^\d{5}$/.test(zipCode)) {
            showToast('Invalid ZIP code', true);
            return;
        }
        localStorage.setItem('zipCode', zipCode);
        const region = zipCode.startsWith('85') ? { name: 'Southwest', multiplier: 1.0 } :
                      zipCode.startsWith('1') ? { name: 'Northeast', multiplier: 1.25 } :
                      zipCode.startsWith('9') ? { name: 'West Coast', multiplier: 1.2 } :
                      zipCode.startsWith('6') ? { name: 'Midwest', multiplier: 1.1 } :
                      { name: 'Southeast', multiplier: 1.05 };
        setRegionName(region.name);
        setRegionMultiplier(region.multiplier);
        const regionDisplay = document.getElementById('region-display');
        if (regionDisplay) {
            regionDisplay.textContent = `Region: ${region.name}`;
        }
        showToast(`Region set to ${region.name}`);
    };

    const handleQuoteSubmit = (e) => {
        e.preventDefault();
        const name = e.target.name.value;
        const email = e.target.email.value;
        if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showToast('Please provide a valid name and email', true);
            return;
        }
        showToast('Quote submitted successfully');
        e.target.reset();
        setCurrentTab('search');
    };

    const vendors = [...new Set(priceData.map(item => item.vendorName))].sort();

    const filteredResults = priceData.filter(item => {
        const matchesSearch = !searchQuery || item.colorName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                             item.material.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesMaterial = !filters.material || item.material === filters.material;
        const matchesColor = !filters.color || item.colorName.toLowerCase().includes(filters.color.toLowerCase());
        const matchesVendor = !filters.vendor || item.vendorName === filters.vendor;
        return matchesSearch && matchesMaterial && matchesColor && matchesVendor;
    });

    return React.createElement('div', { className: 'app-container' },
        React.createElement('div', { className: 'container relative' },
            // Theme Toggle
            React.createElement('button', {
                onClick: toggleTheme,
                className: 'theme-toggle',
                'aria-label': `Switch to ${theme === 'light' ? 'dark' : 'light'} mode`
            },
                theme === 'light' ?
                    React.createElement('svg', {
                        fill: 'none',
                        viewBox: '0 0 24 24',
                        stroke: 'currentColor'
                    }, React.createElement('path', {
                        strokeLinecap: 'round',
                        strokeLinejoin: 'round',
                        strokeWidth: '2',
                        d: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z'
                    })) :
                    React.createElement('svg', {
                        fill: 'none',
                        viewBox: '0 0 24 24',
                        stroke: 'currentColor'
                    }, React.createElement('path', {
                        strokeLinecap: 'round',
                        strokeLinejoin: 'round',
                        strokeWidth: '2',
                        d: 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z'
                    }))
            ),

            // Top Navigation (Desktop)
            React.createElement('nav', { className: 'top-nav' },
                React.createElement('button', {
                    onClick: () => setCurrentTab('search'),
                    className: `px-4 py-2 font-medium ${currentTab === 'search' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-600'}`,
                    style: { color: currentTab === 'search' ? 'var(--accent-color)' : 'var(--text-secondary)' }
                }, 'Search'),
                React.createElement('button', {
                    onClick: () => setCurrentTab('cart'),
                    className: `px-4 py-2 font-medium ${currentTab === 'cart' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-600'}`,
                    style: { color: currentTab === 'cart' ? 'var(--accent-color)' : 'var(--text-secondary)' }
                }, 'Cart'),
                React.createElement('button', {
                    onClick: () => setCurrentTab('quote'),
                    className: `px-4 py-2 font-medium ${currentTab === 'quote' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-600'}`,
                    style: { color: currentTab === 'quote' ? 'var(--accent-color)' : 'var(--text-secondary)' }
                }, 'Quote')
            ),

            // Header
            React.createElement('header', { className: 'text-center mb-6 relative' },
                React.createElement('img', {
                    src: '/images/icon-192.png',
                    alt: 'Surprise Granite Logo',
                    className: 'h-12 mx-auto mb-4 max-w-full'
                }),
                React.createElement('h1', { className: 'font-bold', style: { color: 'var(--accent-color)' } }, 'Countertop Quote'),
                React.createElement('p', { className: 'mt-2 text-sm', style: { color: 'var(--text-secondary)' } }, 'Compare and get quotes for your perfect countertops')
            ),

            // ZIP Code Input
            React.createElement('div', { className: 'mb-6 flex flex-col sm:flex-row gap-2 max-w-md mx-auto' },
                React.createElement('input', {
                    type: 'text',
                    value: zipCode,
                    onChange: e => setZipCode(e.target.value),
                    placeholder: 'ZIP Code',
                    className: 'flex-1 p-2 border rounded-lg',
                    maxLength: '5',
                    pattern: '[0-9]{5}'
                }),
                React.createElement('button', {
                    onClick: handleZipSubmit,
                    className: 'bg-blue-600 text-white px-4 py-2 rounded-lg sm:w-auto w-full',
                    style: { backgroundColor: 'var(--accent-color)' }
                }, 'Update')
            ),

            // Search Tab
            currentTab === 'search' && React.createElement('div', { className: 'animate-slide-up', style: { transition: 'opacity 0.3s' } },
                React.createElement('div', { className: 'relative mb-4 max-w-md mx-auto' },
                    React.createElement('input', {
                        type: 'search',
                        value: searchQuery,
                        onChange: e => setSearchQuery(e.target.value),
                        placeholder: 'Search colors, materials...',
                        className: 'w-full p-2 pl-10 border rounded-lg'
                    }),
                    React.createElement('svg', {
                        className: 'absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5',
                        style: { color: 'var(--text-secondary)' },
                        fill: 'none',
                        viewBox: '0 0 24 24',
                        stroke: 'currentColor'
                    }, React.createElement('path', {
                        strokeLinecap: 'round',
                        strokeLinejoin: 'round',
                        strokeWidth: '2',
                        d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
                    }))
                ),

                React.createElement('button', {
                    onClick: () => setShowFilters(!showFilters),
                    className: 'w-full max-w-md mx-auto p-2 rounded-lg text-left mb-4 sm:hidden',
                    style: { backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }
                }, showFilters ? 'Hide Filters' : 'Show Filters'),

                React.createElement('div', { className: `filter-panel ${showFilters ? 'active' : ''} sm:block grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4 max-w-4xl mx-auto` },
                    React.createElement('div', null,
                        React.createElement('label', { className: 'block text-sm font-medium', style: { color: 'var(--text-primary)' } }, 'Material'),
                        React.createElement('select', {
                            value: filters.material,
                            onChange: e => setFilters({ ...filters, material: e.target.value }),
                            className: 'w-full p-2 border rounded-lg'
                        },
                            React.createElement('option', { value: '' }, 'All Materials'),
                            React.createElement('option', { value: 'Granite' }, 'Granite'),
                            React.createElement('option', { value: 'Quartz' }, 'Quartz'),
                            React.createElement('option', { value: 'Quartzite' }, 'Quartzite'),
                            React.createElement('option', { value: 'Dekton' }, 'Dekton'),
                            React.createElement('option', { value: 'Porcelain' }, 'Porcelain')
                        )
                    ),
                    React.createElement('div', null,
                        React.createElement('label', { className: 'block text-sm font-medium', style: { color: 'var(--text-primary)' } }, 'Color'),
                        React.createElement('select', {
                            value: filters.color,
                            onChange: e => setFilters({ ...filters, color: e.target.value }),
                            className: 'w-full p-2 border rounded-lg'
                        },
                            React.createElement('option', { value: '' }, 'All Colors'),
                            React.createElement('option', { value: 'White' }, 'White'),
                            React.createElement('option', { value: 'Black' }, 'Black'),
                            React.createElement('option', { value: 'Blue' }, 'Blue'),
                            React.createElement('option', { value: 'Gray' }, 'Gray'),
                            React.createElement('option', { value: 'Neutral' }, 'Neutral')
                        )
                    ),
                    React.createElement('div', null,
                        React.createElement('label', { className: 'block text-sm font-medium', style: { color: 'var(--text-primary)' } }, 'Vendor'),
                        React.createElement('select', {
                            value: filters.vendor,
                            onChange: e => setFilters({ ...filters, vendor: e.target.value }),
                            className: 'w-full p-2 border rounded-lg'
                        },
                            React.createElement('option', { value: '' }, 'All Vendors'),
                            vendors.map(vendor => React.createElement('option', { key: vendor, value: vendor }, vendor))
                        )
                    )
                ),

                React.createElement('div', { className: 'card-grid' },
                    filteredResults.length === 0 ?
                        React.createElement('p', { className: 'text-center col-span-full', style: { color: 'var(--text-secondary)' } }, 'No results found') :
                        filteredResults.map(item => React.createElement('div', {
                            key: item.id,
                            className: 'card'
                        },
                            React.createElement('img', {
                                src: item.imageUrl,
                                alt: item.colorName,
                                className: 'w-full h-32 object-cover rounded-lg mb-4 max-w-full',
                                loading: 'lazy'
                            }),
                            React.createElement('h3', {
                                className: 'font-semibold flex items-center text-base',
                                style: { color: 'var(--text-primary)' }
                            },
                                React.createElement('span', {
                                    className: 'color-swatch mr-2',
                                    style: { borderColor: 'var(--border-color)', backgroundColor: getColorSwatch(item.colorName) }
                                }),
                                item.colorName
                            ),
                            React.createElement('p', { className: 'text-sm', style: { color: 'var(--text-secondary)' } },
                                'Material: ',
                                React.createElement('span', {
                                    className: `material-badge ${getMaterialBadgeColor(item.material)}`
                                }, item.material)
                            ),
                            React.createElement('p', { className: 'text-sm', style: { color: 'var(--text-secondary)' } },
                                'Vendor: ', item.vendorName
                            ),
                            React.createElement('p', { className: 'text-sm', style: { color: 'var(--text-secondary)' } },
                                'Price: $', item.installedPricePerSqFt.toFixed(2), '/sq ft'
                            ),
                            React.createElement('button', {
                                onClick: () => addToQuote(item),
                                disabled: quote.some(q => q.id === item.id),
                                className: 'w-full mt-4 text-white p-2 rounded-lg',
                                style: { backgroundColor: quote.some(q => q.id === item.id) ? '#6b7280' : 'var(--accent-color)' }
                            }, quote.some(q => q.id === item.id) ? 'In Cart' : 'Add to Cart')
                        ))
                )
            ),

            // Cart Tab
            currentTab === 'cart' && React.createElement('div', { className: 'animate-slide-up', style: { transition: 'opacity 0.3s' } },
                React.createElement('h2', {
                    className: 'text-xl font-bold mb-4 text-center',
                    style: { color: 'var(--text-primary)' }
                }, 'Your Cart'),
                quote.length === 0 ?
                    React.createElement('p', {
                        className: 'text-center',
                        style: { color: 'var(--text-secondary)' }
                    }, 'Your cart is empty') :
                    React.createElement('div', { className: 'card-grid' },
                        quote.map((item, index) => React.createElement('div', {
                            key: item.id,
                            className: 'card'
                        },
                            React.createElement('img', {
                                src: item.imageUrl,
                                alt: item.colorName,
                                className: 'w-full h-32 object-cover rounded-lg mb-4 max-w-full',
                                loading: 'lazy'
                            }),
                            React.createElement('h3', {
                                className: 'font-semibold text-base',
                                style: { color: 'var(--text-primary)' }
                            }, item.colorName),
                            React.createElement('p', {
                                className: 'text-sm',
                                style: { color: 'var(--text-secondary)' }
                            },
                                'Material: ',
                                React.createElement('span', {
                                    className: `material-badge ${getMaterialBadgeColor(item.material)}`
                                }, item.material)
                            ),
                            React.createElement('p', {
                                className: 'text-sm',
                                style: { color: 'var(--text-secondary)' }
                            }, 'Vendor: ', item.vendorName),
                            React.createElement('div', { className: 'mt-2' },
                                React.createElement('label', {
                                    className: 'block text-sm',
                                    style: { color: 'var(--text-primary)' }
                                }, 'Area (sq ft)'),
                                React.createElement('input', {
                                    type: 'number',
                                    value: item.sqFt,
                                    onChange: e => updateSqFt(index, e.target.value),
                                    className: 'w-full p-2 border rounded-lg',
                                    min: '0',
                                    step: '0.01'
                                })
                            ),
                            React.createElement('p', {
                                className: 'text-sm mt-2',
                                style: { color: 'var(--text-secondary)' }
                            },
                                'Cost: $', (item.sqFt * getWasteFactor(item.sqFt) * item.installedPricePerSqFt).toFixed(2)
                            ),
                            React.createElement('button', {
                                onClick: () => removeFromQuote(index),
                                className: 'w-full mt-4 text-white p-2 rounded-lg',
                                style: { backgroundColor: 'var(--error-color)' }
                            }, 'Remove')
                        ))
                    ),
                quote.length > 0 && React.createElement('button', {
                    onClick: () => setCurrentTab('quote'),
                    className: 'w-full max-w-md mx-auto text-white p-3 rounded-lg mt-6 block',
                    style: { backgroundColor: 'var(--accent-color)' }
                }, 'Get Quote')
            ),

            // Quote Tab
            currentTab === 'quote' && React.createElement('div', { className: 'animate-slide-up', style: { transition: 'opacity 0.3s' } },
                React.createElement('h2', {
                    className: 'text-xl font-bold mb-4 text-center',
                    style: { color: 'var(--text-primary)' }
                }, 'Get Your Quote'),
                React.createElement('form', {
                    onSubmit: handleQuoteSubmit,
                    className: 'card p-4 max-w-md mx-auto',
                    'data-wf-form': 'quote-form'
                },
                    React.createElement('div', { className: 'mb-4' },
                        React.createElement('label', {
                            className: 'block text-sm font-medium',
                            style: { color: 'var(--text-primary)' }
                        }, 'Name *'),
                        React.createElement('input', {
                            type: 'text',
                            name: 'name',
                            className: 'w-full p-2 border rounded-lg',
                            required: true
                        })
                    ),
                    React.createElement('div', { className: 'mb-4' },
                        React.createElement('label', {
                            className: 'block text-sm font-medium',
                            style: { color: 'var(--text-primary)' }
                        }, 'Email *'),
                        React.createElement('input', {
                            type: 'email',
                            name: 'email',
                            className: 'w-full p-2 border rounded-lg',
                            required: true
                        })
                    ),
                    React.createElement('div', { className: 'mb-4' },
                        React.createElement('label', {
                            className: 'block text-sm font-medium',
                            style: { color: 'var(--text-primary)' }
                        }, 'Phone (Optional)'),
                        React.createElement('input', {
                            type: 'tel',
                            name: 'phone',
                            className: 'w-full p-2 border rounded-lg'
                        })
                    ),
                    React.createElement('div', { className: 'mb-4' },
                        React.createElement('label', {
                            className: 'block text-sm font-medium',
                            style: { color: 'var(--text-primary)' }
                        }, 'Notes'),
                        React.createElement('textarea', {
                            name: 'notes',
                            className: 'w-full p-2 border rounded-lg',
                            rows: '4'
                        })
                    ),
                    React.createElement('button', {
                        type: 'submit',
                        className: 'w-full text-white p-3 rounded-lg',
                        style: { backgroundColor: 'var(--accent-color)' }
                    }, 'Submit Quote')
                )
            ),

            // Toast
            React.createElement('div', {
                className: `toast ${toast.show ? 'block' : 'hidden'} ${toast.isError ? 'error' : ''}`,
                style: { opacity: toast.show ? 1 : 0 }
            }, toast.message)
        ),

        // Bottom Navigation (Mobile)
        React.createElement('nav', { className: 'bottom-nav' },
            React.createElement('button', {
                onClick: () => setCurrentTab('search'),
                className: `flex flex-col items-center min-w-[80px] ${currentTab === 'search' ? 'text-blue-600' : ''}`,
                style: { color: currentTab === 'search' ? 'var(--accent-color)' : 'var(--text-secondary)' }
            },
                React.createElement('svg', {
                    className: 'w-6 h-6 mb-1',
                    fill: 'none',
                    viewBox: '0 0 24 24',
                    stroke: 'currentColor'
                }, React.createElement('path', {
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                    strokeWidth: '2',
                    d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
                })),
                'Search'
            ),
            React.createElement('button', {
                onClick: () => setCurrentTab('cart'),
                className: `flex flex-col items-center min-w-[80px] ${currentTab === 'cart' ? 'text-blue-600' : ''}`,
                style: { color: currentTab === 'cart' ? 'var(--accent-color)' : 'var(--text-secondary)' }
            },
                React.createElement('svg', {
                    className: 'w-6 h-6 mb-1',
                    fill: 'none',
                    viewBox: '0 0 24 24',
                    stroke: 'currentColor'
                }, React.createElement('path', {
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                    strokeWidth: '2',
                    d: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z'
                })),
                'Cart'
            ),
            React.createElement('button', {
                onClick: () => setCurrentTab('quote'),
                className: `flex flex-col items-center min-w-[80px] ${currentTab === 'quote' ? 'text-blue-600' : ''}`,
                style: { color: currentTab === 'quote' ? 'var(--accent-color)' : 'var(--text-secondary)' }
            },
                React.createElement('svg', {
                    className: 'w-6 h-6 mb-1',
                    fill: 'none',
                    viewBox: '0 0 24 24',
                    stroke: 'currentColor'
                }, React.createElement('path', {
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                    strokeWidth: '2',
                    d: 'M3 3h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z'
                })),
                'Quote'
            )
        )
    );
}

// Render App
document.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (window.React && window.ReactDOM) {
            ReactDOM.render(React.createElement(App), document.getElementById('root'));
        } else {
            const errorDiv = document.getElementById('error');
            if (errorDiv) {
                errorDiv.textContent = 'Failed to load React. Please refresh the page.';
                errorDiv.classList.remove('hidden');
            }
        }
    }, 100);
});

// Service Worker Registration
if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost')) {
    window.addEventListener('load', async () => {
        try {
            await navigator.serviceWorker.register('/sw.js');
            console.log('Service Worker registered');
        } catch (err) {
            console.warn('Service Worker registration failed:', err.message);
        }
    });
}
```

**Notes**:
- Fixes the `Uncaught SyntaxError: Invalid regular expression: missing /` by ensuring regex patterns (e.g., `/^\d{5}$/`, `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) are correct.
- Adds null check for `region-display` to fix `Cannot set properties of null (setting 'textContent')`.
- Uses Flask server’s `/api/countertops` endpoint.
- Includes local fallback (`/images/fallback.jpg`) to avoid `via.placeholder.com` errors.

#### 4. `sw.js`
- **Purpose**: Service worker for PWA offline support, caching resources and images.
- **Content**: Caches critical files and dynamically caches `countertop_images`.

<xaiArtifact artifact_id="8fbeeebd-684e-4a3b-8536-200d96398a18" artifact_version_id="78cc4402-2bbd-4694-8164-2f713452dfe8" title="sw.js" contentType="application/javascript">
```javascript
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open('granite-quote-v1').then(cache => {
            return cache.addAll([
                '/',
                '/manifest.json',
                '/dist/output.css',
                '/js/app.js',
                '/images/fallback.jpg',
                '/images/icon-192.png',
                '/images/icon-512.png'
            ]);
        })
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request).then(response => {
            return response || fetch(event.request).then(fetchResponse => {
                if (event.request.url.includes('/countertop_images/')) {
                    caches.open('granite-quote-v1').then(cache => {
                        cache.put(event.request, fetchResponse.clone());
                    });
                }
                return fetchResponse;
            });
        }).catch(() => {
            if (event.request.url.includes('/countertop_images/')) {
                return caches.match('/images/fallback.jpg');
            }
        })
    );
});
```

**Notes**:
- Fixes the service worker 404 by serving `sw.js` via Flask.
- Caches essential files for offline support.

#### 5. `manifest.json`
- **Purpose**: Web app manifest for PWA features (e.g., home screen installation).
- **Content**: Defines app metadata and icons.

<xaiArtifact artifact_id="8fbeeebd-684e-4a3b-8536-200d96398a18" artifact_version_id="5f950c85-45a6-46a9-b41a-e1ad16c9fd00" title="manifest.json" contentType="application/json">
```json
{
    "name": "Surprise Granite Countertop Quote",
    "short_name": "Granite Quote",
    "start_url": "/",
    "display": "standalone",
    "background_color": "#f5f5f5",
    "theme_color": "#2563eb",
    "icons": [
        {
            "src": "/images/icon-192.png",
            "sizes": "192x192",
            "type": "image/png"
        },
        {
            "src": "/images/icon-512.png",
            "sizes": "512x512",
            "type": "image/png"
        }
    ]
}
```

**Notes**:
- Fixes the invalid `<script>` manifest issue by using a proper JSON file.
- Uses local PNG icons for reliability.

#### 6. `input.css`
- **Purpose**: Input file for Tailwind CSS compilation.
- **Content**: Imports Tailwind’s base, components, and utilities.

<xaiArtifact artifact_id="8fbeeebd-684e-4a3b-8536-200d96398a18" artifact_version_id="ec65935e-3f9f-4c37-a78c-7a8f8929c27a" title="input.css" contentType="text/css">
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

#### 7. `tailwind.config.js`
- **Purpose**: Configures Tailwind CSS for purging unused styles.
- **Content**: Specifies files to scan for Tailwind classes.

<xaiArtifact artifact_id="8fbeeebd-684e-4a3b-8536-200d96398a18" artifact_version_id="472859ee-100a-483d-ac39-43adf898e8d3" title="tailwind.config.js" contentType="application/javascript">
```javascript
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './app.js'
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

#### 8. `package.json`
- **Purpose**: Defines Node.js dependencies and scripts for building Tailwind CSS.
- **Content**: Includes Tailwind and build script.

<xaiArtifact artifact_id="8fbeeebd-684e-4a3b-8536-200d96398a18" artifact_version_id="33206887-a8bc-4dd5-b7d1-5eca7a4bb428" title="package.json" contentType="application/json">
```json
{
  "name": "countertop-app",
  "version": "1.0.0",
  "description": "Surprise Granite Countertop Comparison Quote",
  "main": "app.js",
  "scripts": {
    "build:css": "tailwindcss -i ./input.css -o ./dist/output.css --minify"
  },
  "dependencies": {},
  "devDependencies": {
    "tailwindcss": "^3.4.3",
    "postcss": "^8.4.38",
    "autoprefixer": "^10.4.19"
  }
}
```

**Notes**:
- Run `npm install` to install dependencies.
- Run `npm run build:css` to generate `dist/output.css`.

#### 9. `dist/output.css`
- **Purpose**: Compiled Tailwind CSS file with optimized styles.
- **Content**: Generated by running:
  ```bash
  npm run build:css
  ```
- **Note**: Ensure `dist/output.css` is in the `dist` directory and served by Flask.

#### 10. `countertop_images/`
- **Purpose**: Stores countertop images (e.g., `calacatta-quartz.jpg`) served by `/countertop_images/<filename>`.
- **Content**:
  - Add sample images:
    ```bash
    mkdir countertop_images
    curl -o countertop_images/calacatta-quartz.jpg https://example.com/sample-quartz.jpg
    curl -o countertop_images/black-granite.jpg https://example.com/sample-granite.jpg
    curl -o countertop_images/fallback.jpg https://placehold.co/150x150
    ```
  - Source real images from vendors (e.g., Caesarstone, Cosentino) or stock libraries (Unsplash, Pexels).
- **Note**: Ensure MongoDB `imageUrl` fields match filenames (e.g., `calacatta-quartz.jpg`).

#### 11. `images/`
- **Purpose**: Stores static images for PWA icons and fallbacks.
- **Content**:
  - `fallback.jpg`: Fallback image for failed loads.
  - `icon-192.png`, `icon-512.png`: PWA icons (convert from SVG using convertio.co).
  - Create directory and add files:
    ```bash
    mkdir images
    curl -o images/fallback.jpg https://placehold.co/150x150
    # Add icon-192.png and icon-512.png after converting SVG
    ```

### Deployment and Testing
1. **Setup Project**:
   - Create the directory structure and add all files.
   - Install Node.js dependencies:
     ```bash
     npm install
     ```
   - Build CSS:
     ```bash
     npm run build:css
     ```
   - Populate MongoDB (see `app.py` instructions above).

2. **Run Locally**:
   - Start MongoDB:
     ```bash
     mongod
     ```
   - Run Flask:
     ```bash
     python app.py
     ```
   - Open `http://localhost:5000` in a browser.

3. **Deploy to Heroku**:
   - Create a `Procfile`:
     ```bash
     echo "web: gunicorn app:app" > Procfile
     ```
   - Create `requirements.txt`:
     ```bash
     echo "Flask==2.3.2\npymongo==4.6.3\ngunicorn==22.0.0" > requirements.txt
     ```
   - Deploy:
     ```bash
     heroku create your-app-name
     git add .
     git commit -m "Deploy app with all files"
     git push heroku main
     ```
   - Update `BASE_URL` in `app.py` and MongoDB URI.

4. **Test**:
   - **Errors**: Confirm no `Uncaught SyntaxError: Invalid regular expression`, `textContent` null errors, or placeholder image failures in DevTools (F12 → Console).
   - **Pricing**: Verify `installedPricePerSqFt` (e.g., `$237.50/sq ft` for Calacatta Quartz 3cm, West Coast).
   - **Images**: Check images load from `/countertop_images/` and fallback to `/images/fallback.jpg`.
   - **PWA**: Test home screen installation and offline support (Application → Service Workers).
   - **Devices**: Ensure iPhone (app-like, no zooming) and PC (wide-screen layout) functionality.

### Addressing Previous Errors
- **Regex Error**: Fixed by validating regex patterns in `handleZipSubmit` and `handleQuoteSubmit`.
- **Shopyflow**: Disable in Webflow or host on Flask to avoid conflicts.
- **Null Error**: Added `region-display` and null checks.
- **Wized 404**: Removed Wized script (not needed).
- **Placeholder Errors**: Replaced `via.placeholder.com` with local fallback.
- **Service Worker 404**: Served `sw.js` via Flask.

### Additional Notes
- **Webflow**: If hosting on Webflow, upload `index.html`, `dist/output.css`, `/images/*`, and `manifest.json` to the Asset Manager, but serve `app.js` and `sw.js` from Flask to avoid minification issues.
- **MongoDB**: Use a hosted service (e.g., MongoDB Atlas) for production.
- **CDN**: For production, use Cloudinary for images:
  ```python
  BASE_URL = 'https://res.cloudinary.com/your-account/image/upload/'
  ```

If you encounter issues, please provide:
- The full console log from Chrome DevTools.
- The deployed Flask server URL and `/api/countertops` response.
- Confirmation of file presence and MongoDB data.
I’ll ensure the app works fully across your devices!
