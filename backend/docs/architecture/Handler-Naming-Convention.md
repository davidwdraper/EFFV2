Controller handlers naming conventions:

All parts are seperated with a "."

Part 1:
One of:
s2s
db
code
api

Part 2:
if part 1 is s2s:
<service-name>.<endpoint>
if part 1 is db:
<dbName>.<collectionName>
if part 1 is code:
<primaryFunction>
if part 1 is api:
<ApiName> i.e., googlePlaces
