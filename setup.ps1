# PowerShell script to setup the Surprise Granite AI Tools project

# Create necessary directories if they don't exist
$directories = @(
    "public/js", 
    "public/css", 
    "public/images", 
    "public/fonts",
    "data",
    "models",
    "services",
    "routes"
)

foreach ($dir in $directories) {
    if (-not (Test-Path $dir)) {
        Write-Host "Creating directory: $dir"
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

# Copy the clean server file to server.js (if needed)
if (Test-Path "server.clean.js") {
    Write-Host "Copying clean server.js from server.clean.js"
    Copy-Item -Path "server.clean.js" -Destination "server.js" -Force
}

# Install Node.js dependencies
Write-Host "Installing Node.js dependencies..."
npm install

# Set up Python environment (if Python is installed)
if (Get-Command python -ErrorAction SilentlyContinue) {
    Write-Host "Installing Python dependencies..."
    pip install -r requirements.txt
} else {
    Write-Host "Python not found. Skipping Python setup."
}

# Create a basic README if it doesn't exist
if (-not (Test-Path "README.md")) {
    Write-Host "Creating README.md"
    @"
# Surprise Granite AI Tools

AI-powered chatbot and tools for countertop estimations and remodeling services.

## Features

- Interactive AI chatbot with countertop expertise
- Material comparison and visualization
- Cost estimation tools
- Quote generation
- Offline support via PWA

## Setup

### Prerequisites
- Node.js v18+
- Python 3.8+
- MongoDB

### Installation

1. Clone the repository
2. Run \`npm install\`
3. Run \`pip install -r requirements.txt\`
4. Create a \`.env\` file with your configuration

### Development

- \`npm run dev\` - Start development server
- \`npm start\` - Start production server

## License

MIT
"@ | Out-File -FilePath "README.md" -Encoding utf8
}

# Setup complete
Write-Host "Setup complete! You can now run 'npm run dev' to start the development server."
