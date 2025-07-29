// index.ts
import app from './src/app';
import { config } from './src/config';

const PORT = process.env.PLACE_PORT || config.port || 4003;

app.listen(PORT, () => {
  console.log(`Place service running on port ${PORT}`);
});
