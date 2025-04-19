document.addEventListener("DOMContentLoaded", () => {
  const elements = {
    roomType: document.getElementById("room-type"),
    configType: document.getElementById("config-type"),
    toggleManualConfig: document.getElementById("toggle-manual-config"),
    manualConfigGroup: document.getElementById("manual-config-group"),
    addSection: document.getElementById("add-section"),
    totalSqftBtn: document.getElementById("total-sqft-btn"),
    countertopSections: document.getElementById("countertop-sections"),
    runningSqft: document.getElementById("running-sqft"),
    slabInputMode: document.getElementById("slab-input-mode"),
    materialSearch: document.getElementById("material-search"),
    materialOptions: document.getElementById("material-options"),
    material: document.getElementById("material"),
    materialManual: document.getElementById("material-manual"),
    slabName: document.getElementById("slab-name"),
    slabNameManual: document.getElementById("slab-name-manual"),
    slabVendor: document.getElementById("slab-vendor"),
    slabVendorManual: document.getElementById("slab-vendor-manual"),
    slabThickness: document.getElementById("slab-thickness"),
    slabThicknessManual: document.getElementById("slab-thickness-manual"),
    slabSize: document.getElementById("slab-size"),
    slabSqft: document.getElementById("slab-sqft"),
    slabCostSqft: document.getElementById("slab-cost-sqft"),
    slabPriceGroup: document.getElementById("slab-price-group"),
    slabTier: document.getElementById("slab-tier"),
    slabCost: document.getElementById("slab-cost"),
    wasteFactor: document.getElementById("waste-factor"),
    backsplash: document.getElementById("backsplash"),
    backsplashLinearFt: document.getElementById("backsplash-linear-ft"),
    backsplashLinearFtGroup: document.getElementById("backsplash-linear-ft-group"),
    customBacksplashGroup: document.getElementById("custom-backsplash-group"),
    customBacksplash: document.getElementById("custom-backsplash"),
    edgeDetail: document.getElementById("edge-detail"),
    edgeLinearFt: document.getElementById("edge-linear-ft"),
    edgeLinearFtGroup: document.getElementById("edge-linear-ft-group"),
    demoRequired: document.getElementById("demo-required"),
    sinkCutouts: document.getElementById("sink-cutouts"),
    cooktopCutout: document.getElementById("cooktop-cutout"),
    plumbingOptions: document.getElementById("plumbing-options"),
    angleStopsCount: document.getElementById("angle-stops-count"),
    angleStopsGroup: document.getElementById("angle-stops-group"),
    jobType: document.getElementById("job-type"),
    clientSqftDisplay: document.getElementById("client-sqft-display"),
    totalSlabs: document.getElementById("total-slabs"),
    slabsRecommended: document.getElementById("slabs-recommended"),
    slabsCalculated: document.getElementById("slabs-calculated"),
    installedPriceSqft: document.getElementById("installed-price-sqft"),
    materialCost: document.getElementById("material-cost"),
    materialRate: document.getElementById("material-rate"),
    laborCost: document.getElementById("labor-cost"),
    laborRate: document.getElementById("labor-rate"),
    edgeCost: document.getElementById("edge-cost"),
    edgeRate: document.getElementById("edge-rate"),
    backsplashCost: document.getElementById("backsplash-cost"),
    servicesCost: document.getElementById("services-cost"),
    plumbingCost: document.getElementById("plumbing-cost"),
    setupFee: document.getElementById("setup-fee"),
    subtotal: document.getElementById("subtotal"),
    profitMargin: document.getElementById("profit-margin"),
    profitTotal: document.getElementById("profit-total"),
    estimateTotal: document.getElementById("estimate-total"),
    clearBtn: document.getElementById("clear-btn"),
    saveBtn: document.getElementById("save-btn"),
    updateBtn: document.getElementById("update-btn"),
    errorMessage: document.getElementById("error-message"),
    errorText: document.getElementById("error-text"),
    successMessage: document.getElementById("success-message"),
    successText: document.getElementById("success-text"),
    lightModeBtn: document.getElementById("light-mode-btn"),
    darkModeBtn: document.getElementById("dark-mode-btn"),
    leadName: document.getElementById("lead-name"),
    leadEmail: document.getElementById("lead-email"),
    leadPhone: document.getElementById("lead-phone"),
    leadAddress: document.getElementById("lead-address"),
    logo: document.getElementById("logo"),
  };

  let materialsData = [];
  let isManualMode = false;
  let isManualConfig = false;
  let sectionCount = 0;
  let clientSqft = 0;
  let searchTimeout;
  const MAX_SECTIONS = 100;
  const LOGO_LIGHT = "https://cdn.prod.website-files.com/6456ce4476abb25581fbad0c/673d648c63aa43897b141484_Surprise%20Granite%20Lockup%20Horizontal%20Small%20MIGA.svg";
  const LOGO_DARK = "https://cdn.prod.website-files.com/6456ce4476abb25581fbad0c/6456ce4476abb28216fbb16b_Surprise%20Granite%20Transparent%20White%20Narrow.svg";

  const configPresets = {
    kitchen: [
      { value: "l-shaped", label: "L-Shaped Kitchen", sqft: 40, waste: 20 },
      { value: "l-shaped-island", label: "L-Shaped with Island", sqft: 48, waste: 25 },
      { value: "l-shaped-peninsula", label: "L-Shaped with Peninsula", sqft: 45, waste: 20 },
      { value: "u-shaped", label: "U-Shaped Kitchen", sqft: 50, waste: 20 },
      { value: "u-shaped-island", label: "U-Shaped with Island", sqft: 60, waste: 25 },
      { value: "u-shaped-peninsula", label: "U-Shaped with Peninsula", sqft: 55, waste: 20 },
      { value: "galley", label: "Galley Kitchen", sqft: 30, waste: 20 },
      { value: "galley-island", label: "Galley with Island", sqft: 38, waste: 25 },
      { value: "g-shaped", label: "G-Shaped Kitchen", sqft: 55, waste: 20 },
    ],
    bathroom: [
      { value: "single-vanity", label: "Single Vanity", sqft: 15, waste: 20 },
      { value: "double-vanity", label: "Double Vanity", sqft: 25, waste: 20 },
      { value: "corner-vanity", label: "Corner Vanity", sqft: 18, waste: 20 },
      { value: "floating-vanity", label: "Floating Vanity", sqft: 20, waste: 20 },
    ],
    other: [
      { value: "custom", label: "Custom Configuration", sqft: 0, waste: 20 },
    ],
  };

  const fallbackData = [
    {
      colorName: "Frost-N",
      vendorName: "Arizona Tile",
      thickness: "3cm",
      material: "Quartz",
      size: "126x63",
      totalSqFt: 55.13,
      costSqFt: 0,
      priceGroup: "2",
      tier: "Low Tier",
    },
    {
      colorName: "Bianco Romano",
      vendorName: "MSI Surfaces",
      thickness: "2cm",
      material: "Granite",
      size: "126x63",
      totalSqFt: 55.0,
      costSqFt: 0,
      priceGroup: "2",
      tier: "Low Tier",
    },
  ];

  const setTheme = (theme) => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme);
    elements.logo.src = theme === "dark" ? LOGO_DARK : LOGO_LIGHT;
    elements.lightModeBtn.style.display = theme === "dark" ? "block" : "none";
    elements.darkModeBtn.style.display = theme === "dark" ? "none" : "block";
  };

  const showError = (message) => {
    elements.errorText.textContent = message;
    elements.errorMessage.style.display = "block";
    setTimeout(() => {
      elements.errorMessage.style.display = "none";
    }, 3000);
  };

  const showSuccess = (message) => {
    elements.successText.textContent = message;
    elements.successMessage.style.display = "block";
    setTimeout(() => {
      elements.successMessage.style.display = "none";
    }, 3000);
  };

  const fetchMaterials = async () => {
    try {
      const response = await fetch("/api/materials");
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      materialsData = await response.json();
      if (materialsData.length === 0) throw new Error("No valid materials data");
      populateMaterials();
      updateMaterialSearch();
    } catch (error) {
      console.error("Fetch error:", error.message);
      showError("Failed to load materials. Using fallback data.");
      materialsData = fallbackData;
      populateMaterials();
      updateMaterialSearch();
    }
  };

  const toggleInputMode = () => {
    isManualMode = elements.slabInputMode.value === "manual";
    const searchElements = document.querySelectorAll(".search-mode");
    const manualElements = document.querySelectorAll(".manual-mode");
    searchElements.forEach((el) => (el.style.display = isManualMode ? "none" : "block"));
    manualElements.forEach((el) => (el.style.display = isManualMode ? "block" : "none"));
    updateSlabDetails();
  };

  const updateJobTypeDependencies = () => {
    const jobType = elements.jobType.value;
    const isInstallOnly = jobType === "Install Only";
    const isMaterialOnly = jobType === "Material Only";
    const isFabricationOnly = jobType === "Fabrication Only";

    elements.slabInputMode.disabled = isInstallOnly;
    elements.materialSearch.disabled = isInstallOnly;
    elements.material.disabled = isInstallOnly;
    elements.materialManual.disabled = isInstallOnly;
    elements.slabVendor.disabled = isInstallOnly;
    elements.slabVendorManual.disabled = isInstallOnly;
    elements.slabThickness.disabled = isInstallOnly;
    elements.slabThicknessManual.disabled = isInstallOnly;
    elements.slabName.disabled = isInstallOnly;
    elements.slabNameManual.disabled = isInstallOnly;
    elements.slabSize.disabled = isInstallOnly;
    elements.slabSqft.disabled = isInstallOnly;
    elements.slabCostSqft.disabled = isInstallOnly;
    elements.slabPriceGroup.disabled = isInstallOnly;
    elements.slabTier.disabled = isInstallOnly;

    elements.wasteFactor.disabled = isMaterialOnly || isInstallOnly;
    elements.backsplash.disabled = isMaterialOnly || isInstallOnly;
    elements.backsplashLinearFt.disabled = isMaterialOnly || isInstallOnly;
    elements.customBacksplash.disabled = isMaterialOnly || isInstallOnly;
    elements.edgeDetail.disabled = isMaterialOnly || isInstallOnly;
    elements.edgeLinearFt.disabled = isMaterialOnly || isInstallOnly;
    elements.sinkCutouts.disabled = isMaterialOnly || isInstallOnly;
    elements.cooktopCutout.disabled = isMaterialOnly || isInstallOnly;

    elements.demoRequired.disabled = isMaterialOnly || isFabricationOnly;
    elements.plumbingOptions.disabled = isMaterialOnly || isFabricationOnly;
    elements.angleStopsCount.disabled = isMaterialOnly || isFabricationOnly;

    elements.backsplashLinearFtGroup.style.display = elements.backsplash.value !== "None" && !isMaterialOnly && !isInstallOnly ? "block" : "none";
    elements.customBacksplashGroup.style.display = elements.backsplash.value === "Custom" && !isMaterialOnly && !isInstallOnly ? "block" : "none";
    elements.edgeLinearFtGroup.style.display = elements.edgeDetail.value !== "None" && !isMaterialOnly && !isInstallOnly ? "block" : "none";
    elements.angleStopsGroup.style.display = ["KitchenAngleStop", "BathroomAngleStop", "LaundryAngleStop"].includes(elements.plumbingOptions.value) && !isMaterialOnly && !isFabricationOnly ? "block" : "none";

    calculateEstimate();
  };

  const populateMaterials = () => {
    const materials = [...new Set(materialsData.map((item) => item.material))].filter(Boolean);
    elements.material.innerHTML = `<option value="">Select Material</option>` +
      materials.map((mat) => `<option value="${mat}">${mat}</option>`).join("");

    const updateVendors = () => {
      const material = elements.material.value;
      const vendors = material
        ? [...new Set(materialsData.filter((item) => item.material === material).map((item) => item.vendorName))]
        : [...new Set(materialsData.map((item) => item.vendorName))];
      elements.slabVendor.innerHTML = `<option value="">Select Vendor</option>` +
        vendors.map((vendor) => `<option value="${vendor}">${vendor}</option>`).join("");
      updateThicknesses();
    };

    const updateThicknesses = () => {
      const material = elements.material.value;
      const vendor = elements.slabVendor.value;
      const thicknesses = material && vendor
        ? [...new Set(materialsData.filter((item) => item.material === material && item.vendorName === vendor).map((item) => item.thickness))]
        : material
        ? [...new Set(materialsData.filter((item) => item.material === material).map((item) => item.thickness))]
        : [...new Set(materialsData.map((item) => item.thickness))];
      elements.slabThickness.innerHTML = `<option value="">Select Thickness</option>` +
        thicknesses.map((thick) => `<option value="${thick}">${thick}</option>`).join("");
    };

    elements.material.addEventListener("change", updateVendors);
    elements.slabVendor.addEventListener("change", updateThicknesses);
    elements.slabThickness.addEventListener("change", updateSlabDetails);
    updateVendors();
  };

  const updateMaterialSearch = (term = "") => {
    if (isManualMode) return;
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      const filtered = materialsData
        .filter(
          (item) =>
            term === "" ||
            item.colorName.toLowerCase().includes(term.toLowerCase()) ||
            item.material.toLowerCase().includes(term.toLowerCase()) ||
            item.vendorName.toLowerCase().includes(term.toLowerCase()) ||
            item.thickness.toLowerCase().includes(term.toLowerCase()) ||
            item.size.toLowerCase().includes(term.toLowerCase()) ||
            item.priceGroup.toLowerCase().includes(term.toLowerCase()) ||
            item.tier.toLowerCase().includes(term.toLowerCase())
        )
        .slice(0, 10);
      elements.materialOptions.innerHTML = filtered
        .map((item) => `<option value="${item.colorName}">${item.colorName} - ${item.material} (${item.vendorName}, ${item.thickness})</option>`)
        .join("");
    }, 200);
  };

  const updateSlabDetails = () => {
    if (isManualMode) {
      elements.slabSize.readOnly = false;
      elements.slabSqft.readOnly = false;
      elements.slabCostSqft.readOnly = false;
      elements.slabPriceGroup.readOnly = false;
      elements.slabTier.readOnly = false;
      elements.slabName.readOnly = false;
      elements.slabName.value = elements.slabNameManual.value;
      updateSlabSqftFromSize();
    } else {
      const slabName = elements.materialSearch.value;
      const slab = materialsData.find((item) => item.colorName === slabName);
      if (slab) {
        elements.slabName.value = slab.colorName;
        elements.material.value = slab.material;
        elements.slabVendor.value = slab.vendorName;
        elements.slabThickness.value = slab.thickness;
        elements.slabSize.value = slab.size;
        elements.slabSqft.value = slab.totalSqFt.toFixed(2);
        elements.slabCostSqft.value = slab.costSqFt.toFixed(2);
        elements.slabPriceGroup.value = slab.priceGroup;
        elements.slabTier.value = slab.tier;
      } else {
        elements.slabName.value = "";
        elements.material.value = "";
        elements.slabVendor.value = "";
        elements.slabThickness.value = "";
        elements.slabSize.value = "";
        elements.slabSqft.value = "";
        elements.slabCostSqft.value = "";
        elements.slabPriceGroup.value = "";
        elements.slabTier.value = "";
      }
      elements.slabName.readOnly = true;
      elements.slabSize.readOnly = true;
      elements.slabSqft.readOnly = true;
      elements.slabCostSqft.readOnly = true;
      elements.slabPriceGroup.readOnly = true;
      elements.slabTier.readOnly = true;
    }
    calculateEstimate();
  };

  const updateSlabSqftFromSize = () => {
    if (!isManualMode) return;
    const size = elements.slabSize.value.trim();
    const match = size.match(/^(\d+\.?\d*)x(\d+\.?\d*)$/);
    if (match) {
      const length = parseFloat(match[1]);
      const width = parseFloat(match[2]);
      if (length > 0 && width > 0) {
        const sqft = (length * width) / 144;
        elements.slabSqft.value = sqft.toFixed(2);
      } else {
        elements.slabSqft.value = "";
      }
    } else {
      elements.slabSqft.value = "";
    }
  };

  const populateConfigOptions = () => {
    const roomType = elements.roomType.value;
    const configs = configPresets[roomType] || configPresets.kitchen;
    elements.configType.innerHTML = configs
      .map((config) => `<option value="${config.value}" data-sqft="${config.sqft}" data-waste="${config.waste}">${config.label}</option>`)
      .join("");
    updateClientSqft();
  };

  const updateClientSqft = () => {
    if (isManualConfig) return;
    const selectedOption = elements.configType.options[elements.configType.selectedIndex];
    let sqft = selectedOption ? parseFloat(selectedOption.dataset.sqft) || 0 : 0;
    const waste = selectedOption ? parseFloat(selectedOption.dataset.waste) || 20 : 20;
    elements.wasteFactor.value = waste;

    if (elements.backsplash.value !== "None" && elements.jobType.value !== "Material Only" && elements.jobType.value !== "Install Only") {
      const linearFt = parseFloat(elements.backsplashLinearFt.value) || 0;
      const height = elements.backsplash.value === "4in"
        ? 4
        : elements.backsplash.value === "6in"
        ? 6
        : parseFloat(elements.customBacksplash.value) || 4;
      if (linearFt >= 0 && height >= 0) {
        sqft += (linearFt * height) / 12;
      }
    }

    clientSqft = sqft;
    elements.clientSqftDisplay.textContent = sqft.toFixed(1);
    calculateEstimate();
  };

  const addCountertopSection = () => {
    if (sectionCount >= MAX_SECTIONS) {
      showError(`Cannot add more than ${MAX_SECTIONS} sections`);
      return;
    }
    sectionCount++;
    const sectionId = `section-${sectionCount}`;
    const defaultWidth = elements.roomType.value === "kitchen" ? 26.5 : elements.roomType.value === "bathroom" ? 22.5 : 24;
    const html = `
      <div id="${sectionId}" class="section-row">
        <div class="input-group">
          <label for="${sectionId}-length">Length (in)</label>
          <input type="number" id="${sectionId}-length" min="0" step="0.1" value="0" aria-label="Length" />
        </div>
        <div class="input-group">
          <label for="${sectionId}-width">Width (in)</label>
          <input type="number" id="${sectionId}-width" min="0" step="0.1" value="${defaultWidth}" aria-label="Width" />
        </div>
        <div class="input-group">
          <label for="${sectionId}-sqft">Subtotal Sq Ft</label>
          <input type="number" id="${sectionId}-sqft" value="0" readonly aria-label="Subtotal Sq Ft" />
        </div>
        <div class="input-group">
          <button type="button" class="btn-secondary remove-section" data-id="${sectionId}" aria-label="Remove section">Remove</button>
        </div>
      </div>
    `;
    const lastSection = elements.countertopSections.querySelector(".section-row:last-child");
    if (lastSection) {
      lastSection.insertAdjacentHTML("afterend", html);
    } else {
      elements.countertopSections.insertAdjacentHTML("afterbegin", html);
    }

    const section = document.getElementById(sectionId);
    const lengthInput = section.querySelector(`#${sectionId}-length`);
    const widthInput = section.querySelector(`#${sectionId}-width`);
    const sqftInput = section.querySelector(`#${sectionId}-sqft`);
    const removeBtn = section.querySelector(".remove-section");

    const updateSubtotal = () => {
      const length = parseFloat(lengthInput.value) || 0;
      const width = parseFloat(widthInput.value) || 0;
      if (length < 0 || width < 0) {
        showError("Length and width must be non-negative");
        lengthInput.value = Math.max(0, length);
        widthInput.value = Math.max(0, width);
        return;
      }
      const sqft = (length * width) / 144;
      sqftInput.value = sqft.toFixed(1);
      calculateManualSqft();
    };

    lengthInput.addEventListener("input", updateSubtotal);
    widthInput.addEventListener("input", updateSubtotal);
    removeBtn.addEventListener("click", () => {
      section.remove();
      sectionCount--;
      calculateManualSqft();
    });

    updateSubtotal();
  };

  const calculateManualSqft = () => {
    if (!isManualConfig) return;
    let totalSqft = 0;
    const sections = elements.countertopSections.querySelectorAll(".section-row");
    sections.forEach((section) => {
      const sqftInput = section.querySelector("input[id$='-sqft']");
      totalSqft += parseFloat(sqftInput.value) || 0;
    });

    if (elements.backsplash.value !== "None" && elements.jobType.value !== "Material Only" && elements.jobType.value !== "Install Only") {
      const linearFt = parseFloat(elements.backsplashLinearFt.value) || 0;
      const height = elements.backsplash.value === "4in"
        ? 4
        : elements.backsplash.value === "6in"
        ? 6
        : parseFloat(elements.customBacksplash.value) || 4;
      if (linearFt < 0 || height < 0) {
        showError("Backsplash measurements must be non-negative");
        if (linearFt < 0) elements.backsplashLinearFt.value = 0;
        if (height < 0) elements.customBacksplash.value = 4;
        return;
      }
      totalSqft += (linearFt * height) / 12;
    }

    clientSqft = totalSqft;
    elements.runningSqft.textContent = totalSqft.toFixed(1);
    elements.clientSqftDisplay.textContent = totalSqft.toFixed(1);
    calculateEstimate();
  };

  const toggleManualConfig = () => {
    isManualConfig = !isManualConfig;
    elements.manualConfigGroup.style.display = isManualConfig ? "block" : "none";
    elements.toggleManualConfig.textContent = isManualConfig
      ? "Use Preset"
      : "Configure Manually";
    if (isManualConfig) {
      elements.wasteFactor.value = "20";
      elements.countertopSections.innerHTML = "";
      sectionCount = 0;
      clientSqft = 0;
      elements.runningSqft.textContent = "0.0";
      elements.clientSqftDisplay.textContent = "0.0";
      addCountertopSection();
    } else {
      updateClientSqft();
    }
    calculateEstimate();
  };

  const updatePlumbingOptions = () => {
    const plumbingOption = elements.plumbingOptions.value;
    const requiresAngleStops = ["KitchenAngleStop", "BathroomAngleStop", "LaundryAngleStop"].includes(plumbingOption);
    elements.angleStopsGroup.style.display = requiresAngleStops ? "block" : "none";
    if (!requiresAngleStops) {
      elements.angleStopsCount.value = "0";
    }
    calculateEstimate();
  };

  const calculateEstimate = () => {
    const slabSqft = parseFloat(elements.slabSqft.value) || 0;
    const slabCostSqft = parseFloat(elements.slabCostSqft.value) || 0;
    const wasteFactor = parseFloat(elements.wasteFactor.value) / 100 || 0.2;
    const edgeDetail = elements.edgeDetail.value;
    const edgeLinearFt = parseFloat(elements.edgeLinearFt.value) || 0;
    const backsplash = elements.backsplash.value;
    const backsplashLinearFt = parseFloat(elements.backsplashLinearFt.value) || 0;
    const customBacksplashHeight = parseFloat(elements.customBacksplash.value) || 0;
    const demoRequired = elements.demoRequired.value === "Yes";
    const sinkCutouts = parseInt(elements.sinkCutouts.value) || 0;
    const cooktopCutout = elements.cooktopCutout.value === "Yes";
    const plumbingOption = elements.plumbingOptions.value;
    const angleStopsCount = parseInt(elements.angleStopsCount.value) || 0;
    const jobType = elements.jobType.value;

    // Material Cost
    let materialCost = 0;
    if (jobType !== "Install Only") {
      const slabsCalculated = slabSqft > 0 ? clientSqft * (1 + wasteFactor) / slabSqft : 0;
      const slabsRecommended = Math.ceil(slabsCalculated);
      elements.totalSlabs.textContent = slabsRecommended;
      elements.slabsRecommended.textContent = slabsRecommended;
      elements.slabsCalculated.textContent = slabsCalculated.toFixed(2);
      materialCost = slabsRecommended * slabSqft * slabCostSqft;
    }

    // Backsplash Cost
    let backsplashCost = 0;
    if (backsplash !== "None" && jobType !== "Material Only" && jobType !== "Install Only") {
      const height = backsplash === "4in" ? 4 : backsplash === "6in" ? 6 : customBacksplashHeight;
      const backsplashSqft = (backsplashLinearFt * height) / 12;
      backsplashCost = backsplashSqft * slabCostSqft;
    }

    // Edge Detail Cost
    let edgeCost = 0;
    if (edgeDetail !== "None" && jobType !== "Material Only" && jobType !== "Install Only") {
      const edgeRate = edgeDetail === "Bullnose" ? 10 : edgeDetail === "Ogee" ? 20 : 0;
      edgeCost = edgeLinearFt * edgeRate;
      elements.edgeRate.textContent = `$${edgeRate.toFixed(2)}`;
    } else {
      elements.edgeRate.textContent = "$0.00";
    }

    // Additional Services Cost
    let servicesCost = 0;
    if (jobType !== "Material Only" && jobType !== "Fabrication Only") {
      if (demoRequired) servicesCost += clientSqft * 10;
      servicesCost += sinkCutouts * 100;
      if (cooktopCutout) servicesCost += 150;
    }

    // Plumbing Cost
    let plumbingCost = 0;
    if (jobType !== "Material Only" && jobType !== "Fabrication Only") {
      const plumbingCosts = {
        KitchenStandard: 350,
        KitchenBasket: 50,
        KitchenROReconnect: 175,
        KitchenRONew: 375,
        KitchenAngleStop: 75 * angleStopsCount,
        KitchenIcemaker: 350,
        BathroomFaucet: 200,
        BathroomAngleStop: 75 * angleStopsCount,
        LaundrySink: 150,
        LaundryAngleStop: 75 * angleStopsCount,
        ComboKitchenBath: 550,
      };
      plumbingCost = plumbingCosts[plumbingOption] || 0;
    }

    // Labor Cost
    let laborCost = 0;
    if (jobType !== "Material Only") {
      laborCost = clientSqft * 30; // Example labor rate: $30/sq ft
    }

    // Setup Fee
    const setupFee = 250;

    // Totals
    const subtotal = materialCost + laborCost + edgeCost + backsplashCost + servicesCost + plumbingCost + setupFee;
    const profitMargin = 0.35;
    const profitTotal = subtotal * profitMargin;
    const estimateTotal = subtotal + profitTotal;

    // Update DOM
    elements.slabCost.textContent = `$${materialCost.toFixed(2)}`;
    elements.clientSqftDisplay.textContent = clientSqft.toFixed(1);
    elements.materialCost.textContent = `$${materialCost.toFixed(2)}`;
    elements.materialRate.textContent = `$${slabCostSqft.toFixed(2)}`;
    elements.laborCost.textContent = `$${laborCost.toFixed(2)}`;
    elements.laborRate.textContent = "$30.00";
    elements.edgeCost.textContent = `$${edgeCost.toFixed(2)}`;
    elements.backsplashCost.textContent = `$${backsplashCost.toFixed(2)}`;
    elements.servicesCost.textContent = `$${servicesCost.toFixed(2)}`;
    elements.plumbingCost.textContent = `$${plumbingCost.toFixed(2)}`;
    elements.setupFee.textContent = `$${setupFee.toFixed(2)}`;
    elements.subtotal.textContent = `$${subtotal.toFixed(2)}`;
    elements.profitMargin.textContent = `${(profitMargin * 100).toFixed(0)}%`;
    elements.profitTotal.textContent = `$${profitTotal.toFixed(2)}`;
    elements.estimateTotal.textContent = `$${estimateTotal.toFixed(2)}`;
    elements.installedPriceSqft.textContent = clientSqft > 0 ? `$${(estimateTotal / clientSqft).toFixed(2)}` : "$0.00";
  };

  const clearLeadForm = () => {
    elements.leadName.value = "";
    elements.leadEmail.value = "";
    elements.leadPhone.value = "";
    elements.leadAddress.value = "";
    showSuccess("Lead form cleared!");
  };

  const clearConfigForm = () => {
    elements.roomType.value = "kitchen";
    populateConfigOptions();
    elements.configType.value = configPresets.kitchen[0].value;
    isManualConfig = false;
    elements.manualConfigGroup.style.display = "none";
    elements.toggleManualConfig.textContent = "Configure Manually";
    elements.countertopSections.innerHTML = "";
    sectionCount = 0;
    elements.runningSqft.textContent = "0.0";
    clientSqft = 0;
    elements.clientSqftDisplay.textContent = "0.0";
    calculateEstimate();
    showSuccess("Configuration form cleared!");
  };

  const clearSlabForm = () => {
    elements.slabInputMode.value = "search";
    isManualMode = false;
    toggleInputMode();
    elements.materialSearch.value = "";
    elements.material.value = "";
    elements.materialManual.value = "";
    elements.slabName.value = "";
    elements.slabNameManual.value = "";
    elements.slabVendor.value = "";
    elements.slabVendorManual.value = "";
    elements.slabThickness.value = "";
    elements.slabThicknessManual.value = "";
    elements.slabSize.value = "";
    elements.slabSqft.value = "";
    elements.slabCostSqft.value = "";
    elements.slabPriceGroup.value = "";
    elements.slabTier.value = "";
    calculateEstimate();
    showSuccess("Slab form cleared!");
  };

  const clearCountertopForm = () => {
    elements.jobType.value = "Fabrication and Install";
    elements.wasteFactor.value = "20";
    elements.backsplash.value = "None";
    elements.backsplashLinearFt.value = "0";
    elements.backsplashLinearFtGroup.style.display = "none";
    elements.customBacksplashGroup.style.display = "none";
    elements.customBacksplash.value = "0";
    elements.edgeDetail.value = "None";
    elements.edgeLinearFt.value = "0";
    elements.edgeLinearFtGroup.style.display = "none";
    elements.demoRequired.value = "No";
    elements.sinkCutouts.value = "0";
    elements.cooktopCutout.value = "No";
    elements.plumbingOptions.value = "None";
    elements.angleStopsCount.value = "0";
    elements.angleStopsGroup.style.display = "none";
    updateJobTypeDependencies();
    showSuccess("Countertop options cleared!");
  };

  const clearAllForms = () => {
    clearLeadForm();
    clearConfigForm();
    clearSlabForm();
    clearCountertopForm();
    showSuccess("All forms cleared!");
  };

  const saveEstimate = () => {
    const estimateData = {
      lead: {
        name: elements.leadName.value,
        email: elements.leadEmail.value,
        phone: elements.leadPhone.value,
        address: elements.leadAddress.value,
      },
      configuration: {
        roomType: elements.roomType.value,
        configType: elements.configType.value,
        isManual: isManualConfig,
        sections: isManualConfig
          ? Array.from(elements.countertopSections.querySelectorAll(".section-row")).map((section) => ({
              length: parseFloat(section.querySelector("input[id$='-length']").value) || 0,
              width: parseFloat(section.querySelector("input[id$='-width']").value) || 0,
              sqft: parseFloat(section.querySelector("input[id$='-sqft']").value) || 0,
            }))
          : null,
        totalSqft: clientSqft,
      },
      slab: {
        inputMode: elements.slabInputMode.value,
        material: isManualMode ? elements.materialManual.value : elements.material.value,
        vendor: isManualMode ? elements.slabVendorManual.value : elements.slabVendor.value,
        thickness: isManualMode ? elements.slabThicknessManual.value : elements.slabThickness.value,
        colorName: isManualMode ? elements.slabNameManual.value : elements.slabName.value,
        size: elements.slabSize.value,
        sqft: parseFloat(elements.slabSqft.value) || 0,
        costSqft: parseFloat(elements.slabCostSqft.value) || 0,
        priceGroup: elements.slabPriceGroup.value,
        tier: elements.slabTier.value,
      },
      countertopOptions: {
        jobType: elements.jobType.value,
        wasteFactor: parseFloat(elements.wasteFactor.value) || 20,
        backsplash: elements.backsplash.value,
        backsplashLinearFt: parseFloat(elements.backsplashLinearFt.value) || 0,
        customBacksplash: parseFloat(elements.customBacksplash.value) || 0,
        edgeDetail: elements.edgeDetail.value,
        edgeLinearFt: parseFloat(elements.edgeLinearFt.value) || 0,
        demoRequired: elements.demoRequired.value,
        sinkCutouts: parseInt(elements.sinkCutouts.value) || 0,
        cooktopCutout: elements.cooktopCutout.value,
        plumbingOptions: elements.plumbingOptions.value,
        angleStopsCount: parseInt(elements.angleStopsCount.value) || 0,
      },
      estimate: {
        totalSqft: clientSqft,
        slabsRecommended: parseInt(elements.slabsRecommended.textContent) || 0,
        slabCost: parseFloat(elements.slabCost.textContent.replace('$', '')) || 0,
        materialCost: parseFloat(elements.materialCost.textContent.replace('$', '')) || 0,
        laborCost: parseFloat(elements.laborCost.textContent.replace('$', '')) || 0,
        edgeCost: parseFloat(elements.edgeCost.textContent.replace('$', '')) || 0,
        backsplashCost: parseFloat(elements.backsplashCost.textContent.replace('$', '')) || 0,
        servicesCost: parseFloat(elements.servicesCost.textContent.replace('$', '')) || 0,
        plumbingCost: parseFloat(elements.plumbingCost.textContent.replace('$', '')) || 0,
        setupFee: parseFloat(elements.setupFee.textContent.replace('$', '')) || 0,
        subtotal: parseFloat(elements.subtotal.textContent.replace('$', '')) || 0,
        profitMargin: parseFloat(elements.profitMargin.textContent.replace('%', '')) / 100 || 0,
        profitTotal: parseFloat(elements.profitTotal.textContent.replace('$', '')) || 0,
        estimateTotal: parseFloat(elements.estimateTotal.textContent.replace('$', '')) || 0,
      },
      timestamp: new Date().toISOString(),
    };

    if (!estimateData.lead.name || !estimateData.lead.email) {
      showError("Name and Email are required to save the estimate.");
      return;
    }

    try {
      const blob = new Blob([JSON.stringify(estimateData, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `estimate-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showSuccess("Estimate saved successfully!");
    } catch (error) {
      console.error("Save error:", error);
      showError("Failed to save estimate.");
    }
  };

  // Event Listeners
  elements.lightModeBtn.addEventListener("click", () => setTheme("light"));
  elements.darkModeBtn.addEventListener("click", () => setTheme("dark"));
  elements.roomType.addEventListener("change", populateConfigOptions);
  elements.configType.addEventListener("change", updateClientSqft);
  elements.toggleManualConfig.addEventListener("click", toggleManualConfig);
  elements.addSection.addEventListener("click", addCountertopSection);
  elements.totalSqftBtn.addEventListener("click", calculateManualSqft);
  elements.slabInputMode.addEventListener("change", toggleInputMode);
  elements.materialSearch.addEventListener("input", () => updateMaterialSearch(elements.materialSearch.value));
  elements.materialSearch.addEventListener("change", updateSlabDetails);
  elements.slabSize.addEventListener("input", updateSlabSqftFromSize);
  elements.backsplash.addEventListener("change", () => {
    elements.backsplashLinearFtGroup.style.display = elements.backsplash.value !== "None" && elements.jobType.value !== "Material Only" && elements.jobType.value !== "Install Only" ? "block" : "none";
    elements.customBacksplashGroup.style.display = elements.backsplash.value === "Custom" && elements.jobType.value !== "Material Only" && elements.jobType.value !== "Install Only" ? "block" : "none";
    calculateEstimate();
  });
  elements.backsplashLinearFt.addEventListener("input", calculateEstimate);
  elements.customBacksplash.addEventListener("input", calculateEstimate);
  elements.edgeDetail.addEventListener("change", () => {
    elements.edgeLinearFtGroup.style.display = elements.edgeDetail.value !== "None" && elements.jobType.value !== "Material Only" && elements.jobType.value !== "Install Only" ? "block" : "none";
    calculateEstimate();
  });
  elements.edgeLinearFt.addEventListener("input", calculateEstimate);
  elements.demoRequired.addEventListener("change", calculateEstimate);
  elements.sinkCutouts.addEventListener("input", calculateEstimate);
  elements.cooktopCutout.addEventListener("change", calculateEstimate);
  elements.plumbingOptions.addEventListener("change", updatePlumbingOptions);
  elements.angleStopsCount.addEventListener("input", calculateEstimate);
  elements.jobType.addEventListener("change", updateJobTypeDependencies);
  elements.wasteFactor.addEventListener("input", calculateEstimate);
  elements.clearBtn.addEventListener("click", clearAllForms);
  elements.saveBtn.addEventListener("click", saveEstimate);
  elements.updateBtn.addEventListener("click", calculateEstimate);

  // Initialize
  const savedTheme = localStorage.getItem("theme") || "dark";
  setTheme(savedTheme);
  fetchMaterials();
  populateConfigOptions();
  updateJobTypeDependencies();
  calculateEstimate();
});
