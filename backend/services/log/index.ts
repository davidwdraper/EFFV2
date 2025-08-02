// index.ts
import app from "./src/app";
import { config } from "./src/config";

app.listen(config.port, () => {
  console.log(`Log service running on port ${config.port}`);
});
