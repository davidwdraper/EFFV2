import app from './src/app';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 4009;

app.listen(PORT, () => {
  console.log(`eventplace service running on port ${PORT}`);
});
