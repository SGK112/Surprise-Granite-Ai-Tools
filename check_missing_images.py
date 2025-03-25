import csv
import os
import re

CSV_FILE = "countertop_images.csv"
OUTPUT_DIR = "countertop_images"

def sanitize_filename(name):
    # Replace invalid characters with underscores
    return re.sub(r'[^a-zA-Z0-9\-]', '_', name.lower())

def get_file_extension(url):
    # Extract the file extension from the URL
    return os.path.splitext(url)[1].lower()

def check_missing_images():
    print(f"Checking for missing images...")
    print(f"CSV file: {CSV_FILE}")
    print(f"Output directory: {OUTPUT_DIR}")

    # Get list of downloaded files (convert to lowercase for case-insensitive comparison)
    if not os.path.exists(OUTPUT_DIR):
        print(f"Error: Directory {OUTPUT_DIR} does not exist.")
        return
    downloaded_files = set(f.lower() for f in os.listdir(OUTPUT_DIR))
    print(f"Found {len(downloaded_files)} files in {OUTPUT_DIR}")

    # Read the CSV and check for missing files
    if not os.path.exists(CSV_FILE):
        print(f"Error: CSV file {CSV_FILE} does not exist.")
        return
    with open(CSV_FILE, "r", encoding="utf-8") as f:
        reader = csv.reader(f)
        headers = next(reader)  # Skip the header row
        print(f"CSV headers: {headers}")
        row_count = 0
        missing_count = 0
        for row in reader:
            row_count += 1
            print(f"Processing row {row_count}: {row}")
            if len(row) < 3:
                print(f"Skipping invalid row {row_count}: {row}")
                continue
            product_name = sanitize_filename(row[2])
            scene_ext = get_file_extension(row[0])  # Get extension from scene URL
            closeup_ext = get_file_extension(row[1])  # Get extension from closeup URL
            scene_filename = f"{product_name}_scene{scene_ext}"
            closeup_filename = f"{product_name}_closeup{closeup_ext}"
            if scene_filename.lower() not in downloaded_files:
                print(f"Missing: {scene_filename} (URL: {row[0]})")
                missing_count += 1
            if closeup_filename.lower() not in downloaded_files:
                print(f"Missing: {closeup_filename} (URL: {row[1]})")
                missing_count += 1
        print(f"Processed {row_count} rows in CSV.")
        print(f"Found {missing_count} missing images.")

if __name__ == "__main__":
    check_missing_images()
