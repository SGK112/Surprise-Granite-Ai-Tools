const formatCurrency = (amount) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(amount || 0);
const inToSqFt = (length, width) => (length * width) / 144;

const validateInput = (input, isRequired = false) => {
    const value = input.value.trim();
    if (isRequired && (!value || isNaN(value) || parseFloat(value) <= 0)) {
        input.classList.add('error');
        return false;
    }
    input.classList.remove('error');
    return true;
};

document.addEventListener('DOMContentLoaded', () => {
    const pricing = {
        profitMargin: 42.61,
        wasteFactor: 20,
        materialCosts: { Granite: 60, Quartz: 70, Marble: 80, Dekton: 90, Porcelain: 75, Soapstone: 85 },
        slabMargin: 30,
        deliveryCost: 150,
        edgeCosts: { Eased: 5, Bullnose: 10, Waterfall: 15, None: 0, Squared: 0 },
        backsplashCosts: { '4': 15, '6': 20, Custom: 25, None: 0 },
        demoCosts: { Laminate: 2, Stone: 5, Heavy: 10, None: 0 },
        plumbingCosts: { Bathroom: 350, Kitchen: 550, None: 0 },
        cooktopCost: 250,
        cabinetCosts: { Shaker: 150, 'Flat-Panel': 120, 'Raised-Panel': 180, Custom: 250, None: 0 },
        cabinetMaterialAdjust: { Plywood: 0, MDF: -10, 'Solid Wood': 20 },
        cabinetFinishCosts: { Painted: 30, Stained: 20, Natural: 0 },
        cabinetHardwareCosts: { Basic: 5, Premium: 15, None: 0 },
        cabinetInstallCost: 50,
        tileCosts: { Ceramic: 5, Porcelain: 7, 'Natural Stone': 12, Glass: 15, None: 0 },
        tileDemoCosts: { None: 0, Basic: 3, Full: 6 },
        tileInstallCosts: { Standard: 10, Custom: 15, None: 0 },
        tileFixturesCosts: { Basic: 200, Premium: 500, None: 0 }
    };

    const toggleTheme = () => {
        document.body.classList.toggle('light-mode');
        document.getElementById('themeToggle').classList.toggle('bi-moon-stars-fill');
        document.getElementById('themeToggle').classList.toggle('bi-sun-fill');
    };

    const toggleNav = () => document.getElementById('navbar').classList.toggle('open');

    const showTool = (toolId) => {
        document.querySelectorAll('.tool-card').forEach(card => card.classList.remove('active'));
        document.getElementById(`${toolId}-tool`).classList.add('active');
        document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
        document.querySelector(`.nav-item[data-tool="${toolId}"]`).classList.add('active');
        if (toolId === 'estimator') calculateEstimate();
    };

    const toggleSection = (header) => {
        const content = header.nextElementSibling;
        content.classList.toggle('active');
        const icon = header.querySelector('i');
        icon.classList.toggle('bi-chevron-down');
        icon.classList.toggle('bi-chevron-up');
    };

    const toggleVersion = () => {
        const isProMode = document.getElementById('version-toggle').checked;
        localStorage.setItem('isProMode', isProMode);
        calculateEstimate();
    };

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
        customBacksplashHeight: parseFloat(document.getElementById('custom-backsplash-height').value) || 0,
        backsplashLinearIn: parseFloat(document.getElementById('backsplash-linear-in').value) || 0,
        demoType: document.getElementById('demo-type').value,
        plumbingType: document.getElementById('plumbing-type').value,
        cooktopCutout: document.getElementById('cooktop-cutout').value === 'Yes',
        delivery: document.getElementById('delivery')?.value === 'Yes' || false,
        cabinetStyle: document.getElementById('cabinet-style').value,
        cabinetMaterial: document.getElementById('cabinet-material').value,
        cabinetLinearFt: parseFloat(document.getElementById('cabinet-linear-ft').value) || 0,
        cabinetFinish: document.getElementById('cabinet-finish').value,
        cabinetHardware: document.getElementById('cabinet-hardware').value,
        cabinetInstall: document.getElementById('cabinet-install').value === 'Yes',
        tileType: document.getElementById('tile-type').value,
        showerSqFt: parseFloat(document.getElementById('shower-sqft').value) || 0,
        showerDemo: document.getElementById('shower-demo').value,
        showerInstall: document.getElementById('shower-install').value,
        showerFixtures: document.getElementById('shower-fixtures').value
    });

    const validateEstimate = () => {
        const inputs = getInputs();
        const countertopsValid = inputs.material === 'SlabOnly' ? 
            validateInput(document.getElementById('slab-cost-per-sqft'), true) && validateInput(document.getElementById('slab-total-sqft'), true) :
            validateInput(document.getElementById('slab-cost-per-sqft'), true) && validateInput(document.getElementById('client-sqft'), true) && validateInput(document.getElementById('slab-total-sqft'), true);
        const cabinetsValid = inputs.cabinetStyle === 'None' || validateInput(document.getElementById('cabinet-linear-ft'), true);
        const tileShowersValid = inputs.tileType === 'None' || validateInput(document.getElementById('shower-sqft'), true);
        return countertopsValid && cabinetsValid && tileShowersValid;
    };

    const calculateEstimate = () => {
        if (!validateEstimate()) {
            document.getElementById('estimator-results').innerHTML = '<p class="error">Please fill in all required fields.</p>';
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
        const materialCost = inputs.material === 'SlabOnly' ? 0 : pricing.materialCosts[inputs.material] * inputs.clientSqFt;
        const edgeCost = pricing.edgeCosts[inputs.edgeType] * inputs.clientSqFt;
        const waterfallMaterialCost = inputs.edgeType === 'Waterfall' ? pricing.materialCosts[inputs.material] * inputs.waterfallSqFt : 0;
        const backsplashSqFt = inputs.backsplashHeight === 'None' ? 0 : inToSqFt(inputs.backsplashHeight === 'Custom' ? inputs.customBacksplashHeight : parseFloat(inputs.backsplashHeight) || 0, inputs.backsplashLinearIn);
        const backsplashCost = pricing.backsplashCosts[inputs.backsplashHeight] * inputs.backsplashLinearIn;
        const backsplashMaterialCost = inputs.backsplashHeight === 'None' ? 0 : pricing.materialCosts[inputs.material] * backsplashSqFt;
        const demoCost = pricing.demoCosts[inputs.demoType] * inputs.clientSqFt;
        const plumbingCost = pricing.plumbingCosts[inputs.plumbingType];
        const cooktopCost = inputs.cooktopCutout ? pricing.cooktopCost : 0;
        const deliveryCost = inputs.material === 'SlabOnly' && inputs.delivery ? pricing.deliveryCost : 0;
        const countertopsSubtotal = inputs.material === 'SlabOnly' ? slabCost + deliveryCost : materialCost + edgeCost + waterfallMaterialCost + backsplashCost + backsplashMaterialCost + demoCost + plumbingCost + cooktopCost;
        const countertopsProfit = isProMode ? (inputs.material === 'SlabOnly' ? slabCost * (pricing.slabMargin / 100) : countertopsSubtotal * (pricing.profitMargin / 100)) : 0;

        // Cabinets
        const baseCost = pricing.cabinetCosts[inputs.cabinetStyle] * inputs.cabinetLinearFt;
        const materialAdjust = pricing.cabinetMaterialAdjust[inputs.cabinetMaterial] * inputs.cabinetLinearFt;
        const finishCost = pricing.cabinetFinishCosts[inputs.cabinetFinish] * inputs.cabinetLinearFt;
        const hardwareCost = pricing.cabinetHardwareCosts[inputs.cabinetHardware] * inputs.cabinetLinearFt;
        const installCost = inputs.cabinetInstall ? pricing.cabinetInstallCost * inputs.cabinetLinearFt : 0;
        const cabinetsSubtotal = inputs.cabinetStyle === 'None' ? 0 : baseCost + materialAdjust + finishCost + hardwareCost + installCost;
        const cabinetsProfit = isProMode && inputs.cabinetStyle !== 'None' ? cabinetsSubtotal * (pricing.profitMargin / 100) : 0;

        // Tile Showers
        const tileCost = pricing.tileCosts[inputs.tileType] * inputs.showerSqFt;
        const showerDemoCost = pricing.tileDemoCosts[inputs.showerDemo] * inputs.showerSqFt;
        const showerInstallCost = pricing.tileInstallCosts[inputs.showerInstall] * inputs.showerSqFt;
        const fixturesCost = pricing.tileFixturesCosts[inputs.showerFixtures];
        const tileShowersSubtotal = inputs.tileType === 'None' ? 0 : tileCost + showerDemoCost + showerInstallCost + fixturesCost;
        const tileShowersProfit = isProMode && inputs.tileType !== 'None' ? tileShowersSubtotal * (pricing.profitMargin / 100) : 0;

        // Totals
        const totalSubtotal = countertopsSubtotal + cabinetsSubtotal + tileShowersSubtotal;
        const totalProfit = countertopsProfit + cabinetsProfit + tileShowersProfit;
        const totalQuote = totalSubtotal + totalProfit;

        // Results
        const countertopsResults = `
            <h3>Countertops Quote</h3>
            ${inputs.material !== 'SlabOnly' ? `
                <p><strong>Material Cost:</strong> ${formatCurrency(materialCost)}</p>
                ${edgeCost > 0 ? `<p><strong>Edge Cost (${inputs.edgeType}):</strong> ${formatCurrency(edgeCost)}</p>` : ''}
                ${waterfallMaterialCost > 0 ? `<p><strong>Waterfall Material Cost:</strong> ${formatCurrency(waterfallMaterialCost)}</p>` : ''}
                ${backsplashCost > 0 ? `<p><strong>Backsplash Cost:</strong> ${formatCurrency(backsplashCost)}</p>` : ''}
                ${backsplashMaterialCost > 0 ? `<p><strong>Backsplash Material Cost:</strong> ${formatCurrency(backsplashMaterialCost)}</p>` : ''}
                ${demoCost > 0 ? `<p><strong>Demo Cost (${inputs.demoType}):</strong> ${formatCurrency(demoCost)}</p>` : ''}
                ${plumbingCost > 0 ? `<p><strong>Plumbing Cost (${inputs.plumbingType}):</strong> ${formatCurrency(plumbingCost)}</p>` : ''}
                ${cooktopCost > 0 ? `<p><strong>Cooktop Cutout:</strong> ${formatCurrency(cooktopCost)}</p>` : ''}
            ` : `
                <p><strong>Slab Cost:</strong> ${formatCurrency(slabCost)}</p>
                ${deliveryCost > 0 ? `<p><strong>Delivery Cost:</strong> ${formatCurrency(deliveryCost)}</p>` : ''}
            `}
            <p><strong>Subtotal:</strong> ${formatCurrency(countertopsSubtotal)}</p>
            ${isProMode ? `<p><strong>Profit:</strong> ${formatCurrency(countertopsProfit)}</p>` : ''}
        `;

        const cabinetsResults = inputs.cabinetStyle === 'None' ? '' : `
            <h3>Cabinets Quote</h3>
            <p><strong>Base Cost:</strong> ${formatCurrency(baseCost)}</p>
            ${materialAdjust !== 0 ? `<p><strong>Material Adjustment:</strong> ${formatCurrency(materialAdjust)}</p>` : ''}
            ${finishCost > 0 ? `<p><strong>Finish Cost (${inputs.cabinetFinish}):</strong> ${formatCurrency(finishCost)}</p>` : ''}
            ${hardwareCost > 0 ? `<p><strong>Hardware Cost (${inputs.cabinetHardware}):</strong> ${formatCurrency(hardwareCost)}</p>` : ''}
            ${installCost > 0 ? `<p><strong>Installation Cost:</strong> ${formatCurrency(installCost)}</p>` : ''}
            <p><strong>Subtotal:</strong> ${formatCurrency(cabinetsSubtotal)}</p>
            ${isProMode ? `<p><strong>Profit:</strong> ${formatCurrency(cabinetsProfit)}</p>` : ''}
        `;

        const tileShowersResults = inputs.tileType === 'None' ? '' : `
            <h3>Tile Showers Quote</h3>
            <p><strong>Tile Cost:</strong> ${formatCurrency(tileCost)}</p>
            ${showerDemoCost > 0 ? `<p><strong>Demolition Cost (${inputs.showerDemo}):</strong> ${formatCurrency(showerDemoCost)}</p>` : ''}
            ${showerInstallCost > 0 ? `<p><strong>Installation Cost (${inputs.showerInstall}):</strong> ${formatCurrency(showerInstallCost)}</p>` : ''}
            ${fixturesCost > 0 ? `<p><strong>Fixtures Cost (${inputs.showerFixtures}):</strong> ${formatCurrency(fixturesCost)}</p>` : ''}
            <p><strong>Subtotal:</strong> ${formatCurrency(tileShowersSubtotal)}</p>
            ${isProMode ? `<p><strong>Profit:</strong> ${formatCurrency(tileShowersProfit)}</p>` : ''}
        `;

        document.getElementById('countertops-results').innerHTML = countertopsResults;
        document.getElementById('cabinets-results').innerHTML = cabinetsResults;
        document.getElementById('tile-showers-results').innerHTML = tileShowersResults;
        document.getElementById('total-results').innerHTML = `
            <h3>Total Project Quote</h3>
            <p><strong>Total Subtotal:</strong> ${formatCurrency(totalSubtotal)}</p>
            ${isProMode ? `<p><strong>Total Profit:</strong> ${formatCurrency(totalProfit)}</p>` : ''}
            <p><strong>Total Quote:</strong> ${formatCurrency(totalQuote)}</p>
        `;
    };

    const emailQuote = async () => {
        const inputs = getInputs();
        const customerNeeds = document.getElementById('estimator-results').innerText;
        const formData = new FormData();
        formData.append('customer_needs', customerNeeds);
        formData.append('email', inputs.clientEmail);
        formData.append('action', 'both');

        try {
            const response = await fetch('https://surprise-granite-connections-dev.onrender.com/api/v1/estimate', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Email failed');
            localStorage.setItem('estimateId', data.id);
            alert('Quote emailed successfully!');
        } catch (error) {
            console.error('Email error:', error);
            alert('Failed to send email.');
        }
    };

    const likeQuote = () => {
        let likes = parseInt(localStorage.getItem('likes') || '0') + 1;
        localStorage.setItem('likes', likes);
        alert(`Quote liked! Total likes: ${likes}`);
    };

    const shareQuote = () => {
        const body = document.getElementById('estimator-results').innerText;
        window.location.href = `mailto:?subject=Check out this quote&body=${encodeURIComponent(body)}`;
    };

    const analyzeAI = async () => {
        const files = document.getElementById('ai-files').files;
        if (files.length > 9) {
            alert('Maximum 9 files allowed.');
            return;
        }
        const formData = new FormData();
        formData.append('customer_needs', 'Analyze these files for countertop and remodeling estimates/advice (repair, replace, remodel).');
        for (let i = 0; i < files.length; i++) formData.append('files', files[i]);

        try {
            const response = await fetch('https://surprise-granite-connections-dev.onrender.com/api/v1/estimate', {
                method: 'POST',
                body: formData
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Analysis failed');
            document.getElementById('ai-results').innerHTML = `<h3>AI Analysis</h3><pre>${data.recommendation}</pre>`;
        } catch (error) {
            console.error('AI Analysis error:', error);
            document.getElementById('ai-results').innerHTML = '<p class="error">Failed to analyze files.</p>';
        }
    };

    const calculateArea = () => {
        const length = parseFloat(document.getElementById('calc-length').value) || 0;
        const width = parseFloat(document.getElementById('calc-width').value) || 0;
        const area = inToSqFt(length, width);
        document.getElementById('calc-results').innerHTML = `<p><strong>Area:</strong> ${area.toFixed(2)} sq ft</p>`;
    };

    // Event Listeners
    document.getElementById('nav-toggle').addEventListener('click', toggleNav);
    document.getElementById('close-nav').addEventListener('click', toggleNav);
    document.querySelectorAll('.nav-item[data-tool]').forEach(item => item.addEventListener('click', () => showTool(item.dataset.tool)));
    document.getElementById('theme-toggle-nav').addEventListener('click', toggleTheme);
    document.getElementById('version-toggle').addEventListener('change', toggleVersion);
    document.getElementById('clear-form').addEventListener('click', () => document.getElementById('estimator-form').reset());
    document.getElementById('email-quote').addEventListener('click', emailQuote);
    document.getElementById('like-quote').addEventListener('click', likeQuote);
    document.getElementById('share-quote').addEventListener('click', shareQuote);
    document.getElementById('analyze-ai').addEventListener('click', analyzeAI);
    document.getElementById('calc-area').addEventListener('click', calculateArea);
    document.querySelectorAll('.section-header').forEach(header => header.addEventListener('click', () => toggleSection(header)));
    document.querySelectorAll('#estimator-form input, #estimator-form select').forEach(input => input.addEventListener('input', calculateEstimate));
    document.querySelectorAll('#calculator-tool input').forEach(input => input.addEventListener('input', calculateArea));

    // Dynamic Triggers
    document.getElementById('material').addEventListener('change', (e) => {
        document.getElementById('delivery-group').style.display = e.target.value === 'SlabOnly' ? 'block' : 'none';
        calculateEstimate();
    });
    document.getElementById('edge-type').addEventListener('change', (e) => {
        document.getElementById('waterfall-group').style.display = e.target.value === 'Waterfall' ? 'block' : 'none';
        calculateEstimate();
    });
    document.getElementById('backsplash-height').addEventListener('change', (e) => {
        document.getElementById('custom-backsplash-group').style.display = e.target.value === 'Custom' ? 'block' : 'none';
        calculateEstimate();
    });

    // Initialization
    if (localStorage.getItem('theme') === 'light') toggleTheme();
    document.getElementById('version-toggle').checked = localStorage.getItem('isProMode') === 'true';
    showTool('estimator');
    calculateEstimate();
});
