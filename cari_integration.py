from pymongo import MongoClient
import os

class CARI:
    def __init__(self):
        # MongoDB connection
        self.MONGO_URI = "mongodb://localhost:27017"
        self.DB_NAME = "countertops"
        self.COLLECTION_NAME = "images"
        self.client = MongoClient(self.MONGO_URI)
        self.db = self.client[self.DB_NAME]
        self.collection = self.db[self.COLLECTION_NAME]

    def get_all_countertops(self):
        """Retrieve all countertops from the database."""
        return list(self.collection.find())

    def search_by_material(self, material):
        """Search countertops by material (e.g., Granite, Quartz)."""
        return list(self.collection.find({"material": material}))

    def search_by_brand(self, brand):
        """Search countertops by brand (e.g., MSI Surfaces, Cambria)."""
        return list(self.collection.find({"brand": brand}))

    def search_by_color(self, primary_color=None, secondary_color=None):
        """Search countertops by primary or secondary color."""
        query = {}
        if primary_color:
            query["primary_color"] = primary_color
        if secondary_color:
            query["secondary_color"] = secondary_color
        return list(self.collection.find(query))

    def close_connection(self):
        """Close the MongoDB connection."""
        self.client.close()

# Example usage
if __name__ == "__main__":
    cari = CARI()
    # Example: Get all countertops
    all_countertops = cari.get_all_countertops()
    print(f"Total countertops: {len(all_countertops)}")
    # Example: Search by material
    granite_countertops = cari.search_by_material("Granite")
    print(f"Granite countertops: {len(granite_countertops)}")
    for countertop in granite_countertops[:3]:  # Show first 3
        print(f"- {countertop['product_name']} (Brand: {countertop['brand']})")
    # Example: Search by brand
    msi_countertops = cari.search_by_brand("MSI Surfaces")
    print(f"MSI Surfaces countertops: {len(msi_countertops)}")
    # Example: Search by color
    white_countertops = cari.search_by_color(primary_color="White")
    print(f"White countertops: {len(white_countertops)}")
    cari.close_connection()
