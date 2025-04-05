// Calc.js
document.addEventListener('DOMContentLoaded', () => {
    const stoneSelect = document.getElementById('stone-select');
    const customStoneToggle = document.getElementById('custom-stone-toggle');
    const customStoneForm = document.getElementById('custom-stone-form');
    const customStoneSubmit = document.getElementById('custom-stone-submit');
    const customerNeeds = document.getElementById('customer-needs');
    const fileInput = document.getElementById('file-input');
    const estimateButton = document.getElementById('estimate-button');
    const estimateResult = document.getElementById('estimate-result');

    let stoneProducts = [];
    let selectedStone = null;

    // Fetch stone products from the backend
    fetch('http://localhost:10000/api/stone-products')
        .then(response => response.json())
        .then(data => {
            stoneProducts = data;
            populateStoneSelect(data);
        })
        .catch(err => console.error('Failed to fetch stone products:', err));

    function populateStoneSelect(stones) {
        stoneSelect.innerHTML = '<option value="">-- Choose a Stone --</option>';
        stones.forEach(stone => {
            const option = document.createElement('option');
            option.value = stone.colorName;
            option.textContent = `${stone.colorName} (${stone.vendorName}, ${stone.thickness})`;
            stoneSelect.appendChild(option);
        });
    }

    stoneSelect.addEventListener('change', (e) => {
        selectedStone = stoneProducts.find(s => s.colorName === e.target.value);
    });

    customStoneToggle.addEventListener('change', () => {
        customStoneForm.style.display = customStoneToggle.checked ? 'block' : 'none';
        stoneSelect.disabled = customStoneToggle.checked;
    });

    customStoneSubmit.addEventListener('click', () => {
        const customStone = {
            colorName: document.getElementById('custom-color').value,
            vendorName: document.getElementById('custom-vendor').value,
            thickness: document.getElementById('custom-thickness').value,
            material: document.getElementById('custom-material').value,
            size: document.getElementById('custom-size').value,
            totalSqFt: document.getElementById('custom-sqft').value,
            costPerSqFt: document.getElementById('custom-cost').value,
            priceGroup: document.getElementById('custom-group').value,
            tier: document.getElementById('custom-tier').value
        };

        fetch('http://localhost:10000/api/custom-stone', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(customStone)
        })
            .then(response => response.json())
            .then(result => {
                stoneProducts.push(result.data);
                populateStoneSelect(stoneProducts);
                selectedStone = result.data;
                stoneSelect.value = result.data.colorName;
                customStoneToggle.checked = false;
                customStoneForm.style.display = 'none';
                stoneSelect.disabled = false;
            })
            .catch(err => console.error('Failed to add custom stone:', err));
    });

    estimateButton.addEventListener('click', () => {
        estimateButton.textContent = 'Estimating...';
        estimateButton.disabled = true;
        const formData = new FormData();
        formData.append('customer_needs', customerNeeds.value);
        Array.from(fileInput.files).forEach(file => formData.append('files', file));

        fetch('http://localhost:10000/api/estimate', {
            method: 'POST',
            body: formData
        })
            .then(response => response.json())
            .then(data => {
                displayEstimate(data);
                estimateButton.textContent = 'Get Estimate';
                estimateButton.disabled = false;
            })
            .catch(err => {
                console.error('Failed to get estimate:', err);
                estimateResult.innerHTML = '<p>Failed to generate estimate</p>';
                estimateButton.textContent = 'Get Estimate';
                estimateButton.disabled = false;
            });
    });

    function displayEstimate(data) {
        estimateResult.innerHTML = data.error
            ? `<p>${data.error}</p>`
            : `
                <h3>Estimate</h3>
                <p><strong>Recommendation:</strong> ${data.recommendation}</p>
                <p><strong>Material:</strong> ${data.materialType}</p>
                <p><strong>Color:</strong> ${data.color}</p>
                <p><strong>Dimensions:</strong> ${data.dimensions}</p>
                <p><strong>Condition:</strong> ${data.condition.damage_type} (${data.condition.severity})</p>
                <p><strong>Edge Profile:</strong> ${data.edgeProfile}</p>
                <p><strong>Additional Features:</strong> ${data.additionalFeatures.join(', ') || 'None'}</p>
                <p><strong>Cost Range:</strong> $${data.costEstimate.low.toFixed(2)} - $${data.costEstimate.high.toFixed(2)}</p>
                <p><strong>Selected Stone:</strong> ${selectedStone ? `${selectedStone.colorName} (${selectedStone.vendorName})` : 'N/A'}</p>
                <p><strong>Solutions:</strong> ${data.solutions}</p>
                <p><strong>Reasoning:</strong> ${data.reasoning}</p>
                <p>${data.consultationPrompt}</p>
                ${data.audioFilePath ? `<audio controls src="http://localhost:10000${data.audioFilePath}"></audio>` : ''}
            `;
    }
});
