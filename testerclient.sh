#!/bin/bash

BASE_URL="http://localhost:8766"
DB_NAME="testdb"
TABLE_NAME="testtable"
RECORD_ID="1"

echo "1. Create database"
curl -s -X POST "$BASE_URL/database/create" -H "Content-Type: application/json" -d '{"schema":{"name":"'"$DB_NAME"'"},"requestedSpace":1000000,"allocatedPeers":[]}' | jq

echo "2. List all databases"
curl -s "$BASE_URL/databases" | jq

echo "3. Add table to database"
curl -s -X POST "$BASE_URL/database/$DB_NAME/table" -H "Content-Type: application/json" -d '{"name":"'"$TABLE_NAME"'","columns":[{"name":"id","type":"int"},{"name":"value","type":"string"}]}' | jq

echo "4. List all tables in database"
curl -s "$BASE_URL/database/$DB_NAME/tables" | jq

echo "5. Insert record"
curl -s -X POST "$BASE_URL/database/$DB_NAME/$TABLE_NAME" -H "Content-Type: application/json" -d '{"id":1,"value":"hello"}' | jq

echo "6. Get all records"
curl -s "$BASE_URL/database/$DB_NAME/$TABLE_NAME" | jq

echo "7. Get table schema"
curl -s "$BASE_URL/database/$DB_NAME/$TABLE_NAME/schema" | jq

echo "8. Update record"
curl -s -X PUT "$BASE_URL/database/$DB_NAME/$TABLE_NAME/$RECORD_ID" -H "Content-Type: application/json" -d '{"value":"world"}' | jq

echo "9. Delete record"
curl -s -X DELETE "$BASE_URL/database/$DB_NAME/$TABLE_NAME/$RECORD_ID" | jq

echo "10. Rename table"
curl -s -X PUT "$BASE_URL/database/$DB_NAME/table/$TABLE_NAME/rename" -H "Content-Type: application/json" -d '{"newName":"newtable"}' | jq

echo "11. Delete table"
curl -s -X DELETE "$BASE_URL/database/$DB_NAME/table/newtable" | jq

echo "12. Delete database"
curl -s -X DELETE "$BASE_URL/database/$DB_NAME" | jq
