import csv
import os
import re

CSV_FILE = "countertop_images.csv"
OUTPUT_DIR = "countertop_images"

def sanitize_filename(name):
    return re.sub(r'[^a-zA-Z0-9\-]', '_', name.lower())

def get_file_extension(url):
    return os.path.splitext(url)[1].lower()

def check_missing_images():
    print(f"Checking for missing images...")
    print(f"CSV file: {CSV_FILE}")
    print(f"Output directory: {OUTPUT_DIR}")

    if not os.path.exists(OUTPUT_DIR):
        print(f"Error: Directory {OUTPUT_DIR} does not exist.")
        return
    downloaded_files = set(f.lower() for f in os.listdir(OUTPUT_DIR))
    print(f"Found {len(downloaded_files)} files in {OUTPUT_DIR}")

    if not os.path.exists(CSV_FILE):
        print(f"Error: CSV file {CSV_FILE} does not exist.")
        return

    with open(CSV_FILE, "r", encoding="utf-8") as f:
        lines = f.readlines()
        total_lines = len(lines) - 1
        print(f"Total lines in CSV (excluding header): {total_lines}")

    with open(CSV_FILE, "r", encoding="utf-8") as f:
        reader = csv.reader(lines)
        headers = next(reader)
        print(f"CSV headers: {headers}")
        row_count = 0
        missing_count = 0
        expected_files = set()
        for row in reader:
            row_count += 1
            print(f"Processing row {row_count}: {row}")
            if len(row) < 3:
                print(f"Skipping invalid row {row_count}: {row}")
                continue
            product_name = sanitize_filename(row[2])
            scene_ext = get_file_extension(row[0])
            closeup_ext = get_file_extension(row[1])
            scene_filename = f"{product_name}_scene{scene_ext}"
            closeup_filename = f"{product_name}_closeup{closeup_ext}"
            print(f"Expected: {scene_filename}, {closeup_filename}")
            expected_files.add(scene_filename.lower())
            expected_files.add(closeup_filename.lower())
            if scene_filename.lower() not in downloaded_files:
                print(f"Missing: {scene_filename} (URL: {row[0]})")
                missing_count += 1
            if closeup_filename.lower() not in downloaded_files:
                print(f"Missing: {closeup_filename} (URL: {row[1]})")
                missing_count += 1
        print(f"Processed {row_count} rows in CSV.")
        print(f"Found {missing_count} missing images.")
        print(f"Expected {len(expected_files)} files.")

    # Print all downloaded files for comparison
    print("\nDownloaded files:")
    for f in sorted(downloaded_files):
        print(f)

if __name__ == "__main__":
    check_missing_images()
