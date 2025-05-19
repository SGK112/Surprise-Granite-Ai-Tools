```python
from flask import Flask, send_from_directory, request, jsonify
from pymongo import MongoClient
import os
import csv
import requests
from urllib.parse import quote, urlparse
from werkzeug.utils import secure_filename
from PIL import Image

app = Flask(__name__)

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
    return send_from_directory('.', 'sw.js')

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
            'colorPattern': 'Unknown',
            'isNaturalStone': False,
            'damageType': 'None',
            'severity': 'None',
            'estimatedCost': 'N/A'
        }
    })

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)
```

#### 2. `requirements.txt`
<xaiArtifact artifact_id="8fbeeebd-684e-4a3b-8536-200d96398a18" artifact_version_id="25b26bcf-3f6f-408b-9ee2-637e2ba1688c" title="requirements.txt" contentType="text/plain">
```
Flask==2.3.2
pymongo==4.6.3
gunicorn==22.0.0
requests==2.31.0
Pillow==10.3.0
```

#### 3. `Procfile`
<xaiArtifact artifact_id="8fbeeebd-684e-4a3b-8536-200d96398a18" artifact_version_id="e6ef2dad-16be-49e8-8e89-052ef156fc48" title="Procfile" contentType="text/plain">
```
web: gunicorn app:app
```

### Front-End Files

