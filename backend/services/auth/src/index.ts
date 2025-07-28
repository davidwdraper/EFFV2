import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.AUTH_PORT || 4006;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

// Mock users for demo purposes
const users = [
  { id: '1', username: 'admin', password: 'password', userType: 'admin' },
  { id: '2', username: 'member', password: 'password', userType: 'member' },
];

// POST /auth/login
app.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  const found = users.find(u => u.username === username && u.password === password);

  if (!found) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { username: found.username, userType: found.userType },
    JWT_SECRET,
    { expiresIn: '24h' }
  );

  res.json({ token });
});

// POST /auth/signup
app.post('/auth/signup', (req, res) => {
  const { username, password, userType } = req.body;

  if (users.find(u => u.username === username)) {
    return res.status(409).json({ error: 'Username already taken' });
  }

  const newUser = {
    id: String(users.length + 1),
    username,
    password,
    userType: userType || 'member',
  };

  users.push(newUser);
  res.status(201).json({ message: 'User created' });
});

app.listen(PORT, () => {
  console.log(`Auth service running on port ${PORT}`);
});
