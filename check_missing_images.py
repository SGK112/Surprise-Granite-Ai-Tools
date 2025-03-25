import csv
import os
import re

CSV_FILE = "countertop_images.csv"
OUTPUT_DIR = "countertop_images"

def sanitize_filename(name):
    # Replace invalid characters with underscores
    return re.sub(r'[^a-zA-Z0-9\-]', '_', name.lower())

def check_missing_images():
    # Get list of downloaded files
    downloaded_files = set(os.listdir(OUTPUT_DIR))
    
    # Read the CSV and check for missing files
    with open(CSV_FILE, "r", encoding="utf-8") as f:
        reader = csv.reader(f)
        headers = next(reader)  # Skip the header row
        for row in reader:
            if len(row) < 3:
                print(f"Skipping invalid row: {row}")
                continue
            product_name = sanitize_filename(row[2])
            scene_filename = f"{product_name}_scene.avif"
            closeup_filename = f"{product_name}_closeup.avif"
            if scene_filename not in downloaded_files:
                print(f"Missing: {scene_filename} (URL: {row[0]})")
            if closeup_filename not in downloaded_files:
                print(f"Missing: {closeup_filename} (URL: {row[1]})")

if __name__ == "__main__":
    check_missing_images()
