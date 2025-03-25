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

    def search_by_color
