#!/bin/bash

BASE_URL="http://localhost:8765"
DB="testdb_$RANDOM"
TABLE="users"
NEW_TABLE="customers"
RECORD='{"name":"Alice","email":"alice@example.com"}'
RECORD_ID=""

echo
echo "1. [POST /database/create] Create a new database"
echo "Expected: status=created, database name returned"
curl -s -X POST "$BASE_URL/database/create" -H "Content-Type: application/json" \
  -d "{\"schema\":{\"name\":\"$DB\",\"tables\":[]}}" | tee /tmp/dbtest.out
echo

echo "2. [GET /databases] List all databases"
echo "Expected: databases array includes our new db"
curl -s "$BASE_URL/databases" | tee /tmp/dbtest.out
echo

echo "3. [POST /database/:dbName/table] Add a table"
echo "Expected: success=true, table info returned"
curl -s -X POST "$BASE_URL/database/$DB/table" -H "Content-Type: application/json" \
  -d "{\"name\":\"$TABLE\",\"columns\":[{\"name\":\"name\",\"type\":\"VARCHAR\"},{\"name\":\"email\",\"type\":\"VARCHAR\"}]}" | tee /tmp/dbtest.out
echo

echo "4. [GET /database/:dbName/tables] List tables in database"
echo "Expected: tables array includes our table"
curl -s "$BASE_URL/database/$DB/tables" | tee /tmp/dbtest.out
echo

echo "5. [GET /database/:dbName/:tableName/schema] Get table schema"
echo "Expected: columns array with name/email"
curl -s "$BASE_URL/database/$DB/$TABLE/schema" | tee /tmp/dbtest.out
echo

echo "6. [POST /database/:dbName/:tableName] Insert a record"
echo "Expected: success=true, record returned with id"
curl -s -X POST "$BASE_URL/database/$DB/$TABLE" -H "Content-Type: application/json" \
  -d "$RECORD" | tee /tmp/dbtest.out
RECORD_ID=$(cat /tmp/dbtest.out | grep -o '"id":"[^"]*' | head -n1 | cut -d':' -f2 | tr -d '"')
echo

echo "7. [GET /database/:dbName/:tableName] Get all records"
echo "Expected: records array includes our record"
curl -s "$BASE_URL/database/$DB/$TABLE" | tee /tmp/dbtest.out
echo

echo "8. [PUT /database/:dbName/:tableName/:id] Update a record"
echo "Expected: success=true, updated record returned"
curl -s -X PUT "$BASE_URL/database/$DB/$TABLE/$RECORD_ID" -H "Content-Type: application/json" \
  -d '{"name":"Alice Smith"}' | tee /tmp/dbtest.out
echo

echo "9. [DELETE /database/:dbName/:tableName/:id] Delete a record"
echo "Expected: success=true, id returned"
curl -s -X DELETE "$BASE_URL/database/$DB/$TABLE/$RECORD_ID" | tee /tmp/dbtest.out
echo

echo "10. [PUT /database/:dbName/table/:tableName/rename] Rename table"
echo "Expected: success=true, message about rename"
curl -s -X PUT "$BASE_URL/database/$DB/table/$TABLE/rename" -H "Content-Type: application/json" \
  -d "{\"newName\":\"$NEW_TABLE\"}" | tee /tmp/dbtest.out
echo

echo "11. [DELETE /database/:dbName/table/:tableName] Delete table"
echo "Expected: success=true, message about deletion"
curl -s -X DELETE "$BASE_URL/database/$DB/table/$NEW_TABLE" | tee /tmp/dbtest.out
echo

echo "12. [DELETE /database/:dbName] Delete database"
echo "Expected: success=true, message about deletion"
curl -s -X DELETE "$BASE_URL/database/$DB" | tee /tmp/dbtest.out
echo

echo "All tests completed."
