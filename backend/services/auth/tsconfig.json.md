// backend/services/auth/tsconfig.json (replace)
{
"extends": "../../../tsconfig.base.json",
"compilerOptions": {
"baseUrl": "../../../",
"rootDir": "src",
"outDir": "dist",
"composite": true
},
"include": [
"src/**/*",
"../shared/src/http/handlers/db.readExisting.ts",
"../shared/src/http/handlers/db.update.ts"
],
"exclude": ["dist", "node_modules"],
"references": [{ "path": "../shared" }]
}
