import csv
import os
import re
from pymongo import MongoClient

CSV_FILE = "countertop_images.csv"
OUTPUT_DIR = "countertop_images"
MONGO_URI = "mongodb://localhost:27017"
DB_NAME = "countertops"
COLLECTION_NAME = "images"

def sanitize_filename(name):
    return re.sub(r'[^a-zA-Z0-9\-]', '_', name.lower())

def get_file_extension(url):
    return os.path.splitext(url)[1].lower()

def insert_into_mongodb():
    client = MongoClient(MONGO_URI)
    db = client[DB_NAME]
    collection = db[COLLECTION_NAME]
    collection.drop()
    print(f"Dropped collection {COLLECTION_NAME} in database {DB_NAME}")

    with open(CSV_FILE, "r", encoding="utf-8") as f:
        reader = csv.reader(f)
        headers = next(reader)
        row_count = 0
        for row in reader:
            if len(row) < 8:
                print(f"Skipping invalid row: {row}")
                continue
            row_count += 1
            product_name = sanitize_filename(row[2])
            scene_ext = get_file_extension(row[0])
            closeup_ext = get_file_extension(row[1])
            scene_filename = f"{product_name}_scene{scene_ext}"
            closeup_filename = f"{product_name}_closeup{closeup_ext}"
            scene_path = os.path.join(OUTPUT_DIR, scene_filename)
            closeup_path = os.path.join(OUTPUT_DIR, closeup_filename)
            document = {
                "product_name": row[2],
                "material": row[3],
                "brand": row[4],
                "veining": row[5],
                "primary_color": row[6],
                "secondary_color": row[7],
                "scene_image_path": scene_path if os.path.exists(scene_path) else None,
                "closeup_image_path": closeup_path if os.path.exists(closeup_path) else None
            }
            collection.insert_one(document)
            print(f"Inserted row {row_count}: {row[2]}")
    
    print(f"Inserted {row_count} documents into {DB_NAME}.{COLLECTION_NAME}")
    client.close()

if __name__ == "__main__":
    insert_into_mongodb()

