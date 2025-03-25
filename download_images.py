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
        headers = next(reader)
        for row in reader:
            image_url1 = row[0]
            image_url2 = row[1]
            product_name = row[2].replace(" ", "_").lower()
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
