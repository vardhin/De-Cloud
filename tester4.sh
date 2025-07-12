#!/bin/bash

BASE_URL="http://localhost:8765"

# 1. Create a database
echo "Creating database..."
curl -s -X POST "$BASE_URL/database/create" -H "Content-Type: application/json" -d '{
  "schema": {
    "name": "testdb",
    "tables": [
      {
        "name": "users",
        "columns": [
          { "name": "username", "type": "VARCHAR" },
          { "name": "email", "type": "VARCHAR" }
        ]
      }
    ]
  }
}'
echo -e "\n"

# 2. List all databases
echo "Listing databases..."
curl -s "$BASE_URL/databases"
echo -e "\n"

# 3. Add a new table to the database
echo "Adding table 'products' to database..."
curl -s -X POST "$BASE_URL/database/testdb/table" -H "Content-Type: application/json" -d '{
  "name": "products",
  "columns": [
    { "name": "product_name", "type": "VARCHAR" },
    { "name": "price", "type": "FLOAT" }
  ]
}'
echo -e "\n"

# 4. List all tables in the database
echo "Listing tables in 'testdb'..."
curl -s "$BASE_URL/database/testdb/tables"
echo -e "\n"

# 5. Insert a record into 'users'
echo "Inserting record into 'users'..."
curl -s -X POST "$BASE_URL/database/testdb/users" -H "Content-Type: application/json" -d '{
  "username": "alice",
  "email": "alice@example.com"
}'
echo -e "\n"

# 6. Get all records from 'users'
echo "Fetching records from 'users'..."
curl -s "$BASE_URL/database/testdb/users"
echo -e "\n"

# 7. Update a record in 'users' (replace <RECORD_ID> with actual id)
RECORD_ID=$(curl -s "$BASE_URL/database/testdb/users" | grep -oP '"id":"\K[^"]+')
echo "Updating record $RECORD_ID in 'users'..."
curl -s -X PUT "$BASE_URL/database/testdb/users/$RECORD_ID" -H "Content-Type: application/json" -d '{
  "email": "alice@newdomain.com"
}'
echo -e "\n"

# 8. Delete a record in 'users'
echo "Deleting record $RECORD_ID in 'users'..."
curl -s -X DELETE "$BASE_URL/database/testdb/users/$RECORD_ID"
echo -e "\n"

# 9. Get schema for 'users'
echo "Getting schema for 'users'..."
curl -s "$BASE_URL/database/testdb/users/schema"
echo -e "\n"

# 10. Rename table 'users' to 'members'
echo "Renaming table 'users' to 'members'..."
curl -s -X PUT "$BASE_URL/database/testdb/table/users/rename" -H "Content-Type: application/json" -d '{
  "newName": "members"
}'
echo -e "\n"

# 11. Delete table 'products'
echo "Deleting table 'products'..."
curl -s -X DELETE "$BASE_URL/database/testdb/table/products"
echo -e "\n"

# 12. Delete the database
echo "Deleting database 'testdb'..."
curl -s -X DELETE "$BASE_URL/database/testdb"
echo -e "\n"

echo "All tests completed."
