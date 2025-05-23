if (!window.compareQuoteApp) {
  window.compareQuoteApp = true;

  window.onerror = function(message, source, lineno, colno, error) {
    console.error('Script error:', { message, source, lineno, colno, error });
    const errorElement = document.getElementById('error');
    if (errorElement) {
      errorElement.textContent = `Error loading app: ${message}. Please refresh.`;
      errorElement.classList.remove('hidden');
    }
  };

  const vendorCsvMap = {
    'All Vendors': '[invalid url, do not cite]',
    'MSI': '[invalid url, do not cite]',
    'Vendor2': '[invalid url, do not cite]'
  };

  function encryptData(data) {
    return btoa(JSON.stringify(data));
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
    const div = document.createElement('div');
    div.textContent = input;
    return div.innerHTML;
  }

  function normalizeColorName(name) {
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
    if (window.React && window.ReactDOM && window.Papa && window.Fuse) {
      console.log('React, ReactDOM, PapaParse, and Fuse.js found, calling callback');
      callback();
    } else {
      if (!window.React) console.log('React not found');
      if (!window.ReactDOM) console.log('ReactDOM not found');
      if (!window.Papa) console.log('PapaParse not found');
      if (!window.Fuse) console.log('Fuse.js not found');
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

      const CountertopCard = React.memo(function({ item, addToQuote, quote, updateTempSqFt, tempSqFtInputs, setTempSqFtInputs, index, highlightText }) {
        const price = typeof item.installedPricePerSqFt === 'number' && !isNaN(item.installedPricePerSqFt) ? item.installedPricePerSqFt : 0;
        const isInQuote = quote.some(q => q.id === item.id);
        const tempSqFt = tempSqFtInputs[index] || '';
        const highlight = (text) => {
          if (!highlightText || !text) return text;
          const regex = new RegExp(`(${highlightText})`, 'gi');
          const parts = text.split(regex);
          return parts.map((part, i) => 
            regex.test(part) ? 
              React.createElement('span', { key: i, className: 'highlight', style: { backgroundColor: '#dbeafe', color: '#1e40af' } }, part) : 
              part
          );
        };
        return React.createElement('div', { 
          className: 'card bg-white shadow-md rounded-lg p-4 flex flex-col gap-2 max-w-sm w-full',
          style: { border: isInQuote ? '2px solid #3b82f6' : 'none' }
        },
          React.createElement('div', { className: 'flex items-center gap-2' },
            React.createElement('div', {
              className: 'w-8 h-8 rounded-full border border-gray-300',
              style: { backgroundColor: getColorSwatch(item.colorName) }
            }),
            React.createElement('h3', { className: 'text-lg font-semibold text-gray-800' }, highlight(item.colorName)),
            item.isNew && React.createElement('span', { className: 'bg-green-500 text-white text-xs px-2 py-1 rounded' }, 'New')
          ),
          React.createElement('p', { className: 'text-sm text-gray-600' },
            'Material: ',
            React.createElement('span', { className: `px-2 py-1 rounded text-white ${getMaterialBadgeColor(item.material)}` }, highlight(item.material))
          ),
          React.createElement('p', { className: 'text-sm text-gray-600' }, 'Vendor: ', highlight(item.vendorName)),
          React.createElement('p', { className: 'text-sm text-gray-600' }, 'Thickness: ', highlight(item.thickness || 'N/A')),
          React.createElement('p', { className: 'text-sm text-gray-600' }, 'Price: $', price.toFixed(2), '/sq ft', price === 0 ? ' (Estimated)' : ''),
          React.createElement('div', { className: 'flex flex-col gap-2 mt-2' },
            React.createElement('label', { className: 'text-sm font-medium text-gray-700' }, 'Area (sq ft)'),
            React.createElement('input', {
              type: 'number',
              value: tempSqFt,
              onChange: function(e) { 
                const newInputs = [...tempSqFtInputs];
                newInputs[index] = e.target.value;
                setTempSqFtInputs(newInputs);
              },
              className: 'p-2 border rounded-lg w-full',
              min: '0',
              step: '0.01',
              placeholder: 'Enter sq ft',
              'aria-label': `Square footage for ${item.colorName}`,
              style: { borderColor: '#d1d5db' }
            })
          ),
          React.createElement('button', {
            onClick: function() { 
              if (tempSqFt && parseFloat(tempSqFt) > 0) {
                addToQuote({ ...item, sqFt: tempSqFt });
              } else {
                showToast('Please enter a valid square footage', true);
              }
            },
            className: `w-full py-2 rounded-lg text-white font-medium ${isInQuote ? 'bg-gray-400' : 'bg-blue-600 hover:bg-blue-700'}`,
            disabled: isInQuote,
            'aria-label': `Add ${item.colorName} to quote`
          }, isInQuote ? 'Added' : 'Add to Quote')
        );
      });

      function App() {
        const [priceData, setPriceData] = React.useState([]);
        const [quote, setQuote] = React.useState(function() {
          try {
            const encryptedQuote = localStorage.getItem('quote');
            return encryptedQuote ? decryptData(encryptedQuote) : [];
          } catch (e) {
            console.error('Failed to parse quote from localStorage:', e);
            return [];
          }
        });
        const [searchQuery, setSearchQuery] = React.useState('');
        const [searchResults, setSearchResults] = React.useState([]);
        const [currentStep, setCurrentStep] = React.useState(1);
        const [isLoading, setIsLoading] = React.useState(false);
        const [isSearchLoading, setIsSearchLoading] = React.useState(false);
        const [zipCode, setZipCode] = React.useState('');
        const [regionMultiplier, setRegionMultiplier] = React.useState(1.0);
        const [regionName, setRegionName] = React.useState('National Average');
        const [filters, setFilters] = React.useState({ 
          vendor: 'All Vendors', 
          material: 'All Materials', 
          color: 'All Colors', 
          thickness: 'All Thicknesses' 
        });
        const [toast, setToast] = React.useState({ message: '', show: false, isError: false });
        const [formErrors, setFormErrors] = React.useState({ name: '', email: '' });
        const [showFilters, setShowFilters] = React.useState(false);
        const [tempSqFtInputs, setTempSqFtInputs] = React.useState([]);
        const [suggestions, setSuggestions] = React.useState([]);

        const totalCartCost = React.useMemo(() => {
          return quote.reduce((total, item) => {
            const price = typeof item.installedPricePerSqFt === 'number' && !isNaN(item.installedPricePerSqFt) ? item.installedPricePerSqFt : 0;
            const sqFt = parseFloat(item.sqFt) || 0;
            return total + (sqFt * getWasteFactor(sqFt) * price);
          }, 0).toFixed(2);
        }, [quote]);

        const activeFiltersCount = React.useMemo(() => {
          let count = 0;
          if (filters.vendor !== 'All Vendors') count++;
          if (filters.material !== 'All Materials') count++;
          if (filters.color !== 'All Colors') count++;
          if (filters.thickness !== 'All Thicknesses') count++;
          return count;
        }, [filters]);

        React.useEffect(function() {
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
              installedPricePerSqFt: (costSqFt * 3.25 + 35) * (regionMultiplier || 1.0),
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

        const addToQuote = React.useCallback(function(item) {
          if (quote.some(q => q.id === item.id)) {
            showToast(`${item.colorName} is already in your quote`, true);
            return;
          }
          const newQuote = [...quote, { ...item }];
          setQuote(newQuote);
          localStorage.setItem('quote', encryptData(newQuote));
          showToast(`${item.colorName} added to quote`);
        }, [quote]);

        const removeFromQuote = React.useCallback(function(id) {
          const newQuote = quote.filter(item => item.id !== id);
          setQuote(newQuote);
          localStorage.setItem('quote', encryptData(newQuote));
          showToast('Item removed from quote');
        }, [quote]);

        const updateTempSqFt = React.useCallback(function(index, value) {
          const newInputs = [...tempSqFtInputs];
          newInputs[index] = value;
          setTempSqFtInputs(newInputs);
        }, [tempSqFtInputs]);

        function clearSearchAndFilters() {
          setSearchQuery('');
          setFilters({ 
            vendor: 'All Vendors', 
            material: 'All Materials', 
            color: 'All Colors', 
            thickness: 'All Thicknesses' 
          });
          setSearchResults([]);
          setSuggestions([]);
          setShowFilters(false);
        }

        function handleSuggestionClick(suggestion) {
          setSearchQuery(suggestion);
          setSuggestions([]);
        }

        function validateForm(name, email) {
          const errors = { name: '', email: '' };
          if (!name || !name.trim()) errors.name = 'Name is required';
          if (!email) {
            errors.email = 'Email is required';
          } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            errors.email = 'Invalid email format';
          }
          setFormErrors(errors);
          return !errors.name && !errors.email;
        }

        async function handleQuoteSubmit(e) {
          e.preventDefault();
          setIsLoading(true);
          const name = sanitizeInput(e.target.name.value);
          const email = sanitizeInput(e.target.email.value);
          const phone = sanitizeInput(e.target.phone.value);
          const notes = sanitizeInput(e.target.notes.value);

          if (!validateForm(name, email)) {
            setIsLoading(false);
            showToast('Please fix form errors', true);
            return;
          }

          if (quote.length === 0) {
            setIsLoading(false);
            showToast('Please add items to your quote', true);
            return;
          }

          const quoteDetails = quote.map(function(item) {
            return {
              colorName: item.colorName,
              material: item.material,
              vendor: item.vendorName,
              thickness: item.thickness,
              sqFt: item.sqFt || 'Not specified',
              cost: item.sqFt && typeof item.installedPricePerSqFt === 'number' ? (item.sqFt * getWasteFactor(item.sqFt) * item.installedPricePerSqFt).toFixed(2) : 'N/A'
            };
          });

          const formData = new FormData();
          formData.append('name', name);
          formData.append('email', email);
          formData.append('phone', phone || 'Not provided');
          formData.append('notes', notes || 'No additional notes');
          formData.append('quote_details', quoteDetails.map(function(item) {
            return `Color: ${item.colorName}, Material: ${item.material}, Vendor: ${item.vendor}, Thickness: ${item.thickness}, Sq Ft: ${item.sqFt}, Cost: $${item.cost}`;
          }).join('\n'));
          formData.append('region', regionName);
          formData.append('zip_code', zipCode);

          try {
            const response = await fetch('https://usebasin.com/f/0e1679dd8d79', {
              method: 'POST',
              body: formData,
              headers: { 'Accept': 'application/json' }
            });
            if (response.status !== 200 && response.status !== 202) {
              throw new Error(`Submission failed: ${response.status}`);
            }
            showToast('Quote submitted successfully');
            e.target.reset();
            setQuote([]);
            localStorage.setItem('quote', encryptData([]));
            setCurrentStep(1);
            setFormErrors({ name: '', email: '' });
          } catch (err) {
            console.error('Quote submission error:', err);
            showToast('Failed to submit quote. Check spam folder or try again.', true);
          } finally {
            setIsLoading(false);
          }
        }

        const debouncedSetSearchQuery = React.useCallback(debounce(setSearchQuery, 500), []);

        const vendors = React.useMemo(function() {
          return ['All Vendors', ...new Set(priceData.map(function(item) { return item.vendorName; }))].sort();
        }, [priceData]);

        const availableMaterials = React.useMemo(function() {
          if (!filters.vendor || filters.vendor === 'All Vendors') return ['All Materials', ...new Set(priceData.map(function(item) { return item.material; }))].sort();
          return ['All Materials', ...new Set(priceData
            .filter(function(item) { return item.vendorName === filters.vendor; })
            .map(function(item) { return item.material; }))].sort();
        }, [priceData, filters.vendor]);

        const availableColors = React.useMemo(function() {
          if (!filters.vendor || !filters.material || filters.vendor === 'All Vendors' || filters.material === 'All Materials') return ['All Colors', ...new Set(priceData.map(function(item) { return item.colorName; }))].sort();
          return ['All Colors', ...new Set(priceData
            .filter(function(item) { return item.vendorName === filters.vendor && item.material === filters.material; })
            .map(function(item) { return item.colorName; }))].sort();
        }, [priceData, filters.vendor, filters.material]);

        const availableThicknesses = React.useMemo(function() {
          if (!filters.vendor || !filters.material || !filters.color || filters.vendor === 'All Vendors' || filters.material === 'All Materials' || filters.color === 'All Colors') {
            return ['All Thicknesses', ...new Set(priceData.map(function(item) { return item.thickness; }))].sort();
          }
          return ['All Thicknesses', ...new Set(priceData
            .filter(function(item) { return item.vendorName === filters.vendor && item.material === filters.material && item.colorName === filters.color; })
            .map(function(item) { return item.thickness; }))].sort();
        }, [priceData, filters.vendor, filters.material, filters.color]);

        const filteredResults = React.useMemo(function() {
          console.log('Computing filteredResults', { searchQuery, searchResultsLength: searchResults.length, filters });
          let results = searchQuery ? searchResults || [] : priceData || [];
          return results.filter(function(item) {
            const matchesVendor = filters.vendor === 'All Vendors' || item.vendorName === filters.vendor;
            const matchesMaterial = filters.material === 'All Materials' || item.material === filters.material;
            const matchesColor = filters.color === 'All Colors' || item.colorName === filters.color;
            const matchesThickness = filters.thickness === 'All Thicknesses' || item.thickness === filters.thickness;
            return matchesVendor && matchesMaterial && matchesColor && matchesThickness;
          });
        }, [searchQuery, searchResults, filters, priceData]);

        return React.createElement('div', { className: 'app-container min-h-screen bg-gray-100 flex flex-col' },
          React.createElement('header', { className: 'fixed top-0 left-0 right-0 bg-white shadow-md z-10 p-4 flex flex-col gap-2' },
            React.createElement('div', { className: 'flex items-center justify-between max-w-6xl mx-auto w-full' },
              React.createElement('div', { className: 'flex items-center gap-2' },
                React.createElement('img', {
                  src: 'https://cdn.prod.website-files.com/6456ce4476abb25581fbad0c/64a70d4b30e87feb388f004f_surprise-granite-profile-logo.svg',
                  alt: 'Surprise Granite Logo',
                  className: 'h-10'
                }),
                React.createElement('h1', { className: 'text-xl font-semibold text-gray-800' }, 'Granite Quote Wizard')
              ),
              React.createElement('button', {
                onClick: toggleTheme,
                className: 'p-2 rounded-full hover:bg-gray-200',
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
            React.createElement('div', { className: 'flex items-center justify-between max-w-6xl mx-auto w-full' },
              React.createElement('div', { className: 'flex items-center gap-2' },
                React.createElement('button', {
                  onClick: function() { setCurrentStep(1); },
                  className: `text-sm font-medium ${currentStep === 1 ? 'text-blue-600' : 'text-gray-500'}`,
                  disabled: currentStep === 1
                }, '1. Search'),
                React.createElement('span', { className: 'text-gray-400' }, '→'),
                React.createElement('button', {
                  onClick: function() { setCurrentStep(2); },
                  className: `text-sm font-medium ${currentStep === 2 ? 'text-blue-600' : 'text-gray-500'}`,
                  disabled: currentStep === 2 || priceData.length === 0
                }, '2. Select'),
                React.createElement('span', { className: 'text-gray-400' }, '→'),
                React.createElement('button', {
                  onClick: function() { setCurrentStep(3); },
                  className: `text-sm font-medium ${currentStep === 3 ? 'text-blue-600' : 'text-gray-500'}`,
                  disabled: currentStep === 3 || quote.length === 0
                }, '3. Review')
              ),
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
                className: 'text-sm text-gray-600 hover:underline'
              }, zipCode ? `Region: ${regionName}` : 'Set ZIP Code')
            )
          ),

          React.createElement('main', { className: 'flex-1 pt-32 pb-8 px-4 max-w-6xl mx-auto w-full' },
            currentStep === 1 && React.createElement('div', { className: 'flex flex-col gap-4' },
              React.createElement('div', { className: 'flex items-center gap-2' },
                React.createElement('div', { className: 'relative flex-1' },
                  React.createElement('input', {
                    type: 'search',
                    value: searchQuery,
                    onChange: function(e) { debouncedSetSearchQuery(e.target.value); },
                    placeholder: 'Search for colors, materials, vendors...',
                    className: 'w-full p-3 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500',
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
                  }))
                ),
                React.createElement('button', {
                  onClick: function() { setShowFilters(!showFilters); },
                  className: 'p-3 bg-gray-200 rounded-lg hover:bg-gray-300 relative',
                  'aria-label': 'Toggle filters'
                },
                  React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2', d: 'M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707v3.586a1 1 0 01-.293.707l-2 2A1 1 0 0111 21v-5.586a1 1 0 00-.293-.707L4.293 8.293A1 1 0 014 7.586V4z' })
                  ),
                  activeFiltersCount > 0 && React.createElement('span', { className: 'absolute top-1 right-1 bg-blue-600 text-white text-xs w-5 h-5 flex items-center justify-center rounded-full' }, activeFiltersCount)
                )
              ),
              showFilters && React.createElement('div', { className: 'bg-white shadow-md rounded-lg p-4 flex flex-col gap-4 md:absolute md:top-20 md:left-4 md:w-64' },
                React.createElement('div', { className: 'flex justify-between items-center' },
                  React.createElement('h3', { className: 'text-lg font-semibold text-gray-800' }, 'Filters'),
                  React.createElement('button', {
                    onClick: clearSearchAndFilters,
                    className: 'text-sm text-blue-600 hover:underline',
                    'aria-label': 'Clear filters'
                  }, 'Clear All')
                ),
                React.createElement('div', { className: 'flex flex-col gap-2' },
                  React.createElement('label', { className: 'text-sm font-medium text-gray-700' }, 'Vendor'),
                  React.createElement('select', {
                    value: filters.vendor,
                    onChange: function(e) { setFilters({ ...filters, vendor: e.target.value, material: 'All Materials', color: 'All Colors', thickness: 'All Thicknesses' }); },
                    className: 'p-2 border rounded-lg text-sm',
                    'aria-label': 'Filter by vendor'
                  },
                    vendors.map(function(vendor) { return React.createElement('option', { key: vendor, value: vendor }, vendor); })
                  )
                ),
                filters.vendor !== 'All Vendors' && React.createElement('div', { className: 'flex flex-col gap-2' },
                  React.createElement('label', { className: 'text-sm font-medium text-gray-700' }, 'Material'),
                  React.createElement('select', {
                    value: filters.material,
                    onChange: function(e) { setFilters({ ...filters, material: e.target.value, color: 'All Colors', thickness: 'All Thicknesses' }); },
                    className: 'p-2 border rounded-lg text-sm',
                    'aria-label': 'Filter by material'
                  },
                    availableMaterials.map(function(material) { 
                      return React.createElement('option', { key: material, value: material }, material);
                    })
                  )
                ),
                filters.vendor !== 'All Vendors' && React.createElement('div', { className: 'flex flex-col gap-2' },
                  React.createElement('label', { className: 'text-sm font-medium text-gray-700' }, 'Color'),
                  React.createElement('select', {
                    value: filters.color,
                    onChange: function(e) { setFilters({ ...filters, color: e.target.value, thickness: 'All Thicknesses' }); },
                    className: 'p-2 border rounded-lg text-sm',
                    'aria-label': 'Filter by color'
                  },
                    availableColors.map(function(color) { 
                      return React.createElement('option', { key: color, value: color }, color);
                    })
                  )
                ),
                filters.vendor !== 'All Vendors' && React.createElement('div', { className: 'flex flex-col gap-2' },
                  React.createElement('label', { className: 'text-sm font-medium text-gray-700' }, 'Thickness'),
                  React.createElement('select', {
                    value: filters.thickness,
                    onChange: function(e) { setFilters({ ...filters, thickness: e.target.value }); },
                    className: 'p-2 border rounded-lg text-sm',
                    'aria-label': 'Filter by thickness'
                  },
                    availableThicknesses.map(function(thickness) { 
                      return React.createElement('option', { key: thickness, value: thickness }, thickness);
                    })
                  )
                )
              ),
              suggestions.length > 0 && React.createElement('div', { className: 'bg-white shadow-md rounded-lg p-2 absolute top-20 left-4 right-4 z-20' },
                suggestions.map((suggestion, index) => 
                  React.createElement('div', {
                    key: index,
                    className: 'p-2 hover:bg-gray-100 cursor-pointer text-sm',
                    onClick: function() { handleSuggestionClick(suggestion); }
                  }, suggestion)
                )
              ),
              filteredResults.length > 0 && React.createElement('p', { className: 'text-sm text-gray-600 text-center' }, `Found ${filteredResults.length} result${filteredResults.length === 1 ? '' : 's'}`),
              isLoading ? 
                React.createElement('p', { className: 'text-center text-gray-600' }, 'Loading countertops...') :
                isSearchLoading ?
                  React.createElement('p', { className: 'text-center text-gray-600' }, 'Searching...') :
                !filteredResults ?
                  React.createElement('p', { className: 'text-center text-gray-600' }, 'Loading results...') :
                filteredResults.length === 0 ?
                  React.createElement('p', { className: 'text-center text-gray-600' }, searchQuery || filters.vendor !== 'All Vendors' ? 'No countertops found' : 'Please enter a search query or apply filters') :
                  React.createElement('div', { className: 'flex flex-col gap-4 items-center' },
                    filteredResults.map(function(item, index) {
                      return React.createElement(CountertopCard, {
                        key: item.id,
                        item: item,
                        addToQuote: addToQuote,
                        quote: quote,
                        updateTempSqFt: updateTempSqFt,
                        tempSqFtInputs: tempSqFtInputs,
                        setTempSqFtInputs: setTempSqFtInputs,
                        index: index,
                        highlightText: searchQuery
                      });
                    })
                  ),
              filteredResults.length > 0 && React.createElement('button', {
                onClick: function() { setCurrentStep(2); },
                className: 'mt-4 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium',
                disabled: quote.length === 0,
                'aria-label': 'Proceed to selection'
              }, 'Next: Select Countertops')
            ),

            currentStep === 2 && React.createElement('div', { className: 'flex flex-col gap-4' },
              React.createElement('h2', { className: 'text-2xl font-semibold text-gray-800 text-center' }, 'Select Your Countertops'),
              quote.length === 0 ?
                React.createElement('p', { className: 'text-center text-gray-600' }, 'No countertops selected. Go back to search.') :
                React.createElement('div', { className: 'flex flex-col gap-4 items-center' },
                  quote.map(function(item) {
                    const price = typeof item.installedPricePerSqFt === 'number' && !isNaN(item.installedPricePerSqFt) ? item.installedPricePerSqFt : 0;
                    return React.createElement('div', { 
                      key: item.id,
                      className: 'bg-white shadow-md rounded-lg p-4 flex items-center justify-between max-w-sm w-full'
                    },
                      React.createElement('div', { className: 'flex items-center gap-2' },
                        React.createElement('div', {
                          className: 'w-8 h-8 rounded-full border border-gray-300',
                          style: { backgroundColor: getColorSwatch(item.colorName) }
                        }),
                        React.createElement('div', { className: 'flex flex-col' },
                          React.createElement('h3', { className: 'text-lg font-semibold text-gray-800' }, item.colorName),
                          React.createElement('p', { className: 'text-sm text-gray-600' }, `Area: ${item.sqFt} sq ft`),
                          React.createElement('p', { className: 'text-sm text-gray-600' }, `Cost: $${item.sqFt && price ? (item.sqFt * getWasteFactor(item.sqFt) * price).toFixed(2) : 'N/A'}`)
                        )
                      ),
                      React.createElement('button', {
                        onClick: function() { removeFromQuote(item.id); },
                        className: 'p-2 bg-red-500 text-white rounded-lg hover:bg-red-600',
                        'aria-label': `Remove ${item.colorName} from quote`
                      },
                        React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor' },
                          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: '2', d: 'M6 18L18 6M6 6l12 12' })
                        )
                      )
                    );
                  })
                ),
              React.createElement('div', { className: 'flex gap-4 mt-4' },
                React.createElement('button', {
                  onClick: function() { setCurrentStep(1); },
                  className: 'px-6 py-3 bg-gray-300 text-gray-800 rounded-lg hover:bg-gray-400 font-medium',
                  'aria-label': 'Go back to search'
                }, 'Back'),
                React.createElement('button', {
                  onClick: function() { setCurrentStep(3); },
                  className: 'px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium',
                  disabled: quote.length === 0,
                  'aria-label': 'Proceed to review'
                }, 'Next: Review & Submit')
              )
            ),

            currentStep === 3 && React.createElement('div', { className: 'flex flex-col gap-4' },
              React.createElement('h2', { className: 'text-2xl font-semibold text-gray-800 text-center' }, 'Review & Submit Your Quote'),
              React.createElement('div', { className: 'bg-white shadow-md rounded-lg p-4 max-w-sm w-full' },
                React.createElement('h3', { className: 'text-lg font-semibold text-gray-800 mb-2' }, 'Quote Summary'),
                React.createElement('p', { className: 'text-sm text-gray-600' }, `Total Items: ${quote.length}`),
                React.createElement('p', { className: 'text-sm text-gray-600' }, `Total Cost: $${totalCartCost}`),
                React.createElement('p', { className: 'text-sm text-gray-600' }, `Region: ${regionName}`)
              ),
              React.createElement('form', { onSubmit: handleQuoteSubmit, className: 'flex flex-col gap-4 max-w-sm w-full' },
                React.createElement('div', { className: 'flex flex-col gap-2' },
                  React.createElement('label', { className: 'text-sm font-medium text-gray-700' }, 'Name *'),
                  React.createElement('input', {
                    type: 'text',
                    name: 'name',
                    className: `p-3 border rounded-lg text-sm ${formErrors.name ? 'border-red-500' : ''}`,
                    required: true,
                    onChange: function(e) { setFormErrors({ ...formErrors, name: '' }); },
                    'aria-label': 'Enter your name'
                  }),
                  formErrors.name && React.createElement('p', { className: 'text-red-500 text-xs' }, formErrors.name)
                ),
                React.createElement('div', { className: 'flex flex-col gap-2' },
                  React.createElement('label', { className: 'text-sm font-medium text-gray-700' }, 'Email *'),
                  React.createElement('input', {
                    type: 'email',
                    name: 'email',
                    className: `p-3 border rounded-lg text-sm ${formErrors.email ? 'border-red-500' : ''}`,
                    required: true,
                    onChange: function(e) { setFormErrors({ ...formErrors, email: '' }); },
                    'aria-label': 'Enter your email'
                  }),
                  formErrors.email && React.createElement('p', { className: 'text-red-500 text-xs' }, formErrors.email)
                ),
                React.createElement('div', { className: 'flex flex-col gap-2' },
                  React.createElement('label', { className: 'text-sm font-medium text-gray-700' }, 'Phone (Optional)'),
                  React.createElement('input', {
                    type: 'tel',
                    name: 'phone',
                    className: 'p-3 border rounded-lg text-sm',
                    'aria-label': 'Enter your phone number'
                  })
                ),
                React.createElement('div', { className: 'flex flex-col gap-2' },
                  React.createElement('label', { className: 'text-sm font-medium text-gray-700' }, 'Notes'),
                  React.createElement('textarea', {
                    name: 'notes',
                    className: 'p-3 border rounded-lg text-sm',
                    rows: '4',
                    'aria-label': 'Enter additional notes'
                  })
                ),
                React.createElement('div', { className: 'flex gap-4' },
                  React.createElement('button', {
                    type: 'button',
                    onClick: function() { setCurrentStep(2); },
                    className: 'flex-1 px-6 py-3 bg-gray-300 text-gray-800 rounded-lg hover:bg-gray-400 font-medium',
                    'aria-label': 'Go back to selection'
                  }, 'Back'),
                  React.createElement('button', {
                    type: 'submit',
                    disabled: isLoading,
                    className: 'flex-1 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium',
                    'aria-label': 'Submit quote'
                  }, isLoading ? 'Submitting...' : 'Submit Quote')
                )
              )
            )
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
        errorElement.textContent = `App error: ${err.message}. Please refresh.`;
        errorElement.classList.remove('hidden');
      }
    }
  }

  waitForReact(initApp);
}
