# PowerShell script to clean up the workspace and prepare for deployment

# Define files to remove
$filesToRemove = @(
    "server.backup.js",
    "package.backup.json",
    "*.log"
)

# Define directories to clean
$dirsToClean = @(
    "node_modules",
    "__pycache__",
    ".vscode",
    ".idea",
    ".git/objects/pack",
    "tmp"
)

# Clean up files
foreach ($file in $filesToRemove) {
    Get-ChildItem -Path $file -ErrorAction SilentlyContinue | ForEach-Object {
        Write-Host "Removing file: $_"
        Remove-Item $_ -Force
    }
}

# Clean up directories
foreach ($dir in $dirsToClean) {
    if (Test-Path $dir) {
        Write-Host "Cleaning directory: $dir"
        if ($dir -eq "node_modules" -or $dir -eq "__pycache__") {
            Remove-Item -Path $dir -Recurse -Force
        } else {
            Get-ChildItem -Path $dir -Recurse -Force | Where-Object { !$_.PSIsContainer } | ForEach-Object {
                Remove-Item $_ -Force
            }
        }
    }
}

# Remove merge conflict markers from files
Write-Host "Checking for merge conflict markers..."
$pattern = '(<<<<<<<|=======|>>>>>>>)'
Get-ChildItem -Path . -Recurse -File -Include "*.js","*.html","*.css","*.py","*.json" | 
    Select-String -Pattern $pattern | 
    ForEach-Object {
        Write-Host "Found merge conflicts in: $($_.Path)"
    }

# Check for .env.example and create if it doesn't exist
if (-not (Test-Path ".env.example")) {
    Write-Host "Creating .env.example file"
    @"
OPENAI_API_KEY=your_openai_api_key_here
MONGO_URI=mongodb://localhost:27017
DB_NAME=countertops
COLLECTION_NAME=images
BASE_URL=http://localhost:5000
SHOPIFY_ACCESS_TOKEN=your_shopify_access_token_here
SHOPIFY_SHOP=your_shopify_store_name_here.myshopify.com
EMAIL_USER=your_email_user
EMAIL_PASS=your_email_password
"@ | Out-File -FilePath ".env.example" -Encoding utf8
}

# Create a clean version of server.js if needed
if ((Test-Path "server.js") -and (Test-Path "server.clean.js")) {
    $serverContent = Get-Content -Path "server.js" -Raw
    if ($serverContent -match $pattern) {
        Write-Host "Replacing server.js with clean version..."
        Copy-Item -Path "server.clean.js" -Destination "server.js" -Force
    }
}

Write-Host "Cleanup complete!"
