// A simple example of a class to handle your price data and table rendering
class PriceCalculator {
  constructor(tableSelector) {
    this.tableElement = document.querySelector(tableSelector);
    this.data = [];
  }

  // Load data (in a real scenario, you might fetch from a CSV/JSON endpoint)
  async loadData() {
    // Example static data:
    this.data = [
      {
        color: "Aruca White",
        vendor: "MSI",
        thickness: "2cm",
        material: "Quartz",
        size: "126x63",
        totalSqFt: 8.83,
        costSqFt: 9.33,
        priceGroup: 2,
        tier: "Low Tier"
      },
      {
        color: "Aruca White",
        vendor: "MSI",
        thickness: "3cm",
        material: "Quartz",
        size: "126x63",
        totalSqFt: 11.55,
        costSqFt: 12.30,
        priceGroup: 2,
        tier: "Low Tier"
      },
      // ... more data ...
    ];
    this.renderTable();
  }

  // Render the data into the table
  renderTable() {
    if (!this.tableElement) return;
    this.tableElement.innerHTML = ""; // clear existing

    const thead = document.createElement("thead");
    thead.innerHTML = `
      <tr>
        <th>Color Name</th>
        <th>Vendor</th>
        <th>Thickness</th>
        <th>Material</th>
        <th>Size</th>
        <th>Total/SqFt</th>
        <th>Cost/SqFt</th>
        <th>Price Group</th>
        <th>Tier</th>
      </tr>
    `;
    this.tableElement.appendChild(thead);

    const tbody = document.createElement("tbody");
    this.data.forEach(item => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${item.color}</td>
        <td>${item.vendor}</td>
        <td>${item.thickness}</td>
        <td>${item.material}</td>
        <td>${item.size}</td>
        <td>${item.totalSqFt}</td>
        <td>${item.costSqFt}</td>
        <td>${item.priceGroup}</td>
        <td>${item.tier}</td>
      `;
      tbody.appendChild(row);
    });
    this.tableElement.appendChild(tbody);
  }

  // Example method to filter data
  filterData(criteria) {
    // Re-load the original data each time to reset (or store a backup if you prefer)
    this.loadData();
    // We'll do a quick fix to wait for load to finish:
    setTimeout(() => {
      if (criteria.tier) {
        this.data = this.data.filter(d => d.tier === criteria.tier);
      }
      // You could add more filters here (e.g., vendor)
      this.renderTable();
    }, 100);
  }
}

// Initialize the calculator on page load
document.addEventListener("DOMContentLoaded", () => {
  window.calc = new PriceCalculator("#priceTable");
  window.calc.loadData(); // Load and render
});
