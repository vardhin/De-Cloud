#!/bin/bash

BASE_URL="http://localhost:8765"

echo "1. Create database with table and columns"
curl -s -X POST "$BASE_URL/database/create" \
  -H "Content-Type: application/json" \
  -d '{
    "schema": {
      "name": "schematestdb",
      "tables": [
        {
          "name": "table1",
          "columns": [
            { "name": "id", "type": "INT" },
            { "name": "username", "type": "VARCHAR" }
          ]
        }
      ]
    }
  }' | jq

echo "2. Check schema for table1 (should list columns)"
curl -s "$BASE_URL/database/schematestdb/table1/schema" | jq

echo "3. Add a new table with columns"
curl -s -X POST "$BASE_URL/database/schematestdb/table" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "table2",
    "columns": [
      { "name": "email", "type": "TEXT" },
      { "name": "created_at", "type": "DATETIME" }
    ]
  }' | jq

echo "4. Check schema for table2 (should list columns)"
curl -s "$BASE_URL/database/schematestdb/table2/schema" | jq

echo "5. Add a table with no columns"
curl -s -X POST "$BASE_URL/database/schematestdb/table" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "emptytable",
    "columns": []
  }' | jq

echo "6. Check schema for emptytable (should be empty array)"
curl -s "$BASE_URL/database/schematestdb/emptytable/schema" | jq
