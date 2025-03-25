import csv
import requests
import os
import re

CSV_FILE = "countertop_images.csv"
OUTPUT_DIR = "countertop_images"

def sanitize_filename(name):
    # Replace invalid characters with underscores
    return re.sub(r'[^a-zA-Z0-9\-]', '_', name.lower())

def download_images():
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)

    # Get list of already downloaded files to skip them
    downloaded_files = set(os.listdir(OUTPUT_DIR))

    with open(CSV_FILE, "r", encoding="utf-8") as f:
        reader = csv.reader(f)
        headers = next(reader)  # Skip the header row
        total_rows = sum(1 for _ in reader)  # Count total rows
        f.seek(0)  # Reset file pointer
        next(reader)  # Skip header again
        for i, row in enumerate(reader, 1):
            if len(row) < 3:  # Ensure the row has at least 3 columns
                print(f"Skipping invalid row {i}/{total_rows}: {row}")
                continue
            image_url1 = row[0]
            image_url2 = row[1]
            product_name = sanitize_filename(row[2])  # Sanitize the product name
            print(f"Processing row {i}/{total_rows}: {product_name}")
            for url, suffix in [(image_url1, "scene"), (image_url2, "closeup")]:
                filename = f"{product_name}_{suffix}{os.path.splitext(url)[1]}"
                if filename in downloaded_files:
                    print(f"Skipping already downloaded: {filename}")
                    continue
                try:
                    response = requests.get(url, stream=True)
                    response.raise_for_status()
                    filepath = os.path.join(OUTPUT_DIR, filename)
                    with open(filepath, "wb") as img_file:
                        for chunk in response.iter_content(chunk_size=8192):
                            if chunk:
                                img_file.write(chunk)
                    print(f"Downloaded: {filename}")
                except Exception as e:
                    print(f"Error downloading {url}: {e}")

if __name__ == "__main__":
    download_images()
