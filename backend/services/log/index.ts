// index.ts
import app from "./src/app";
import { config } from "./src/config";

const PORT = process.env.LOG_PORT || config.port || 4006;

app.listen(PORT, () => {
  console.log(`Log service running on port ${PORT}`);
});
