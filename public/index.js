const formatCurrency = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(amount || 0);
const inToSqFt = (length, width) => (length * width) / 144;

// Debounce utility
const debounce = (func, wait) => {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
};

// Sanitize input to prevent XSS
const sanitizeInput = (value) => {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
};

// Validate input with error message
const validateInput = (input, isRequired = false) => {
    const value = input.value.trim();
    const errorMessage = document.getElementById(`${input.id}-error`);
    if (isRequired && (!value || isNaN(value) || parseFloat(value) <= 0)) {
        input.classList.add('error');
        errorMessage.textContent = `Please enter a valid ${input.id.replace(/-/g, ' ')}.`;
        errorMessage.classList.add('active');
        return false;
    }
    input.classList.remove('error');
    errorMessage.classList.remove('active');
    errorMessage.textContent = '';
    return true;
};

// Fetch with retry for handling network issues
const fetchWithRetry = async (url, options, retries = 3, delay = 1000) => {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.status === 429) {
                await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
                continue;
            }
            if (!response.ok) throw new Error(`HTTP error ${response.status}`);
            return await response.json();
        } catch (error) {
            if (i === retries - 1) throw error;
        }
    }
};

// Cache labor pricing
const getLaborPricing = async () => {
    const cached = localStorage.getItem('laborPricing');
    if (cached) return JSON.parse(cached);
    const data = await fetchWithRetry('https://surprise-granite-connections-dev.onrender.com/labor-pricing');
    if (!Array.isArray(data)) throw new Error('Invalid pricing data');
    localStorage.setItem('laborPricing', JSON.stringify(data));
    return data;
};

// Button loading state
const addLoadingState = (button) => {
    button.disabled = true;
    button.innerHTML = '<span class="spinner"></span> Loading...';
};

const removeLoadingState = (button, originalText) => {
    button.disabled = false;
    button.innerHTML = originalText;
};

