if (!window.compareQuoteApp) {
  window.compareQuoteApp = true;

  window.onerror = function(message, source, lineno, colno, error) {
    console.error('Script error:', { message, source, lineno, colno, error: error ? error.stack : 'No error stack available' });
    const errorElement = document.getElementById('error');
    if (errorElement) {
      errorElement.textContent = `Error loading app: ${message} at ${source}:${lineno}:${colno}. Please refresh or check the console for details.`;
      errorElement.classList.remove('hidden');
    }
    return true;
  };

  const vendorCsvMap = {
    'All Vendors': '[invalid url, do not cite]',
    'MSI': '[invalid url, do not cite]',
    'Vendor2': '[invalid url, do not cite]'
  };

  function encryptData(data) {
    try {
      return btoa(JSON.stringify(data));
    } catch (e) {
      console.error('Encryption failed:', e);
      return '';
    }
  }

  function decryptData(encryptedData) {
    try {
      return JSON.parse(atob(encryptedData));
    } catch (e) {
      console.error('Failed to decrypt data:', e);
      return [];
    }
  }

  function sanitizeInput(input) {
    if (typeof input !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = input;
    return div.innerHTML;
  }

  function normalizeColorName(name) {
    if (typeof name !== 'string') return '';
    return name.trim().toLowerCase().replace(/\s+/g, '');
  }

  function getColorSwatch(colorName) {
    const name = normalizeColorName(colorName || '');
    if (name.includes('white')) return '#F5F5F5';
    if (name.includes('black')) return '#1F2937';
    if (name.includes('blue')) return '#3B82F6';
    if (name.includes('gray')) return '#6B7280';
    if (name.includes('brown')) return '#8B4513';
    if (name.includes('green')) return '#10B981';
    if (name.includes('gold')) return '#DAA520';
    if (name.includes('pearl')) return '#E6E0FA';
    if (name.includes('montreal')) return '#D3D3D3';
    if (name.includes('fantasy')) return '#A0522D';
    if (name.includes('calacatta')) return '#F0F0F0';
    return '#D1D5DB';
  }

  function getWasteFactor(sqFt) {
    if (sqFt < 25) return 1.30;
    if (sqFt <= 50) return 1.20;
    return 1.15;
  }

  function getFixedCost(material) {
    const m = (material || '').toLowerCase();
    if (m.includes('granite') || m.includes('quartz')) return 26;
    if (m.includes('quartzite') || m.includes('marble')) return 35;
    if (m.includes('dekton') || m.includes('porcelain')) return 55;
    return 26;
  }

  function debounce(func, wait) {
    let timeout;
    return function(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(function() { func(...args); }, wait);
    };
  }

  const imageComingSoon = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTUwIiBoZWlnaHQ9IjE1MCIgdmlld0JveD0iMCAwIDE1MCAxNTAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PHJlY3Qgd2lkdGg9IjE1MCIgaGVpZ2h0PSIxNTAiIGZpbGw9IiNFNUU3RUIiLz48cGF0aCBkPSJNMTI1IDc1QzEyNSA5Ni42MDg4IDk2LjYwODggMTI1IDc1IDEyNUM1My4zOTExIDEyNSAyNSAxOTYuNjA4OCAyNSA3NUMyNSAyMy4zOTExIDUzLjM5MTEgMjUgNzUgMjVDOTYuNjA4OCAyNSAxMjUgNTMuMzkxMSAxMjUgNzVaIiBzdHJva2U9IiM0QjU1NjMiIHN0cm9rZS13aWR0aD0iOCIvPjxwYXRoIGQ9Ik02OC43NSAxMDYuMjVDNjguNzUgMTA4LjMyMSAyNy4wNzE0IDc1IDc1IDc1QzEyMi45MjkgNzUgODEuMjUgMTA4LjMyMSA4MS4yNSAxMDYuMjUiIHN0cm9rZT0iIzRCMTU1NjMiIHN0cm9rZS13aWR0aD0iOCIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiBkb21pbmFudC1iYXNlbGluZT0ibWlkZGxlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjMUYyOTM3IiBmb250LXNpemU9IjE2IiBmb250LWZhbWlseT0iJ0ludGVyJywgc3lzdGVtLXVpLCBzYW5zLXNlcmlmIj5JbWFnZTwvdGV4dD48dGV4dCB4PSI1MCUiIHk9IjYwJSIgZG9taW5hbnQtYmFzZWxpbmU9Im1pZGRsZSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0iIzFGMjkzNyIgZm9udC1zaXplPSIxNiIgZm9udC1mYW1pbHk9IidJbnRlcicsIHN5c3RlbS11aSwgc2Fucy1zZXJpZiI+Q29taW5nIFNvb248L3RleHQ+PC9zdmc+';

  async function fetchImageUrl(colorName) {
    const normalizedColorName = normalizeColorName(colorName);
    console.log(`Fetching image for colorName: ${normalizedColorName}`);
    try {
      const response = await fetch(`/api/images/${encodeURIComponent(normalizedColorName)}`);
      if (!response.ok) {
        console.error(`Image fetch failed for ${normalizedColorName}, status: ${response.status}`);
        throw new Error(`HTTP error: ${response.status}`);
      }
      const data = await response.json();
      console.log(`Image fetch response for ${normalizedColorName}:`, data);
      return data.imageUrl || imageComingSoon;
    } catch (err) {
      console.error(`Failed to fetch image for ${normalizedColorName}:`, err);
      return imageComingSoon;
    }
  }

  function waitForReact(callback, retries = 50, interval = 1000) {
    console.log('waitForReact called, retries:', retries);
    if (window.React && window.ReactDOM && window.Papa && window.Fuse && window.jspdf) {
      console.log('React, ReactDOM, PapaParse, Fuse.js, and jsPDF found, calling callback');
      callback();
    } else {
      if (!window.React) console.log('React not found');
      if (!window.ReactDOM) console.log('ReactDOM not found');
      if (!window.Papa) console.log('PapaParse not found');
      if (!window.Fuse) console.log('Fuse.js not found');
      if (!window.jspdf) console.log('jsPDF not found');
      if (retries > 0) {
        setTimeout(function() { waitForReact(callback, retries - 1, interval); }, interval);
      } else {
        console.error('Failed to load dependencies after maximum retries');
        const errorElement = document.getElementById('error');
        if (errorElement) {
          errorElement.textContent = 'Failed to load app dependencies after 50 seconds. Please check your connection and refresh.';
          errorElement.classList.remove('hidden');
        }
      }
    }
  }

  function initApp() {
    console.log('initApp called');
    try {
      const rootElement = document.getElementById('root');
      const errorElement = document.getElementById('error');
      if (!rootElement) throw new Error('Root element not found');
      if (!errorElement) console.warn('Error element not found, error messages may not display');
      console.log('Root element found:', rootElement);
      console.log('Attempting ReactDOM.render');

      function App() {
        const [priceData, setPriceData] = React.useState([]);
        const [searchQuery, setSearchQuery] = React.useState('');
        const [searchResults, setSearchResults] = React.useState([]);
        const [isLoading, setIsLoading] = React.useState(false);
        const [isSearchLoading, setIsSearchLoading] = React.useState(false);
        const [zipCode, setZipCode] = React.useState('');
        const [regionMultiplier, setRegionMultiplier] = React.useState(1.0);
        const [regionName, setRegionName] = React.useState('National Average');
        const [filters, setFilters] = React.useState({
          vendor: 'All Vendors',
          material: 'All Materials',
          thickness: 'All Thicknesses'
        });
        const [toast, setToast] = React.useState({ message: '', show: false, isError: false });
        const [suggestions, setSuggestions] = React.useState([]);
        const [totalSqFt, setTotalSqFt] = React.useState('');
        const [budget, setBudget] = React.useState('');

        const slabArea = (127 * 64) / 144; // 127" x 64" slab in square feet

        const calculateSlabsNeeded = (sqFt) => {
          const wasteFactor = getWasteFactor(sqFt);
          const totalAreaWithWaste = sqFt * wasteFactor;
          return Math.ceil(totalAreaWithWaste / slabArea);
        };

        const calculateCostPerSqFt = (item) => {
          const baseCost = item.installedPricePerSqFt || 0;
          const fixedCost = getFixedCost(item.material);
          return (baseCost * 3.25 + fixedCost) * regionMultiplier;
        };

        React.useEffect(() => {
          document.documentElement.setAttribute('data-theme', localStorage.getItem('theme') || 'light');
        }, []);

        React.useEffect(() => {
          if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              (position) => {
                console.log('Location permission granted:', position);
                const mockZip = '85001';
                setZipCode(mockZip);
                const region = mockZip.startsWith('85') ? { name: 'Southwest', multiplier: 1.0 } :
                               mockZip.startsWith('1') ? { name: 'Northeast', multiplier: 1.25 } :
                               mockZip.startsWith('9') ? { name: 'West Coast', multiplier: 1.2 } :
                               mockZip.startsWith('6') ? { name: 'Midwest', multiplier: 1.1 } :
                               { name: 'Southeast', multiplier: 1.05 };
                setRegionName(region.name);
                setRegionMultiplier(region.multiplier);
                fetchPriceList();
              },
              (error) => {
                console.error('Location permission denied:', error);
                setRegionName('National Average');
                setRegionMultiplier(1.0);
                fetchPriceList();
              }
            );
          } else {
            console.log('Geolocation not supported');
            setRegionName('National Average');
            setRegionMultiplier(1.0);
            fetchPriceList();
          }
        }, []);

        function showToast(message, isError) {
          if (isError === undefined) isError = false;
          setToast({ message: message, show: true, isError: isError });
          setTimeout(function() { setToast({ message: '', show: false, isError: false }); }, 3000);
        }

        function toggleTheme() {
          const newTheme = (localStorage.getItem('theme') || 'light') === 'light' ? 'dark' : 'light';
          localStorage.setItem('theme', newTheme);
          document.documentElement.setAttribute('data-theme', newTheme);
        }

        async function fetchPriceList(retries = 3) {
          setIsLoading(true);
          console.log('fetchPriceList: Starting fetch, retries left:', retries);
          try {
            const csvUrl = vendorCsvMap[filters.vendor] || vendorCsvMap['All Vendors'];
            const cacheKey = `priceData_${filters.vendor || 'All Vendors'}`;
            const cachedData = localStorage.getItem(cacheKey);
            if (cachedData) {
              console.log('Using cached price data');
              const data = decryptData(cachedData);
              setPriceData(data);
              setIsLoading(false);
              return;
            }

            const response = await fetch(csvUrl);
            if (!response.ok) {
              console.error(`CSV fetch failed, status: ${response.status}`);
              throw new Error(`HTTP error: ${response.status}`);
            }
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('text/csv')) {
              throw new Error('Unexpected content type: ' + contentType);
            }
            const csvText = await response.text();
            console.log('fetchPriceList: Raw CSV data:', csvText.substring(0, 500));

            Papa.parse(csvText, {
              header: true,
              skipEmptyLines: true,
              complete: async function(results) {
                const rawData = results.data;
                console.log('fetchPriceList: Parsed CSV data:', rawData);
                const processedData = processData(rawData);
                console.log('fetchPriceList: Processed data:', processedData);
                if (processedData.length === 0) {
                  showToast('No valid countertop data available.', true);
                  setPriceData([]);
                  setIsLoading(false);
                  return;
                }
                setPriceData(processedData);
                localStorage.setItem(cacheKey, encryptData(processedData));
                setIsLoading(false);
              },
              error: function(error) {
                console.error('PapaParse error:', error);
                showToast('Failed to parse countertop data.', true);
                setPriceData([]);
                setIsLoading(false);
              }
            });
          } catch (err) {
            console.error('fetchPriceList error:', err);
            if (retries > 0) {
              console.log('Retrying fetchPriceList, attempts left:', retries - 1);
              setTimeout(() => fetchPriceList(retries - 1), 1000);
            } else {
              showToast('Failed to load countertop data after retries.', true);
              setPriceData([]);
              setIsLoading(false);
            }
          }
        }

        function processData(rawData) {
          if (!Array.isArray(rawData)) {
            console.error('Raw data is not an array:', rawData);
            return [];
          }
          return rawData.map(function(item, index) {
            if (!item || typeof item !== 'object') {
              console.log('Skipping invalid item:', item);
              return null;
            }
            const costSqFt = parseFloat(item['Cost/SqFt']);
            if (isNaN(costSqFt)) {
              console.log(`Skipping item with invalid costSqFt: ${item['Cost/SqFt']}`, item);
              return null;
            }
            const thickness = item['Thickness'] ? String(item['Thickness']) : 'Unknown';
            return {
              id: `${item['Color Name'] || 'Unknown'}-${item['Vendor Name'] || 'Unknown'}-${thickness}-${index}`,
              colorName: item['Color Name'] ? String(item['Color Name']) : 'Unknown',
              vendorName: item['Vendor Name'] ? String(item['Vendor Name']) : 'Unknown',
              thickness: thickness,
              material: item['Material'] ? String(item['Material']) : 'Unknown',
              installedPricePerSqFt: costSqFt,
              availableSqFt: parseFloat(item['Total/SqFt']) || 0,
              imageUrl: imageComingSoon,
              popularity: Math.random(),
              isNew: Math.random() > 0.8
            };
          }).filter(item => item !== null);
        }

        React.useEffect(() => {
          if (searchQuery && priceData.length > 0) {
            setIsSearchLoading(true);
            const sanitizedQuery = sanitizeInput(searchQuery);
            const filteredData = priceData.filter(item => 
              filters.vendor === 'All Vendors' || item.vendorName === filters.vendor
            );
            const fuse = new Fuse(filteredData, {
              keys: [
                { name: 'colorName', weight: 0.4 },
                { name: 'material', weight: 0.3 },
                { name: 'vendorName', weight: 0.2 },
                { name: 'thickness', weight: 0.1 }
              ],
              threshold: 0.2,
              includeScore: true,
              minMatchCharLength: 1,
              tokenize: true,
              matchAllTokens: true
            });
            const results = fuse.search(sanitizedQuery).map(result => result.item);
            setSearchResults(results);
            setSuggestions(results.slice(0, 5).map(item => `${item.colorName} (${item.material}, ${item.vendorName})`));
            setTimeout(() => setIsSearchLoading(false), 100);
          } else {
            setSearchResults([]);
            setSuggestions([]);
            setIsSearchLoading(false);
          }
        }, [searchQuery, priceData, filters.vendor]);

        React.useEffect(() => {
          fetchPriceList();
        }, [filters.vendor]);

        function clearSearchAndFilters() {
          setSearchQuery('');
          setFilters({
            vendor: 'All Vendors',
            material: 'All Materials',
            thickness: 'All Thicknesses'
          });
          setSearchResults([]);
          setSuggestions([]);
        }

        function handleSuggestionClick(suggestion) {
          setSearchQuery(suggestion);
          setSuggestions([]);
        }

        const vendors = React.useMemo(function() {
          return ['All Vendors', ...new Set(priceData.map(function(item) { return item.vendorName; }))].sort();
        }, [priceData]);

        const availableMaterials = React.useMemo(function() {
          if (!filters.vendor || filters.vendor === 'All Vendors') return ['All Materials', ...new Set(priceData.map(function(item) { return item.material; }))].sort();
          return ['All Materials', ...new Set(priceData
            .filter(function(item) { return item.vendorName === filters.vendor; })
            .map(function(item) { return item.material; }))].sort();
        }, [priceData, filters.vendor]);

        const availableThicknesses = React.useMemo(function() {
          if (!filters.vendor || !filters.material || filters.vendor === 'All Vendors' || filters.material === 'All Materials') {
            return ['All Thicknesses', ...new Set(priceData.map(function(item) { return item.thickness; }))].sort();
          }
          return ['All Thicknesses', ...new Set(priceData
            .filter(function(item) { return item.vendorName === filters.vendor && item.material === filters.material; })
            .map(function(item) { return item.thickness; }))].sort();
        }, [priceData, filters.vendor, filters.material]);

        const filteredResults = React.useMemo(function() {
          let results = searchQuery ? searchResults || [] : priceData || [];
          return results
            .filter(function(item) {
              const matchesVendor = filters.vendor === 'All Vendors' || item.vendorName === filters.vendor;
              const matchesMaterial = filters.material === 'All Materials' || item.material === filters.material;
              const matchesThickness = filters.thickness === 'All Thicknesses' || item.thickness === filters.thickness;
              return matchesVendor && matchesMaterial && matchesThickness;
            })
            .map(item => ({
              ...item,
              slabsNeeded: totalSqFt ? calculateSlabsNeeded(parseFloat(totalSqFt)) : 0,
              costPerSqFt: calculateCostPerSqFt(item),
              totalCost: totalSqFt ? (calculateCostPerSqFt(item) * parseFloat(totalSqFt) * getWasteFactor(parseFloat(totalSqFt))).toFixed(2) : 'N/A',
              isRecommended: totalSqFt && budget ? (
                parseFloat(totalSqFt) * calculateCostPerSqFt(item) * getWasteFactor(parseFloat(totalSqFt)) <= parseFloat(budget) &&
                (parseFloat(totalSqFt) < 25 ? item.material.toLowerCase().includes('granite') || item.material.toLowerCase().includes('quartz') : true)
              ) : false
            }))
            .sort((a, b) => {
              if (a.isRecommended && !b.isRecommended) return -1;
              if (!a.isRecommended && b.isRecommended) return 1;
              return b.popularity - a.popularity;
            });
        }, [searchQuery, searchResults, filters, priceData, totalSqFt, budget]);

        const debouncedSetSearchQuery = React.useCallback(debounce(setSearchQuery, 500), []);

        function exportToPDF() {
          if (!totalSqFt || filteredResults.length === 0) {
            showToast('Please enter square footage and ensure results are available.', true);
            return;
          }

          const { jsPDF } = window.jspdf;
          const doc = new jsPDF();

          doc.setFontSize(16);
          doc.text('Surprise Granite Countertop Quote', 20, 20);
          doc.setFontSize(12);
          doc.text(`Date: ${new Date().toLocaleDateString()}`, 20, 30);
          doc.text(`Total Square Footage: ${totalSqFt} sq ft`, 20, 40);
          doc.text(`Budget: $${budget || 'Not specified'}`, 20, 50);
          doc.text(`Region: ${regionName}`, 20, 60);

          doc.setFontSize(14);
          doc.text('Countertop Options:', 20, 80);

          const tableData = filteredResults.map((item, index) => [
            item.colorName,
            item.material,
            item.vendorName,
            item.thickness,
            item.slabsNeeded.toString(),
            `$${item.costPerSqFt.toFixed(2)}`,
            `$${item.totalCost}`
          ]);

          doc.autoTable({
            startY: 90,
            head: [['Color', 'Material', 'Vendor', 'Thickness', 'Slabs Needed', 'Cost/Sq Ft', 'Total Cost']],
            body: tableData,
            theme: 'grid',
            styles: { fontSize: 10, cellPadding: 2 },
            headStyles: { fillColor: [37, 99, 235] },
            alternateRowStyles: { fillColor: [240, 240, 240] }
          });

          doc.save(`Surprise_Granite_Quote_${new Date().toISOString().split('T')[0]}.pdf`);
          showToast('Quote exported as PDF.');
        }

        return React.createElement('div', { className: 'min-h-screen bg-gray-50 flex flex-col' },
          React.createElement('header', { className: 'fixed top-0 left-0 right-0 bg-white shadow-md z-10 p-4 flex flex-col gap-4' },
            React.createElement('div', { className: 'max-w-6xl mx-auto w-full flex items-center justify-between' },
              React.createElement('div', { className: 'flex items-center gap-2' },
                React.createElement('img', {
                  src: 'https://cdn.prod.website-files.com/6456ce4476abb25581fbad0c/64a70d4b30e87feb388f004f_surprise-granite-profile-logo.svg',
                  alt: 'Surprise Granite Logo',
                  className: 'h-10'
                }),
                React.createElement('h1', { className: 'text-xl font-semibold text-gray-800' }, 'Quick Quote')
              ),
              React.createElement('button', {
                onClick: toggleTheme,
                className: 'px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors duration-200',
                'aria-label': 'Switch theme'
              },
                (localStorage.getItem('theme') || 'light') === 'light' ?
                  React.createElement('svg', { className: 'w-6 h-6', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2', d: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z' })
                  ) :
                  React.createElement('svg', { className: 'w-6 h-6', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2', d: 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z' })
                  )
              )
            ),
            React.createElement('div', { className: 'max-w-6xl mx-auto w-full flex flex-col gap-4' },
              React.createElement('div', { className: 'bg-white shadow-md rounded-lg p-4 flex flex-wrap gap-4' },
                React.createElement('div', { className: 'flex flex-col gap-2 w-full sm:w-40' },
                  React.createElement('label', { className: 'text-sm font-medium text-gray-700' }, 'Total Sq Ft'),
                  React.createElement('input', {
                    type: 'number',
                    value: totalSqFt,
                    onChange: function(e) { setTotalSqFt(e.target.value); },
                    className: 'p-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500',
                    min: '0',
                    step: '0.01',
                    placeholder: 'Enter sq ft',
                    'aria-label': 'Total square footage'
                  })
                ),
                React.createElement('div', { className: 'flex flex-col gap-2 w-full sm:w-40' },
                  React.createElement('label', { className: 'text-sm font-medium text-gray-700' }, 'Budget ($)'),
                  React.createElement('input', {
                    type: 'number',
                    value: budget,
                    onChange: function(e) { setBudget(e.target.value); },
                    className: 'p-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500',
                    min: '0',
                    placeholder: 'Enter budget',
                    'aria-label': 'Budget in dollars'
                  })
                ),
                React.createElement('div', { className: 'flex flex-col gap-2 w-full sm:w-40' },
                  React.createElement('label', { className: 'text-sm font-medium text-gray-700' }, 'Vendor'),
                  React.createElement('select', {
                    value: filters.vendor,
                    onChange: function(e) { setFilters({ ...filters, vendor: e.target.value, material: 'All Materials', thickness: 'All Thicknesses' }); },
                    className: 'p-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500',
                    'aria-label': 'Filter by vendor'
                  },
                    vendors.map(function(vendor) { return React.createElement('option', { key: vendor, value: vendor }, vendor); })
                  )
                ),
                React.createElement('div', { className: 'flex flex-col gap-2 w-full sm:w-40' },
                  React.createElement('label', { className: 'text-sm font-medium text-gray-700' }, 'Material'),
                  React.createElement('select', {
                    value: filters.material,
                    onChange: function(e) { setFilters({ ...filters, material: e.target.value, thickness: 'All Thicknesses' }); },
                    className: 'p-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500',
                    'aria-label': 'Filter by material'
                  },
                    availableMaterials.map(function(material) { 
                      return React.createElement('option', { key: material, value: material }, material);
                    })
                  )
                ),
                React.createElement('div', { className: 'flex flex-col gap-2 w-full sm:w-40' },
                  React.createElement('label', { className: 'text-sm font-medium text-gray-700' }, 'Thickness'),
                  React.createElement('select', {
                    value: filters.thickness,
                    onChange: function(e) { setFilters({ ...filters, thickness: e.target.value }); },
                    className: 'p-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500',
                    'aria-label': 'Filter by thickness'
                  },
                    availableThicknesses.map(function(thickness) { 
                      return React.createElement('option', { key: thickness, value: thickness }, thickness);
                    })
                  )
                ),
                React.createElement('div', { className: 'relative flex-1 min-w-[200px]' },
                  React.createElement('input', {
                    type: 'search',
                    value: searchQuery,
                    onChange: function(e) { debouncedSetSearchQuery(e.target.value); },
                    placeholder: 'Search by slab name, material, vendor...',
                    className: 'w-full p-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500',
                    'aria-label': 'Search countertops'
                  }),
                  React.createElement('svg', {
                    className: 'absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-500',
                    fill: 'none',
                    viewBox: '0 0 24 24',
                    stroke: 'currentColor'
                  }, React.createElement('path', {
                    strokeLinecap: 'round',
                    strokeLinejoin: 'round',
                    strokeWidth: '2',
                    d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
                  })),
                  searchQuery && React.createElement('button', {
                    onClick: clearSearchAndFilters,
                    className: 'absolute right-3 top-1/2 transform -translate-y-1/2 text-sm text-blue-600 hover:underline',
                    'aria-label': 'Clear search and filters'
                  }, 'Clear')
                )
              ),
              React.createElement('div', { className: 'flex justify-between items-center' },
                React.createElement('button', {
                  onClick: function() {
                    const newZip = prompt('Enter your ZIP code:', zipCode || '');
                    if (newZip && /^\d{5}$/.test(newZip)) {
                      setZipCode(newZip);
                      const region = newZip.startsWith('85') ? { name: 'Southwest', multiplier: 1.0 } :
                                     newZip.startsWith('1') ? { name: 'Northeast', multiplier: 1.25 } :
                                     newZip.startsWith('9') ? { name: 'West Coast', multiplier: 1.2 } :
                                     newZip.startsWith('6') ? { name: 'Midwest', multiplier: 1.1 } :
                                     { name: 'Southeast', multiplier: 1.05 };
                      setRegionName(region.name);
                      setRegionMultiplier(region.multiplier);
                      fetchPriceList();
                      showToast(`Region set to ${region.name}`);
                    } else if (newZip) {
                      showToast('Invalid ZIP code', true);
                    }
                  },
                  className: 'text-sm text-gray-600 hover:underline',
                  'aria-label': 'Set ZIP code'
                }, zipCode ? `Region: ${regionName}` : 'Set ZIP Code'),
                totalSqFt && filteredResults.length > 0 && React.createElement('p', { className: 'text-sm text-gray-600' }, `Found ${filteredResults.length} options`)
              )
            )
          ),

          React.createElement('main', { className: 'flex-1 pt-36 pb-8 px-4 max-w-6xl mx-auto w-full' },
            isLoading ? 
              React.createElement('p', { className: 'text-center text-gray-600' }, 'Loading countertops...') :
              isSearchLoading ?
                React.createElement('p', { className: 'text-center text-gray-600' }, 'Searching...') :
              !filteredResults ?
                React.createElement('p', { className: 'text-center text-gray-600' }, 'Loading results...') :
              filteredResults.length === 0 ?
                React.createElement('p', { className: 'text-center text-gray-600' }, searchQuery || filters.vendor !== 'All Vendors' ? 'No countertops found' : 'Please enter a search query or apply filters') :
                React.createElement('div', { className: 'bg-white shadow-md rounded-lg overflow-x-auto' },
                  React.createElement('table', { className: 'min-w-full divide-y divide-gray-200' },
                    React.createElement('thead', { className: 'bg-gray-50' },
                      React.createElement('tr', null,
                        React.createElement('th', { className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider' }, 'Color'),
                        React.createElement('th', { className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider' }, 'Material'),
                        React.createElement('th', { className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider' }, 'Vendor'),
                        React.createElement('th', { className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider' }, 'Thickness'),
                        React.createElement('th', { className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider' }, 'Slabs Needed'),
                        React.createElement('th', { className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider' }, 'Cost/Sq Ft'),
                        React.createElement('th', { className: 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider' }, 'Total Cost')
                      )
                    ),
                    React.createElement('tbody', { className: 'bg-white divide-y divide-gray-200' },
                      filteredResults.map(function(item) {
                        return React.createElement('tr', { key: item.id, className: item.isRecommended ? 'bg-blue-50' : '' },
                          React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap flex items-center gap-2' },
                            React.createElement('div', {
                              className: 'w-6 h-6 rounded-full border border-gray-300',
                              style: { backgroundColor: getColorSwatch(item.colorName) }
                            }),
                            React.createElement('span', { className: 'text-sm font-medium text-gray-900' }, item.colorName),
                            item.isRecommended && React.createElement('span', { className: 'text-xs bg-blue-600 text-white px-2 py-1 rounded' }, 'Recommended')
                          ),
                          React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap text-sm text-gray-500' }, item.material),
                          React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap text-sm text-gray-500' }, item.vendorName),
                          React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap text-sm text-gray-500' }, item.thickness),
                          React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap text-sm text-gray-500' }, item.slabsNeeded || 'N/A'),
                          React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap text-sm text-gray-500' }, `$${item.costPerSqFt.toFixed(2)}`),
                          React.createElement('td', { className: 'px-6 py-4 whitespace-nowrap text-sm text-gray-500' }, `$${item.totalCost}`)
                        );
                      })
                    )
                  )
                ),
            filteredResults.length > 0 && React.createElement('button', {
              onClick: exportToPDF,
              className: 'mt-4 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors duration-200 mx-auto block',
              'aria-label': 'Export quote to PDF'
            }, 'Export to PDF')
          ),

          React.createElement('div', {
            className: `fixed bottom-4 left-1/2 transform -translate-x-1/2 px-4 py-2 rounded-lg text-white text-sm ${toast.isError ? 'bg-red-500' : 'bg-green-500'} ${toast.show ? 'opacity-100' : 'opacity-0'} transition-opacity`,
            style: { zIndex: 1000 }
          }, toast.message)
        );
      }

      ReactDOM.render(React.createElement(App), document.getElementById('root'));
      console.log('ReactDOM.render completed');
    } catch (err) {
      console.error('App error:', err);
      const errorElement = document.getElementById('error');
      if (errorElement) {
        errorElement.textContent = `App error: ${err.message}. Please refresh or check the console for details.`;
        errorElement.classList.remove('hidden');
      }
    }
  }

  waitForReact(initApp);
}