#### 4. `index.html`
<xaiArtifact artifact_id="8fbeeebd-684e-4a3b-8536-200d96398a18" artifact_version_id="98ea4d3b-aafb-48df-adf7-3b68161ae551" title="index.html" contentType="text/html">
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
            padding: 0.75rem 1.5rem;
            border-radius: 8px;
            z-index: 1000;
            max-width: 90%;
            font-size: 1rem;
            opacity: 0;
            transition: opacity 0.3s;
        }
        .toast.show {
            opacity: 1;
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
                padding: 2rem 4rem;
                background: var(--bg-secondary);
                border-bottom: 1px solid var(--border-color);
                margin-bottom: 1rem;
                transition: background-color 0.3s, border-color 0.3s;
                max-width: 1400px;
                margin-left: auto;
                margin-right: auto;
                position: relative;
                z-index: 50;
            }
        }
        .theme-toggle {
            position: fixed;
            top: 0.5rem;
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
            z-index: 100;
        }
        .theme-toggle svg {
            width: 20px;
            height: 20px;
            color: var(--text-primary);
        }
        @media (min-width: 640px) {
            .theme-toggle {
                right: 1rem;
                top: 0.5rem;
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

#### 5. `app.js`
<xaiArtifact artifact_id="8fbeeebd-684e-4a3b-8536-200d96398a18" artifact_version_id="ca025c30-b78e-4dba-a6e9-bf6fb3a4fa7f" title="app.js" contentType="application/javascript">
```javascript
window.addEventListener('load', () => {
    document.body.style.zoom = '1';
    window.scrollTo(0, 0);
    history.scrollRestoration = 'manual';
});

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

const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value);
};

const debounce = (func, delay) => {
    let timeoutId;
    return (...args) => {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => func(...args), delay);
    };
};

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
        }
    };

    const toggleTheme = () => {
        setTheme(theme === 'light' ? 'dark' : 'light');
    };

    const fetchPriceList = async () => {
        try {
            const response = await fetch('/api/countertops', {
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
        if (quote.some(q => q.id === item.id)) {
            showToast(`${item.colorName} is already in cart`, true);
            return;
        }
        const newQuote = [...quote, { ...item, sqFt: 10 }];
        setQuote(newQuote);
        localStorage.setItem('quote', JSON.stringify(newQuote));
        showToast(`${item.colorName} added to cart`);
        setCurrentTab('cart');
    };

    const removeFromQuote = (index) => {
        const newQuote = quote.filter((_, i) => i !== index);
        setQuote(newQuote);
        localStorage.setItem('quote', JSON.stringify(newQuote));
        showToast('Item removed from cart');
    };

    const updateSqFt = (index, value) => {
        const parsedValue = parseFloat(value);
        if (isNaN(parsedValue) || parsedValue < 0) {
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

    const handleSearchChange = debounce((value) => {
        setSearchQuery(value);
    }, 300);

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
            React.createElement('header', { className: 'text-center mb-6 relative' },
                React.createElement('img', {
                    src: '/images/icon-192.png',
                    alt: 'Surprise Granite Logo',
                    className: 'h-12 mx-auto mb-4 max-w-full'
                }),
                React.createElement('h1', { className: 'font-bold', style: { color: 'var(--accent-color)' } }, 'Countertop Quote'),
                React.createElement('p', { className: 'mt-2 text-sm', style: { color: 'var(--text-secondary)' } }, 'Compare and get quotes for your perfect countertops')
            ),
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
            currentTab === 'search' && React.createElement('div', { className: 'animate-slide-up', style: { transition: 'opacity 0.3s' } },
                React.createElement('div', { className: 'relative mb-4 max-w-md mx-auto' },
                    React.createElement('input', {
                        type: 'search',
                        value: searchQuery,
                        onChange: e => handleSearchChange(e.target.value),
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
                        React.createElement('label', { className: 'block text-sm font-medium', style: { color: 'var(--text-primary)' } }, 'Vendor'),
                        React.createElement('select', {
                            value: filters.vendor,
                            onChange: e => setFilters({ ...filters, vendor: e.target.value }),
                            className: 'w-full p-2 border rounded-lg'
                        },
                            React.createElement('option', { value: '' }, 'All Vendors'),
                            vendors.map(vendor => React.createElement('option', { key: vendor, value: vendor }, vendor))
                        )
                    ),
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
                                'Price: ', formatCurrency(item.installedPricePerSqFt), '/sq ft'
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
                                    value: item.sqFt.toString(),
                                    onChange: e => updateSqFt(index, e.target.value),
                                    onBlur: e => updateSqFt(index, e.target.value),
                                    className: 'w-full p-2 border rounded-lg',
                                    min: '0',
                                    step: '0.01',
                                    placeholder: 'Enter sq ft'
                                })
                            ),
                            React.createElement('p', {
                                className: 'text-sm mt-2',
                                style: { color: 'var(--text-secondary)' }
                            },
                                'Cost: ', formatCurrency(item.sqFt * getWasteFactor(item.sqFt) * item.installedPricePerSqFt)
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
            React.createElement('div', {
                className: `toast ${toast.show ? 'show' : ''} ${toast.isError ? 'error' : ''}`,
                style: { opacity: toast.show ? 1 : 0 }
            }, toast.message)
        ),
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

if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost')) {
    window.addEventListener('load', async () => {
        try {
            await navigator.serviceWorker.register('/sw.js');
        } catch (err) {}
    });
}
```

#### 6. `sw.js`
<xaiArtifact artifact_id="8fbeeebd-684e-4a3b-8536-200d96398a18" artifact_version_id="f726cc10-2453-4af0-902a-f1b947a76d86" title="sw.js" contentType="application/javascript">
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

#### 7. `manifest.json`
<xaiArtifact artifact_id="8fbeeebd-684e-4a3b-8536-200d96398a18" artifact_version_id="50245c8f-adeb-4f95-a24a-52748366f634" title="manifest.json" contentType="application/json">
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

#### 8. `input.css`
<xaiArtifact artifact_id="8fbeeebd-684e-4a3b-8536-200d96398a18" artifact_version_id="198c90d9-0324-4f87-8402-3d52152b7c18" title="input.css" contentType="text/css">
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

#### 9. `tailwind.config.js`
<xaiArtifact artifact_id="8fbeeebd-684e-4a3b-8536-200d96398a18" artifact_version_id="278a576d-61bb-44a7-9d2b-76c178e5e798" title="tailwind.config.js" contentType="application/javascript">
```javascript
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

#### 10. `package.json`
<xaiArtifact artifact_id="8fbeeebd-684e-4a3b-8536-200d96398a18" artifact_version_id="0093960d-842b-4f72-8a6f-650fc1f1f291" title="package.json" contentType="application/json">
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

### Additional Setup
- **Images**:
  - **countertop_images/**: Add images or let `app.py` download from CSV. Include:
    ```bash
    curl -o countertop_images/fallback.jpg https://placehold.co/150x150
    ```
  - **images/**: Add `fallback.jpg`, `icon-192.png`, `icon-512.png` (convert SVG via convertio.co).
- **CSV**: If local, include `materials.csv` with format:
  ```csv
  colorName,vendorName,material,thickness,costSqFt,availableSqFt,imageUrl,popularity,isNew
  Calacatta Quartz,Caesarstone,Quartz,3cm,50,100,calacatta-quartz.jpg,0.8,false
  Black Granite,Local Supplier,Granite,2cm,40,80,black-granite.jpg,0.7,true
  ```

### Deployment
1. **Setup**:
   ```bash
   npm install
   pip install -r requirements.txt
   npm run build:css
   ```

2. **Local Testing**:
   ```bash
   export PUBLISHED_CSV_MATERIALS=/path/to/materials.csv
   export MONGO_URI=mongodb://localhost:27017
   export BASE_URL=http://localhost:5000
   python app.py
   ```
   Open `http://localhost:5000`.

3. **Render Deployment**:
   - Commit:
     ```bash
     git add .
     git commit -m "Clean app files"
     git push origin main
     ```
   - In Render, set:
     ```
     PUBLISHED_CSV_MATERIALS=https://example.com/materials.csv
     MONGO_URI=mongodb+srv://user:password@cluster.mongodb.net
     BASE_URL=https://your-app-name.onrender.com
     ```
   - Deploy via GitHub.

### Testing
- **Cart**: Add color; verify cart tab and toast.
- **Filters**: Vendors first.
- **Performance**: Smooth iPhone scrolling.
- **Square Footage**: Enter 10, 50, 10.5.
- **Prices**: `$1,700.00` format.
- **Theme Toggle**: No desktop overlap.
- **Errors**: No console errors (F12 → Console).

Provide console logs or Render URL if issues arise.
