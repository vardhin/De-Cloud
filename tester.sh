#!/bin/bash

BASE_URL="http://localhost:8765"

# 1. Health check
curl -s "$BASE_URL/health" | jq

# 2. Create a database with tables and columns
curl -s -X POST "$BASE_URL/database/create" \
  -H "Content-Type: application/json" \
  -d '{
    "schema": {
      "name": "mydb",
      "tables": [
        {
          "name": "mytable",
          "columns": [
            { "name": "id", "type": "INT" },
            { "name": "name", "type": "VARCHAR" }
          ]
        }
      ]
    }
  }' | jq

# 3. List all databases
curl -s "$BASE_URL/databases" | jq

# 4. Get all tables in a database
curl -s "$BASE_URL/database/mydb/tables" | jq

# 5. Add a new table to the database
curl -s -X POST "$BASE_URL/database/mydb/table" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "secondtable",
    "columns": [
      { "name": "col1", "type": "TEXT" }
    ]
  }' | jq

# 6. Get schema for a table
curl -s "$BASE_URL/database/mydb/mytable/schema" | jq

# 7. Insert a record into a table
curl -s -X POST "$BASE_URL/database/mydb/mytable" \
  -H "Content-Type: application/json" \
  -d '{"id":"1","name":"Alice"}' | jq

# 8. Get all records from a table
curl -s "$BASE_URL/database/mydb/mytable" | jq

# 9. Update a record (replace "1" with actual record id if needed)
curl -s -X PUT "$BASE_URL/database/mydb/mytable/1" \
  -H "Content-Type: application/json" \
  -d '{"name":"Alice Updated"}' | jq

# 10. Delete a record (replace "1" with actual record id if needed)
curl -s -X DELETE "$BASE_URL/database/mydb/mytable/1" | jq

# 11. Get stats
curl -s "$BASE_URL/stats" | jq
