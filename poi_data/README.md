# POI Data Files

This directory contains CSV files for "Recharge and Work" POI markers on the map.

## Required Files

### mcdonalds.csv
Download from: https://data-m8.com/products/free-list-of-all-mcdonalds-locations-in-the-us-csv-and-json

Expected columns (order matters):
```
longitude,latitude,name,address,city,state,phone
```

Or use the data-m8 format with these columns:
```
store_brand,store_id,store_name,street_address,city,state_code,state_name,country_name,country_code,postal_code,phone_number,latitude,longitude,store_url,open_hours,open_hours_drive_through
```

### starbucks.csv
Download from: https://www.kaggle.com/datasets/omarsobhy14/starbucks-store-location-2023

Expected columns will be detected automatically. Common formats supported:
- `longitude,latitude,name,address,city,state`
- Kaggle format with Brand, Store Number, Store Name, etc.

## Distance Filters

- **McDonald's**: Shows locations within 2 miles of the route
- **Starbucks**: Shows locations within 5 miles of the route

These are hardcoded in the backend to keep the map uncluttered while still showing convenient stops.
