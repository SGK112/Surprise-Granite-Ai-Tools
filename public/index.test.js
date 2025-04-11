// index.test.js
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

// Load HTML
const html = fs.readFileSync(path.resolve(__dirname, './index.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously' });
global.document = dom.window.document;
global.window = dom.window;
global.fetch = jest.fn();

// Mock localStorage
const localStorageMock = (() => {
    let store = {};
    return {
        getItem: key => store[key] || null,
        setItem: (key, value) => (store[key] = value.toString()),
        clear: () => (store = {}),
    };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Load JavaScript
const script = fs.readFileSync(path.resolve(__dirname, './index.js'), 'utf8');
dom.window.eval(script);

describe('Surprise Granite Estimator', () => {
    beforeEach(() => {
        fetch.mockClear();
        localStorage.clear();
        document.getElementById('estimator-form').reset();
        document.getElementById('estimator-results').innerHTML = '';
        document.getElementById('calc-results').innerHTML = '';
    });

    test('nav toggle opens and closes navbar', () => {
        const navToggle = document.getElementById('nav-toggle');
        const navbar = document.getElementById('navbar');
        navToggle.click();
        expect(navbar.classList.contains('open')).toBe(true);
        document.getElementById('close-nav').click();
        expect(navbar.classList.contains('open')).toBe(false);
    });

    test('tool switching', () => {
        document.querySelector('.nav-item[data-tool="calculator"]').click();
        expect(document.getElementById('calculator-tool').classList.contains('active')).toBe(true);
        expect(document.getElementById('estimator-tool').classList.contains('active')).toBe(false);
        document.querySelector('.nav-item[data-tool="estimator"]').click();
        expect(document.getElementById('estimator-tool').classList.contains('active')).toBe(true);
    });

    test('theme toggle', () => {
        document.getElementById('theme-toggle-nav').click();
        expect(document.body.classList.contains('light-mode')).toBe(true);
        expect(localStorage.getItem('theme')).toBe('light');
        document.getElementById('theme-toggle-nav').click();
        expect(document.body.classList.contains('light-mode')).toBe(false);
    });

    test('version toggle shows profit in Pro mode', async () => {
        fetch.mockResolvedValueOnce({
            json: () => Promise.resolve([
                { Code: 'CT-002', Price: 60, 'U/M': 'SF', Description: 'Granite' },
                { Code: 'CT-011', Price: 30, 'U/M': 'LF', Description: 'Ogee/Chiseled' },
            ]),
        });
        document.getElementById('slab-cost-per-sqft').value = 60;
        document.getElementById('client-sqft').value = 10;
        document.getElementById('slab-total-sqft').value = 10;
        document.getElementById('version-toggle').checked = true;
        document.getElementById('slab-cost-per-sqft').dispatchEvent(new Event('input'));
        await new Promise(resolve => setTimeout(resolve, 350)); // Wait for debounce
        expect(document.getElementById('estimator-results').innerHTML).toContain('Profit (42.61%)');
    });

    test('section toggle', () => {
        const header = document.querySelector('.section-header[data-section="project-info"]');
        const content = document.getElementById('project-info');
        header.click();
        expect(content.classList.contains('active')).toBe(false);
        header.click();
        expect(content.classList.contains('active')).toBe(true);
    });

    test('form validation', () => {
        document.getElementById('slab-cost-per-sqft').value = '';
        document.getElementById('slab-cost-per-sqft').dispatchEvent(new Event('input'));
        expect(document.getElementById('slab-cost-per-sqft-error').classList.contains('active')).toBe(true);
        document.getElementById('slab-cost-per-sqft').value = '60';
        document.getElementById('slab-cost-per-sqft').dispatchEvent(new Event('input'));
        expect(document.getElementById('slab-cost-per-sqft-error').classList.contains('active')).toBe(false);
    });

    test('clear form', () => {
        document.getElementById('client-name').value = 'John Doe';
        document.getElementById('clear-form').click();
        expect(document.getElementById('client-name').value).toBe('');
    });

    test('save and load quote', () => {
        document.getElementById('client-name').value = 'John Doe';
        document.getElementById('save-quote').click();
        expect(localStorage.getItem('savedQuote')).toContain('John Doe');
        document.getElementById('client-name').value = '';
        document.getElementById('load-quote').click();
        expect(document.getElementById('client-name').value).toBe('John Doe');
    });

    test('email quote', async () => {
        fetch.mockResolvedValueOnce({ id: '123' });
        document.getElementById('client-email').value = 'test@example.com';
        document.getElementById('email-quote').click();
        expect(fetch).toHaveBeenCalled();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(document.getElementById('estimator-results').innerHTML).toContain('Quote emailed successfully');
    });

    test('download PDF', () => {
        const mockSave = jest.fn();
        window.jspdf.jsPDF = jest.fn(() => ({
            setFontSize: jest.fn(),
            text: jest.fn(),
            splitTextToSize: jest.fn(() => ['Mock text']),
            save: mockSave,
        }));
        document.getElementById('download-pdf').click();
        expect(mockSave).toHaveBeenCalledWith('quote.pdf');
    });

    test('like quote', async () => {
        fetch.mockResolvedValueOnce({});
        document.getElementById('like-quote').click();
        expect(localStorage.getItem('likes')).toBe('1');
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(document.getElementById('estimator-results').innerHTML).toContain('Total likes: 1');
    });

    test('share quote', () => {
        Object.defineProperty(window, 'location', {
            value: { href: '' },
            writable: true,
        });
        document.getElementById('share-quote').click();
        expect(window.location.href).toContain('mailto:');
    });

    test('AI analysis', async () => {
        fetch.mockResolvedValueOnce({ recommendation: 'Test analysis' });
        document.getElementById('analyze-ai').click();
        await new Promise(resolve => setTimeout(resolve, 100));
        expect(document.getElementById('ai-results').innerHTML).toContain('Test analysis');
    });

    test('calculate area', () => {
        document.getElementById('calc-length').value = '120';
        document.getElementById('calc-width').value = '30';
        document.getElementById('calc-area').click();
        expect(document.getElementById('calc-results').innerHTML).toContain('25.00 sq ft');
    });
});
