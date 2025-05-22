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

  // Temporary mapping of color names to image URLs (for quick implementation)
  const colorImageMap = {
    'white': 'https://example.com/images/white-countertop.jpg',
    'black': 'https://example.com/images/black-countertop.jpg',
    'blue': 'https://example.com/images/blue-countertop.jpg',
    'gray': 'https://example.com/images/gray-countertop.jpg'
    // Add more mappings as needed; replace with actual URLs when available
  };

  function getColorSwatch(colorName) {
    const name = (colorName || '').toLowerCase();
    if (name.includes('white')) return '#F5F5F5';
    if (name.includes('black')) return '#1F2937';
    if (name.includes('blue')) return '#3B82F6';
    if (name.includes('gray')) return '#6B7280';
    return '#D1D5DB';
  }

  function getMaterialBadgeColor(material) {
    const m = (material || '').toLowerCase();
    if (m.includes('granite')) return 'bg-green-600';
    if (m.includes('quartz')) return 'bg-blue-600';
    if (m.includes('quartzite')) return 'bg-purple-600';
    if (m.includes('dekton')) return 'bg-gray-600';
    if (m.includes('porcelain')) return 'bg-red-600';
    return 'bg-gray-500';
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

  function waitForReact(callback, retries, interval) {
    if (retries === undefined) retries = 50;
    if (interval === undefined) interval = 1000;
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
      if (!rootElement) {
        throw new Error('Root element not found');
      }
      if (!errorElement) {
        console.warn('Error element not found, error messages may not display');
      }
      console.log('Root element found:', rootElement);
      console.log('Attempting ReactDOM.render');

      const CountertopCard = React.memo(function({ item, isInCart, addToQuote, removeFromQuote, updateTempSqFt, tempSqFt, setTempSqFt, toggleCard, isExpanded, index, totalCartCost, highlightText }) {
        const price = typeof item.installedPricePerSqFt === 'number' && !isNaN(item.installedPricePerSqFt) ? item.installedPricePerSqFt : 0;
        const highlight = (text) => {
          if (!highlightText || !text) return text;
          const regex = new RegExp(`(${highlightText})`, 'gi');
          const parts = text.split(regex);
          return parts.map((part, i) => 
            regex.test(part) ? 
              React.createElement('span', { key: i, className: 'highlight' }, part) : 
              part
          );
        };
        return React.createElement('div', { 
          className: 'card',
          style: { 
            transition: 'all 0.3s ease',
            padding: '1rem',
            margin: '0.5rem 0',
            width: '100%',
            maxWidth: '16rem'
          }
        },
          React.createElement('img', {
            src: item.imageUrl,
            alt: item.colorName,
            className: 'w-full h-32 object-contain rounded-lg mb-2 max-w-full',
            loading: 'lazy'
          }),
          React.createElement('h3', {
            className: 'font-semibold flex items-center text-base sm:text-lg',
            style: { color: 'var(--text-primary)', padding: '0.25rem 0' }
          },
            React.createElement('span', {
              className: 'color-swatch',
              style: { borderColor: 'var(--border-color)', backgroundColor: getColorSwatch(item.colorName), marginRight: '0.5rem' }
            }),
            highlight(item.colorName)
          ),
          React.createElement('p', { className: 'text-sm sm:text-base', style: { color: 'var(--text-secondary)', padding: '0.25rem 0' } },
            'Material: ',
            React.createElement('span', {
              className: `material-badge ${getMaterialBadgeColor(item.material)}`
            }, highlight(item.material))
          ),
          React.createElement('p', { className: 'text-sm sm:text-base', style: { color: 'var(--text-secondary)', padding: '0.25rem 0' } },
            'Vendor: ', highlight(item.vendorName)
          ),
          React.createElement('p', { className: 'text-sm sm:text-base', style: { color: 'var(--text-secondary)', padding: '0.25rem 0' } },
            'Thickness: ', highlight(item.thickness || 'N/A')
          ),
          isInCart && React.createElement('div', { className: 'tooltip' },
            React.createElement('p', { className: 'text-sm sm:text-base', style: { color: 'var(--text-secondary)', padding: '0.25rem 0' } },
              'Price: $', price.toFixed(2), '/sq ft', price === 0 ? ' (Estimated)' : ''
            ),
            React.createElement('span', { className: 'tooltip-text' },
              'Price includes material, installation, and regional adjustments.'
            )
          ),
          !isInCart && React.createElement('button', {
            onClick: function() { toggleCard(index); },
            className: 'w-full mt-2 text-white p-2 rounded-lg',
            style: { backgroundColor: 'var(--accent-color)', padding: '0.75rem', marginTop: '0.5rem' },
            'aria-label': `Select ${item.colorName}`
          }, isExpanded ? 'Close' : 'Select'),
          !isInCart && isExpanded && React.createElement('div', { className: 'mt-2 flex gap-2 w-full' },
            React.createElement('div', { className: 'flex-1' },
              React.createElement('label', {
                className: 'block text-sm sm:text-base',
                style: { color: 'var(--text-primary)', padding: '0.25rem 0' }
              }, 'Area (sq ft)'),
              React.createElement('input', {
                type: 'number',
                value: tempSqFt,
                onChange: function(e) { updateTempSqFt(e.target.value); },
                className: 'w-full p-2 border rounded-lg',
                min: '0',
                step: '0.01',
                placeholder: 'Enter sq ft',
                'aria-label': `Square footage for ${item.colorName}`,
                style: { padding: '0.75rem' }
              })
            ),
            React.createElement('button', {
              onClick: function() { 
                if (tempSqFt && parseFloat(tempSqFt) > 0) {
                  addToQuote({ ...item, sqFt: tempSqFt });
                  setTempSqFt('');
                } else {
                  showToast('Please enter a valid square footage', true);
                }
              },
              className: 'p-2 border rounded-lg',
              style: { backgroundColor: 'var(--accent-color)', color: 'white', padding: '0.75rem' },
              'aria-label': `Add ${item.colorName} to cart with square footage`
            }, 'Add to Cart')
          ),
          isInCart && React.createElement('div', { className: 'mt-2 flex gap-2 w-full' },
            React.createElement('div', { className: 'flex-1' },
              React.createElement('label', {
                className: 'block text-sm sm:text-base',
                style: { color: 'var(--text-primary)', padding: '0.25rem 0' }
              }, 'Area (sq ft)'),
              React.createElement('input', {
                type: 'number',
                value: item.sqFt,
                onChange: function(e) { updateTempSqFt(e.target.value); },
                className: 'w-full p-2 border rounded-lg',
                min: '0',
                step: '0.01',
                placeholder: 'Enter sq ft',
                'aria-label': `Square footage for ${item.colorName}`,
                style: { padding: '0.75rem' }
              })
            ),
            React.createElement('button', {
              onClick: function() { clearSqFt(index); },
              className: 'p-2 border rounded-lg',
              style: { color: 'var(--text-primary)', borderColor: 'var(--border-color)', padding: '0.75rem' },
              'aria-label': `Clear square footage for ${item.colorName}`
            }, 'Clear')
          ),
          isInCart && React.createElement('p', {
            className: 'text-sm sm:text-base mt-2',
            style: { color: 'var(--text-secondary)', padding: '0.25rem 0' }
          },
            'Cost: $', item.sqFt && price ? (item.sqFt * getWasteFactor(item.sqFt) * price).toFixed(2) : 'N/A'
          ),
          isInCart && React.createElement('button', {
            onClick: function() { removeFromQuote(index); },
            className: 'w-full mt-2 text-white p-2 rounded-lg',
            style: { backgroundColor: 'var(--error-color)', padding: '0.75rem', marginTop: '0.5rem' },
            'aria-label': `Remove ${item.colorName} from cart`
          }, 'Remove')
        );
      });

      function App() {
        const [priceData, setPriceData] = React.useState([]);
        const [quote, setQuote] = React.useState(function() {
          try {
            return JSON.parse(localStorage.getItem('quote')) || [];
          } catch (e) {
            console.error('Failed to parse quote from localStorage:', e);
            return [];
          }
        });
        const [searchQuery, setSearchQuery] = React.useState('');
        const [searchResults, setSearchResults] = React.useState([]);
        const [currentTab, setCurrentTab] = React.useState('search');
        const [isTabLoading, setIsTabLoading] = React.useState(false);
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
        const [showFilters] = React.useState(true);
        const [toast, setToast] = React.useState({ message: '', show: false, isError: false });
        const [isLoading, setIsLoading] = React.useState(false);
        const [formErrors, setFormErrors] = React.useState({ name: '', email: '' });
        const [showBackToTop, setShowBackToTop] = React.useState(false);
        const [expandedCard, setExpandedCard] = React.useState(null);
        const [tempSqFt, setTempSqFt] = React.useState('');
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
          console.log('useEffect: Setting theme');
          document.documentElement.setAttribute('data-theme', localStorage.getItem('theme') || 'light');

          function handleScroll() {
            const viewportHeight = window.innerHeight;
            setShowBackToTop(window.scrollY > viewportHeight);
          }

          window.addEventListener('scroll', handleScroll);
          return function() { window.removeEventListener('scroll', handleScroll); };
        }, []);

        // Silently fetch user's location and set region
        React.useEffect(() => {
          if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              (position) => {
                console.log('Location permission granted:', position);
                // Simulate ZIP code lookup based on coordinates (mock for now)
                const mockZip = '85001'; // Example: Phoenix, AZ
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
                // Fallback to National Average
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

        async function fetchPriceList() {
          setIsLoading(true);
          console.log('fetchPriceList: Starting fetch');
          try {
            const csvUrl = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRWyYuTQxC8_fKNBg9_aJiB7NMFztw6mgdhN35lo8sRL45MvncRg4D217lopZxuw39j5aJTN6TP4Elh/pub?output=csv';
            const response = await fetch(csvUrl);
            if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
            const csvText = await response.text();
            console.log('fetchPriceList: Raw CSV data:', csvText.substring(0, 500));

            Papa.parse(csvText, {
              header: true,
              skipEmptyLines: true,
              complete: function(results) {
                const rawData = results.data;
                console.log('fetchPriceList: Parsed CSV data:', rawData);
                const processedData = processData(rawData);
                console.log('fetchPriceList: Processed data:', processedData);
                if (processedData.length === 0) {
                  showToast('No valid countertop data available.', true);
                  setPriceData([]);
                  return;
                }
                setPriceData(processedData);
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
            showToast('Failed to load countertop data.', true);
            setPriceData([]);
            setIsLoading(false);
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
            const thickness = item['Thickness'] || 'Unknown';
            const colorNameLower = (item['Color Name'] || '').toLowerCase();
            // Temporary image mapping: use colorImageMap, fallback to imageComingSoon
            const imageUrl = Object.keys(colorImageMap).reduce((url, color) => {
              if (colorNameLower.includes(color)) return colorImageMap[color];
              return url;
            }, imageComingSoon);
            return {
              id: `${item['Color Name'] || 'Unknown'}-${item['Vendor Name'] || 'Unknown'}-${thickness}-${index}`,
              colorName: item['Color Name'] || 'Unknown',
              vendorName: item['Vendor Name'] || 'Unknown',
              thickness: thickness,
              material: item['Material'] || 'Unknown',
              installedPricePerSqFt: (costSqFt * 3.25 + 35) * (regionMultiplier || 1.0),
              availableSqFt: parseFloat(item['Total/SqFt']) || 0,
              imageUrl: imageUrl,
              popularity: Math.random(),
              isNew: Math.random() > 0.8
            };
          }).filter(item => item !== null);
        }

        React.useEffect(() => {
          if (searchQuery && priceData.length > 0) {
            setIsSearchLoading(true);
            const fuse = new Fuse(priceData, {
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
            const results = fuse.search(searchQuery).map(result => result.item);
            setSearchResults(results);
            setSuggestions(results.slice(0, 5).map(item => `${item.colorName} (${item.material}, ${item.vendorName})`));
            setTimeout(() => setIsSearchLoading(false), 100);
          } else {
            setSearchResults([]);
            setSuggestions([]);
            setIsSearchLoading(false);
          }
        }, [searchQuery, priceData]);

        const addToQuote = React.useCallback(function(item) {
          if (quote.some(function(q) { return q.id === item.id; })) {
            showToast(`${item.colorName} is already in cart`, true);
            return;
          }
          const newQuote = [...quote, { ...item }];
          setQuote(newQuote);
          setExpandedCard(null);
          setTempSqFt('');
          localStorage.setItem('quote', JSON.stringify(newQuote));
          showToast(`${item.colorName} added to cart`);
          handleTabChange('cart');
        }, [quote]);

        const removeFromQuote = React.useCallback(function(index) {
          const newQuote = quote.filter(function(_, i) { return i !== index; });
          setQuote(newQuote);
          if (expandedCard === index) {
            setExpandedCard(null);
            setTempSqFt('');
          }
          localStorage.setItem('quote', JSON.stringify(newQuote));
          showToast('Item removed from cart');
        }, [quote, expandedCard]);

        const updateTempSqFt = React.useCallback(function(value) {
          setTempSqFt(value);
        }, []);

        const clearSqFt = React.useCallback(function(index) {
          const newQuote = [...quote];
          newQuote[index].sqFt = '';
          setQuote(newQuote);
          localStorage.setItem('quote', JSON.stringify(newQuote));
          showToast('Square footage cleared');
        }, [quote]);

        const toggleCard = React.useCallback(function(index) {
          if (expandedCard === index) {
            setExpandedCard(null);
            setTempSqFt('');
          } else {
            setExpandedCard(index);
            setTempSqFt('');
          }
        }, [expandedCard]);

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
          const name = e.target.name.value;
          const email = e.target.email.value;
          const phone = e.target.phone.value;
          const notes = e.target.notes.value;

          if (!validateForm(name, email)) {
            setIsLoading(false);
            showToast('Please fix form errors', true);
            return;
          }

          if (quote.length === 0) {
            setIsLoading(false);
            showToast('Please add items to your cart', true);
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
            localStorage.setItem('quote', JSON.stringify([]));
            setCurrentTab('search');
            setFormErrors({ name: '', email: '' });
          } catch (err) {
            console.error('Quote submission error:', err);
            showToast('Failed to submit quote. Check spam folder or try again.', true);
          } finally {
            setIsLoading(false);
          }
        }

        const debouncedSetSearchQuery = React.useCallback(debounce(setSearchQuery, 300), []);

        function handleTabChange(tab) {
          setIsTabLoading(true);
          setTimeout(function() {
            setCurrentTab(tab);
            setIsTabLoading(false);
          }, 300);
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

        function scrollToTop() {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        return React.createElement('div', { className: 'app-container', style: { paddingBottom: '5rem', paddingTop: '0' } },
          React.createElement('div', {
            style: {
              position: 'relative',
              padding: '0.5rem 0',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              background: 'var(--bg-primary)',
              zIndex: 100
            }
          },
            React.createElement('header', { style: { width: '100%', maxWidth: '90rem', textAlign: 'center', margin: '0.5rem 0' } },
              React.createElement('img', {
                src: 'https://cdn.prod.website-files.com/6456ce4476abb25581fbad0c/64a70d4b30e87feb388f004f_surprise-granite-profile-logo.svg',
                alt: 'Surprise Granite Logo',
                style: { height: '2.5rem', margin: '0 auto' }
              }),
              React.createElement('h1', { style: { fontSize: '1.25rem', color: 'var(--accent-color)', margin: '0.5rem 0' } }, 'Surprise Granite Quote'),
              React.createElement('p', { style: { fontSize: '0.875rem', color: 'var(--text-secondary)', margin: '0.25rem 0' } }, 'Compare and get quotes for your perfect countertops'),
              React.createElement('div', { style: { display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', marginTop: '0.5rem' } },
                React.createElement('button', {
                  onClick: toggleTheme,
                  className: 'theme-toggle',
                  'aria-label': 'Switch theme',
                  style: { padding: '0.5rem', width: '2rem', height: '2rem' }
                },
                  (localStorage.getItem('theme') || 'light') === 'light' ?
                    React.createElement('svg', {
                      fill: 'none',
                      viewBox: '0 0 24 24',
                      stroke: 'currentColor',
                      style: { width: '1.25rem', height: '1.25rem' }
                    }, React.createElement('path', {
                      strokeLinecap: 'round',
                      strokeLinejoin: 'round',
                      strokeWidth: '2',
                      d: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z'
                    })) :
                    React.createElement('svg', {
                      fill: 'none',
                      viewBox: '0 0 24 24',
                      stroke: 'currentColor',
                      style: { width: '1.25rem', height: '1.25rem' }
                    }, React.createElement('path', {
                      strokeLinecap: 'round',
                      strokeLinejoin: 'round',
                      strokeWidth: '2',
                      d: 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z'
                    }))
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
                  style: { 
                    padding: '0.5rem', 
                    fontSize: '0.875rem', 
                    color: 'var(--text-secondary)', 
                    background: 'transparent', 
                    border: 'none',
                    textDecoration: 'underline'
                  }
                }, zipCode ? `Region: ${regionName}` : 'Set ZIP Code')
              )
            )
          ),

          React.createElement('div', { 
            className: 'container', 
            style: { 
              padding: '1rem', 
              display: 'flex', 
              flexDirection: 'column', 
              alignItems: 'center', 
              width: '100%' 
            } 
          },
            React.createElement('nav', { 
              className: 'top-nav', 
              style: { 
                width: '100%', 
                maxWidth: '30rem', 
                margin: '0.5rem auto', 
                padding: '0.5rem 0', 
                display: 'flex', 
                justifyContent: 'center', 
                gap: '1rem' 
              }
            },
              React.createElement('button', {
                onClick: function() { handleTabChange('search'); },
                className: `relative ${currentTab === 'search' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-600'}`,
                style: { 
                  color: currentTab === 'search' ? 'var(--accent-color)' : 'var(--text-secondary)', 
                  padding: '0.75rem 1rem', 
                  fontSize: '1rem' 
                }
              }, 'Search'),
              React.createElement('button', {
                onClick: function() { handleTabChange('cart'); },
                className: `relative ${currentTab === 'cart' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-600'}`,
                style: { 
                  color: currentTab === 'cart' ? 'var(--accent-color)' : 'var(--text-secondary)', 
                  padding: '0.75rem 1rem', 
                  fontSize: '1rem',
                  position: 'relative'
                }
              },
                'Cart ($', totalCartCost, ')',
                quote.length > 0 && React.createElement('span', { 
                  className: 'cart-badge',
                  style: {
                    position: 'absolute',
                    top: '0',
                    right: '0',
                    background: 'var(--accent-color)',
                    color: 'white',
                    borderRadius: '9999px',
                    fontSize: '0.75rem',
                    width: '1.25rem',
                    height: '1.25rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }
                }, quote.length)
              ),
              React.createElement('button', {
                onClick: function() { handleTabChange('quote'); },
                className: `relative ${currentTab === 'quote' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-600'}`,
                style: { 
                  color: currentTab === 'quote' ? 'var(--accent-color)' : 'var(--text-secondary)', 
                  padding: '0.75rem 1rem', 
                  fontSize: '1rem' 
                }
              }, 'Quote')
            ),

            React.createElement('div', {
              className: `fade-transition ${currentTab === 'search' ? '' : 'hidden'}`,
              style: { 
                opacity: isTabLoading ? 0.5 : 1, 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                width: '100%' 
              }
            },
              currentTab === 'search' && React.createElement('div', { 
                className: 'animate-slide-up', 
                style: { 
                  width: '100%', 
                  maxWidth: '90rem', 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center' 
                } 
              },
                React.createElement('div', { 
                  className: 'search-container', 
                  style: { 
                    width: '100%', 
                    maxWidth: '40rem', 
                    padding: '0 1rem', 
                    margin: '1rem auto' 
                  }
                },
                  React.createElement('div', { className: 'search-bar', style: { position: 'relative', width: '100%' } },
                    React.createElement('input', {
                      type: 'search',
                      value: searchQuery,
                      onChange: function(e) { debouncedSetSearchQuery(e.target.value); },
                      placeholder: 'Search for colors, materials, vendors...',
                      'aria-label': 'Search countertops',
                      style: { padding: '0.75rem 2.5rem 0.75rem 3rem', fontSize: '1rem' }
                    }),
                    React.createElement('svg', {
                      fill: 'none',
                      viewBox: '0 0 24 24',
                      stroke: 'currentColor',
                      style: { position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', width: '1.5rem', height: '1.5rem' }
                    }, React.createElement('path', {
                      strokeLinecap: 'round',
                      strokeLinejoin: 'round',
                      strokeWidth: '2',
                      d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
                    }))
                  ),
                  searchQuery && React.createElement('button', {
                    onClick: clearSearchAndFilters,
                    className: 'clear-search',
                    'aria-label': 'Clear search and filters',
                    style: { padding: '0.75rem' }
                  }, 'Clear'),
                  suggestions.length > 0 && React.createElement('div', { className: 'autocomplete-suggestions', style: { width: '100%' } },
                    suggestions.map((suggestion, index) => 
                      React.createElement('div', {
                        key: index,
                        className: 'autocomplete-suggestion',
                        onClick: function() { handleSuggestionClick(suggestion); },
                        style: { padding: '0.75rem 1rem' }
                      }, suggestion)
                    )
                  )
                ),

                React.createElement('div', { 
                  className: 'filter-panel', 
                  style: { 
                    width: '100%', 
                    maxWidth: '60rem', 
                    display: 'flex', 
                    flexWrap: 'wrap', 
                    justifyContent: 'center', 
                    gap: '1rem', 
                    marginBottom: '1.5rem', 
                    position: 'relative' 
                  }
                },
                  React.createElement('div', { className: 'tooltip', style: { width: '100%', maxWidth: '12rem' } },
                    React.createElement('label', { style: { padding: '0.25rem 0' } }, 'Vendor'),
                    React.createElement('span', { className: 'tooltip-text' }, 'Select a vendor to narrow down results'),
                    React.createElement('select', {
                      value: filters.vendor,
                      onChange: function(e) { setFilters({ ...filters, vendor: e.target.value, material: 'All Materials', color: 'All Colors', thickness: 'All Thicknesses' }); },
                      'aria-label': 'Filter by vendor',
                      style: { padding: '0.75rem', fontSize: '0.875rem' }
                    },
                      vendors.map(function(vendor) { return React.createElement('option', { key: vendor, value: vendor }, vendor); })
                    )
                  ),
                  filters.vendor !== 'All Vendors' && React.createElement('div', { className: 'tooltip', style: { width: '100%', maxWidth: '12rem' } },
                    React.createElement('label', { style: { padding: '0.25rem 0' } }, 'Material'),
                    React.createElement('span', { className: 'tooltip-text' }, 'Filter by material type'),
                    React.createElement('select', {
                      value: filters.material,
                      onChange: function(e) { setFilters({ ...filters, material: e.target.value, color: 'All Colors', thickness: 'All Thicknesses' }); },
                      'aria-label': 'Filter by material',
                      style: { padding: '0.75rem', fontSize: '0.875rem' }
                    },
                      availableMaterials.map(function(material) { 
                        return React.createElement('option', { key: material, value: material }, material);
                      })
                    )
                  ),
                  filters.vendor !== 'All Vendors' && React.createElement('div', { className: 'tooltip', style: { width: '100%', maxWidth: '12rem' } },
                    React.createElement('label', { style: { padding: '0.25rem 0' } }, 'Color'),
                    React.createElement('span', { className: 'tooltip-text' }, 'Filter by color'),
                    React.createElement('select', {
                      value: filters.color,
                      onChange: function(e) { setFilters({ ...filters, color: e.target.value, thickness: 'All Thicknesses' }); },
                      'aria-label': 'Filter by color',
                      style: { padding: '0.75rem', fontSize: '0.875rem' }
                    },
                      availableColors.map(function(color) { 
                        return React.createElement('option', { key: color, value: color }, color);
                      })
                    )
                  ),
                  filters.vendor !== 'All Vendors' && React.createElement('div', { className: 'tooltip', style: { width: '100%', maxWidth: '12rem' } },
                    React.createElement('label', { style: { padding: '0.25rem 0' } }, 'Thickness'),
                    React.createElement('span', { className: 'tooltip-text' }, 'Filter by thickness'),
                    React.createElement('select', {
                      value: filters.thickness,
                      onChange: function(e) { setFilters({ ...filters, thickness: e.target.value }); },
                      'aria-label': 'Filter by thickness',
                      style: { padding: '0.75rem', fontSize: '0.875rem' }
                    },
                      availableThicknesses.map(function(thickness) { 
                        return React.createElement('option', { key: thickness, value: thickness }, thickness);
                      })
                    )
                  ),
                  activeFiltersCount > 0 && React.createElement('span', {
                    style: {
                      position: 'absolute',
                      top: '0',
                      right: '0',
                      background: 'var(--accent-color)',
                      color: 'white',
                      borderRadius: '9999px',
                      fontSize: '0.75rem',
                      width: '1.5rem',
                      height: '1.5rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }
                  }, activeFiltersCount)
                ),

                filteredResults.length > 0 && React.createElement('p', {
                  style: {
                    color: 'var(--text-secondary)',
                    padding: '0.5rem 0',
                    fontSize: '0.875rem',
                    textAlign: 'center'
                  }
                }, `Found ${filteredResults.length} result${filteredResults.length === 1 ? '' : 's'}`),

                isLoading ? 
                  React.createElement('p', { 
                    className: 'text-center', 
                    style: { 
                      color: 'var(--text-secondary)', 
                      padding: '1rem 0', 
                      fontSize: '1rem' 
                    } 
                  }, 'Loading countertops...') :
                  isSearchLoading ?
                    React.createElement('p', { 
                      className: 'text-center', 
                      style: { 
                        color: 'var(--text-secondary)', 
                        padding: '1rem 0', 
                        fontSize: '1rem' 
                      } 
                    }, 'Searching...') :
                  !filteredResults ?
                    React.createElement('p', { 
                      className: 'text-center', 
                      style: { 
                        color: 'var(--text-secondary)', 
                        padding: '1rem 0', 
                        fontSize: '1rem' 
                      } 
                    }, 'Loading results...') :
                  filteredResults.length === 0 ?
                    React.createElement('p', { 
                      className: 'text-center', 
                      style: { 
                        color: 'var(--text-secondary)', 
                        padding: '1rem 0', 
                        fontSize: '1rem' 
                      } 
                    }, searchQuery || filters.vendor !== 'All Vendors' ? 'No countertops found' : 'Please enter a search query or select a vendor') :
                    React.createElement('div', { 
                      className: 'card-grid', 
                      style: { 
                        width: '100%', 
                        maxWidth: '90rem', 
                        display: 'flex', 
                        flexDirection: 'column', 
                        alignItems: 'center', 
                        gap: '1rem' 
                      } 
                    },
                      filteredResults.map(function(item, index) {
                        return React.createElement(CountertopCard, {
                          key: item.id,
                          item: item,
                          isInCart: quote.some(function(q) { return q.id === item.id; }),
                          addToQuote: addToQuote,
                          removeFromQuote: removeFromQuote,
                          updateTempSqFt: updateTempSqFt,
                          tempSqFt: tempSqFt,
                          setTempSqFt: setTempSqFt,
                          toggleCard: toggleCard,
                          isExpanded: expandedCard === index,
                          index: index,
                          totalCartCost: totalCartCost,
                          highlightText: searchQuery
                        });
                      })
                    )
              )
            ),

            React.createElement('div', {
              className: `fade-transition ${currentTab === 'cart' ? '' : 'hidden'}`,
              style: { 
                opacity: isTabLoading ? 0.5 : 1, 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                width: '100%' 
              }
            },
              currentTab === 'cart' && React.createElement('div', { 
                className: 'animate-slide-up', 
                style: { 
                  width: '100%', 
                  maxWidth: '90rem', 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center' 
                } 
              },
                React.createElement('div', { 
                  className: 'search-container', 
                  style: { 
                    width: '100%', 
                    maxWidth: '40rem', 
                    padding: '0 1rem', 
                    margin: '1rem auto' 
                  }
                },
                  React.createElement('div', { className: 'search-bar', style: { position: 'relative', width: '100%' } },
                    React.createElement('input', {
                      type: 'search',
                      value: searchQuery,
                      onChange: function(e) { debouncedSetSearchQuery(e.target.value); },
                      placeholder: 'Search for colors, materials, vendors...',
                      'aria-label': 'Search countertops',
                      style: { padding: '0.75rem 2.5rem 0.75rem 3rem', fontSize: '1rem' }
                    }),
                    React.createElement('svg', {
                      fill: 'none',
                      viewBox: '0 0 24 24',
                      stroke: 'currentColor',
                      style: { position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', width: '1.5rem', height: '1.5rem' }
                    }, React.createElement('path', {
                      strokeLinecap: 'round',
                      strokeLinejoin: 'round',
                      strokeWidth: '2',
                      d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
                    }))
                  ),
                  searchQuery && React.createElement('button', {
                    onClick: clearSearchAndFilters,
                    className: 'clear-search',
                    'aria-label': 'Clear search and filters',
                    style: { padding: '0.75rem' }
                  }, 'Clear'),
                  suggestions.length > 0 && React.createElement('div', { className: 'autocomplete-suggestions', style: { width: '100%' } },
                    suggestions.map((suggestion, index) => 
                      React.createElement('div', {
                        key: index,
                        className: 'autocomplete-suggestion',
                        onClick: function() { handleSuggestionClick(suggestion); },
                        style: { padding: '0.75rem 1rem' }
                      }, suggestion)
                    )
                  )
                ),

                React.createElement('h2', {
                  className: 'text-xl sm:text-2xl font-bold mb-4 text-center',
                  style: { color: 'var(--text-primary)', padding: '0.5rem 0', fontSize: '1.25rem' }
                }, 'Your Cart (Total: $', totalCartCost, ')'),
                quote.length === 0 ?
                  React.createElement('p', {
                    className: 'text-center',
                    style: { color: 'var(--text-secondary)', padding: '1rem 0', fontSize: '1rem' }
                  }, 'Your cart is empty') :
                  React.createElement('div', { 
                    className: 'card-grid', 
                    style: { 
                      width: '100%', 
                      maxWidth: '90rem', 
                      display: 'flex', 
                      flexDirection: 'column', 
                      alignItems: 'center', 
                      gap: '1rem' 
                    } 
                  },
                    quote.map(function(item, index) {
                      return React.createElement(CountertopCard, {
                        key: item.id,
                        item: item,
                        isInCart: true,
                        removeFromQuote: removeFromQuote,
                        updateTempSqFt: updateTempSqFt,
                        tempSqFt: item.sqFt,
                        setTempSqFt: setTempSqFt,
                        clearSqFt: clearSqFt,
                        index: index,
                        totalCartCost: totalCartCost,
                        highlightText: searchQuery
                      });
                    })
                  ),
                quote.length > 0 && React.createElement('button', {
                  onClick: function() { handleTabChange('quote'); },
                  className: 'w-full max-w-md mx-auto text-white p-2 rounded-lg mt-6 block',
                  style: { backgroundColor: 'var(--accent-color)', padding: '0.75rem', fontSize: '1rem', margin: '1rem auto' }
                }, 'Confirm Quote')
              )
            ),

            React.createElement('div', {
              className: `fade-transition ${currentTab === 'quote' ? '' : 'hidden'}`,
              style: { 
                opacity: isTabLoading ? 0.5 : 1, 
                display: 'flex', 
                flexDirection: 'column', 
                alignItems: 'center', 
                width: '100%' 
              }
            },
              currentTab === 'quote' && React.createElement('div', { 
                className: 'animate-slide-up', 
                style: { 
                  width: '100%', 
                  maxWidth: '90rem', 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center' 
                } 
              },
                React.createElement('h2', {
                  className: 'text-xl sm:text-2xl font-bold mb-4 text-center',
                  style: { color: 'var(--text-primary)', padding: '0.5rem 0', fontSize: '1.25rem' }
                }, 'Get Your Quote (Total: $', totalCartCost, ')'),
                React.createElement('form', {
                  onSubmit: handleQuoteSubmit,
                  className: 'quote-form',
                  style: { width: '100%', maxWidth: '30rem' }
                },
                  React.createElement('div', { style: { marginBottom: '1rem' } },
                    React.createElement('label', { style: { padding: '0.25rem 0', fontSize: '0.875rem' } }, 'Name *'),
                    React.createElement('input', {
                      type: 'text',
                      name: 'name',
                      className: `w-full ${formErrors.name ? 'input-error' : ''}`,
                      required: true,
                      onChange: function(e) { setFormErrors({ ...formErrors, name: '' }); },
                      'aria-label': 'Enter your name',
                      style: { padding: '0.75rem', fontSize: '0.875rem' }
                    }),
                    formErrors.name && React.createElement('p', { className: 'error-text' }, formErrors.name)
                  ),
                  React.createElement('div', { style: { marginBottom: '1rem' } },
                    React.createElement('label', { style: { padding: '0.25rem 0', fontSize: '0.875rem' } }, 'Email *'),
                    React.createElement('input', {
                      type: 'email',
                      name: 'email',
                      className: `w-full ${formErrors.email ? 'input-error' : ''}`,
                      required: true,
                      onChange: function(e) { setFormErrors({ ...formErrors, email: '' }); },
                      'aria-label': 'Enter your email',
                      style: { padding: '0.75rem', fontSize: '0.875rem' }
                    }),
                    formErrors.email && React.createElement('p', { className: 'error-text' }, formErrors.email)
                  ),
                  React.createElement('div', { style: { marginBottom: '1rem' } },
                    React.createElement('label', { style: { padding: '0.25rem 0', fontSize: '0.875rem' } }, 'Phone (Optional)'),
                    React.createElement('input', {
                      type: 'tel',
                      name: 'phone',
                      className: 'w-full',
                      'aria-label': 'Enter your phone number',
                      style: { padding: '0.75rem', fontSize: '0.875rem' }
                    })
                  ),
                  React.createElement('div', { style: { marginBottom: '1rem' } },
                    React.createElement('label', { style: { padding: '0.25rem 0', fontSize: '0.875rem' } }, 'Notes'),
                    React.createElement('textarea', {
                      name: 'notes',
                      className: 'w-full',
                      rows: '4',
                      'aria-label': 'Enter additional notes',
                      style: { padding: '0.75rem', fontSize: '0.875rem' }
                    })
                  ),
                  React.createElement('button', {
                    type: 'submit',
                    disabled: isLoading,
                    style: { backgroundColor: 'var(--accent-color)', padding: '0.75rem', fontSize: '1rem', width: '100%' }
                  }, isLoading ? 'Submitting...' : 'Submit Quote')
                )
              )
            ),

            React.createElement('div', {
              className: `toast ${toast.show ? 'show' : ''} ${toast.isError ? 'error' : ''}`,
              style: { 
                opacity: toast.show ? 1 : 0, 
                bottom: '6rem', 
                left: '50%', 
                transform: 'translateX(-50%)', 
                padding: '0.75rem 1.5rem', 
                fontSize: '1rem', 
                maxWidth: '90%' 
              }
            }, toast.message),

            React.createElement('button', {
              onClick: scrollToTop,
              className: `back-to-top ${showBackToTop ? 'show' : ''}`,
              'aria-label': 'Scroll to top',
              style: { 
                left: '50%', 
                transform: 'translateX(-50%)', 
                right: 'auto', 
                bottom: '6rem', 
                padding: '0.75rem', 
                borderRadius: '50%', 
                background: 'var(--accent-color)', 
                color: 'white', 
                border: 'none', 
                display: showBackToTop ? 'block' : 'none' 
              }
            },
              React.createElement('svg', {
                fill: 'none',
                viewBox: '0 0 24 24',
                stroke: 'currentColor',
                style: { width: '1.5rem', height: '1.5rem' }
              }, React.createElement('path', {
                strokeLinecap: 'round',
                strokeLinejoin: 'round',
                strokeWidth: '2',
                d: 'M5 15l7-7 7 7'
              }))
            ),

            React.createElement('nav', { 
              className: 'bottom-nav', 
              style: { 
                width: '100%', 
                maxWidth: '100vw', 
                padding: '0.75rem 0', 
                display: 'flex', 
                justifyContent: 'space-around' 
              }
            },
              React.createElement('button', {
                onClick: function() { handleTabChange('search'); },
                className: `${currentTab === 'search' ? 'text-blue-600' : ''}`,
                style: { 
                  color: currentTab === 'search' ? 'var(--accent-color)' : 'var(--text-secondary)', 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center', 
                  gap: '0.25rem', 
                  fontSize: '0.875rem' 
                }
              },
                React.createElement('svg', {
                  fill: 'none',
                  viewBox: '0 0 24 24',
                  stroke: 'currentColor',
                  style: { width: '1.5rem', height: '1.5rem' }
                }, React.createElement('path', {
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                  strokeWidth: '2',
                  d: 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z'
                })),
                'Search'
              ),
              React.createElement('button', {
                onClick: function() { handleTabChange('cart'); },
                className: `relative ${currentTab === 'cart' ? 'text-blue-600' : ''}`,
                style: { 
                  color: currentTab === 'cart' ? 'var(--accent-color)' : 'var(--text-secondary)', 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center', 
                  gap: '0.25rem', 
                  fontSize: '0.875rem' 
                }
              },
                React.createElement('svg', {
                  fill: 'none',
                  viewBox: '0 0 24 24',
                  stroke: 'currentColor',
                  style: { width: '1.5rem', height: '1.5rem' }
                }, React.createElement('path', {
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                  strokeWidth: '2',
                  d: 'M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z'
                })),
                'Cart'
              ),
              React.createElement('button', {
                onClick: function() { handleTabChange('quote'); },
                className: `${currentTab === 'quote' ? 'text-blue-600' : ''}`,
                style: { 
                  color: currentTab === 'quote' ? 'var(--accent-color)' : 'var(--text-secondary)', 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center', 
                  gap: '0.25rem', 
                  fontSize: '0.875rem' 
                }
              },
                React.createElement('svg', {
                  fill: 'none',
                  viewBox: '0 0 24 24',
                  stroke: 'currentColor',
                  style: { width: '1.5rem', height: '1.5rem' }
                }, React.createElement('path', {
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                  strokeWidth: '2',
                  d: 'M3 3h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z'
                })),
                'Quote'
              )
            )
          )
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
