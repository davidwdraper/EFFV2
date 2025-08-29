// backend/services/template/README.md

# Template Service (Act-style, SOP v4)

**Do not run this folder directly.** Clone it for a new service:

```bash
cp -R backend/services/template backend/services/<service>
find backend/services/<service> -type f -exec sed -i '' 's/Entity/<YourEntity>/g' {} +
find backend/services/<service> -type f -exec sed -i '' 's/entity/<yourEntity>/g' {} +
find backend/services/<service> -type f -exec sed -i '' 's/TEMPLATE_/YOUR_SVC_/g' {} +
```
