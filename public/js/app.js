// Prevent duplicate declarations
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
    if (retries === undefined) retries = 30;
    if (interval === undefined) interval = 500;
    console.log('waitForReact called, retries:', retries);
    if (window.React && window.ReactDOM) {
      console.log('React and ReactDOM found, calling callback');
      callback();
    } else if (retries > 0) {
      setTimeout(function() { waitForReact(callback, retries - 1, interval); }, interval);
    } else {
      console.error('Failed to load React/ReactDOM');
      const errorElement = document.getElementById('error');
      if (errorElement) {
        errorElement.textContent = 'Failed to load app dependencies. Please refresh.';
        errorElement.classList.remove('hidden');
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

      const CountertopCard = React.memo(function({ item, isInCart, addToQuote, removeFromQuote, updateSqFt, clearSqFt, index }) {
        const price = typeof item.installedPricePerSqFt === 'number' && !isNaN(item.installedPricePerSqFt) ? item.installedPricePerSqFt : 0;
        return React.createElement('div', { className: 'card' },
          React.createElement('img', {
            src: item.imageUrl || imageComingSoon,
            alt: item.colorName,
            className: 'w-full h-32 object-contain rounded-lg mb-4 max-w-full',
            loading: 'lazy'
          }),
          React.createElement('h3', {
            className: 'font-semibold flex items-center text-base sm:text-lg',
            style: { color: 'var(--text-primary)' }
          },
            React.createElement('span', {
              className: 'color-swatch mr-2',
              style: { borderColor: 'var(--border-color)', backgroundColor: getColorSwatch(item.colorName) }
            }),
            item.colorName
          ),
          React.createElement('p', { className: 'text-sm sm:text-base', style: { color: 'var(--text-secondary)' } },
            'Material: ',
            React.createElement('span', {
              className: `material-badge ${getMaterialBadgeColor(item.material)}`
            }, item.material)
          ),
          React.createElement('p', { className: 'text-sm sm:text-base', style: { color: 'var(--text-secondary)' } },
            'Vendor: ', item.vendorName
          ),
          React.createElement('p', { className: 'text-sm sm:text-base', style: { color: 'var(--text-secondary)' } },
            'Thickness: ', item.thickness || 'N/A'
          ),
          React.createElement('div', { className: 'tooltip' },
            React.createElement('p', { className: 'text-sm sm:text-base', style: { color: 'var(--text-secondary)' } },
              'Price: $', price.toFixed(2), '/sq ft', price === 0 ? ' (Estimated)' : ''
            ),
            React.createElement('span', { className: 'tooltip-text' },
              'Price includes material, installation, and regional adjustments. 2cm is 10% less than 3cm.'
            )
          ),
          isInCart && React.createElement('div', { className: 'mt-2 flex gap-2' },
            React.createElement('div', { className: 'flex-1' },
              React.createElement('label', {
                className: 'block text-sm sm:text-base',
                style: { color: 'var(--text-primary)' }
              }, 'Area (sq ft)'),
              React.createElement('input', {
                type: 'number',
                value: item.sqFt,
                onChange: function(e) { updateSqFt(index, e.target.value); },
                className: 'w-full p-2 border rounded-lg',
                min: '0',
                step: '0.01',
                placeholder: 'Enter sq ft',
                'aria-label': `Square footage for ${item.colorName}`
              })
            ),
            React.createElement('button', {
              onClick: function() { clearSqFt(index); },
              className: 'p-2 border rounded-lg',
              style: { color: 'var(--text-primary)', borderColor: 'var(--border-color)' },
              'aria-label': `Clear square footage for ${item.colorName}`
            }, 'Clear')
          ),
          isInCart && React.createElement('p', {
            className: 'text-sm sm:text-base mt-2',
            style: { color: 'var(--text-secondary)' }
          },
            'Cost: $', item.sqFt && price ? (item.sqFt * getWasteFactor(item.sqFt) * price).toFixed(2) : 'N/A'
          ),
          !isInCart && React.createElement('button', {
            onClick: function() { addToQuote(item); },
            disabled: isInCart,
            className: 'w-full mt-4 text-white p-2 rounded-lg',
            style: { backgroundColor: isInCart ? '#6b7280' : 'var(--accent-color)' },
            'aria-label': `Add ${item.colorName} to cart`
          }, isInCart ? 'In Cart' : 'Add to Cart'),
          isInCart && React.createElement('button', {
            onClick: function() { removeFromQuote(index); },
            className: 'w-full mt-4 text-white p-2 rounded-lg',
            style: { backgroundColor: 'var(--error-color)' },
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
        const [currentTab, setCurrentTab] = React.useState('search');
        const [isTabLoading, setIsTabLoading] = React.useState(false);
        const [zipCode, setZipCode] = React.useState(localStorage.getItem('zipCode') || '');
        const [regionMultiplier, setRegionMultiplier] = React.useState(1.0);
        const [regionName, setRegionName] = React.useState('National Average');
        const [filters, setFilters] = React.useState({ vendor: '', material: '', color: '', thickness: '' });
        const [showFilters, setShowFilters] = React.useState(false);
        const [toast, setToast] = React.useState({ message: '', show: false, isError: false });
        const [isLoading, setIsLoading] = React.useState(false);
        const [formErrors, setFormErrors] = React.useState({ name: '', email: '' });
        const [showBackToTop, setShowBackToTop] = React.useState(false);

        React.useEffect(function() {
          console.log('useEffect: Fetching price list');
          localStorage.removeItem('priceData');
          fetchPriceList();
          document.documentElement.setAttribute('data-theme', localStorage.getItem('theme') || 'light');

          function handleScroll() {
            setShowBackToTop(window.scrollY + window.innerHeight > document.documentElement.scrollHeight * 0.8);
          }

          window.addEventListener('scroll', handleScroll);
          return function() { window.removeEventListener('scroll', handleScroll); };
        }, [zipCode]);

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
            const response = await fetch('https://surprise-granite-connections-dev.onrender.com/api/materials', {
              headers: { 'Accept': 'application/json' },
              signal: AbortSignal.timeout(10000)
            });
            console.log('fetchPriceList: Response status:', response.status);
            if (!response.ok) throw new Error(`HTTP error: ${response.status}`);
            const rawData = await response.json();
            console.log('fetchPriceList: Raw data:', rawData);
            const processedData = processData(rawData);
            if (processedData.length === 0) {
              showToast('No countertop data available.', true);
              setPriceData([]);
              return;
            }
            setPriceData(processedData);
            localStorage.setItem('priceData', JSON.stringify(processedData));
            console.log('fetchPriceList: Processed data:', processedData);
          } catch (err) {
            console.error('fetchPriceList error:', err);
            showToast('Failed to load countertop data.', true);
            setPriceData([]);
          } finally {
            setIsLoading(false);
          }
        }

        function processData(rawData) {
          if (!Array.isArray(rawData)) {
            console.error('Raw data is not an array:', rawData);
            return [];
          }
          return rawData.flatMap(function(item, index) {
            if (!item || typeof item !== 'object') return [];
            return ['2cm', '3cm'].map(function(thickness) {
              const costSqFt = parseFloat(item.costSqFt);
              if (isNaN(costSqFt) || costSqFt <= 0) return null;
              return {
                id: `${item.colorName || 'Unknown'}-${item.vendorName || 'Unknown'}-${thickness}-${index}`,
                colorName: item.colorName || 'Unknown',
                vendorName: item.vendorName || 'Unknown',
                thickness: thickness,
                material: item.material || 'Unknown',
                installedPricePerSqFt: (costSqFt * 3.25 + 35) * (thickness === '2cm' ? 0.9 : 1) * (regionMultiplier || 1.0),
                availableSqFt: parseFloat(item.availableSqFt) || 0,
                imageUrl: item.imageUrl || imageComingSoon,
                popularity: Math.random(),
                isNew: Math.random() > 0.8
              };
            }).filter(function(item) { return item !== null; });
          });
        }

        const addToQuote = React.useCallback(function(item) {
          if (quote.some(function(q) { return q.id === item.id; })) {
            showToast(`${item.colorName} is already in cart`, true);
            return;
          }
          const newQuote = [...quote, { ...item, sqFt: '' }];
          setQuote(newQuote);
          localStorage.setItem('quote', JSON.stringify(newQuote));
          showToast(`${item.colorName} added to cart`);
        }, [quote]);

        const removeFromQuote = React.useCallback(function(index) {
          const newQuote = quote.filter(function(_, i) { return i !== index; });
          setQuote(newQuote);
          localStorage.setItem('quote', JSON.stringify(newQuote));
          showToast('Item removed from cart');
        }, [quote]);

        const updateSqFt = React.useCallback(function(index, value) {
          const parsedValue = value === '' ? '' : parseFloat(value);
          if (parsedValue !== '' && (isNaN(parsedValue) || parsedValue <= 0)) {
            showToast('Please enter a valid square footage', true);
            return;
          }
          const newQuote = [...quote];
          newQuote[index].sqFt = parsedValue;
          setQuote(newQuote);
          localStorage.setItem('quote', JSON.stringify(newQuote));
        }, [quote]);

        const clearSqFt = React.useCallback(function(index) {
          const newQuote = [...quote];
          newQuote[index].sqFt = '';
          setQuote(newQuote);
          localStorage.setItem('quote', JSON.stringify(newQuote));
          showToast('Square footage cleared');
        }, [quote]);

        function handleZipSubmit() {
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
          localStorage.removeItem('priceData');
          fetchPriceList();
          showToast(`Region set to ${region.name}`);
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
          return [...new Set(priceData.map(function(item) { return item.vendorName; }))].sort();
        }, [priceData]);

        const availableMaterials = React.useMemo(function() {
          if (!filters.vendor) return [...new Set(priceData.map(function(item) { return item.material; }))].sort();
          return [...new Set(priceData
            .filter(function(item) { return item.vendorName === filters.vendor; })
            .map(function(item) { return item.material; }))].sort();
        }, [priceData, filters.vendor]);

        const availableColors = React.useMemo(function() {
          if (!filters.vendor || !filters.material) return [...new Set(priceData.map(function(item) { return item.colorName; }))].sort();
          return [...new Set(priceData
            .filter(function(item) { return item.vendorName === filters.vendor && item.material === filters.material; })
            .map(function(item) { return item.colorName; }))].sort();
        }, [priceData, filters.vendor, filters.material]);

        const availableThicknesses = React.useMemo(function() {
          if (!filters.vendor || !filters.material || !filters.color) return ['2cm', '3cm'];
          return [...new Set(priceData
            .filter(function(item) { return item.vendorName === filters.vendor && item.material === filters.material && item.colorName === filters.color; })
            .map(function(item) { return item.thickness; }))].sort();
        }, [priceData, filters.vendor, filters.material, filters.color]);

        const filteredResults = React.useMemo(function() {
          return priceData.filter(function(item) {
            const matchesSearch = !searchQuery || item.colorName.toLowerCase().includes(searchQuery.toLowerCase()) || 
                                item.material.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesVendor = !filters.vendor || item.vendorName === filters.vendor;
            const matchesMaterial = !filters.material || item.material === filters.material;
            const matchesColor = !filters.color || item.colorName === filters.color;
            const matchesThickness = !filters.thickness || item.thickness === filters.thickness;
            return matchesSearch && matchesVendor && matchesMaterial && matchesColor && matchesThickness;
          }).slice(0, 50);
        }, [priceData, searchQuery, filters]);

        function scrollToTop() {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }

        return React.createElement('div', { className: 'container relative' },
          React.createElement('button', {
            onClick: toggleTheme,
            className: 'theme-toggle',
            'aria-label': 'Switch theme'
          },
            (localStorage.getItem('theme') || 'light') === 'light' ?
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
              onClick: function() { handleTabChange('search'); },
              className: `px-4 py-2 font-medium relative ${currentTab === 'search' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-600'}`,
              style: { color: currentTab === 'search' ? 'var(--accent-color)' : 'var(--text-secondary)' }
            }, 'Search'),
            React.createElement('button', {
              onClick: function() { handleTabChange('cart'); },
              className: `px-4 py-2 font-medium relative ${currentTab === 'cart' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-600'}`,
              style: { color: currentTab === 'cart' ? 'var(--accent-color)' : 'var(--text-secondary)' }
            },
              'Cart',
              quote.length > 0 && React.createElement('span', { className: 'cart-badge' }, quote.length)
            ),
            React.createElement('button', {
              onClick: function() { handleTabChange('quote'); },
              className: `px-4 py-2 font-medium relative ${currentTab === 'quote' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-gray-600'}`,
              style: { color: currentTab === 'quote' ? 'var(--accent-color)' : 'var(--text-secondary)' }
            }, 'Quote')
          ),

          React.createElement('header', { className: 'text-center mb-6 relative' },
            React.createElement('img', {
              src: 'https://cdn.prod.website-files.com/6456ce4476abb25581fbad0c/64a70d4b30e87feb388f004f_surprise-granite-profile-logo.svg',
              alt: 'Surprise Granite Logo',
              className: 'h-12 mx-auto mb-4 max-w-full'
            }),
            React.createElement('h1', { className: 'font-bold', style: { color: 'var(--accent-color)' } }, 'Countertop Quote'),
            React.createElement('p', { className: 'mt-2', style: { color: 'var(--text-secondary)' } }, 'Compare and get quotes for your perfect countertops')
          ),

          React.createElement('div', { className: 'mb-6 flex flex-col sm:flex-row gap-2' },
            React.createElement('input', {
              type: 'text',
              value: zipCode,
              onChange: function(e) { setZipCode(e.target.value.replace(/\D/g, '')); },
              placeholder: 'ZIP Code',
              className: 'flex-1 p-2 border rounded-lg',
              maxLength: '5',
              pattern: '[0-9]{5}',
              'aria-label': 'Enter ZIP Code'
            }),
            React.createElement('button', {
              onClick: handleZipSubmit,
              disabled: isLoading,
              className: 'bg-blue-600 text-white px-4 py-2 rounded-lg sm:w-auto w-full',
              style: { backgroundColor: 'var(--accent-color)' }
            }, isLoading ? 'Updating...' : 'Update')
          ),

          React.createElement('div', {
            className: `fade-transition ${currentTab === 'search' ? '' : 'hidden'}`,
            style: { opacity: isTabLoading ? 0.5 : 1 }
          },
            currentTab === 'search' && React.createElement('div', { className: 'animate-slide-up' },
              React.createElement('div', { className: 'relative mb-4' },
                React.createElement('input', {
                  type: 'search',
                  value: searchQuery,
                  onChange: function(e) { debouncedSetSearchQuery(e.target.value); },
                  placeholder: 'Search colors, materials...',
                  className: 'w-full p-2 pl-10 border rounded-lg',
                  'aria-label': 'Search countertops'
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
                onClick: function() { setShowFilters(!showFilters); },
                className: 'w-full p-2 rounded-lg text-left mb-4 sm:hidden',
                style: { backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }
              }, showFilters ? 'Hide Filters' : 'Show Filters'),

              React.createElement('div', { className: `filter-panel ${showFilters ? 'active' : ''} sm:block grid grid-cols-1 sm:grid-cols-4 gap-4 mb-4` },
                React.createElement('div', null,
                  React.createElement('label', { className: 'block text-sm font-medium', style: { color: 'var(--text-primary)' } }, 'Vendor'),
                  React.createElement('select', {
                    value: filters.vendor,
                    onChange: function(e) { setFilters({ ...filters, vendor: e.target.value, material: '', color: '', thickness: '' }); },
                    className: 'w-full p-2 border rounded-lg',
                    'aria-label': 'Filter by vendor'
                  },
                    React.createElement('option', { value: '' }, 'All Vendors'),
                    vendors.map(function(vendor) { return React.createElement('option', { key: vendor, value: vendor }, vendor); })
                  )
                ),
                React.createElement('div', null,
                  React.createElement('label', { className: 'block text-sm font-medium', style: { color: 'var(--text-primary)' } }, 'Material'),
                  React.createElement('select', {
                    value: filters.material,
                    onChange: function(e) { setFilters({ ...filters, material: e.target.value, color: '', thickness: '' }); },
                    className: 'w-full p-2 border rounded-lg',
                    'aria-label': 'Filter by material'
                  },
                    React.createElement('option', { value: '' }, 'All Materials'),
                    availableMaterials.map(function(material) { 
                      return React.createElement('option', { key: material, value: material }, material);
                    })
                  )
                ),
                React.createElement('div', null,
                  React.createElement('label', { className: 'block text-sm font-medium', style: { color: 'var(--text-primary)' } }, 'Color'),
                  React.createElement('select', {
                    value: filters.color,
                    onChange: function(e) { setFilters({ ...filters, color: e.target.value, thickness: '' }); },
                    className: 'w-full p-2 border rounded-lg',
                    'aria-label': 'Filter by color'
                  },
                    React.createElement('option', { value: '' }, 'All Colors'),
                    availableColors.map(function(color) { 
                      return React.createElement('option', { key: color, value: color }, color);
                    })
                  )
                ),
                React.createElement('div', null,
                  React.createElement('label', { className: 'block text-sm font-medium', style: { color: 'var(--text-primary)' } }, 'Thickness'),
                  React.createElement('select', {
                    value: filters.thickness,
                    onChange: function(e) { setFilters({ ...filters, thickness: e.target.value }); },
                    className: 'w-full p-2 border rounded-lg',
                    'aria-label': 'Filter by thickness'
                  },
                    React.createElement('option', { value: '' }, 'All Thicknesses'),
                    availableThicknesses.map(function(thickness) { 
                      return React.createElement('option', { key: thickness, value: thickness }, thickness);
                    })
                  )
                )
              ),

              isLoading ? 
                React.createElement('p', { className: 'text-center', style: { color: 'var(--text-secondary)' } }, 'Loading countertops...') :
                priceData.length === 0 ?
                  React.createElement('p', { className: 'text-center col-span-full', style: { color: 'var(--text-secondary)' } }, 'No countertops available') :
                  React.createElement('div', { className: 'card-grid' },
                    filteredResults.map(function(item) {
                      return React.createElement(CountertopCard, {
                        key: item.id,
                        item: item,
                        isInCart: quote.some(function(q) { return q.id === item.id; }),
                        addToQuote: addToQuote
                      });
                    })
                  )
            )
          ),

          React.createElement('div', {
            className: `fade-transition ${currentTab === 'cart' ? '' : 'hidden'}`,
            style: { opacity: isTabLoading ? 0.5 : 1 }
          },
            currentTab === 'cart' && React.createElement('div', { className: 'animate-slide-up' },
              React.createElement('h2', {
                className: 'text-xl sm:text-2xl font-bold mb-4 text-center',
                style: { color: 'var(--text-primary)' }
              }, 'Your Cart'),
              quote.length === 0 ?
                React.createElement('p', {
                  className: 'text-center',
                  style: { color: 'var(--text-secondary)' }
                }, 'Your cart is empty') :
                React.createElement('div', { className: 'card-grid' },
                  quote.map(function(item, index) {
                    return React.createElement(CountertopCard, {
                      key: item.id,
                      item: item,
                      isInCart: true,
                      removeFromQuote: removeFromQuote,
                      updateSqFt: updateSqFt,
                      clearSqFt: clearSqFt,
                      index: index
                    });
                  })
                ),
              quote.length > 0 && React.createElement('button', {
                onClick: function() { handleTabChange('quote'); },
                className: 'w-full max-w-md mx-auto text-white p-3 rounded-lg mt-6 block',
                style: { backgroundColor: 'var(--accent-color)' }
              }, 'Get Quote')
            )
          ),

          React.createElement('div', {
            className: `fade-transition ${currentTab === 'quote' ? '' : 'hidden'}`,
            style: { opacity: isTabLoading ? 0.5 : 1 }
          },
            currentTab === 'quote' && React.createElement('div', { className: 'animate-slide-up' },
              React.createElement('h2', {
                className: 'text-xl sm:text-2xl font-bold mb-4 text-center',
                style: { color: 'var(--text-primary)' }
              }, 'Get Your Quote'),
              React.createElement('form', {
                onSubmit: handleQuoteSubmit,
                className: 'card p-4 max-w-md mx-auto'
              },
                React.createElement('div', { className: 'mb-4' },
                  React.createElement('label', {
                    className: 'block text-sm sm:text-base font-medium',
                    style: { color: 'var(--text-primary)' }
                  }, 'Name *'),
                  React.createElement('input', {
                    type: 'text',
                    name: 'name',
                    className: `w-full p-2 border rounded-lg ${formErrors.name ? 'input-error' : ''}`,
                    required: true,
                    onChange: function(e) { setFormErrors({ ...formErrors, name: '' }); },
                    'aria-label': 'Enter your name'
                  }),
                  formErrors.name && React.createElement('p', { className: 'error-text' }, formErrors.name)
                ),
                React.createElement('div', { className: 'mb-4' },
                  React.createElement('label', {
                    className: 'block text-sm sm:text-base font-medium',
                    style: { color: 'var(--text-primary)' }
                  }, 'Email *'),
                  React.createElement('input', {
                    type: 'email',
                    name: 'email',
                    className: `w-full p-2 border rounded-lg ${formErrors.email ? 'input-error' : ''}`,
                    required: true,
                    onChange: function(e) { setFormErrors({ ...formErrors, email: '' }); },
                    'aria-label': 'Enter your email'
                  }),
                  formErrors.email && React.createElement('p', { className: 'error-text' }, formErrors.email)
                ),
                React.createElement('div', { className: 'mb-4' },
                  React.createElement('label', {
                    className: 'block text-sm sm:text-base font-medium',
                    style: { color: 'var(--text-primary)' }
                  }, 'Phone (Optional)'),
                  React.createElement('input', {
                    type: 'tel',
                    name: 'phone',
                    className: 'w-full p-2 border rounded-lg',
                    'aria-label': 'Enter your phone number'
                  })
                ),
                React.createElement('div', { className: 'mb-4' },
                  React.createElement('label', {
                    className: 'block text-sm sm:text-base font-medium',
                    style: { color: 'var(--text-primary)' }
                  }, 'Notes'),
                  React.createElement('textarea', {
                    name: 'notes',
                    className: 'w-full p-2 border rounded-lg',
                    rows: '4',
                    'aria-label': 'Enter additional notes'
                  })
                ),
                React.createElement('button', {
                  type: 'submit',
                  disabled: isLoading,
                  className: 'w-full text-white p-3 rounded-lg',
                  style: { backgroundColor: 'var(--accent-color)' }
                }, isLoading ? 'Submitting...' : 'Submit Quote')
              )
            )
          ),

          React.createElement('div', {
            className: `toast ${toast.show ? 'show' : ''} ${toast.isError ? 'error' : ''}`,
            style: { opacity: toast.show ? 1 : 0 }
          }, toast.message),

          React.createElement('button', {
            onClick: scrollToTop,
            className: `back-to-top ${showBackToTop ? 'show' : ''}`,
            'aria-label': 'Scroll to top'
          },
            React.createElement('svg', {
              className: 'w-6 h-6',
              fill: 'none',
              viewBox: '0 0 24 24',
              stroke: 'currentColor'
            }, React.createElement('path', {
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              strokeWidth: '2',
              d: 'M5 15l7-7 7 7'
            }))
          ),

          React.createElement('nav', { className: 'bottom-nav' },
            React.createElement('button', {
              onClick: function() { handleTabChange('search'); },
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
              onClick: function() { handleTabChange('cart'); },
              className: `flex flex-col items-center min-w-[80px] relative ${currentTab === 'cart' ? 'text-blue-600' : ''}`,
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
              'Cart',
              quote.length > 0 && React.createElement('span', { className: 'cart-badge' }, quote.length)
            ),
            React.createElement('button', {
              onClick: function() { handleTabChange('quote'); },
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
