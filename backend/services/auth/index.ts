// index.ts
import app from "./src/app";
import { config } from "./src/config";

const PORT = process.env.AUTH_PORT || 4007;

app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);
});
