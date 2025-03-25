import csv
import requests
import os

CSV_FILE = "countertop_images.csv"
OUTPUT_DIR = "countertop_images"

def download_images():
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR)
    with open(CSV_FILE, "r", encoding="utf-8") as f:
        reader = csv.reader(f)
        headers = next(reader)  # Skip the header row
        for row in reader:
            if len(row) < 3:  # Ensure the row has at least 3 columns (url1, url2, product name)
                print(f"Skipping invalid row: {row}")
                continue
            image_url1 = row[0]  # First column: product1_image src
            image_url2 = row[1]  # Second column: product1_image src 2
            product_name = row[2].replace(" ", "_").lower()  # Third column: text-size-small (product name)
            for url, suffix in [(image_url1, "scene"), (image_url2, "closeup")]:
                try:
                    response = requests.get(url, stream=True)
                    response.raise_for_status()
                    filename = f"{product_name}_{suffix}{os.path.splitext(url)[1]}"
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
