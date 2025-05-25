// Main application logic for countertop estimator
document.addEventListener('DOMContentLoaded', function() {
    // DOM Elements
    const loadingScreen = document.getElementById('loading-screen');
    const appContainer = document.getElementById('app');
    const estimatorForm = document.getElementById('estimator-form');
    const materialSelect = document.getElementById('material');
    const vendorSelect = document.getElementById('vendor');
    const colorSelect = document.getElementById('color');
    const thicknessSelect = document.getElementById('thickness');
    const sizeSelect = document.getElementById('size');
    const resultsContainer = document.getElementById('results-container');
    const materialInfo = document.getElementById('material-info');
    const countertopPreview = document.getElementById('countertop-preview');
    const emailModal = document.getElementById('email-modal');
    const emailForm = document.getElementById('email-form');
    const emailStatus = document.getElementById('email-status');
    
    // Result elements
    const materialCostEl = document.getElementById('material-cost');
    const fabricationCostEl = document.getElementById('fabrication-cost');
    const edgeCostEl = document.getElementById('edge-cost');
    const cutoutCostEl = document.getElementById('cutout-cost');
    const totalCostEl = document.getElementById('total-cost');
    const sqftAmountEl = document.getElementById('sqft-amount');
    const costPerSqftEl = document.getElementById('cost-per-sqft');
    const linearFtAmountEl = document.getElementById('linear-ft-amount');
    const edgeTypeEl = document.getElementById('edge-type');
    const cutoutAmountEl = document.getElementById('cutout-amount');
    
    // Material info elements
    const infoMaterial = document.getElementById('info-material');
    const infoColor = document.getElementById('info-color');
    const infoThickness = document.getElementById('info-thickness');
    const infoPriceGroup = document.getElementById('info-price-group');
    const infoCost = document.getElementById('info-cost');
    const infoSize = document.getElementById('info-size');
    
    // Button elements
    const emailEstimateBtn = document.getElementById('email-estimate');
    const printEstimateBtn = document.getElementById('print-estimate');
    const newEstimateBtn = document.getElementById('new-estimate');
    const closeModalBtn = document.querySelector('.close-modal');
    const cancelEmailBtn = document.getElementById('cancel-email');
    
    // Current selections and estimate
    let currentSelection = {};
    let currentEstimate = null;
    
    // Initialize the application
    function init() {
        // Simulate loading time for better UX
        setTimeout(() => {
            // Load CSV data
            loadCSVData()
                .then(csvData => {
                    // Initialize data module with CSV data
                    countertopData.init(csvData);
                    
                    // Populate initial dropdowns
                    populateDropdown(materialSelect, ['Quartz', 'Granite', 'Marble', 'Quartzite']);
                    
                    // Setup event listeners
                    setupEventListeners();
                    
                    // Hide loading screen and show app
                    loadingScreen.classList.add('hidden');
                    appContainer.classList.remove('hidden');
                })
                .catch(error => {
                    console.error('Error loading data:', error);
                    alert('Error loading application data. Please refresh the page.');
                });
        }, 1500); // 1.5 second loading screen for better UX
    }
    
    // Load CSV data from file
    async function loadCSVData() {
        try {
            const response = await fetch('data/countertop_pricing.csv');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return await response.text();
        } catch (error) {
            console.error('Error fetching CSV:', error);
            throw error;
        }
    }
    
    // Setup all event listeners
    function setupEventListeners() {
        // Material selection change
        materialSelect.addEventListener('change', function() {
            currentSelection.material = this.value;
            updateVendorOptions();
            resetDependentSelections(['vendor', 'color', 'thickness', 'size']);
        });
        
        // Vendor selection change
        vendorSelect.addEventListener('change', function() {
            currentSelection.vendor = this.value;
            updateColorOptions();
            resetDependentSelections(['color', 'thickness', 'size']);
        });
        
        // Color selection change
        colorSelect.addEventListener('change', function() {
            currentSelection.color = this.value;
            updateThicknessOptions();
            resetDependentSelections(['thickness', 'size']);
        });
        
        // Thickness selection change
        thicknessSelect.addEventListener('change', function() {
            currentSelection.thickness = this.value;
            updateSizeOptions();
            resetDependentSelections(['size']);
        });
        
        // Size selection change
        sizeSelect.addEventListener('change', function() {
            currentSelection.size = this.value;
            updateMaterialInfo();
        });
        
        // Form submission
        estimatorForm.addEventListener('submit', function(e) {
            e.preventDefault();
            calculateEstimate();
        });
        
        // Email estimate button
        emailEstimateBtn.addEventListener('click', function() {
            openEmailModal();
        });
        
        // Print estimate button
        printEstimateBtn.addEventListener('click', function() {
            printEstimate();
        });
        
        // New estimate button
        newEstimateBtn.addEventListener('click', function() {
            resetForm();
        });
        
        // Close modal button
        closeModalBtn.addEventListener('click', function() {
            closeEmailModal();
        });
        
        // Cancel email button
        cancelEmailBtn.addEventListener('click', function() {
            closeEmailModal();
        });
        
        // Email form submission
        emailForm.addEventListener('submit', function(e) {
            e.preventDefault();
            sendEstimateEmail();
        });
        
        // Close modal when clicking outside
        window.addEventListener('click', function(e) {
            if (e.target === emailModal) {
                closeEmailModal();
            }
        });
    }
    
    // Populate dropdown with options
    function populateDropdown(selectElement, options, defaultOption = '') {
        // Clear existing options except the first one (placeholder)
        while (selectElement.options.length > 1) {
            selectElement.remove(1);
        }
        
        // Add new options
        options.forEach(option => {
            const optionElement = document.createElement('option');
            optionElement.value = option;
            optionElement.textContent = option;
            selectElement.appendChild(optionElement);
        });
        
        // Set default option if provided
        if (defaultOption) {
            selectElement.value = defaultOption;
        }
    }
    
    // Update vendor options based on material selection
    function updateVendorOptions() {
        if (!currentSelection.material) return;
        
        const filters = { material: currentSelection.material };
        const vendors = countertopData.getFilteredOptions('vendorName', filters);
        
        populateDropdown(vendorSelect, vendors);
        vendorSelect.disabled = vendors.length === 0;
    }
    
    // Update color options based on material and vendor selection
    function updateColorOptions() {
        if (!currentSelection.material || !currentSelection.vendor) return;
        
        const filters = {
            material: currentSelection.material,
            vendor: currentSelection.vendor
        };
        
        const colors = countertopData.getFilteredOptions('colorName', filters);
        
        populateDropdown(colorSelect, colors);
        colorSelect.disabled = colors.length === 0;
    }
    
    // Update thickness options based on material, vendor, and color selection
    function updateThicknessOptions() {
        if (!currentSelection.material || !currentSelection.vendor || !currentSelection.color) return;
        
        const filters = {
            material: currentSelection.material,
            vendor: currentSelection.vendor,
            color: currentSelection.color
        };
        
        const thicknesses = countertopData.getFilteredOptions('thickness', filters);
        
        populateDropdown(thicknessSelect, thicknesses);
        thicknessSelect.disabled = thicknesses.length === 0;
    }
    
    // Update size options based on material, vendor, color, and thickness selection
    function updateSizeOptions() {
        if (!currentSelection.material || !currentSelection.vendor || 
            !currentSelection.color || !currentSelection.thickness) return;
        
        const filters = {
            material: currentSelection.material,
            vendor: currentSelection.vendor,
            color: currentSelection.color,
            thickness: currentSelection.thickness
        };
        
        const sizes = countertopData.getFilteredOptions('size', filters);
        
        populateDropdown(sizeSelect, sizes);
        sizeSelect.disabled = sizes.length === 0;
    }
    
    // Reset dependent selections
    function resetDependentSelections(fields) {
        fields.forEach(field => {
            switch(field) {
                case 'vendor':
                    vendorSelect.selectedIndex = 0;
                    currentSelection.vendor = '';
                    break;
                case 'color':
                    colorSelect.selectedIndex = 0;
                    currentSelection.color = '';
                    break;
                case 'thickness':
                    thicknessSelect.selectedIndex = 0;
                    currentSelection.thickness = '';
                    break;
                case 'size':
                    sizeSelect.selectedIndex = 0;
                    currentSelection.size = '';
                    break;
            }
        });
        
        // Hide material info when selections are reset
        materialInfo.classList.add('hidden');
    }
    
    // Update material information display
    function updateMaterialInfo() {
        if (!currentSelection.material || !currentSelection.vendor || 
            !currentSelection.color || !currentSelection.thickness || 
            !currentSelection.size) {
            materialInfo.classList.add('hidden');
            return;
        }
        
        const filteredMaterials = countertopData.filterMaterials(currentSelection);
        
        if (filteredMaterials.length === 0) {
            materialInfo.classList.add('hidden');
            return;
        }
        
        const selectedMaterial = filteredMaterials[0];
        
        // Update material info display
        infoMaterial.textContent = selectedMaterial.material;
        infoColor.textContent = selectedMaterial.colorName;
        infoThickness.textContent = selectedMaterial.thickness;
        infoPriceGroup.textContent = selectedMaterial.priceGroup;
        infoCost.textContent = `$${selectedMaterial.costSqFt.toFixed(2)}`;
        infoSize.textContent = selectedMaterial.size;
        
        // Show material info
        materialInfo.classList.remove('hidden');
        
        // Update countertop preview (in a real app, this would load an image)
        updateCountertopPreview(selectedMaterial);
    }
    
    // Update countertop preview
    function updateCountertopPreview(material) {
        // In a real application, this would load an image from MongoDB
        // For now, we'll use a placeholder color based on the material name
        
        // Generate a color based on the material name (for demo purposes)
        let color;
        
        if (material.colorName.toLowerCase().includes('white')) {
            color = '#f5f5f5';
        } else if (material.colorName.toLowerCase().includes('black')) {
            color = '#333333';
        } else if (material.colorName.toLowerCase().includes('gray') || material.colorName.toLowerCase().includes('grey')) {
            color = '#9e9e9e';
        } else if (material.colorName.toLowerCase().includes('beige')) {
            color = '#e8e0d5';
        } else if (material.colorName.toLowerCase().includes('brown')) {
            color = '#795548';
        } else if (material.colorName.toLowerCase().includes('blue')) {
            color = '#90caf9';
        } else if (material.colorName.toLowerCase().includes('green')) {
            color = '#a5d6a7';
        } else {
            // Generate a random color for other materials
            const hue = Math.floor(Math.random() * 360);
            color = `hsl(${hue}, 30%, 70%)`;
        }
        
        // Update the preview background
        countertopPreview.style.backgroundColor = color;
        
        // Remove preview message
        const previewMessage = countertopPreview.querySelector('.preview-message');
        if (previewMessage) {
            previewMessage.remove();
        }
    }
    
    // Calculate estimate based on form inputs
    function calculateEstimate() {
        // Get form values
        const squareFeet = parseFloat(document.getElementById('square-feet').value);
        const linearFeet = parseFloat(document.getElementById('linear-feet').value);
        const edgeProfile = document.getElementById('edge-profile').value;
        const cutouts = parseInt(document.getElementById('cutouts').value);
        
        // Validate inputs
        if (!currentSelection.material || !currentSelection.vendor || 
            !currentSelection.color || !currentSelection.thickness || 
            !currentSelection.size || isNaN(squareFeet) || isNaN(linearFeet) || !edgeProfile) {
            alert('Please complete all required fields.');
            return;
        }
        
        // Calculate estimate (lead generation version - waste and profit are included but not exposed)
        const measurements = {
            squareFeet: squareFeet,
            linearFeet: linearFeet,
            edgeProfile: edgeProfile,
            cutouts: cutouts
        };
        
        currentEstimate = countertopData.calculateEstimate(currentSelection, measurements);
        
        if (currentEstimate.error) {
            alert(currentEstimate.error);
            return;
        }
        
        // Update results display
        updateResultsDisplay();
        
        // Show results container
        resultsContainer.classList.remove('hidden');
        
        // Scroll to results
        resultsContainer.scrollIntoView({ behavior: 'smooth' });
    }
    
    // Update results display
    function updateResultsDisplay() {
        materialCostEl.textContent = `$${currentEstimate.materialCost}`;
        fabricationCostEl.textContent = `$${currentEstimate.fabricationCost}`;
        edgeCostEl.textContent = `$${currentEstimate.edgeCost}`;
        cutoutCostEl.textContent = `$${currentEstimate.cutoutCost}`;
        totalCostEl.textContent = `$${currentEstimate.totalCost}`;
        
        sqftAmountEl.textContent = currentEstimate.squareFeet;
        costPerSqftEl.textContent = `$${currentEstimate.costPerSqFt}`;
        linearFtAmountEl.textContent = currentEstimate.linearFeet;
        edgeTypeEl.textContent = currentEstimate.edgeProfile;
        cutoutAmountEl.textContent = currentEstimate.cutouts;
    }
    
    // Open email modal
    function openEmailModal() {
        if (!currentEstimate) {
            alert('Please calculate an estimate first.');
            return;
        }
        
        emailModal.classList.remove('hidden');
    }
    
    // Close email modal
    function closeEmailModal() {
        emailModal.classList.add('hidden');
        emailStatus.classList.add('hidden');
        emailStatus.textContent = '';
    }
    
    // Send estimate email
    function sendEstimateEmail() {
        if (!currentEstimate) {
            alert('Please calculate an estimate first.');
            return;
        }
        
        const name = document.getElementById('name').value;
        const email = document.getElementById('email').value;
        const phone = document.getElementById('phone').value;
        const address = document.getElementById('address').value;
        const notes = document.getElementById('notes').value;
        
        // Validate inputs
        if (!name || !email || !phone || !address) {
            alert('Please complete all contact information fields.');
            return;
        }
        
        // Show loading status
        emailStatus.textContent = 'Sending estimate...';
        emailStatus.classList.remove('hidden', 'success', 'error');
        
        // Prepare email data
        const emailData = {
            name: name,
            email: email,
            phone: phone,
            address: address,
            notes: notes,
            estimate: currentEstimate,
            selection: currentSelection
        };
        
        // Send email using Node Mailer API
        sendEmailToServer(emailData)
            .then(response => {
                if (response.success) {
                    emailStatus.textContent = 'Estimate sent successfully!';
                    emailStatus.classList.add('success');
                    
                    // Close modal after delay
                    setTimeout(() => {
                        closeEmailModal();
                    }, 2000);
                } else {
                    // Try fallback if primary method fails
                    return sendEmailFallback(emailData);
                }
            })
            .catch(error => {
                // Try fallback if primary method fails
                return sendEmailFallback(emailData);
            });
    }
    
    // Send email to server using Node Mailer
    async function sendEmailToServer(emailData) {
        try {
            const response = await fetch('https://surprise-granite-connections-dev.onrender.com/send-estimate', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(emailData)
            });
            
            return await response.json();
        } catch (error) {
            console.error('Error sending email:', error);
            throw error;
        }
    }
    
    // Fallback email method using UseBasin
    async function sendEmailFallback(emailData) {
        try {
            const formData = new FormData();
            
            // Add email data to form
            formData.append('name', emailData.name);
            formData.append('email', emailData.email);
            formData.append('phone', emailData.phone);
            formData.append('address', emailData.address);
            formData.append('notes', emailData.notes);
            formData.append('estimate', JSON.stringify(emailData.estimate));
            formData.append('selection', JSON.stringify(emailData.selection));
            
            const response = await fetch('https://usebasin.com/f/0e1679dd8d79', {
                method: 'POST',
                body: formData
            });
            
            if (response.ok) {
                emailStatus.textContent = 'Estimate sent successfully!';
                emailStatus.classList.add('success');
                
                // Close modal after delay
                setTimeout(() => {
                    closeEmailModal();
                }, 2000);
                
                return { success: true };
            } else {
                throw new Error('Fallback email failed');
            }
        } catch (error) {
            console.error('Error sending fallback email:', error);
            emailStatus.textContent = 'Failed to send estimate. Please try again later.';
            emailStatus.classList.add('error');
            return { success: false };
        }
    }
    
    // Print estimate
    function printEstimate() {
        if (!currentEstimate) {
            alert('Please calculate an estimate first.');
            return;
        }
        
        // This function is implemented in printable-estimate.js
        generatePrintableEstimate(currentSelection, currentEstimate);
    }
    
    // Reset form
    function resetForm() {
        estimatorForm.reset();
        
        // Reset current selection
        currentSelection = {};
        currentEstimate = null;
        
        // Reset dropdowns
        resetDependentSelections(['vendor', 'color', 'thickness', 'size']);
        
        // Hide results
        resultsContainer.classList.add('hidden');
        
        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    
    // Initialize the application
    init();
});
