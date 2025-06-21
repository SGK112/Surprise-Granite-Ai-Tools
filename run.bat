@echo off
TITLE Surprise Granite AI Tools - Run Script

echo Starting Surprise Granite AI Tools...
echo.

REM Check for required software
echo Checking required software...
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js is required but not installed. Please install Node.js and try again.
    goto :end
)

where python >nul 2>&1
if %errorlevel% neq 0 (
    echo Python is required but not installed. Please install Python and try again.
    goto :end
)

REM Check for port conflicts and kill processes if needed
echo Checking for port conflicts...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :3000') do (
    if not "%%a"=="" (
        echo Killing process using port 3000 (PID: %%a)
        taskkill /F /PID %%a >nul 2>&1
    )
)

for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5000') do (
    if not "%%a"=="" (
        echo Killing process using port 5000 (PID: %%a)
        taskkill /F /PID %%a >nul 2>&1
    )
)

REM Install dependencies
echo Installing Node.js dependencies...
call npm install

echo Installing Python dependencies...
call pip install -r requirements.txt

REM Check for .env file
if not exist .env (
    echo Creating .env file template...
    (
        echo OPENAI_API_KEY=your_openai_api_key_here
        echo MONGO_URI=mongodb://localhost:27017
        echo DB_NAME=countertops
        echo COLLECTION_NAME=images
        echo BASE_URL=http://localhost:5000
        echo SHOPIFY_ACCESS_TOKEN=your_shopify_access_token_here
        echo SHOPIFY_SHOP=your_shopify_store_name_here.myshopify.com
        echo EMAIL_USER=your_email_user
        echo EMAIL_PASS=your_email_password
    ) > .env
    echo Please edit the .env file with your actual credentials before continuing.
    goto :end
)

REM Start MongoDB service if installed via MongoDB Community Edition
echo Starting MongoDB service...
net start MongoDB || echo MongoDB may not be installed as a service or already running.

REM Start servers in separate terminals
echo Starting servers...
start cmd /k "title Node.js Server && echo Node.js server starting... && node server.js"
start cmd /k "title Python Flask Server && echo Python Flask server starting... && python app.py"

echo.
echo All services started in separate terminals!
echo Close the terminals to stop the services.

:end
echo.
pause