document.addEventListener('DOMContentLoaded', async () => {
    let pricingMap = {};
    try {
        const laborPricing = await getLaborPricing();
        laborPricing.forEach(item => pricingMap[item.Code] = { price: item.Price, unit: item['U/M'], description: item.Description });
    } catch (error) {
        console.error('Failed to fetch labor pricing:', error);
        document.getElementById('estimator-results').innerHTML = '<p class="error">Unable to load pricing data. Please try again later.</p>';
        return;
    }

    // Toggle theme
    const toggleTheme = () => {
        document.body.classList.toggle('light-mode');
        const themeIcon = document.getElementById('themeToggle');
        themeIcon.classList.toggle('bi-moon-stars-fill');
        themeIcon.classList.toggle('bi-sun-fill');
        localStorage.setItem('theme', document.body.classList.contains('light-mode') ? 'light' : 'dark');
    };

    // Toggle navigation
    const toggleNav = () => {
        const navbar = document.getElementById('navbar');
        navbar.classList.toggle('open');
        document.getElementById('nav-toggle').setAttribute('aria-expanded', navbar.classList.contains('open'));
    };

    // Show tool
    const showTool = (toolId) => {
        document.querySelectorAll('.tool-card').forEach(card => card.classList.remove('active'));
        const activeTool = document.getElementById(`${toolId}-tool`);
        activeTool.classList.add('active');
        document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
        const activeNav = document.querySelector(`.nav-item[data-tool="${toolId}"]`);
        activeNav.classList.add('active');
        activeTool.querySelector('h2').focus();
        if (toolId === 'estimator') calculateEstimate();
    };

    // Toggle section
    const toggleSection = (header) => {
        const content = header.nextElementSibling;
        const isExpanded = content.classList.toggle('active');
        const icon = header.querySelector('i');
        icon.classList.toggle('bi-chevron-down');
        icon.classList.toggle('bi-chevron-up');
        header.setAttribute('aria-expanded', isExpanded);
    };

    // Toggle version
    const toggleVersion = () => {
        const isProMode = document.getElementById('version-toggle').checked;
        localStorage.setItem('isProMode', isProMode);
        calculateEstimate();
    };

    // Get form inputs
    const getInputs = () => ({
        clientName: document.getElementById('client-name').value || 'N/A',
        clientEmail: document.getElementById('client-email').value || 'N/A',
        projectAddress: document.getElementById('project-address').value || 'N/A',
        material: document.getElementById('material').value,
        slabName: document.getElementById('slab-name').value || 'N/A',
        slabTotalLength: parseFloat(document.getElementById('slab-total-length').value) || 0,
        slabTotalWidth: parseFloat(document.getElementById('slab-total-width').value) || 0,
        slabTotalSqFt: parseFloat(document.getElementById('slab-total-sqft').value) || 0,
        slabCostPerSqFt: parseFloat(document.getElementById('slab-cost-per-sqft').value) || 0,
        clientSqFt: parseFloat(document.getElementById('client-sqft').value) || 0,
        edgeType: document.getElementById('edge-type').value,
        waterfallSqFt: parseFloat(document.getElementById('waterfall-sqft').value) || 0,
        backsplashHeight: document.getElementById('backsplash-height').value,
        backsplashLinearIn: parseFloat(document.getElementById('backsplash-linear-in').value) || 0,
        demoType: document.getElementById('demo-type').value,
        plumbingType: document.getElementById('plumbing-type').value,
        cooktopCutout: document.getElementById('cooktop-cutout').value,
        delivery: document.getElementById('delivery')?.value || 'No',
        sinkCutout: document.getElementById('sink-cutout').value,
        cabinetStyle: document.getElementById('cabinet-style').value,
        cabinetQuantity: parseFloat(document.getElementById('cabinet-quantity').value) || 0,
        cabinetFinish: document.getElementById('cabinet-finish').value,
        cabinetHardware: document.getElementById('cabinet-hardware').value,
        tileType: document.getElementById('tile-type').value,
        showerSqFt: parseFloat(document.getElementById('shower-sqft').value) || 0,
        showerDemo: document.getElementById('shower-demo').value,
        showerFixtures: document.getElementById('shower-fixtures').value
    });

    // Validate estimate
    const validateEstimate = () => {
        const inputs = getInputs();
        const countertopsValid = inputs.material === 'SlabOnly'
            ? validateInput(document.getElementById('slab-cost-per-sqft'), true) && validateInput(document.getElementById('slab-total-sqft'), true)
            : validateInput(document.getElementById('slab-cost-per-sqft'), true) && validateInput(document.getElementById('client-sqft'), true) && validateInput(document.getElementById('slab-total-sqft'), true);
        const cabinetsValid = inputs.cabinetStyle === 'None' || validateInput(document.getElementById('cabinet-quantity'), true);
        const tileShowersValid = inputs.tileType === 'None' || validateInput(document.getElementById('shower-sqft'), true);
        return countertopsValid && cabinetsValid && tileShowersValid;
    };

    // Calculate estimate
    const calculateEstimate = () => {
        if (!validateEstimate()) {
            document.getElementById('estimator-results').innerHTML = '<p class="error">Please fill in all required fields correctly.</p>';
            return;
        }

        const inputs = getInputs();
        const isProMode = document.getElementById('version-toggle').checked;

        // Auto-calculate slab total square feet
        if (inputs.slabTotalLength > 0 && inputs.slabTotalWidth > 0) {
            inputs.slabTotalSqFt = inToSqFt(inputs.slabTotalLength, inputs.slabTotalWidth);
            document.getElementById('slab-total-sqft').value = inputs.slabTotalSqFt.toFixed(2);
        }

        // Countertops
        const slabCost = inputs.slabTotalSqFt * inputs.slabCostPerSqFt;
        const materialCost = inputs.material === 'SlabOnly' ? 0 : pricingMap[inputs.material].price * inputs.clientSqFt;
        const edgeCost = pricingMap[inputs.edgeType]?.unit === 'LF' ? pricingMap[inputs.edgeType].price * inputs.clientSqFt : pricingMap[inputs.edgeType]?.price || 0;
        const waterfallMaterialCost = inputs.edgeType === 'CT-016' ? pricingMap[inputs.material].price * inputs.waterfallSqFt : 0;
        const backsplashCost = inputs.backsplashHeight === 'None' ? 0 : pricingMap[inputs.backsplashHeight].price * inputs.backsplashLinearIn / 12;
        const demoCost = inputs.demoType === 'None' ? 0 : pricingMap[inputs.demoType].price;
        const plumbingCost = pricingMap[inputs.plumbingType]?.price || 0;
        const cooktopCost = inputs.cooktopCutout === 'CT-009' ? pricingMap[inputs.cooktopCutout].price : 0;
        const deliveryCost = inputs.delivery === 'Yes' && inputs.material === 'SlabOnly' ? 150 : 0;
        const sinkCutoutCost = pricingMap[inputs.sinkCutout]?.price || 0;
        const countertopsSubtotal = inputs.material === 'SlabOnly' ? slabCost + deliveryCost : materialCost + edgeCost + waterfallMaterialCost + backsplashCost + demoCost + plumbingCost + cooktopCost + sinkCutoutCost;
        const countertopsProfit = isProMode ? countertopsSubtotal * 0.4261 : 0;

        // Cabinets
        const cabinetBaseCost = inputs.cabinetStyle === 'None' ? 0 : pricingMap[inputs.cabinetStyle].unit === 'EA' ? pricingMap[inputs.cabinetStyle].price * inputs.cabinetQuantity : pricingMap[inputs.cabinetStyle].price;
        const cabinetFinishCost = inputs.cabinetFinish === 'None' ? 0 : pricingMap[inputs.cabinetFinish].price;
        const cabinetHardwareCost = inputs.cabinetHardware === 'None' ? 0 : pricingMap[inputs.cabinetHardware].price * inputs.cabinetQuantity;
        const cabinetsSubtotal = cabinetBaseCost + cabinetFinishCost + cabinetHardwareCost;
        const cabinetsProfit = isProMode && inputs.cabinetStyle !== 'None' ? cabinetsSubtotal * 0.4261 : 0;

        // Tile Showers
        const tileCost = inputs.tileType === 'None' ? 0 : pricingMap[inputs.tileType].price * inputs.showerSqFt;
        const showerDemoCost = inputs.showerDemo === 'None' ? 0 : pricingMap[inputs.showerDemo].price * inputs.showerSqFt;
        const showerFixturesCost = inputs.showerFixtures === 'None' ? 0 : pricingMap[inputs.showerFixtures].price;
        const tileShowersSubtotal = tileCost + showerDemoCost + showerFixturesCost;
        const tileShowersProfit = isProMode && inputs.tileType !== 'None' ? tileShowersSubtotal * 0.4261 : 0;

        // Totals
        const totalSubtotal = countertopsSubtotal + cabinetsSubtotal + tileShowersSubtotal;
        const totalProfit = countertopsProfit + cabinetsProfit + tileShowersProfit;
        const totalQuote = totalSubtotal + totalProfit;

        // Results
        const countertopsResults = `
            <h3>Countertops Quote</h3>
            ${inputs.material !== 'SlabOnly' ? `
                <p><strong>Material Cost (${pricingMap[inputs.material].description}):</strong> ${formatCurrency(materialCost)}</p>
                ${edgeCost > 0 ? `<p><strong>Edge Cost (${pricingMap[inputs.edgeType]?.description || inputs.edgeType}):</strong> ${formatCurrency(edgeCost)}</p>` : ''}
                ${waterfallMaterialCost > 0 ? `<p><strong>Waterfall Material Cost:</strong> ${formatCurrency(waterfallMaterialCost)}</p>` : ''}
                ${backsplashCost > 0 ? `<p><strong>Backsplash Cost (${pricingMap[inputs.backsplashHeight].description}):</strong> ${formatCurrency(backsplashCost)}</p>` : ''}
                ${demoCost > 0 ? `<p><strong>Demo Cost (${pricingMap[inputs.demoType].description}):</strong> ${formatCurrency(demoCost)}</p>` : ''}
                ${plumbingCost > 0 ? `<p><strong>Plumbing Cost (${pricingMap[inputs.plumbingType].description}):</strong> ${formatCurrency(plumbingCost)}</p>` : ''}
                ${cooktopCost > 0 ? `<p><strong>Cooktop Cutout (${pricingMap[inputs.cooktopCutout].description}):</strong> ${formatCurrency(cooktopCost)}</p>` : ''}
                ${sinkCutoutCost > 0 ? `<p><strong>Sink Cutout (${pricingMap[inputs.sinkCutout].description}):</strong> ${formatCurrency(sinkCutoutCost)}</p>` : ''}
            ` : `
                <p><strong>Slab Cost:</strong> ${formatCurrency(slabCost)}</p>
                ${deliveryCost > 0 ? `<p><strong>Delivery Cost:</strong> ${formatCurrency(deliveryCost)}</p>` : ''}
            `}
            <p><strong>Subtotal:</strong> ${formatCurrency(countertopsSubtotal)}</p>
            ${isProMode ? `<p><strong>Profit (42.61%):</strong> ${formatCurrency(countertopsProfit)}</p>` : ''}
        `;

        const cabinetsResults = inputs.cabinetStyle === 'None' ? '' : `
            <h3>Cabinets Quote</h3>
            <p><strong>Base Cost (${pricingMap[inputs.cabinetStyle].description}):</strong> ${formatCurrency(cabinetBaseCost)}</p>
            ${cabinetFinishCost > 0 ? `<p><strong>Finish Cost (${pricingMap[inputs.cabinetFinish].description}):</strong> ${formatCurrency(cabinetFinishCost)}</p>` : ''}
            ${cabinetHardwareCost > 0 ? `<p><strong>Hardware Cost (${pricingMap[inputs.cabinetHardware].description}):</strong> ${formatCurrency(cabinetHardwareCost)}</p>` : ''}
            <p><strong>Subtotal:</strong> ${formatCurrency(cabinetsSubtotal)}</p>
            ${isProMode ? `<p><strong>Profit (42.61%):</strong> ${formatCurrency(cabinetsProfit)}</p>` : ''}
        `;

        const tileShowersResults = inputs.tileType === 'None' ? '' : `
            <h3>Tile Showers Quote</h3>
            <p><strong>Tile Cost (${pricingMap[inputs.tileType].description}):</strong> ${formatCurrency(tileCost)}</p>
            ${showerDemoCost > 0 ? `<p><strong>Demolition Cost (${pricingMap[inputs.showerDemo].description}):</strong> ${formatCurrency(showerDemoCost)}</p>` : ''}
            ${showerFixturesCost > 0 ? `<p><strong>Fixtures Cost (${pricingMap[inputs.showerFixtures].description}):</strong> ${formatCurrency(showerFixturesCost)}</p>` : ''}
            <p><strong>Subtotal:</strong> ${formatCurrency(tileShowersSubtotal)}</p>
            ${isProMode ? `<p><strong>Profit (42.61%):</strong> ${formatCurrency(tileShowersProfit)}</p>` : ''}
        `;

        document.getElementById('countertops-results').innerHTML = countertopsResults;
        document.getElementById('cabinets-results').innerHTML = cabinetsResults;
        document.getElementById('tile-showers-results').innerHTML = tileShowersResults;
        document.getElementById('total-results').innerHTML = `
            <h3>Total Project Quote</h3>
            <p><strong>Total Subtotal:</strong> ${formatCurrency(totalSubtotal)}</p>
            ${isProMode ? `<p><strong>Total Profit (42.61%):</strong> ${formatCurrency(totalProfit)}</p>` : ''}
            <p><strong>Total Quote:</strong> ${formatCurrency(totalQuote)}</p>
        `;
    };

    // Email quote
    const emailQuote = async () => {
        const button = document.getElementById('email-quote');
        const originalText = button.innerHTML;
        addLoadingState(button);
        try {
            const inputs = getInputs();
            const customerNeeds = sanitizeInput(document.getElementById('estimator-results').innerText);
            const formData = new FormData();
            formData.append('customer_needs', customerNeeds);
            formData.append('email', sanitizeInput(inputs.clientEmail));
            formData.append('action', 'both');
            const response = await fetchWithRetry('https://surprise-granite-connections-dev.onrender.com/api/v1/estimate', {
                method: 'POST',
                body: formData
            });
            if (!response.id) throw new Error('Invalid response format');
            localStorage.setItem('estimateId', response.id);
            document.getElementById('estimator-results').innerHTML += '<p class="success">Quote emailed successfully!</p>';
        } catch (error) {
            console.error('Email error:', error);
            document.getElementById('estimator-results').innerHTML += '<p class="error">Failed to send email.</p>';
        } finally {
            removeLoadingState(button, originalText);
        }
    };

    // Like quote
    const likeQuote = async () => {
        const button = document.getElementById('like-quote');
        const originalText = button.innerHTML;
        addLoadingState(button);
        try {
            let likes = parseInt(localStorage.getItem('likes') || '0') + 1;
            localStorage.setItem('likes', likes);
            const estimateId = localStorage.getItem('estimateId');
            if (estimateId) {
                await fetchWithRetry(`https://surprise-granite-connections-dev.onrender.com/api/v1/estimate/${estimateId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ likes })
                });
            }
            document.getElementById('estimator-results').innerHTML += `<p class="success">Quote liked! Total likes: ${likes}</p>`;
        } catch (error) {
            console.error('Like error:', error);
            document.getElementById('estimator-results').innerHTML += '<p class="error">Failed to like quote.</p>';
        } finally {
            removeLoadingState(button, originalText);
        }
    };

    // Share quote
    const shareQuote = () => {
        const body = sanitizeInput(document.getElementById('estimator-results').innerText);
        window.location.href = `mailto:?subject=Check out this quote&body=${encodeURIComponent(body)}`;
    };

    // AI analysis
    const analyzeAI = async () => {
        const button = document.getElementById('analyze-ai');
        const originalText = button.innerHTML;
        addLoadingState(button);
        try {
            const files = document.getElementById('ai-files').files;
            if (files.length > 9) {
                document.getElementById('ai-files-error').textContent = 'Maximum 9 files allowed.';
                document.getElementById('ai-files-error').classList.add('active');
                return;
            }
            const formData = new FormData();
            formData.append('customer_needs', 'Analyze these files for detailed countertop, cabinet, and tile shower estimates/advice (repair, replace, remodel) based on labor pricing.');
            for (let i = 0; i < files.length; i++) formData.append('files', files[i]);
            const response = await fetchWithRetry('https://surprise-granite-connections-dev.onrender.com/api/v1/estimate', {
                method: 'POST',
                body: formData
            });
            if (!response.recommendation) throw new Error('Invalid AI response');
            document.getElementById('ai-results').innerHTML = `<h3>AI Analysis</h3><pre>${sanitizeInput(response.recommendation)}</pre>`;
        } catch (error) {
            console.error('AI Analysis error:', error);
            document.getElementById('ai-results').innerHTML = '<p class="error">Failed to analyze files.</p>';
        } finally {
            removeLoadingState(button, originalText);
        }
    };

    // Calculate area
    const calculateArea = () => {
        const lengthInput = document.getElementById('calc-length');
        const widthInput = document.getElementById('calc-width');
        const isValid = validateInput(lengthInput, true) && validateInput(widthInput, true);
        if (!isValid) {
            document.getElementById('calc-results').innerHTML = '<p class="error">Please enter valid length and width.</p>';
            return;
        }
        const length = parseFloat(lengthInput.value);
        const width = parseFloat(widthInput.value);
        const area = inToSqFt(length, width);
        document.getElementById('calc-results').innerHTML = `<p><strong>Area:</strong> ${area.toFixed(2)} sq ft</p>`;
    };

    // Save quote
    const saveQuote = () => {
        const inputs = getInputs();
        localStorage.setItem('savedQuote', JSON.stringify(inputs));
        document.getElementById('estimator-results').innerHTML += '<p class="success">Quote saved successfully!</p>';
    };

    // Load quote
    const loadQuote = () => {
        const savedQuote = localStorage.getItem('savedQuote');
        if (!savedQuote) {
            document.getElementById('estimator-results').innerHTML += '<p class="error">No saved quote found.</p>';
            return;
        }
        const inputs = JSON.parse(savedQuote);
        Object.keys(inputs).forEach(key => {
            const input = document.getElementById(key);
            if (input) input.value = inputs[key];
        });
        document.getElementById('estimator-results').innerHTML += '<p class="success">Quote loaded successfully!</p>';
        calculateEstimate();
    };

    // Generate PDF
    const generatePDF = () => {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        doc.setFontSize(16);
        doc.text('Surprise Granite Estimator Quote', 10, 10);
        doc.setFontSize(12);
        const resultsText = document.getElementById('estimator-results').innerText;
        const splitText = doc.splitTextToSize(resultsText, 180);
        doc.text(splitText, 10, 20);
        doc.save('quote.pdf');
    };

    // Event Listeners
    document.getElementById('nav-toggle').addEventListener('click', toggleNav);
    document.getElementById('close-nav').addEventListener('click', toggleNav);
    document.querySelectorAll('.nav-item[data-tool]').forEach(item => item.addEventListener('click', () => showTool(item.dataset.tool)));
    document.getElementById('theme-toggle-nav').addEventListener('click', toggleTheme);
    document.getElementById('version-toggle').addEventListener('change', toggleVersion);
    document.getElementById('clear-form').addEventListener('click', () => {
        document.getElementById('estimator-form').reset();
        calculateEstimate();
    });
    document.getElementById('email-quote').addEventListener('click', emailQuote);
    document.getElementById('like-quote').addEventListener('click', likeQuote);
    document.getElementById('share-quote').addEventListener('click', shareQuote);
    document.getElementById('analyze-ai').addEventListener('click', analyzeAI);
    document.getElementById('calc-area').addEventListener('click', calculateArea);
    document.getElementById('save-quote').addEventListener('click', saveQuote);
    document.getElementById('load-quote').addEventListener('click', loadQuote);
    document.getElementById('download-pdf').addEventListener('click', generatePDF);
    document.querySelectorAll('.section-header').forEach(header => header.addEventListener('click', () => toggleSection(header)));
    document.querySelectorAll('#estimator-form input, #estimator-form select').forEach(input => input.addEventListener('input', debounce(calculateEstimate, 300)));
    document.querySelectorAll('#calculator-tool input').forEach(input => input.addEventListener('input', debounce(calculateArea, 300)));

    // Dynamic Triggers
    document.getElementById('material').addEventListener('change', (e) => {
        document.getElementById('delivery-group').style.display = e.target.value === 'SlabOnly' ? 'block' : 'none';
        calculateEstimate();
    });
    document.getElementById('edge-type').addEventListener('change', (e) => {
        document.getElementById('waterfall-group').style.display = e.target.value === 'CT-016' ? 'block' : 'none';
        calculateEstimate();
    });

    // Keyboard Accessibility
    document.querySelectorAll('.nav-item, .section-header, .btn').forEach(el => {
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                el.click();
            }
        });
    });

    // Initialization
    if (localStorage.getItem('theme') === 'light') toggleTheme();
    document.getElementById('version-toggle').checked = localStorage.getItem('isProMode') === 'true';
    showTool('estimator');
    calculateEstimate();
});
